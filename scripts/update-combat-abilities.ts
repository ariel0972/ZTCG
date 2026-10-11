import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { playableErrors } from "../src/game/capabilities";
import { cleanCard } from "../src/services/catalog";

dotenv.config({ path: process.env.CARD_RULES_ENV_FILE ?? ".env", quiet: true });
const attributes: Record<string, string[]> = {
  "025": [
    "elemento",
    "subtipo",
    "custoMana",
    "hp",
    "ataque",
    "manaGerada",
    "resistencia",
    "fraqueza",
    "descricao",
  ],
  "023": ["elemento", "subtipo", "resistencia", "fraqueza"],
  "110": [],
  "117": [],
  "053": [
    "publicado",
    "elemento",
    "custoMana",
    "alvo",
    "alvoAutomatico",
    "ignoraEsconder",
    "tiposAlvo",
    "efeitos",
    "descricao",
  ],
  "054": [
    "publicado",
    "nome",
    "elemento",
    "custoMana",
    "alvo",
    "tiposAlvo",
    "efeitos",
    "descricao",
  ],
};
async function main() {
  await dbConnect();
  const plans: { record: any; patch: Record<string, unknown> }[] = [];
  for (const [id, fields] of Object.entries(attributes)) {
    const local = cardSchema.parse(
      initial.find((c) => c.numeroCatalogo === id),
    );
    const record = await CardModel.findOne({ numeroCatalogo: id }).lean();
    if (!record) {
      const errors = playableErrors(local);
      if (errors.length) throw Error(`Definição local ${id} inválida.`);
      console.log(
        JSON.stringify({
          card: id,
          source: "catalog.json",
          published: local.publicado,
          changedFields: [],
        }),
      );
      continue;
    }
    const old = cleanCard(record as any);
    const patch: Record<string, unknown> = Object.fromEntries(
      fields.map((field) => [field, (local as any)[field]]),
    );
    const ids = new Set(local.habilidadesAtivas.map((h) => h.id));
    if (ids.size)
      patch.habilidadesAtivas = [
        ...old.habilidadesAtivas.filter((h) => !ids.has(h.id)),
        ...local.habilidadesAtivas,
      ].map((h) => ({ ...h, efeitos: h.efeitos ?? [] }));
    const candidate = cardSchema.parse({ ...old, ...patch });
    const errors = playableErrors(candidate);
    if (errors.length) {
      console.log(JSON.stringify({ card: id, errors }));
      throw Error("Definição exige revisão.");
    }
    const changedFields = Object.keys(patch).filter(
      (key) => JSON.stringify((old as any)[key]) !== JSON.stringify(patch[key]),
    );
    console.log(
      JSON.stringify({ card: id, changedFields, published: old.publicado }),
    );
    if (changedFields.length) plans.push({ record, patch });
  }
  if (process.argv.includes("--apply") && plans.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/combat-abilities-${Date.now()}.json`,
      JSON.stringify(
        plans.map((p) => p.record),
        null,
        2,
      ),
    );
    for (const { record, patch } of plans) {
      const result = await CardModel.updateOne(
        { _id: record._id, versao: record.versao },
        { $set: patch, $inc: { versao: 1 } },
      );
      if (result.matchedCount !== 1)
        throw Error(
          "Carta mudou durante a atualização. Revise antes de tentar novamente.",
        );
    }
  }
  console.log(
    JSON.stringify({
      applied: process.argv.includes("--apply"),
      changed: plans.length,
    }),
  );
}
void main()
  .catch(() => {
    console.error("Atualização das regras falhou; nenhum segredo foi exibido.");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
