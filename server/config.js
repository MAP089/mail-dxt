// Wenn leer = alle Konten erlaubt. Wenn gefüllt = nur diese Konten.
export const ALLOWED_ACCOUNTS = [];

export const LIMITS = {
  subject_max_length: 998,
  body_max_length: 100000,
  body_read_max_length: 50000,
  search_limit_default: 20,
  search_limit_max: 100,
};

export const OSASCRIPT_TIMEOUT_MS =
  Number(process.env.MAIL_DXT_OSASCRIPT_TIMEOUT_MS) || 60000;

export const APPLESCRIPT_INNER_TIMEOUT_S =
  Number(process.env.MAIL_DXT_APPLESCRIPT_TIMEOUT_S) || 50;

export const DEBUG =
  process.env.MAIL_DXT_DEBUG === "1" || process.env.MAIL_DXT_DEBUG === "true";

// Mögliche Namen des Papierkorbs je nach Kontotyp und Systemsprache (in dieser Reihenfolge probiert).
// Eigener Name zuerst über MAIL_DXT_TRASH_MAILBOX.
export const TRASH_MAILBOX_NAMES = [
  ...(process.env.MAIL_DXT_TRASH_MAILBOX ? [process.env.MAIL_DXT_TRASH_MAILBOX] : []),
  "Trash",
  "Deleted Messages",
  "Deleted Items",
  "Papierkorb",
  "Gelöschte Objekte",
  "Gelöschte Elemente",
  "[Gmail]/Trash",
  "[Google Mail]/Papierkorb",
];

// Maximale Anzahl Mails, die mail_search rückwärts durchsucht.
// Verhindert, dass bei extrem großen Mailboxen die Suche endlos läuft.
// Suche bricht ab sobald entweder fetch-limit oder dieser Wert erreicht ist.
export const SEARCH_SCAN_MAX =
  Number(process.env.MAIL_DXT_SEARCH_SCAN_MAX) || 2000;

export const AUDIT_LOG_PATH = `${process.env.HOME}/.mail-dxt-audit.log`;
