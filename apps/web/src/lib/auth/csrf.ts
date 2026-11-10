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

/**
 * Defence in depth on top of the token: reject obvious cross-site form posts
 * before touching credentials.
 */
export function isSameOriginRequest(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === url.origin;
  }
  return request.headers.get("sec-fetch-site") !== "cross-site";
}
