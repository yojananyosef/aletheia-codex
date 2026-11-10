import type { APIRoute } from "astro";
import { isSameOriginRequest, verifyFormCsrf } from "../lib/auth";

export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
  const form = await request.formData();
  if (!isSameOriginRequest(request, url) || !verifyFormCsrf(form)) {
    return new Response("Solicitud no válida.", { status: 403 });
  }

  const supabase = locals.supabase;
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      console.error(`[auth] no se pudo cerrar la sesión: ${error.message}`);
    }
  }
  return redirect("/?sesion=cerrada", 303);
};

export const GET: APIRoute = () =>
  new Response("Método no permitido.", {
    status: 405,
    headers: { Allow: "POST" },
  });
