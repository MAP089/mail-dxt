// Wenn leer = alle Konten erlaubt. Wenn gefüllt = nur diese Konten.
export const ALLOWED_ACCOUNTS = [];

export const LIMITS = {
  subject_max_length: 998,
  body_max_length: 100000,
  body_read_max_length: 50000,
  search_limit_default: 20,
  search_limit_max: 100,
};

export const OSASCRIPT_TIMEOUT_MS = 30000;

export const AUDIT_LOG_PATH = `${process.env.HOME}/.mail-dxt-audit.log`;
