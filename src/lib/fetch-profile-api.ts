import { supabase } from "@/integrations/supabase/client";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { getPublicSupabasePublishableKey, getPublicSupabaseUrl } from "@/lib/supabase-public-env";

/**
 * Chama fetch-profile via supabase-js (mesmos headers que PostgREST).
 * Evita "Failed to fetch" com chave publishable nova (sb_publishable_…) vs fetch manual.
 */
export async function fetchProfileLite(
  username: string,
  options: { signal?: AbortSignal },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const supabaseUrl = getPublicSupabaseUrl();
  const anonKey = getPublicSupabasePublishableKey();
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      error:
        "Falta URL ou chave do Supabase. No Replit: SB_PROJECT_URL + SB_ANON_KEY (ou VITE_*). Reinicie após salvar secrets.",
    };
  }

  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new Error("protocol");
    }
  } catch {
    const prev = supabaseUrl.length > 48 ? `${supabaseUrl.slice(0, 48)}…` : supabaseUrl;
    return {
      ok: false,
      error: `URL do Supabase inválida: "${prev}" — use https://xxxx.supabase.co sem aspas.`,
    };
  }

  /** POST + path só "fetch-profile" evita bugs de URL com query em alguns browsers / Replit. */
  const { data: payload, error: fnError } = await supabase.functions.invoke("fetch-profile", {
    body: { user: username, lite: true },
    signal: options.signal,
  });

  if (fnError) {
    if (fnError instanceof FunctionsFetchError) {
      const inner = fnError.context;
      const innerMsg =
        inner instanceof Error
          ? inner.message
          : typeof inner === "object" && inner && "message" in inner
            ? String((inner as { message: unknown }).message)
            : "";
      const isAbort = inner instanceof Error && inner.name === "AbortError";
      if (isAbort) {
        return {
          ok: false,
          error:
            "A busca demorou demais. Tente de novo e use @ sem espaço no meio (ex.: @usuario).",
        };
      }
      const jwtHint =
        !anonKey.startsWith("eyJ") && innerMsg.includes("fetch")
          ? " Se usa chave sb_publishable_, teste também a chave anon JWT (começa com eyJ…) em Settings → API."
          : "";
      const blockHint =
        innerMsg.includes("Failed to fetch") || innerMsg.includes("NetworkError")
          ? " Desative bloqueador de anúncios; confira deploy: supabase functions deploy fetch-profile."
          : "";
      return {
        ok: false,
        error: `Não foi possível chamar a function (${innerMsg || fnError.message}).${jwtHint}${blockHint}`,
      };
    }

    if (fnError instanceof FunctionsRelayError) {
      return {
        ok: false,
        error:
          "Supabase não alcançou a Edge Function. Faça deploy: supabase functions deploy fetch-profile",
      };
    }

    if (fnError instanceof FunctionsHttpError) {
      try {
        const j = (await fnError.context.json()) as Record<string, unknown>;
        const msg =
          (typeof j.error === "string" && j.error) ||
          (typeof j.message === "string" && j.message) ||
          `HTTP ${fnError.context.status}`;
        return { ok: false, error: msg };
      } catch {
        const t = await fnError.context.text().catch(() => "");
        return {
          ok: false,
          error: `Erro HTTP ${fnError.context.status} na function. ${t.slice(0, 200)}`,
        };
      }
    }

    return {
      ok: false,
      error: fnError instanceof Error ? fnError.message : String(fnError),
    };
  }

  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (p.ok === true) {
      return { ok: true, data: p };
    }
    if (p.ok === false) {
      return {
        ok: false,
        error:
          (typeof p.error === "string" && p.error) ||
          "Perfil não encontrado. Verifique o nome de usuário.",
      };
    }
  }

  return { ok: false, error: "Resposta inesperada da function fetch-profile." };
}
