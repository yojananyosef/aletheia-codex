import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAuthConfig } from "./config";

const TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;

function sign(payload: string): string {
  return createHmac("sha256", getAuthConfig().csrfSecret)
    .update(payload)
    .digest("base64url");
}

/**
 * Stateless, expiring CSRF token. The HMAC key is a server secret, so a token
 * cannot be minted by a third-party site and does not need server storage.
 */
export function createCsrfToken(now: number = Date.now()): string {
  const expires = now + TOKEN_TTL_MS;
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${expires}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyCsrfToken(
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!token) {
    return false;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }
  const [expiresRaw, nonce, signature] = parts;
  if (!expiresRaw || !nonce || !signature) {
    return false;
  }
  const expires = Number(expiresRaw);
  if (!Number.isSafeInteger(expires)) {
    return false;
  }
  if (expires < now || expires > now + TOKEN_TTL_MS + 60_000) {
    return false;
  }
  const expected = sign(`${expiresRaw}.${nonce}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function verifyFormCsrf(form: FormData): boolean {
  const value = form.get("csrf");
  return typeof value === "string" && verifyCsrfToken(value);
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function hostFromValue(value: string | null): string | null {
  const candidate = firstHeaderValue(value);
  if (!candidate) {
    return null;
  }
  try {
    const parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    );
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  const hostname = (
    host.startsWith("[")
      ? host.slice(1, host.indexOf("]"))
      : (host.split(":")[0] ?? "")
  ).toLowerCase();
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

/**
 * Defence in depth on top of the token: reject obvious cross-site form posts
 * before touching credentials.
 *
 * Behind a reverse proxy such as Vercel, Astro can build `url` from the
 * internal listener address (`http://localhost:...`) because forwarded headers
 * are only trusted when `security.allowedDomains` is configured. Compare
 * against the public host instead of trusting `url.origin` alone.
 */
export function isSameOriginRequest(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return request.headers.get("sec-fetch-site") !== "cross-site";
  }

  let originHost: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    originHost = parsed.host.toLowerCase();
  } catch {
    return false;
  }

  const siteHost = hostFromValue(getAuthConfig().siteUrl);
  const hosts = new Set<string>();
  for (const value of [
    siteHost,
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
  ]) {
    const host = hostFromValue(value);
    if (host) {
      hosts.add(host);
    }
  }

  // The configured site URL and the incoming Host header cover normal
  // deployments. Keep the internal URL as a fallback for local development on
  // a port other than the configured one.
  if (siteHost && isLoopbackHost(siteHost)) {
    hosts.add(url.host.toLowerCase());
  }

  return hosts.has(originHost);
}
