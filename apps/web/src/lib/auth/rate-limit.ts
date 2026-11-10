import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
import { getAuthConfig } from "./config";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();
let redis: Redis | undefined;
let redisKey: string | undefined;

/*
 * INCR + EXPIRE in a single script. The TTL is returned so the caller can
 * send a precise Retry-After header.
 */
const CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {count, ttl}
`;

function getRedis(): Redis | null {
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return null;
  }
  const key = `${url}:${token.slice(0, 8)}`;
  if (!redis || redisKey !== key) {
    redis = new Redis({ url, token });
    redisKey = key;
  }
  return redis;
}

function hashKey(scope: string, identifier: string): string {
  const digest = createHash("sha256")
    .update(`${getAuthConfig().rateSalt}:${scope}:${identifier}`)
    .digest("hex")
    .slice(0, 40);
  return `bibleol:auth:rate:${scope}:${digest}`;
}

function consumeMemory(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number,
): RateLimitResult {
  const current = memory.get(key);
  if (!current || current.expiresAt <= now) {
    memory.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1_000,
    });
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, limit - 1),
    };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.expiresAt - now) / 1_000),
      ),
      remaining: 0,
    };
  }
  current.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, limit - current.count),
  };
}

function pruneMemory(now: number): void {
  if (memory.size < 500) {
    return;
  }
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) {
      memory.delete(key);
    }
  }
}

/**
 * Fixed-window limiter shared through Upstash when available. Auth endpoints
 * are low-traffic, so a fixed window is enough and keeps the Redis script
 * small. If Redis is unavailable the process-local fallback still slows down
 * brute force on a single instance.
 */
export async function consumeAuthRateLimit(options: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { scope, identifier, limit, windowSeconds } = options;
  const key = hashKey(scope, identifier);
  const now = Date.now();

  const client = getRedis();
  if (client) {
    try {
      const result = await client.eval(
        CONSUME_SCRIPT,
        [key],
        [String(windowSeconds)],
      );
      if (Array.isArray(result) && result.length >= 2) {
        const count = Number(result[0]);
        const ttl = Number(result[1]);
        if (count > limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Number.isFinite(ttl) ? ttl : 60),
            remaining: 0,
          };
        }
        return {
          allowed: true,
          retryAfterSeconds: 0,
          remaining: Math.max(0, limit - count),
        };
      }
    } catch (error) {
      console.error(
        `[auth] límite compartido no disponible: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  pruneMemory(now);
  return consumeMemory(key, limit, windowSeconds, now);
}

export function clientIp(
  request: Request,
  socketAddress: string | undefined,
): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (forwarded || realIp || socketAddress?.trim() || "unknown").slice(
    0,
    128,
  );
}
