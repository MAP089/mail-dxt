import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildSearch } from "../server/applescript.js";

// Führt reines AppleScript ohne Mail.app aus, um das Vergleichsverhalten zu prüfen.
function runPlain(script) {
  return execFileSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8" }).trim();
}

test("Suchtext wird akzent-unabhängig verglichen", () => {
  const script = buildSearch("iCloud", "INBOX", "celine", false, 10);
  assert.match(script, /ignoring diacriticals[\s\S]*does not contain "celine"[\s\S]*end ignoring/);
});

test("ohne Suchtext kein ignoring-Block", () => {
  assert.doesNotMatch(buildSearch("iCloud", "INBOX", "", false, 10), /ignoring diacriticals/);
});

test("AppleScript: ignoring diacriticals findet Céline mit celine", () => {
  assert.equal(runPlain('ignoring diacriticals\nreturn "Céline Marie" contains "celine"\nend ignoring'), "true");
  assert.equal(runPlain('return "Céline Marie" contains "celine"'), "false");
});
