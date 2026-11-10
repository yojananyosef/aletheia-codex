import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  eval: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = mocks.get;
    set = mocks.set;
    eval = mocks.eval;
  },
}));

import { RedisAiBackend } from "../src/lib/ai/redis";

const entry = { text: "hola", model: "model", createdAt: 1_700_000_000_000 };

beforeEach(() => {
  mocks.get.mockReset();
  mocks.set.mockReset();
  mocks.eval.mockReset();
});

describe("RedisAiBackend cache", () => {
  it("reads object values returned by Upstash", async () => {
    mocks.get.mockResolvedValueOnce(entry);
    const backend = new RedisAiBackend("https://example.com", "token");

    await expect(backend.get("key")).resolves.toEqual(entry);
    expect(mocks.get).toHaveBeenCalledWith("bibleol:ai:cache:key");
  });

  it("also reads legacy JSON strings", async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify(entry));
    const backend = new RedisAiBackend("https://example.com", "token");

    await expect(backend.get("key")).resolves.toEqual(entry);
  });

  it("ignores malformed values", async () => {
    mocks.get.mockResolvedValueOnce("not json");
    const backend = new RedisAiBackend("https://example.com", "token");

    await expect(backend.get("key")).resolves.toBeNull();
  });

  it("stores entries as objects with a TTL", async () => {
    const backend = new RedisAiBackend("https://example.com", "token");

    await backend.set("key", entry, 60_000);

    expect(mocks.set).toHaveBeenCalledWith("bibleol:ai:cache:key", entry, {
      ex: 60,
    });
  });
});

describe("RedisAiBackend limits", () => {
  const limits = { perUserDaily: 15, perUserBurst: 3, globalDaily: 40 };
  const now = new Date("2026-01-01T10:00:00.000Z");

  it("accepts a reservation with the remaining quota", async () => {
    mocks.eval.mockResolvedValueOnce([1, "", 14]);
    const backend = new RedisAiBackend("https://example.com", "token");

    const decision = await backend.consume("user", limits, now);

    expect(decision).toMatchObject({
      allowed: true,
      reservation: { identifier: "user", day: "2026-01-01", remaining: 14 },
    });
    expect(mocks.eval).toHaveBeenCalledTimes(1);
  });

  it("maps a burst denial to a retry window", async () => {
    mocks.eval.mockResolvedValueOnce([0, "burst", 0]);
    const backend = new RedisAiBackend("https://example.com", "token");

    const decision = await backend.consume("user", limits, now);

    expect(decision).toMatchObject({
      allowed: false,
      reason: "burst",
      retryAfterSeconds: 60,
    });
  });

  it("maps a global daily denial to the UTC reset", async () => {
    mocks.eval.mockResolvedValueOnce([0, "global-daily", 0]);
    const backend = new RedisAiBackend("https://example.com", "token");

    const decision = await backend.consume("user", limits, now);

    expect(decision).toMatchObject({
      allowed: false,
      reason: "global-daily",
      retryAfterSeconds: 14 * 60 * 60,
    });
  });

  it("refunds the daily counters", async () => {
    const backend = new RedisAiBackend("https://example.com", "token");

    await backend.refund({
      identifier: "user",
      day: "2026-01-01",
      remaining: 0,
    });

    expect(mocks.eval).toHaveBeenCalledWith(
      expect.any(String),
      [
        "bibleol:ai:usage:day:2026-01-01:user:user",
        "bibleol:ai:usage:day:2026-01-01:global",
      ],
      [],
    );
  });
});
