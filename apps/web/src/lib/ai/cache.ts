import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export interface CacheEntry {
  text: string;
  model: string;
  createdAt: number;
}

export interface RateLimits {
  perUserDaily: number;
  perUserBurst: number;
  globalDaily: number;
}

export interface RateReservation {
  identifier: string;
  day: string;
  remaining: number;
}

export type RateLimitReason = "user-daily" | "global-daily" | "burst";

export type RateLimitDecision =
  | { allowed: true; reservation: RateReservation }
  | { allowed: false; reason: RateLimitReason; retryAfterSeconds: number };

interface CacheRow {
  text: string;
  model: string;
  created_at: number;
  expires_at: number;
}

interface UsageRow {
  count: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_cache (
    key TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_usage (
    window_key TEXT NOT NULL,
    scope TEXT NOT NULL,
    identifier TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (window_key, scope, identifier)
  );

  CREATE INDEX IF NOT EXISTS ai_usage_window_idx
    ON ai_usage (window_key);
`;

export function hashIdentifier(value: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${value}`)
    .digest("hex")
    .slice(0, 32);
}

export function cacheKey(parts: {
  model: string;
  prompt: string;
  corpus: string;
  book: string;
  chapter: number;
  from: number;
  to: number;
  mode: string;
}): string {
  const payload = JSON.stringify({
    model: parts.model,
    prompt: parts.prompt,
    corpus: parts.corpus,
    book: parts.book,
    chapter: parts.chapter,
    from: parts.from,
    to: parts.to,
    mode: parts.mode,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function minuteKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}

export function secondsUntilUtcTomorrow(now: Date = new Date()): number {
  const tomorrow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((tomorrow - now.getTime()) / 1000));
}

export function secondsUntilNextMinute(now: Date = new Date()): number {
  return Math.max(1, 60 - now.getUTCSeconds());
}

export class AiStore {
  readonly #database: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.#database = new Database(path);
    this.#database.pragma("busy_timeout = 5000");
    if (path !== ":memory:") {
      this.#database.pragma("journal_mode = WAL");
      this.#database.pragma("synchronous = NORMAL");
    }
    this.#database.exec(SCHEMA);
    this.#prune();
  }

  #prune(now: number = Date.now()): void {
    const cutoff = new Date(now - 3 * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 16);
    this.#database
      .prepare("DELETE FROM ai_cache WHERE expires_at <= ?")
      .run(now);
    this.#database
      .prepare("DELETE FROM ai_usage WHERE window_key < ?")
      .run(cutoff);
  }

  close(): void {
    this.#database.close();
  }

  get(key: string, now: number = Date.now()): CacheEntry | null {
    const row = this.#database
      .prepare(
        "SELECT text, model, created_at, expires_at FROM ai_cache WHERE key = ?",
      )
      .get(key) as CacheRow | undefined;
    if (!row) {
      return null;
    }
    if (row.expires_at <= now) {
      this.#database.prepare("DELETE FROM ai_cache WHERE key = ?").run(key);
      return null;
    }
    return {
      text: row.text,
      model: row.model,
      createdAt: row.created_at,
    };
  }

  set(
    key: string,
    entry: CacheEntry,
    ttlMs: number,
    now: number = Date.now(),
  ): void {
    this.#database
      .prepare(
        `INSERT INTO ai_cache (key, text, model, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           text = excluded.text,
           model = excluded.model,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(key, entry.text, entry.model, entry.createdAt, now + ttlMs);
  }

  delete(key: string): void {
    this.#database.prepare("DELETE FROM ai_cache WHERE key = ?").run(key);
  }

  /**
   * Check and consume a request in one SQLite transaction. This prevents two
   * simultaneous requests from bypassing the daily or burst limit.
   */
  consume(
    identifier: string,
    limits: RateLimits,
    now: Date = new Date(),
  ): RateLimitDecision {
    const day = dayKey(now);
    const minute = minuteKey(now);
    const transaction = this.#database.transaction((): RateLimitDecision => {
      const userDaily = this.#count(day, "user", identifier);
      if (userDaily >= limits.perUserDaily) {
        return {
          allowed: false,
          reason: "user-daily",
          retryAfterSeconds: secondsUntilUtcTomorrow(now),
        };
      }

      const globalDaily = this.#count(day, "global", "global");
      if (globalDaily >= limits.globalDaily) {
        return {
          allowed: false,
          reason: "global-daily",
          retryAfterSeconds: secondsUntilUtcTomorrow(now),
        };
      }

      const burst = this.#count(minute, "burst", identifier);
      if (burst >= limits.perUserBurst) {
        return {
          allowed: false,
          reason: "burst",
          retryAfterSeconds: secondsUntilNextMinute(now),
        };
      }

      this.#increment(day, "user", identifier);
      this.#increment(day, "global", "global");
      this.#increment(minute, "burst", identifier);

      return {
        allowed: true,
        reservation: {
          identifier,
          day,
          remaining: Math.max(0, limits.perUserDaily - userDaily - 1),
        },
      };
    });

    return transaction.immediate();
  }

  /**
   * Give the daily quota back when the provider fails before producing an
   * answer. The burst counter is intentionally not refunded.
   */
  refund(reservation: RateReservation): void {
    const transaction = this.#database.transaction(() => {
      this.#decrement(reservation.day, "user", reservation.identifier);
      this.#decrement(reservation.day, "global", "global");
    });
    transaction.immediate();
  }

  #count(window: string, scope: string, identifier: string): number {
    const row = this.#database
      .prepare(
        `SELECT count FROM ai_usage
         WHERE window_key = ? AND scope = ? AND identifier = ?`,
      )
      .get(window, scope, identifier) as UsageRow | undefined;
    return row?.count ?? 0;
  }

  #increment(window: string, scope: string, identifier: string): void {
    this.#database
      .prepare(
        `INSERT INTO ai_usage (window_key, scope, identifier, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(window_key, scope, identifier) DO UPDATE SET
           count = count + 1`,
      )
      .run(window, scope, identifier);
  }

  #decrement(window: string, scope: string, identifier: string): void {
    this.#database
      .prepare(
        `UPDATE ai_usage
         SET count = MAX(count - 1, 0)
         WHERE window_key = ? AND scope = ? AND identifier = ?`,
      )
      .run(window, scope, identifier);
  }
}
