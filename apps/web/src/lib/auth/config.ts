function readString(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return fallback;
}

function normalizeSiteUrl(value: string | null): string {
  if (!value) {
    return "http://localhost:4321";
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

export interface AuthConfig {
  url: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  configured: boolean;
  adminConfigured: boolean;
  signupEnabled: boolean;
  requireEmailConfirmation: boolean;
  passwordMinLength: number;
  siteUrl: string;
  csrfSecret: string;
  rateSalt: string;
}

let cached: AuthConfig | undefined;

export function getAuthConfig(): AuthConfig {
  if (cached) {
    return cached;
  }

  const url = readString("PUBLIC_SUPABASE_URL") ?? readString("SUPABASE_URL");
  const anonKey =
    readString("PUBLIC_SUPABASE_ANON_KEY") ??
    readString("SUPABASE_ANON_KEY") ??
    readString("PUBLIC_SUPABASE_PUBLISHABLE_KEY") ??
    readString("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey =
    readString("SUPABASE_SERVICE_ROLE_KEY") ??
    readString("SUPABASE_SECRET_KEY");
  const siteUrl = normalizeSiteUrl(
    readString("PUBLIC_SITE_URL") ??
      readString("SITE_URL") ??
      readString("VERCEL_PROJECT_PRODUCTION_URL") ??
      readString("VERCEL_URL") ??
      readString("AI_SITE_URL"),
  );
  const fallbackSecret =
    readString("SUPABASE_JWT_SECRET") ??
    readString("AI_IP_SALT") ??
    "bibleol-development-secret";

  cached = {
    url,
    anonKey,
    serviceRoleKey,
    configured: Boolean(url && anonKey),
    adminConfigured: Boolean(url && serviceRoleKey),
    signupEnabled: readBoolean("AUTH_SIGNUP_ENABLED", true),
    requireEmailConfirmation: readBoolean(
      "AUTH_REQUIRE_EMAIL_CONFIRMATION",
      false,
    ),
    passwordMinLength: 8,
    siteUrl,
    csrfSecret: readString("AUTH_CSRF_SECRET") ?? fallbackSecret,
    rateSalt: readString("AUTH_RATE_SALT") ?? fallbackSecret,
  };

  return cached;
}

export function authAvailable(): boolean {
  return process.env.STATIC_EXPORT !== "1" && getAuthConfig().configured;
}

export function resetAuthConfigForTests(): void {
  cached = undefined;
}
