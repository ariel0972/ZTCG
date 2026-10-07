import model from "../db/models/Card";
import { Card, cardSchema } from "../types/card";
import initial from "../data/catalog.json";
export function cleanCard(raw: Record<string, unknown>): Card {
  const { _id, __v, createdAt, updatedAt, ...card } = raw;
  return cardSchema.parse(card);
}
export function mergeCatalog(records: Record<string, unknown>[]) {
  const issues: { id: string; nome: string; motivo: string }[] = [];
  const merged = new Map(
    (initial as unknown[]).map((raw) => {
      const card = cardSchema.parse(raw);
      return [card.numeroCatalogo, card] as const;
    }),
  );
  for (const record of records) {
    try {
      const card = cleanCard(record);
      merged.set(card.numeroCatalogo, card);
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
export async function catalogWithDiagnostics() {
  return mergeCatalog(
    (await model.find().lean()) as unknown as Record<string, unknown>[],
  );
}
export async function getCatalog(): Promise<Card[]> {
  return (await catalogWithDiagnostics()).cards;
}
