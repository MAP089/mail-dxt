import { ALLOWED_ACCOUNTS, LIMITS } from "./config.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAccountName(account_name) {
  if (typeof account_name !== "string" || account_name.trim() === "") {
    throw new Error("account_name muss ein nicht-leerer String sein.");
  }
  if (ALLOWED_ACCOUNTS.length > 0 && !ALLOWED_ACCOUNTS.includes(account_name)) {
    throw new Error(`Konto "${account_name}" ist nicht erlaubt.`);
  }
}

export function validateMailboxName(mailbox_name) {
  if (typeof mailbox_name !== "string" || mailbox_name.trim() === "") {
    throw new Error("mailbox_name muss ein nicht-leerer String sein.");
  }
}

export function validateMessageId(message_id) {
  if (typeof message_id !== "number" || !Number.isInteger(message_id) || message_id < 1) {
    throw new Error("message_id muss eine positive ganze Zahl sein.");
  }
}

export function validateEmailAddress(email) {
  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    throw new Error(`Ungültige E-Mail-Adresse: "${email}"`);
  }
}

export function validateEmailList(list, fieldName) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${fieldName} muss ein nicht-leeres Array von E-Mail-Adressen sein.`);
  }
  for (const email of list) {
    validateEmailAddress(email);
  }
}

export function validateSubject(subject) {
  if (typeof subject !== "string" || subject.trim() === "") {
    throw new Error("subject muss ein nicht-leerer String sein.");
  }
  if (subject.length > LIMITS.subject_max_length) {
    throw new Error(`subject darf maximal ${LIMITS.subject_max_length} Zeichen lang sein.`);
  }
}

export function validateBody(body) {
  if (typeof body !== "string") {
    throw new Error("body muss ein String sein.");
  }
  if (body.length > LIMITS.body_max_length) {
    throw new Error(`body darf maximal ${LIMITS.body_max_length} Zeichen lang sein.`);
  }
}

export function validateSearchLimit(limit) {
  if (limit === undefined || limit === null) return LIMITS.search_limit_default;
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("limit muss eine positive ganze Zahl sein.");
  }
  return Math.min(n, LIMITS.search_limit_max);
}
