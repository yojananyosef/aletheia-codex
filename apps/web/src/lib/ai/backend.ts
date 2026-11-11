import type {
  CacheEntry,
  RateLimitDecision,
  RateLimits,
  RateLimitStatus,
  RateReservation,
} from "./cache";

export interface AiBackend {
  get(key: string, now?: number): Promise<CacheEntry | null>;
  set(
    key: string,
    entry: CacheEntry,
    ttlMs: number,
    now?: number,
  ): Promise<void>;
  consume(
    identifier: string,
    limits: RateLimits,
    now?: Date,
  ): Promise<RateLimitDecision>;
  status(
    identifier: string,
    limits: RateLimits,
    now?: Date,
  ): Promise<RateLimitStatus>;
  refund(reservation: RateReservation): Promise<void>;
}
