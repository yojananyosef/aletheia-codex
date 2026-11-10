import type { APIRoute } from "astro";

const ALLOWED_TYPES = new Set([
  "signup",
  "email",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
]);

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
    return redirect("/entrar?error=confirmacion", 303);
  }

  const supabase = locals.supabase;
  if (!supabase) {
    return redirect("/entrar?error=confirmacion", 303);
  }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as
      "signup" | "email" | "recovery" | "invite" | "magiclink" | "email_change",
  });
  if (error) {
    console.error(`[auth] confirmación no válida: ${error.message}`);
    return redirect("/entrar?error=confirmacion", 303);
  }
  return redirect("/cuenta?confirmado=1", 303);
};
