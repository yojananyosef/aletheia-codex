import { describe, expect, it } from "vitest";
import {
  AiStore,
  cacheKey,
  dayKey,
  minuteKey,
  secondsUntilNextMinute,
  secondsUntilUtcTomorrow,
} from "../src/lib/ai/cache";

const limits = { perUserDaily: 2, perUserBurst: 3, globalDaily: 10 };
const now = new Date("2026-01-01T10:00:00.000Z");

describe("AiStore cache", () => {
  it("stores and expires cached answers", () => {
    const store = new AiStore(":memory:");
    try {
      const key = cacheKey({
        model: "model",
        prompt: "prompt",
        corpus: "ETCBC4",
        book: "Genesis",
        chapter: 1,
        from: 1,
        to: 3,
        mode: "resumen",
      });
      store.set(
        key,
        { text: "hola", model: "model", createdAt: now.getTime() },
        1_000,
        now.getTime(),
      );
      expect(store.get(key, now.getTime() + 500)?.text).toBe("hola");
      expect(store.get(key, now.getTime() + 1_500)).toBeNull();
    } finally {
      store.close();
    }
  });

  it("builds different keys for different passages or modes", () => {
    const base = {
      model: "model",
      prompt: "prompt",
      corpus: "ETCBC4",
      book: "Genesis",
      chapter: 1,
      from: 1,
      to: 3,
    };
    expect(cacheKey({ ...base, mode: "resumen" })).not.toBe(
      cacheKey({ ...base, mode: "explicacion" }),
    );
    expect(cacheKey({ ...base, mode: "resumen" })).not.toBe(
      cacheKey({ ...base, to: 4, mode: "resumen" }),
    );
  });
});

describe("AiStore rate limits", () => {
  it("consumes the daily quota and refunds it on provider failure", () => {
    const store = new AiStore(":memory:");
    try {
      const first = store.consume("user", limits, now);
      const second = store.consume("user", limits, now);
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      if (!first.allowed) throw new Error("expected first request");
      if (!second.allowed) throw new Error("expected second request");
      expect(second.reservation.remaining).toBe(0);

      const third = store.consume("user", limits, now);
      expect(third.allowed).toBe(false);
      if (third.allowed) throw new Error("expected daily limit");
      expect(third.reason).toBe("user-daily");

      store.refund(second.reservation);
      const fourth = store.consume("user", limits, now);
      expect(fourth.allowed).toBe(true);
    } finally {
      store.close();
    }
  });

  it("limits bursts per minute and resets on the next minute", () => {
    const store = new AiStore(":memory:");
    try {
      const burstLimits = {
        perUserDaily: 10,
        perUserBurst: 2,
        globalDaily: 10,
      };
      expect(store.consume("user", burstLimits, now).allowed).toBe(true);
      expect(store.consume("user", burstLimits, now).allowed).toBe(true);
      const third = store.consume("user", burstLimits, now);
      expect(third.allowed).toBe(false);
      if (third.allowed) throw new Error("expected burst limit");
      expect(third.reason).toBe("burst");

      const nextMinute = new Date(now.getTime() + 60_000);
      expect(store.consume("user", burstLimits, nextMinute).allowed).toBe(true);
    } finally {
      store.close();
    }
  });

  it("applies a global daily limit across users", () => {
    const store = new AiStore(":memory:");
    try {
      const globalLimits = {
        perUserDaily: 10,
        perUserBurst: 10,
        globalDaily: 1,
      };
      expect(store.consume("one", globalLimits, now).allowed).toBe(true);
      const second = store.consume("two", globalLimits, now);
      expect(second.allowed).toBe(false);
      if (second.allowed) throw new Error("expected global limit");
      expect(second.reason).toBe("global-daily");
    } finally {
      store.close();
    }
  });
});

describe("time windows", () => {
  it("uses UTC day and minute keys", () => {
    expect(dayKey(now)).toBe("2026-01-01");
    expect(minuteKey(now)).toBe("2026-01-01T10:00");
  });

  it("calculates retry windows", () => {
    expect(secondsUntilNextMinute(now)).toBe(60);
    expect(secondsUntilUtcTomorrow(now)).toBe(14 * 60 * 60);
  });
});
