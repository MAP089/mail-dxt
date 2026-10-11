import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDeleteToTrash } from "../server/applescript.js";
import { TRASH_MAILBOX_NAMES } from "../server/config.js";
import { validateMessageId, validateMailboxName, validateAccountName } from "../server/validator.js";

// Kompiliert das Script nur (osacompile), führt es aber nicht aus – kein Zugriff auf Mail.app nötig.
function assertCompiles(script) {
  const dir = mkdtempSync(join(tmpdir(), "mail-dxt-test-"));
  try {
    const src = join(dir, "t.applescript");
    writeFileSync(src, script);
    execFileSync("/usr/bin/osacompile", ["-o", join(dir, "t.scpt"), src], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Papierkorb-Script kompiliert", () => {
  assertCompiles(buildDeleteToTrash("iCloud", "INBOX", 42));
});

test("alle Papierkorb-Namen werden probiert, Mail.apps eigener Ordner zuerst", () => {
  const script = buildDeleteToTrash("iCloud", "INBOX", 42);
  for (const name of TRASH_MAILBOX_NAMES) assert.ok(script.includes(`"${name}"`), name);
  assert.equal(TRASH_MAILBOX_NAMES[0], "Deleted Messages");
});

test("Papierkorb wird gesucht, bevor die Mail angefasst wird", () => {
  const script = buildDeleteToTrash("iCloud", "INBOX", 42);
  assert.ok(script.indexOf("trashMailbox is missing value") < script.indexOf("first message of"));
});

test("Escaping von Quotes und Backslashes", () => {
  const script = buildDeleteToTrash('Acc"; delete m --', 'Box\\"x', 1);
  assert.match(script, /name is "Acc\\"; delete m --"/);
  assertCompiles(script);
});

test("kein permanentes delete im Script", () => {
  assert.doesNotMatch(buildDeleteToTrash("a", "b", 1), /\bdelete\b/);
});

test("message_id-Validierung", () => {
  for (const bad of [0, -1, 1.5, "1", "1 or true", NaN, null, undefined]) {
    assert.throws(() => validateMessageId(bad), String(bad));
  }
  validateMessageId(123);
});

test("Konto- und Mailbox-Validierung", () => {
  assert.throws(() => validateMailboxName(""));
  assert.throws(() => validateAccountName("  "));
});
