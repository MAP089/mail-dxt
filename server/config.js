import { homedir } from "os";
import { join } from "path";

// Wenn leer = alle Konten erlaubt. Wenn gefüllt = nur diese Konten.
export const ALLOWED_ACCOUNTS = [];

export const LIMITS = {
  subject_max_length: 998,
  body_max_length: 100000,
  body_read_max_length: 50000,
  search_limit_default: 20,
  search_limit_max: 100,
};

// Claude Desktop bricht jeden Tool-Aufruf nach 60s ab (MCP-SDK-Default).
// Beide Timeouts müssen darunter liegen, sonst kommt statt einer
// aussagekräftigen Fehlermeldung nur "Request timed out" beim Client an.
export const OSASCRIPT_TIMEOUT_MS =
  Number(process.env.MAIL_DXT_OSASCRIPT_TIMEOUT_MS) || 50000;

export const APPLESCRIPT_INNER_TIMEOUT_S =
  Number(process.env.MAIL_DXT_APPLESCRIPT_TIMEOUT_S) || 40;

export const DEBUG =
  process.env.MAIL_DXT_DEBUG === "1" || process.env.MAIL_DXT_DEBUG === "true";

// Maximale Anzahl Mails, die mail_search rückwärts durchsucht.
// Verhindert, dass bei extrem großen Mailboxen die Suche endlos läuft.
// Suche bricht ab sobald entweder fetch-limit oder dieser Wert erreicht ist.
export const SEARCH_SCAN_MAX =
  Number(process.env.MAIL_DXT_SEARCH_SCAN_MAX) || 2000;

// Üblicher Ort für Logs unter macOS – damit auch in der Konsole-App sichtbar.
export const AUDIT_LOG_PATH = join(homedir(), "Library", "Logs", "mail-dxt", "audit.log");

export const AUDIT = {
  max_bytes: 5 * 1024 * 1024, // danach wird nach audit.log.1 rotiert
  subject_max_length: 100,
};

// Mögliche Namen des Papierkorbs je Konto, in dieser Reihenfolge probiert.
// AppleScript sieht die Ordner pro Konto (nicht "Papierkorb (alle)" aus der Seitenleiste),
// und deren Name hängt von Anbieter und Sprache ab (iCloud: "Deleted Messages",
// GMX: "Gelöscht", Exchange: "Gelöschte Elemente" …).
// "Deleted Messages" zuerst: Mail.app legt den Ordner selbst an und nutzt ihn auch dann,
// wenn ein anderer Client daneben noch einen "Papierkorb" angelegt hat.
export const TRASH_MAILBOX_NAMES = [
  "Deleted Messages",
  "Papierkorb",
  "Trash",
  "Gelöschte Objekte",
  "Gelöschte Elemente",
  "Deleted Items",
  "Gelöscht",
  "Deleted",
  "Bin",
];
