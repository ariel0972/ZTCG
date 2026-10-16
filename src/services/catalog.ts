import model from "../db/models/Card";
import { Card, cardSchema } from "../types/card";
import initial from "../data/catalog.json";
import { cardReference } from "../domain/deck";
import { ReadCache } from "../lib/read-cache";
const catalogCache = new ReadCache<ReturnType<typeof mergeCatalog>>(60000, 1);
export function invalidateCatalog() {
  catalogCache.clear();
}
export function cleanCard(raw: Record<string, unknown>): Card {
  const { _id, __v, createdAt, updatedAt, ...card } = raw;
  const parsed = cardSchema.parse(card);
  return {
    ...parsed,
    numeroCatalogo: cardReference({
      numeroCatalogo: parsed.numeroCatalogo,
      nome: parsed.nome,
    }),
  };
}
export function mergeCatalog(records: Record<string, unknown>[]) {
  const issues: { id: string; nome: string; motivo: string }[] = [];
  const merged = new Map(
    (initial as unknown[]).map((raw) => {
      const card = cardSchema.parse(raw);
      return [card.numeroCatalogo, card] as const;
    }),
  );
  const canonicalOverrides = new Set<string>();
  for (const record of records) {
    try {
      const card = cleanCard(record);
      const aliased = String(record.numeroCatalogo) !== card.numeroCatalogo;
      if (aliased && canonicalOverrides.has(card.numeroCatalogo)) continue;
      merged.set(card.numeroCatalogo, card);
      if (!aliased) canonicalOverrides.add(card.numeroCatalogo);
    } catch {
      // Os antigos campos name/type/attack não são convertidos em regras novas
      // nem liberados para jogo. A definição local conhecida continua disponível.
      issues.push({
        id: String(record._id ?? ""),
        nome: String(record.nome ?? record.name ?? "Sem nome"),
        motivo:
          "Registro antigo ou inválido. Recrie a definição no editor do catálogo.",
      });
    }
  }
  return {
    cards: [...merged.values()].sort((a, b) =>
      a.numeroCatalogo.localeCompare(b.numeroCatalogo),
    ),
    issues,
  };
}
export async function catalogWithDiagnostics(fresh = false) {
  if (fresh) invalidateCatalog();
  const catalog = await catalogCache.get("catalog", async () =>
    mergeCatalog(
      (await model.find().lean()) as unknown as Record<string, unknown>[],
    ),
  );
  // Callers (including games) must never mutate the shared definitions.
  return structuredClone(catalog);
}
export async function getCatalog(): Promise<Card[]> {
  return (await catalogWithDiagnostics()).cards;
}
