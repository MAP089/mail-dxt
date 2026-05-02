import { appendFile } from "fs/promises";
import { AUDIT_LOG_PATH } from "./config.js";

export async function writeAuditLog(tool, params, status, error = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    tool,
    params,
    status,
    ...(error ? { error: String(error) } : {}),
  };
  try {
    await appendFile(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.error("Audit log write failed:", e);
  }
}
