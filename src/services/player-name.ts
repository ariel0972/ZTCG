import { z } from "zod";
export const playerName = z
  .string()
  .transform((value) => value.normalize("NFKC").trim().replace(/\s+/g, " "))
  .pipe(z.string().min(4, "Use pelo menos 4 caracteres no nome.").max(80));

// Acentos, maiúsculas e espaços equivalentes não criam outro nome de jogador.
export function playerNameKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
