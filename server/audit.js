import { appendFile, mkdir, rename, stat } from "fs/promises";
import { dirname } from "path";
import { AUDIT_LOG_PATH, AUDIT } from "./config.js";

// Das Audit-Log hält fest, WAS getan wurde – nicht, was in den Mails steht.
function redact(params) {
  if (!params || typeof params !== "object") return params;
  const out = { ...params };
  if (typeof out.body === "string") {
    out.body = `[${out.body.length} Zeichen]`;
  }
  if (typeof out.subject === "string" && out.subject.length > AUDIT.subject_max_length) {
    out.subject = out.subject.slice(0, AUDIT.subject_max_length) + "…";
  }
  return out;
}

async function rotateIfNeeded() {
  try {
    const { size } = await stat(AUDIT_LOG_PATH);
    if (size >= AUDIT.max_bytes) {
      await rename(AUDIT_LOG_PATH, `${AUDIT_LOG_PATH}.1`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

async function append(entry) {
  try {
    await mkdir(dirname(AUDIT_LOG_PATH), { recursive: true, mode: 0o700 });
    await rotateIfNeeded();
    // mode greift beim Anlegen: nur der eigene Benutzer darf lesen/schreiben.
    await appendFile(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch (e) {
    console.error("Audit log write failed:", e);
  }
}

// Schreibvorgänge nacheinander ausführen, damit Rotation und Reihenfolge stimmen.
let queue = Promise.resolve();

export function writeAuditLog(tool, params, status, error = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    tool,
    params: redact(params),
    status,
    ...(error ? { error: String(error) } : {}),
  };
  queue = queue.then(() => append(entry));
  return queue;
}
