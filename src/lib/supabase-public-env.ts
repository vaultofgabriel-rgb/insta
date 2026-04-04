/** URL e chave pública do Supabase (já injetadas pelo Vite / define). */

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function getPublicSupabaseUrl(): string {
  return stripQuotes(String(import.meta.env.VITE_SUPABASE_URL ?? "")).replace(/\/+$/, "");
}

export function getPublicSupabasePublishableKey(): string {
  return stripQuotes(String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""));
}
