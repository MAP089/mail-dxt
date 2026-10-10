// In-Memory-Cache mit Time-to-Live (TTL).
// Vermeidet wiederholte AppleScript-Calls für selten ändernde Daten
// wie Konten- und Mailbox-Listen.
//
// Cache ist prozesslokal — nach Server-Neustart leer.

const DEFAULT_TTL_MS =
  Number(process.env.MAIL_DXT_CACHE_TTL_MS) || 60000;

export class TTLCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

// Zwei Caches, die wir im Server brauchen.
// Beide nutzen die gleiche Default-TTL (60 s, via Env überschreibbar).
export const accountsCache = new TTLCache();
export const mailboxesCache = new TTLCache();
