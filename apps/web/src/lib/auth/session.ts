const DEFAULT_NEXT = "/cuenta";

/**
 * Only same-site absolute paths are accepted as post-login destinations.
 * Rejecting `//host` and backslashes closes the usual open-redirect holes.
 */
export function safeNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_NEXT,
): string {
  if (!value) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) {
    return fallback;
  }
  return value;
}

export function loginUrl(nextPath: string): string {
  return `/entrar?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}

export function registerUrl(nextPath: string): string {
  return `/crear-cuenta?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}
