import { z } from "zod";
import { Card } from "../types/card";
import { AppError } from "../lib/errors";
export const deckRules = {
  cartas: 40,
  magos: 1,
  copias: { Tropa: 3, Feitico: 3, Estrutura: 2, Armamento: 2, Mago: 1 },
} as const;
export function cardReference(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    if (text === "900098") return "107";
    if (/^\d{1,6}$/.test(text)) return text.padStart(3, "0");
  }
  if (value && typeof value === "object") {
    const ref = value as Record<string, unknown>;
    // O catálogo legado usava 98 para Palhaço e Médico da Peste.
    if (
      String(ref.numeroCatalogo ?? ref.id).replace(/^0+/, "") === "98" &&
      /m[eé]dico/i.test(String(ref.nome ?? ref.name))
    )
      return "107";
    return cardReference(ref.numeroCatalogo ?? ref.id);
  }
  throw new AppError(422, "Referência de carta inválida. Use numeroCatalogo.");
}
const reference = z.unknown().transform((value, ctx) => {
  try {
    return cardReference(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Referência inválida." });
    return z.NEVER;
  }
});
export const deckInput = z
  .object({
    nome: z.string().trim().min(1).max(80),
    cartas: z.array(reference).max(40),
    mago: z.union([z.null(), reference]),
    icone: z
      .string()
      .regex(
        /^\/assets\/icons\/(neutro|agua|ar|fogo|terra|zarcos|tropa|feitiço)\.svg$/,
      )
      .default("/assets/icons/neutro.svg"),
    verso: z
      .enum(["common", "zarcos", "water", "air", "fire", "earth"])
      .default("common"),
    publico: z.boolean().optional(),
    revisao: z.number().int().min(0).optional(),
  })
  .strict();
export type DeckInput = z.infer<typeof deckInput>;
export function validateDeck(
  deck: Pick<DeckInput, "cartas" | "mago">,
  catalog: Card[],
  playing = false,
): string[] {
  const errors: string[] = [],
    byId = new Map(catalog.map((c) => [c.numeroCatalogo, c])),
    counts = new Map<string, number>();
  for (const id of deck.cartas) {
    const card = byId.get(id);
    if (!card) {
      errors.push(`Carta ${id} não existe no catálogo.`);
      continue;
    }
    if (card.tipo === "Mago")
      errors.push("O mago pertence ao espaço separado, não às 40 cartas.");
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    if (count > deckRules.copias[card.tipo])
      errors.push(
        `${card.nome}: máximo de ${deckRules.copias[card.tipo]} cópias.`,
      );
    if (playing && !card.publicado)
      errors.push(`${card.nome} ainda não está liberada para partidas.`);
  }
  if (deck.cartas.length > 40)
    errors.push("O deck comporta no máximo 40 cartas.");
  if (deck.mago !== null) {
    const mage = byId.get(deck.mago);
    if (!mage || mage.tipo !== "Mago") errors.push("Selecione um mago válido.");
    else if (playing && !mage.publicado)
      errors.push("Este mago ainda não está liberado.");
  }
  if (playing && (deck.cartas.length !== 40 || deck.mago === null))
    errors.push("Para jogar: exatamente 40 cartas e 1 mago.");
  return [...new Set(errors)];
}
