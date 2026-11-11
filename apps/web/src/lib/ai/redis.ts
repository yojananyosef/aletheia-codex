import { Redis } from "@upstash/redis";
import type { AiBackend } from "./backend";
import {
  dayKey,
  minuteKey,
  secondsUntilNextMinute,
  secondsUntilUtcTomorrow,
  utcTomorrow,
  type CacheEntry,
  type RateLimitDecision,
  type RateLimitReason,
  type RateLimits,
  type RateLimitStatus,
  type RateReservation,
} from "./cache";

const CACHE_PREFIX = "bibleol:ai:cache:";
const USAGE_PREFIX = "bibleol:ai:usage";

/*
 * Check the three counters and increment them in one Redis script so two
 * concurrent requests cannot overshoot a limit. Daily keys expire after the
 * UTC day; the burst key expires after the current minute.
 */
const CONSUME_SCRIPT = `
local userCount = tonumber(redis.call("GET", KEYS[1]) or "0")
local globalCount = tonumber(redis.call("GET", KEYS[2]) or "0")
local burstCount = tonumber(redis.call("GET", KEYS[3]) or "0")
local userLimit = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local burstLimit = tonumber(ARGV[3])

if userCount >= userLimit then
  return {0, "user-daily", userCount}
end
if globalCount >= globalLimit then
  return {0, "global-daily", globalCount}
end
if burstCount >= burstLimit then
  return {0, "burst", burstCount}
end

local userNext = redis.call("INCR", KEYS[1])
if userNext == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[4])
end
local globalNext = redis.call("INCR", KEYS[2])
if globalNext == 1 then
  redis.call("EXPIRE", KEYS[2], ARGV[4])
end
local burstNext = redis.call("INCR", KEYS[3])
if burstNext == 1 then
  redis.call("EXPIRE", KEYS[3], ARGV[5])
end

return {1, "", userLimit - userCount - 1}
`;

const REFUND_SCRIPT = `
local userCount = tonumber(redis.call("GET", KEYS[1]) or "0")
if userCount > 0 then
  redis.call("DECR", KEYS[1])
end
local globalCount = tonumber(redis.call("GET", KEYS[2]) or "0")
if globalCount > 0 then
  redis.call("DECR", KEYS[2])
end
return 1
`;

function parseConsumeResult(value: unknown): {
  allowed: boolean;
  reason: RateLimitReason;
  remaining: number;
} {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error("Respuesta inesperada del límite de uso en Redis.");
  }
  const allowed = Number(value[0]) === 1;
  const rawReason = String(value[1]);
  const reason: RateLimitReason =
    rawReason === "global-daily" || rawReason === "burst"
      ? rawReason
      : "user-daily";
  const remaining = Number(value[2]);
  return {
    allowed,
    reason,
    remaining: Number.isFinite(remaining) ? remaining : 0,
  };
}

/** Shared, serverless-friendly backend for Vercel and other multi-instance deployments. */
export class RedisAiBackend implements AiBackend {
  readonly #redis: Redis;

  constructor(url: string, token: string) {
    this.#redis = new Redis({ url, token });
  }

  async get(key: string): Promise<CacheEntry | null> {
    const raw = await this.#redis.get<CacheEntry | string>(
      `${CACHE_PREFIX}${key}`,
    );
    if (!raw) {
      return null;
    }
    if (typeof raw === "object") {
      return typeof raw.text === "string" &&
        typeof raw.model === "string" &&
        typeof raw.createdAt === "number"
        ? raw
        : null;
    }
    try {
      const parsed = JSON.parse(raw) as CacheEntry;
      return typeof parsed.text === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    const seconds = Math.max(1, Math.ceil(ttlMs / 1_000));
    await this.#redis.set(`${CACHE_PREFIX}${key}`, entry, {
      ex: seconds,
    });
  }

  async consume(
    identifier: string,
    limits: RateLimits,
    now: Date = new Date(),
  ): Promise<RateLimitDecision> {
    const day = dayKey(now);
    const minute = minuteKey(now);
    const userKey = `${USAGE_PREFIX}:day:${day}:user:${identifier}`;
    const globalKey = `${USAGE_PREFIX}:day:${day}:global`;
    const burstKey = `${USAGE_PREFIX}:minute:${minute}:user:${identifier}`;
    const result = await this.#redis.eval(
      CONSUME_SCRIPT,
      [userKey, globalKey, burstKey],
      [
        String(limits.perUserDaily),
        String(limits.globalDaily),
        String(limits.perUserBurst),
        String(secondsUntilUtcTomorrow(now) + 60),
        String(secondsUntilNextMinute(now) + 5),
      ],
    );
    const parsed = parseConsumeResult(result);
    if (parsed.allowed) {
      return {
        allowed: true,
        reservation: {
          identifier,
          day,
          remaining: Math.max(0, parsed.remaining),
        },
      };
    }
    return {
      allowed: false,
      reason: parsed.reason,
      retryAfterSeconds:
        parsed.reason === "burst"
          ? secondsUntilNextMinute(now)
          : secondsUntilUtcTomorrow(now),
    };
  }

  async status(
    identifier: string,
    limits: RateLimits,
    now: Date = new Date(),
  ): Promise<RateLimitStatus> {
    const day = dayKey(now);
    const userKey = `${USAGE_PREFIX}:day:${day}:user:${identifier}`;
    const raw = await this.#redis.get<number | string>(userKey);
    const used = Math.max(0, Number(raw ?? 0) || 0);
    return {
      used,
      limit: limits.perUserDaily,
      remaining: Math.max(0, limits.perUserDaily - used),
      resetAt: utcTomorrow(now).toISOString(),
    };
  }

  async refund(reservation: RateReservation): Promise<void> {
    const userKey = `${USAGE_PREFIX}:day:${reservation.day}:user:${reservation.identifier}`;
    const globalKey = `${USAGE_PREFIX}:day:${reservation.day}:global`;
    await this.#redis.eval(REFUND_SCRIPT, [userKey, globalKey], []);
  }
}
