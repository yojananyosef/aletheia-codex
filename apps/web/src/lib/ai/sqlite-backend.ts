import type { AiBackend } from "./backend";
import type {
  AiStore,
  CacheEntry,
  RateLimitDecision,
  RateLimits,
  RateReservation,
} from "./cache";

/** Adapter for local development and single-instance deployments. */
export class SqliteAiBackend implements AiBackend {
  readonly #store: AiStore;

  constructor(store: AiStore) {
    this.#store = store;
  }

  async get(key: string, now: number = Date.now()): Promise<CacheEntry | null> {
    return this.#store.get(key, now);
  }

  async set(
    key: string,
    entry: CacheEntry,
    ttlMs: number,
    now: number = Date.now(),
  ): Promise<void> {
    this.#store.set(key, entry, ttlMs, now);
  }

  async consume(
    identifier: string,
    limits: RateLimits,
    now: Date = new Date(),
  ): Promise<RateLimitDecision> {
    return this.#store.consume(identifier, limits, now);
  }

  async refund(reservation: RateReservation): Promise<void> {
    this.#store.refund(reservation);
  }
}
