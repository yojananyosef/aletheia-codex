import { createServerClient } from "@supabase/ssr";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import type { AstroCookies } from "astro";
import { getAuthConfig } from "./config";

interface CookiePair {
  name: string;
  value: string;
}

/**
 * Cookies written during this request (for example a token refresh performed
 * by the middleware). Astro cannot enumerate its cookie jar, so the incoming
 * header is parsed and these values are merged on top for later clients that
 * share the same request-scoped cookie jar.
 */
const requestCookies = new WeakMap<AstroCookies, Map<string, string>>();

function writtenCookies(cookies: AstroCookies): Map<string, string> {
  let written = requestCookies.get(cookies);
  if (!written) {
    written = new Map();
    requestCookies.set(cookies, written);
  }
  return written;
}

function parseCookieHeader(header: string | null): CookiePair[] {
  if (!header) {
    return [];
  }
  const result: CookiePair[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (!name) {
      continue;
    }
    try {
      result.push({ name, value: decodeURIComponent(raw) });
    } catch {
      result.push({ name, value: raw });
    }
  }
  return result;
}

/**
 * Request-scoped client. Astro does not expose an enumerable cookie store, so
 * the incoming Cookie header is parsed here. Cookies written during the
 * request are merged on top, which is what a token refresh needs.
 */
export function createSupabaseServerClient(
  request: Request,
  cookies: AstroCookies,
  requestUrl: URL,
): SupabaseClient | null {
  const config = getAuthConfig();
  if (!config.url || !config.anonKey) {
    return null;
  }
  const secure = requestUrl.protocol === "https:";
  const cookieOptions = {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure,
  };
  const written = writtenCookies(cookies);

  return createServerClient(config.url, config.anonKey, {
    cookieOptions,
    cookies: {
      getAll() {
        const merged = new Map<string, string>();
        for (const { name, value } of parseCookieHeader(
          request.headers.get("cookie"),
        )) {
          merged.set(name, value);
        }
        for (const [name, value] of written) {
          merged.set(name, value);
        }
        return [...merged].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          written.set(name, value);
          cookies.set(name, value, {
            ...options,
            ...cookieOptions,
          });
        }
      },
    },
  });
}

/**
 * Privileged client for operations that Supabase Auth only exposes to the
 * service role: creating already-confirmed accounts and deleting users.
 * It must never be imported from client-side code.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const config = getAuthConfig();
  if (!config.url || !config.serviceRoleKey) {
    return null;
  }
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function hasAuthCookie(request: Request): boolean {
  return parseCookieHeader(request.headers.get("cookie")).some(
    ({ name }) => name.startsWith("sb-") && name.includes("-auth-token"),
  );
}

export async function getSessionUser(
  request: Request,
  cookies: AstroCookies,
  requestUrl: URL,
): Promise<User | null> {
  const client = createSupabaseServerClient(request, cookies, requestUrl);
  if (!client) {
    return null;
  }
  try {
    const { data, error } = await client.auth.getUser();
    if (error) {
      return null;
    }
    return data.user;
  } catch (error) {
    console.error(
      `[auth] no se pudo validar la sesión: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
