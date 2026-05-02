import { execFile } from "child_process";
import { promisify } from "util";
import { OSASCRIPT_TIMEOUT_MS, LIMITS } from "./config.js";

const execFileAsync = promisify(execFile);

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

export async function runAppleScript(script) {
  validateScript(script);
  const { stdout } = await execFileAsync("osascript", ["-"], {
    input: script,
    timeout: OSASCRIPT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

export function buildListAccounts() {
  return `tell application "Mail"
  set accountNames to {}
  repeat with a in accounts
    set end of accountNames to name of a
  end repeat
  return accountNames
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
  return mbNames
end tell`;
}

export function buildSearch(account_name, mailbox_name, query, unread_only, limit) {
  const acc = escapeAppleScript(account_name);
  const mb = escapeAppleScript(mailbox_name);
  const q = query ? escapeAppleScript(query) : "";

  let filterCondition = "";
  if (unread_only && q) {
    filterCondition = `whose (read status is false) and (subject contains "${q}" or sender contains "${q}")`;
  } else if (unread_only) {
    filterCondition = `whose read status is false`;
  } else if (q) {
    filterCondition = `whose (subject contains "${q}" or sender contains "${q}")`;
  }

  return `tell application "Mail"
  set targetAccount to first account whose name is "${acc}"
  set targetMailbox to first mailbox of targetAccount whose name is "${mb}"
  set allMessages to messages ${filterCondition} of targetMailbox
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
  return resultList
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
  return msgSubject & "|||" & msgSender & "|||" & msgDate & "|||" & (msgRecipients as string) & "|||" & msgBody
end tell`;
}

export function buildComposeDraft(account_name, to, cc, bcc, subject, body) {
  const acc = escapeAppleScript(account_name);
  const subj = escapeAppleScript(subject);
  const bodyText = escapeAppleScript(body);

  const toList = to.map(e => `"${escapeAppleScript(e)}"`).join(", ");

  let ccBlock = "";
  if (cc && cc.length > 0) {
    ccBlock = cc.map(e => `
    make new to recipient at end of cc recipients of newMsg with properties {address:"${escapeAppleScript(e)}"}`).join("");
  }

  let bccBlock = "";
  if (bcc && bcc.length > 0) {
    bccBlock = bcc.map(e => `
    make new to recipient at end of bcc recipients of newMsg with properties {address:"${escapeAppleScript(e)}"}`).join("");
  }

  return `tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"${subj}", content:"${bodyText}", visible:true}
  tell newMsg
    set sender to (address of first account whose name is "${acc}")
    repeat with toAddr in {${toList}}
      make new to recipient at end of to recipients with properties {address:toAddr}
    end repeat${ccBlock}${bccBlock}
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

export function buildDeleteToTrash(account_name, mailbox_name, message_id) {
  const acc = escapeAppleScript(account_name);
  const mb = escapeAppleScript(mailbox_name);
  return `tell application "Mail"
  set targetAccount to first account whose name is "${acc}"
  set targetMailbox to first mailbox of targetAccount whose name is "${mb}"
  set m to first message of targetMailbox whose id is ${message_id}
  set trashMailbox to first mailbox of targetAccount whose name is "Trash"
  move m to trashMailbox
  return "ok"
end tell`;
}
