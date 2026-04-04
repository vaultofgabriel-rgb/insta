/**
 * Proxy de perfil Instagram → chama GET `{PROFILE_API_BASE}/api/profile?user=`.
 * Aceita GET (query) ou POST JSON `{ user, lite?: boolean }` — o app usa POST via supabase-js (mais estável).
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeUser(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const imageUrl = url.searchParams.get("image");

  if (imageUrl) {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      return new Response(blob, {
        headers: {
          ...corsHeaders,
          "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return new Response("Image fetch failed", { status: 502, headers: corsHeaders });
    }
  }

  let user = "";
  let lite = false;

  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        const j = (await req.json()) as Record<string, unknown>;
        const rawUser = typeof j.user === "string" ? j.user : "";
        user = normalizeUser(rawUser);
        lite =
          j.lite === true ||
          j.lite === 1 ||
          j.lite === "1" ||
          j.lite === "true";
      } catch {
        /* query fallback */
      }
    }
  }

  if (!user) {
    user = normalizeUser(url.searchParams.get("user") ?? "");
    lite = url.searchParams.get("lite") === "1" || url.searchParams.get("lite") === "true";
  }

  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: "Missing user" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const upstreamBase = (Deno.env.get("PROFILE_API_BASE") ?? "http://187.124.91.24:8080").replace(/\/+$/, "");
  const upstreamUrl = `${upstreamBase}/api/profile?user=${encodeURIComponent(user)}`;
  const timeoutMs = Math.min(Math.max(Number(Deno.env.get("PROFILE_API_TIMEOUT_MS")) || 10_000, 3_000), 60_000);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(upstreamUrl, { signal: ac.signal });

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Serviço de perfil indisponível (HTTP ${res.status}). Tente de novo em instantes.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "Resposta inválida do serviço de perfil." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const proxyBase = `${supabaseUrl}/functions/v1/fetch-profile?image=`;

    if (typeof data.profile_pic === "string" && data.profile_pic) {
      data.profile_pic = proxyBase + encodeURIComponent(data.profile_pic);
    }
    if (lite) {
      delete data.posts;
    } else if (data.posts && Array.isArray(data.posts)) {
      data.posts = (data.posts as string[]).map((p: string) => proxyBase + encodeURIComponent(p));
    }

    const cache =
      typeof data.ok === "boolean" && data.ok
        ? "public, max-age=90, s-maxage=90, stale-while-revalidate=300"
        : "no-store";

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": cache },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return new Response(
      JSON.stringify({
        ok: false,
        error: aborted
          ? "Tempo esgotado ao buscar o perfil. O Instagram pode estar lento ou o serviço sobrecarregado."
          : "Falha ao contatar o serviço de perfil.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    clearTimeout(t);
  }
});
