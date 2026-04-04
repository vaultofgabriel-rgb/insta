/** Normaliza handle para busca (remove @, espaços e trim). */
export function normalizeInstagramUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
