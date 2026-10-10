import { execFile } from "child_process";
import { promisify } from "util";
import {
  OSASCRIPT_TIMEOUT_MS,
  APPLESCRIPT_INNER_TIMEOUT_S,
  DEBUG,
  LIMITS,
  SEARCH_SCAN_MAX,
} from "./config.js";
import { writeAuditLog } from "./audit.js";

const execFileAsync = promisify(execFile);

// --- Retry-Konfiguration ---
const MAX_RETRIES = Number(process.env.MAIL_DXT_MAX_RETRIES) || 3;
const RETRY_BASE_DELAY_MS = Number(process.env.MAIL_DXT_RETRY_BASE_DELAY_MS) || 1000;

// Fehlermuster, die typischerweise transient sind (Mail.app kurz busy, startet gerade)
const RETRYABLE_ERROR_PATTERNS = [
  /not\s+responding/i,
  /connection.*invalid/i,
  /lost\s+connection/i,
  /busy/i,
];

function isRetryableError(err) {
  // Timeouts (Node-Kill oder AppleEvent timed out) werden NICHT wiederholt:
  // Sie haben das Zeitbudget schon verbraucht, ein Retry vervielfacht nur die Wartezeit.
  if (err.killed === true || err.signal === "SIGTERM") return false;
  const stderr = (err.stderr || "").toString();
  return RETRYABLE_ERROR_PATTERNS.some((p) => p.test(stderr));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Eindeutiger Separator zwischen Listen-Items.
// Wird im AppleScript via `text item delimiters` gesetzt und in Node zum Splitten genutzt.
export const LIST_SEPARATOR = "|||ITEM|||";

function errorHint(stderr, killed) {
  if (killed) {
    return ` – Abbruch nach ${OSASCRIPT_TIMEOUT_MS / 1000}s. Läuft Mail.app? Wartet ein macOS-Dialog (Automation-Berechtigung) auf Bestätigung?`;
  }
  if (stderr.includes("-1743")) {
    return " – Keine Automation-Berechtigung: Systemeinstellungen → Datenschutz & Sicherheit → Automation → Claude → Mail aktivieren.";
  }
  if (stderr.includes("-1712")) {
    return ` – Mail.app hat nicht innerhalb von ${APPLESCRIPT_INNER_TIMEOUT_S}s geantwortet.`;
  }
  return "";
}

const BLOCKED_PATTERNS = [
  /do\s+shell\s+script/i,
  /tell\s+application\s+"(?!Mail")[^"]+"/i,
];

function escapeAppleScript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function validateScript(script) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(script)) {
      throw new Error(`Verbotenes Muster im AppleScript gefunden: ${pattern}`);
    }
  }
  if (!script.trimStart().startsWith('tell application "Mail"')) {
    throw new Error('AppleScript muss mit tell application "Mail" beginnen.');
  }
}

function wrapWithTimeout(script) {
  return `with timeout of ${APPLESCRIPT_INNER_TIMEOUT_S} seconds\n${script}\nend timeout`;
}

// retry: false für schreibende Aktionen – ein Fehler heißt dort nicht sicher,
// dass Mail die Aktion nicht doch ausgeführt hat (sonst z. B. doppelte Entwürfe).
export async function runAppleScript(script, { retry = true } = {}) {
  validateScript(script);
  const wrapped = wrapWithTimeout(script);

  if (DEBUG) {
    await writeAuditLog(
      "runAppleScript",
      {
        node_timeout_ms: OSASCRIPT_TIMEOUT_MS,
        applescript_timeout_s: APPLESCRIPT_INNER_TIMEOUT_S,
        script: wrapped,
      },
      "debug"
    );
  }

  const maxAttempts = retry ? MAX_RETRIES : 1;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const run = execFileAsync("/usr/bin/osascript", ["-"], {
        timeout: OSASCRIPT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      // Das async execFile ignoriert die `input`-Option (gibt es nur bei execFileSync) –
      // ohne explizites Schreiben auf stdin wartet osascript bis zum Timeout.
      // EPIPE o.ä., falls osascript vorzeitig endet – der Fehler kommt über das Promise.
      run.child.stdin.on("error", () => {});
      run.child.stdin.end(wrapped);
      const { stdout } = await run;
      return stdout.trim();
    } catch (err) {
      lastErr = err;
      const stderr = (err.stderr || "").toString().trim();
      const stdout = (err.stdout || "").toString().trim();
      const killed = !!err.killed;
      const code = err.code;
      const signal = err.signal;

      const canRetry = isRetryableError(err) && attempt < maxAttempts;

      if (DEBUG) {
        await writeAuditLog(
          "runAppleScript",
          {
            attempt,
            max_retries: maxAttempts,
            will_retry: canRetry,
            node_timeout_ms: OSASCRIPT_TIMEOUT_MS,
            applescript_timeout_s: APPLESCRIPT_INNER_TIMEOUT_S,
            stderr,
            stdout,
            killed,
            code,
            signal,
          },
          canRetry ? "warn" : "error",
          canRetry ? "transient failure, retrying" : "osascript failed (debug)"
        );
      }

      if (canRetry) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }

      const killedStr = killed ? " [TIMEOUT/KILLED]" : "";
      const codeStr = code !== undefined ? ` (exit ${code})` : "";
      const sigStr = signal ? ` (signal ${signal})` : "";
      throw new Error(
        `osascript failed${codeStr}${sigStr}${killedStr} after ${attempt} attempt(s): stderr="${stderr}" stdout="${stdout}"${errorHint(stderr, killed)}`
      );
    }
  }

  // Unerreichbar, aber Safety-Net falls die Schleife unerwartet beendet:
  throw lastErr ?? new Error("runAppleScript: unbekannter Fehler ohne Versuch");
}

export function buildListAccounts() {
  return `tell application "Mail"
  set accountNames to {}
  repeat with a in accounts
    set end of accountNames to name of a
  end repeat
  set AppleScript's text item delimiters to "${LIST_SEPARATOR}"
  set joinedResult to accountNames as string
  set AppleScript's text item delimiters to {""}
  return joinedResult
end tell`;
}

export function buildListMailboxes(account_name) {
  const acc = escapeAppleScript(account_name);
  return `tell application "Mail"
  set mbNames to {}
  set targetAccount to first account whose name is "${acc}"
  repeat with mb in mailboxes of targetAccount
    set end of mbNames to name of mb
  end repeat
  set AppleScript's text item delimiters to "${LIST_SEPARATOR}"
  set joinedResult to mbNames as string
  set AppleScript's text item delimiters to {""}
  return joinedResult
end tell`;
}

export function buildSearch(account_name, mailbox_name, query, unread_only, limit) {
  const acc = escapeAppleScript(account_name);
  const mb = escapeAppleScript(mailbox_name);
  const q = query ? escapeAppleScript(query) : "";
  const hasQuery = Boolean(q);

  // Manuelle Iteration statt `whose`-Vorfilterung über die ganze Mailbox.
  // - Bricht ab, sobald `fetchLimit` Treffer gefunden wurden ODER
  // - Bricht ab, sobald `scanMax` Mails inspiziert wurden (Cap gegen Endlossuche)
  // - Beginnt beim neuesten Ende der Mailbox: In Mail.app ist message 1 die neueste Mail
  const unreadCheck = unread_only ? `
    try
      if read status of m then set matches to false
    on error
      set matches to false
    end try` : "";

  const queryCheck = hasQuery ? `
    if matches then
      try
        set tmpSubject to subject of m
        set tmpSender to sender of m
        if tmpSubject does not contain "${q}" and tmpSender does not contain "${q}" then
          set matches to false
        end if
      on error
        set matches to false
      end try
    end if` : "";

  return `tell application "Mail"
  set targetAccount to first account whose name is "${acc}"
  set targetMailbox to first mailbox of targetAccount whose name is "${mb}"
  set msgRefs to messages of targetMailbox
  set msgCount to count of msgRefs
  set fetchLimit to ${limit}
  set scanMax to ${SEARCH_SCAN_MAX}
  set resultList to {}
  set found to 0
  set scanned to 0
  set i to 1

  repeat while found < fetchLimit and scanned < scanMax and i ≤ msgCount
    set m to item i of msgRefs
    set matches to true${unreadCheck}${queryCheck}
    if matches then
      try
        set msgId to id of m
        set msgSubject to subject of m
        set msgSender to sender of m
        set msgDate to date sent of m as string
        set msgRead to read status of m
        set end of resultList to (msgId as string) & "|||" & msgSubject & "|||" & msgSender & "|||" & msgDate & "|||" & (msgRead as string)
        set found to found + 1
      end try
    end if
    set i to i + 1
    set scanned to scanned + 1
  end repeat

  set AppleScript's text item delimiters to "${LIST_SEPARATOR}"
  set joinedResult to resultList as string
  set AppleScript's text item delimiters to {""}
  return joinedResult
end tell`;
}

export function buildReadMessage(account_name, mailbox_name, message_id) {
  const acc = escapeAppleScript(account_name);
  const mb = escapeAppleScript(mailbox_name);
  return `tell application "Mail"
  set targetAccount to first account whose name is "${acc}"
  set targetMailbox to first mailbox of targetAccount whose name is "${mb}"
  set m to first message of targetMailbox whose id is ${message_id}
  set msgSubject to subject of m
  set msgSender to sender of m
  set msgDate to date sent of m as string
  set msgBody to content of m
  set msgRecipients to {}
  repeat with r in to recipients of m
    set end of msgRecipients to address of r
  end repeat
  set AppleScript's text item delimiters to ","
  set recipientText to msgRecipients as text
  set AppleScript's text item delimiters to ""
  return msgSubject & "|||" & msgSender & "|||" & msgDate & "|||" & recipientText & "|||" & msgBody
end tell`;
}

export function buildComposeDraft(account_name, to, cc, bcc, subject, body) {
  const acc = escapeAppleScript(account_name);
  const subj = escapeAppleScript(subject);
  const bodyText = escapeAppleScript(body);

  // Jede Empfängerart braucht ihre eigene Klasse (to/cc/bcc recipient).
  const recipientLines = (list, kind) =>
    (list ?? []).map(e => `
    make new ${kind} recipient at end of ${kind} recipients with properties {address:"${escapeAppleScript(e)}"}`).join("");

  // Absender außerhalb von "tell newMsg" auflösen – dort würde "account"
  // als Element der Nachricht gesucht. Konten haben "email addresses", kein "address".
  return `tell application "Mail"
  set senderAccount to first account whose name is "${acc}"
  set senderAddress to first item of (email addresses of senderAccount)
  set newMsg to make new outgoing message with properties {sender:senderAddress, subject:"${subj}", content:"${bodyText}", visible:true}
  tell newMsg${recipientLines(to, "to")}${recipientLines(cc, "cc")}${recipientLines(bcc, "bcc")}
  end tell
  return id of newMsg as string
end tell`;
}

export function buildMoveMessage(account_name, source_mailbox, message_id, target_mailbox) {
  const acc = escapeAppleScript(account_name);
  const src = escapeAppleScript(source_mailbox);
  const tgt = escapeAppleScript(target_mailbox);
  return `tell application "Mail"
  set targetAccount to first account whose name is "${acc}"
  set srcMailbox to first mailbox of targetAccount whose name is "${src}"
  set tgtMailbox to first mailbox of targetAccount whose name is "${tgt}"
  set m to first message of srcMailbox whose id is ${message_id}
  move m to tgtMailbox
  return "ok"
end tell`;
}

// Der Papierkorb heißt je nach Anbieter und Sprache anders (iCloud: "Deleted
// Messages", GMX: "Gelöscht", Exchange: "Gelöschte Elemente" …).
const TRASH_MAILBOX_NAMES = [
  "Trash",
  "Papierkorb",
  "Deleted Messages",
  "Gelöschte Objekte",
  "Deleted Items",
  "Gelöschte Elemente",
  "Gelöscht",
  "Deleted",
  "Bin",
];

export function buildDeleteToTrash(account_name, mailbox_name, message_id) {
  const acc = escapeAppleScript(account_name);
  const mb = escapeAppleScript(mailbox_name);
  const trashNames = TRASH_MAILBOX_NAMES.map(n => `"${escapeAppleScript(n)}"`).join(", ");
  const notFound = escapeAppleScript(
    `Kein Papierkorb-Ordner im Konto gefunden (gesucht: ${TRASH_MAILBOX_NAMES.join(", ")}). ` +
    `Ordner mit mail_list_mailboxes ermitteln und die Mail mit mail_move dorthin verschieben.`
  );
  // Bewusst kein Fallback auf "delete": je nach Kontoeinstellung löscht das endgültig.
  return `tell application "Mail"
  set targetAccount to first account whose name is "${acc}"
  set targetMailbox to first mailbox of targetAccount whose name is "${mb}"
  set m to first message of targetMailbox whose id is ${message_id}
  set trashMailbox to missing value
  repeat with trashName in {${trashNames}}
    set wantedName to contents of trashName
    set candidates to (mailboxes of targetAccount whose name is wantedName)
    if (count of candidates) > 0 then
      set trashMailbox to item 1 of candidates
      exit repeat
    end if
  end repeat
  if trashMailbox is missing value then error "${notFound}"
  move m to trashMailbox
  return name of trashMailbox
end tell`;
}
