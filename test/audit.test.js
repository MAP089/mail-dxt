import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Der Log-Pfad hängt an homedir() und wird beim Import von config.js festgelegt.
const home = await mkdtemp(join(tmpdir(), "mail-dxt-test-"));
process.env.HOME = home;

const { writeAuditLog } = await import("../server/audit.js");
const { AUDIT_LOG_PATH, AUDIT } = await import("../server/config.js");

async function lastEntry() {
  const lines = (await readFile(AUDIT_LOG_PATH, "utf8")).trim().split("\n");
  return JSON.parse(lines.at(-1));
}

test("Audit: liegt im Test-Home, nicht im echten", () => {
  assert.ok(AUDIT_LOG_PATH.startsWith(home));
});

test("Audit: Entwurfstext wird nur als Länge protokolliert", async () => {
  await writeAuditLog("mail_compose_draft", { body: "streng vertraulich", subject: "S" }, "success");
  const raw = await readFile(AUDIT_LOG_PATH, "utf8");
  assert.ok(!raw.includes("streng vertraulich"));
  assert.equal((await lastEntry()).params.body, "[18 Zeichen]");
});

test("Audit: lange Betreffs werden gekürzt", async () => {
  const subject = "x".repeat(AUDIT.subject_max_length + 50);
  await writeAuditLog("mail_compose_draft", { subject }, "success");
  const logged = (await lastEntry()).params.subject;
  assert.equal(logged, "x".repeat(AUDIT.subject_max_length) + "…");
});

test("Audit: Datei und Ordner sind nur für den Nutzer zugänglich", async () => {
  if (process.platform === "win32") return;
  assert.equal((await stat(AUDIT_LOG_PATH)).mode & 0o777, 0o600);
  assert.equal((await stat(join(AUDIT_LOG_PATH, ".."))).mode & 0o777, 0o700);
});

test("Audit: ab der Maximalgröße wird nach .1 rotiert", async () => {
  await writeFile(AUDIT_LOG_PATH, "x".repeat(AUDIT.max_bytes));
  await writeAuditLog("mail_list_accounts", {}, "success");
  assert.equal((await stat(`${AUDIT_LOG_PATH}.1`)).size, AUDIT.max_bytes);
  assert.ok((await stat(AUDIT_LOG_PATH)).size < 1000, "neues Log beginnt klein");
});

test("Audit: parallele Aufrufe behalten ihre Reihenfolge", async () => {
  await Promise.all([1, 2, 3].map((n) => writeAuditLog("t", { n }, "success")));
  const lines = (await readFile(AUDIT_LOG_PATH, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.slice(-3).map((e) => e.params.n), [1, 2, 3]);
});
