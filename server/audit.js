import { appendFile } from "fs/promises";
import { AUDIT_LOG_PATH } from "./config.js";

// Inhalte, die nicht im Klartext ins Log sollen: nur die Länge wird protokolliert.
const REDACTED_KEYS = new Set(["body", "query"]);

export function redactParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] =
      REDACTED_KEYS.has(key) && typeof value === "string"
        ? `<${value.length} Zeichen>`
        : value;
  }
  return out;
}

export async function writeAuditLog(tool, params, status, error = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    tool,
    params: redactParams(params),
    status,
    ...(error ? { error: String(error) } : {}),
  };
  try {
    // mode gilt nur beim Anlegen der Datei: nur der Nutzer darf lesen/schreiben
    await appendFile(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (e) {
    console.error("Audit log write failed:", e);
  }
}
