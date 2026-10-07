import { execFile } from "child_process";
import {
  OSASCRIPT_TIMEOUT_MS,
  APPLESCRIPT_INNER_TIMEOUT_S,
  DEBUG,
} from "./config.js";
import { writeAuditLog } from "./audit.js";

// Das asynchrone execFile kennt keine "input"-Option (die gibt es nur bei
// execFileSync/spawnSync). Ohne explizites Schreiben + Schließen von stdin
// wartet "osascript -" endlos auf das Skript und läuft in den Timeout.
function execOsascript(script) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/usr/bin/osascript",
      ["-"],
      { timeout: OSASCRIPT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
    // EPIPE o.ä., falls osascript vorzeitig endet – der Fehler kommt über den Callback.
    child.stdin.on("error", () => {});
    child.stdin.end(script, "utf8");
  });
}

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

function validateScript(script) {
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

export async function runAppleScript(script) {
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

  try {
    const { stdout } = await execOsascript(wrapped);
    return stdout.trim();
  } catch (err) {
    const stderr = (err.stderr || "").toString().trim();
    const stdout = (err.stdout || "").toString().trim();
    const killed = !!err.killed;
    const code = err.code;
    const signal = err.signal;

    if (DEBUG) {
      await writeAuditLog(
        "runAppleScript",
        {
          node_timeout_ms: OSASCRIPT_TIMEOUT_MS,
          applescript_timeout_s: APPLESCRIPT_INNER_TIMEOUT_S,
          script: wrapped,
          stderr,
          stdout,
          killed,
          code,
          signal,
        },
        "error",
        "osascript failed (debug)"
      );
    }

    const killedStr = killed ? " [TIMEOUT/KILLED]" : "";
    const codeStr = code !== undefined ? ` (exit ${code})` : "";
    const sigStr = signal ? ` (signal ${signal})` : "";
    throw new Error(
      `osascript failed${codeStr}${sigStr}${killedStr}: stderr="${stderr}" stdout="${stdout}"${errorHint(stderr, killed)}`
    );
  }
}

export function buildListAccounts() {
  return `tell application "Mail"
  set accountNames to {}
  repeat with a in accounts
    set end of accountNames to name of a
  end repeat
  set AppleScript's text item delimiters to linefeed
  set resultText to accountNames as text
  set AppleScript's text item delimiters to ""
  return resultText
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
  set AppleScript's text item delimiters to linefeed
  set resultText to mbNames as text
  set AppleScript's text item delimiters to ""
  return resultText
end tell`;
}

export function buildSearch(account_name, mailbox_name, query, unread_only, limit) {
  const acc = escapeAppleScript(account_name);
  const mb = escapeAppleScript(mailbox_name);
  const q = query ? escapeAppleScript(query) : "";

  let filterCondition = "";
  if (unread_only && q) {
    filterCondition = `(read status is false) and (subject contains "${q}" or sender contains "${q}")`;
  } else if (unread_only) {
    filterCondition = `read status is false`;
  } else if (q) {
    filterCondition = `(subject contains "${q}" or sender contains "${q}")`;
  }

  // Ohne Filter nur die ersten N Mails holen statt Referenzen auf die ganze
  // Mailbox – bei großen Postfächern sonst ein sicherer Timeout.
  const selectMessages = filterCondition
    ? `set allMessages to (messages of targetMailbox whose ${filterCondition})`
    : `set msgTotal to count of messages of targetMailbox
  if msgTotal > ${limit} then set msgTotal to ${limit}
  if msgTotal > 0 then
    set allMessages to messages 1 thru msgTotal of targetMailbox
  else
    set allMessages to {}
  end if`;

  return `tell application "Mail"
  set targetAccount to first account whose name is "${acc}"
  set targetMailbox to first mailbox of targetAccount whose name is "${mb}"
  ${selectMessages}
  set resultList to {}
  set msgCount to count of allMessages
  set fetchCount to ${limit}
  if msgCount < fetchCount then set fetchCount to msgCount
  repeat with i from 1 to fetchCount
    set m to item i of allMessages
    set msgId to id of m
    set msgSubject to subject of m
    set msgSender to sender of m
    set msgDate to date sent of m as string
    set msgRead to read status of m
    set end of resultList to (msgId as string) & "|||" & msgSubject & "|||" & msgSender & "|||" & msgDate & "|||" & (msgRead as string)
  end repeat
  set AppleScript's text item delimiters to linefeed
  set resultText to resultList as text
  set AppleScript's text item delimiters to ""
  return resultText
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
