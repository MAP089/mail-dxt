import { test } from "node:test";
import assert from "node:assert/strict";

const { buildDeleteToTrash, validateScript } = await import("../server/applescript.js");

test("Papierkorb: übliche Namen (u. a. deutsch) werden gesucht", () => {
  const script = buildDeleteToTrash("iCloud", "INBOX", 42);
  for (const name of ["Trash", "Papierkorb", "Gelöschte Objekte", "Deleted Messages"]) {
    assert.ok(script.includes(`"${name}"`), `${name} fehlt im Skript`);
  }
  assert.ok(script.includes("first message of targetMailbox whose id is 42"));
});

test("Papierkorb: Skript besteht den Sicherheitsfilter und verschiebt nur", () => {
  const script = buildDeleteToTrash("iCloud", "INBOX", 42);
  assert.doesNotThrow(() => validateScript(script));
  assert.ok(script.includes("move m to trashMailbox"));
  // Ein "delete" würde je nach Kontoeinstellung endgültig löschen.
  assert.ok(!/^\s*delete\b/m.test(script), "darf nie permanent löschen");
});

test("Papierkorb: ohne Treffer bricht das Skript mit Fehler ab, statt zu raten", () => {
  const script = buildDeleteToTrash("iCloud", "INBOX", 42);
  assert.ok(/if trashMailbox is missing value then error /.test(script));
});

test("Escaping: Anführungszeichen in Kontonamen bleiben im AppleScript-String", () => {
  const script = buildDeleteToTrash('a" & (do shell script "x") & "', "INBOX", 1);
  assert.ok(script.includes('whose name is "a\\" & (do shell script \\"x\\") & \\""'));
});

test("Sicherheitsfilter: blockiert Shell-Zugriff und fremde Anwendungen", () => {
  assert.throws(() => validateScript('tell application "Mail"\ndo shell script "ls"\nend tell'));
  assert.throws(() => validateScript('tell application "Mail"\nend tell\ntell application "Finder"\nend tell'));
  assert.throws(() => validateScript('display dialog "x"'), /muss mit tell application "Mail" beginnen/);
  assert.doesNotThrow(() => validateScript('tell application "Mail"\nreturn 1\nend tell'));
});
