import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAuthConfigForTests } from "../src/lib/auth/config";
import {
  createCsrfToken,
  isSameOriginRequest,
  verifyCsrfToken,
} from "../src/lib/auth/csrf";
import { consumeAuthRateLimit } from "../src/lib/auth/rate-limit";
import { safeNextPath } from "../src/lib/auth/session";
import {
  isValidEmail,
  normalizeEmail,
  passwordIssue,
} from "../src/lib/auth/validation";

function configure(): void {
  vi.stubEnv("AUTH_CSRF_SECRET", "test-csrf-secret");
  vi.stubEnv("AUTH_RATE_SALT", "test-rate-salt");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  resetAuthConfigForTests();
}

afterEach(() => {
  resetAuthConfigForTests();
  vi.unstubAllEnvs();
});

describe("CSRF", () => {
  it("accepts a fresh token and rejects a tampered one", () => {
    configure();
    const token = createCsrfToken();
    expect(verifyCsrfToken(token)).toBe(true);
    expect(verifyCsrfToken(`${token}x`)).toBe(false);
    expect(
      verifyCsrfToken(token.replace(/^\d+/, String(Date.now() + 60_000))),
    ).toBe(false);
  });

  it("rejects expired and malformed tokens", () => {
    configure();
    const old = createCsrfToken(Date.now() - 3 * 60 * 60 * 1_000);
    expect(verifyCsrfToken(old)).toBe(false);
    expect(verifyCsrfToken("")).toBe(false);
    expect(verifyCsrfToken("a.b")).toBe(false);
  });

  it("checks the request origin", () => {
    configure();
    const url = new URL("https://bibleol.example/cuenta");
    expect(
      isSameOriginRequest(
        new Request(url, { headers: { origin: "https://bibleol.example" } }),
        url,
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        new Request(url, { headers: { origin: "https://evil.example" } }),
        url,
      ),
    ).toBe(false);
  });
});

describe("redirects", () => {
  it("only accepts same-site paths", () => {
    expect(safeNextPath("/cuenta/historial")).toBe("/cuenta/historial");
    expect(safeNextPath("//evil.example")).toBe("/cuenta");
    expect(safeNextPath("https://evil.example")).toBe("/cuenta");
    expect(safeNextPath("/\\evil")).toBe("/cuenta");
    expect(safeNextPath(null)).toBe("/cuenta");
  });
});

describe("validation", () => {
  it("normalizes and validates emails", () => {
    expect(normalizeEmail("  Persona@Example.COM ")).toBe(
      "persona@example.com",
    );
    expect(isValidEmail("persona@example.com")).toBe(true);
    expect(isValidEmail("persona@example")).toBe(false);
    expect(isValidEmail("sin-arroba")).toBe(false);
  });

  it("requires a letter, a number and enough length", () => {
    expect(passwordIssue("corta1", 8)).toBe("short");
    expect(passwordIssue("sololetras", 8)).toBe("weak");
    expect(passwordIssue("12345678", 8)).toBe("weak");
    expect(passwordIssue("segura-123", 8)).toBeNull();
    expect(passwordIssue(`${"a1".repeat(40)}`, 8)).toBe("long");
  });
});

describe("auth rate limit", () => {
  it("allows the configured number of attempts and then blocks", async () => {
    configure();
    const identifier = `test-${Math.random()}`;
    const first = await consumeAuthRateLimit({
      scope: "test",
      identifier,
      limit: 2,
      windowSeconds: 60,
    });
    const second = await consumeAuthRateLimit({
      scope: "test",
      identifier,
      limit: 2,
      windowSeconds: 60,
    });
    const third = await consumeAuthRateLimit({
      scope: "test",
      identifier,
      limit: 2,
      windowSeconds: 60,
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });
});
