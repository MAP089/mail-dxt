import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Audit-Log-Pfad hängt von HOME ab und wird beim Import von config.js festgelegt.
const home = await mkdtemp(join(tmpdir(), "mail-dxt-test-"));
process.env.HOME = home;

const { buildDeleteToTrash, validateScript } = await import("../server/applescript.js");
const { redactParams, writeAuditLog } = await import("../server/audit.js");
const { TRASH_MAILBOX_NAMES } = await import("../server/config.js");

test("Papierkorb: bekannte Namen (u. a. deutsch) werden probiert", () => {
  const script = buildDeleteToTrash("iCloud", "INBOX", 42);
  for (const name of ["Trash", "Papierkorb", "Gelöschte Objekte", "Deleted Messages"]) {
    assert.ok(script.includes(`"${name}"`), `${name} fehlt im Skript`);
  }
  assert.ok(script.includes("first message of targetMailbox whose id is 42"));
  assert.ok(script.includes("MAIL_DXT_TRASH_MAILBOX"), "Fehlermeldung nennt die Einstellung");
});

test("Papierkorb: Skript besteht den Sicherheitsfilter und ist nur ein Verschieben", () => {
  const script = buildDeleteToTrash("iCloud", "INBOX", 42);
  assert.doesNotThrow(() => validateScript(script));
  assert.ok(script.includes("move m to trashMailbox"));
  assert.ok(!/\bdelete\b/.test(script), "darf nie permanent löschen");
});

test("Papierkorb: Anführungszeichen in Kontonamen werden escaped", () => {
  const script = buildDeleteToTrash('a" & (do shell script "x") & "', "INBOX", 1);
  // Der Name bleibt ein einziger AppleScript-String; die Anführungszeichen sind maskiert.
  assert.ok(script.includes('whose name is "a\\" & (do shell script \\"x\\") & \\""'));
});

test("Papierkorb: MAIL_DXT_TRASH_MAILBOX steht an erster Stelle", () => {
  const out = spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
     'import { TRASH_MAILBOX_NAMES as t } from "./server/config.js"; console.log(JSON.stringify(t));'],
    { env: { ...process.env, MAIL_DXT_TRASH_MAILBOX: "Mein Papierkorb" }, encoding: "utf8" }
  );
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout)[0], "Mein Papierkorb");
  assert.equal(TRASH_MAILBOX_NAMES[0], "Trash");
});

test("Audit: body und query werden nur als Länge protokolliert", () => {
  const r = redactParams({
    account_name: "iCloud",
    subject: "Betreff",
    to: ["a@b.de"],
    body: "geheimer Text",
    query: "suchbegriff",
  });
  assert.equal(r.body, "<13 Zeichen>");
  assert.equal(r.query, "<11 Zeichen>");
  assert.equal(r.subject, "Betreff");
  assert.deepEqual(r.to, ["a@b.de"]);
});

test("Audit: Logdatei enthält keinen Klartext-Body und ist nur für den Nutzer lesbar", async () => {
  await writeAuditLog("mail_compose_draft", { body: "streng vertraulich", subject: "S" }, "success");
  const path = join(home, ".mail-dxt-audit.log");
  const content = await readFile(path, "utf8");
  assert.ok(!content.includes("streng vertraulich"));
  assert.ok(content.includes("<18 Zeichen>"));
  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
});
