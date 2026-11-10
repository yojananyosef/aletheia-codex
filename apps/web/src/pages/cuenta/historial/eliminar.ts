import type { APIRoute } from "astro";
import {
  deleteAnalysis,
  isSameOriginRequest,
  loginUrl,
  verifyFormCsrf,
} from "../../../lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
  const form = await request.formData();
  if (!isSameOriginRequest(request, url) || !verifyFormCsrf(form)) {
    return new Response("Solicitud no válida.", { status: 403 });
  }

  const idValue = form.get("id");
  const id = typeof idValue === "string" ? idValue : "";
  if (!UUID.test(id)) {
    return redirect("/cuenta/historial", 303);
  }

  const supabase = locals.supabase;
  const user = locals.user;
  if (!supabase || !user) {
    return redirect(loginUrl("/cuenta/historial"), 303);
  }

  try {
    await deleteAnalysis(supabase, user.id, id);
  } catch (error) {
    console.error(
      `[history] no se pudo eliminar el análisis ${id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return redirect("/cuenta/historial?deleted=1", 303);
};

export const GET: APIRoute = () =>
  new Response("Método no permitido.", {
    status: 405,
    headers: { Allow: "POST" },
  });
