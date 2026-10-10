import dotenv from "dotenv";
import mongoose from "mongoose";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { playableErrors } from "../src/game/capabilities";
import { cleanCard } from "../src/services/catalog";
import { normalizePassive } from "../src/game/legacy-passives";
import { mkdir, writeFile } from "node:fs/promises";
dotenv.config({ path: process.env.CARD_RULES_ENV_FILE ?? ".env", quiet: true });
const fields = {
  "028": [
    "elemento",
    "hp",
    "ataque",
    "recuperacaoMana",
    "limites",
    "descricao",
  ],
  "095": [
    "elemento",
    "subtipo",
    "hp",
    "ataque",
    "custoMana",
    "manaGerada",
    "direcaoAtaque",
    "fraqueza",
    "resistencia",
    "descricao",
  ],
  "098": [
    "elemento",
    "subtipo",
    "hp",
    "ataque",
    "custoMana",
    "manaGerada",
    "direcaoAtaque",
    "fraqueza",
    "resistencia",
    "descricao",
  ],
};
async function main() {
  await dbConnect();
  const plans: { record: any; patch: Record<string, unknown> }[] = [];
  for (const [id, attributes] of Object.entries(fields)) {
    const local = cardSchema.parse(
      initial.find((c) => c.numeroCatalogo === id),
    );
    const record = await CardModel.findOne({ numeroCatalogo: id }).lean();
    if (!record) throw Error(`Carta ${id} ausente no banco`);
    const old = cleanCard(record as any);
    const key = (h: (typeof local.habilidadesPassivas)[number]) => {
      const rule = normalizePassive(h);
      return rule.gatilho + ":" + rule.efeitos.map((e) => e.id).join(",");
    };
    const keys = new Set(local.habilidadesPassivas.map(key));
    const activeIds = new Set(local.habilidadesAtivas.map((h) => h.id));
    const patch: Record<string, unknown> = Object.fromEntries(
      attributes.map((field) => [field, (local as any)[field]]),
    );
    patch.habilidadesPassivas = [
      ...old.habilidadesPassivas.filter((h) => !keys.has(key(h))),
      ...local.habilidadesPassivas,
    ];
    // The owner explicitly chose only the Skeleton rule shown on the card.
    if (id === "095") patch.habilidadesPassivas = local.habilidadesPassivas;
    patch.habilidadesAtivas = [
      ...old.habilidadesAtivas.filter((h) => !activeIds.has(h.id)),
      ...local.habilidadesAtivas,
    ].map((h) => ({ ...h, efeitos: h.efeitos ?? [] }));
    const candidate = cardSchema.parse({ ...old, ...patch });
    const errors = playableErrors(candidate);
    if (errors.length) {
      console.log(JSON.stringify({ card: id, errors }));
      throw Error("Carta exige revisão antes da atualização");
    }
    const changedFields = Object.keys(patch).filter(
      (field) =>
        JSON.stringify((old as any)[field]) !== JSON.stringify(patch[field]),
    );
    console.log(
      JSON.stringify({ card: id, changedFields, published: old.publicado }),
    );
    if (changedFields.length) plans.push({ record, patch });
  }
  if (process.argv.includes("--apply") && plans.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/apprentice-skeleton-clown-${Date.now()}.json`,
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
          "Carta mudou durante a atualização; execute novamente para revisar.",
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
    console.error(
      "Não foi possível atualizar as três cartas. Nenhum segredo foi exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
