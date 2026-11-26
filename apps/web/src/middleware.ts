import { defineMiddleware } from "astro:middleware";
import { createSupabaseServerClient, hasAuthCookie } from "./lib/auth/supabase";

const PRIVATE_PREFIXES = [
  "/cuenta",
  "/entrar",
  "/crear-cuenta",
  "/salir",
  "/auth",
  "/recuperar",
  "/restablecer",
];

// Variantes de lectura que no aportan contenido nuevo (el canonical apunta a la
// URL limpia). Los rastreadores las enumeraban y multiplicaban el tráfico.
const VARIANT_PARAMS = ["translit", "grammar", "gloss", "ai", "from", "to"];
const AI_BOT_PATTERN =
  /(?:ClaudeBot|GPTBot|CCBot|Bytespider|Amazonbot|Applebot-Extended|meta-externalagent|Google-Extended)/i;

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hasVariantParams(url: URL): boolean {
  return VARIANT_PARAMS.some((key) => url.searchParams.has(key));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const userAgent = context.request.headers.get("user-agent") ?? "";
  if (hasVariantParams(context.url) && AI_BOT_PATTERN.test(userAgent)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "X-Robots-Tag": "noindex, nofollow" },
    });
  }

  context.locals.user = null;
  context.locals.supabase = null;

  if (process.env.STATIC_EXPORT !== "1") {
    const supabase = createSupabaseServerClient(
      context.request,
      context.cookies,
      context.url,
    );
    context.locals.supabase = supabase;
    if (supabase && hasAuthCookie(context.request)) {
      try {
        const { data, error } = await supabase.auth.getUser();
        context.locals.user = error ? null : data.user;
      } catch (error) {
        console.error(
          `[auth] no se pudo validar la sesión: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  const response = await next();

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (context.url.protocol === "https:") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  if (isPrivatePath(context.url.pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  } else if (hasVariantParams(context.url)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
});
