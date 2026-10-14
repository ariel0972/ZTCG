import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { cleanCard } from "../src/services/catalog";
import { playableErrors } from "../src/game/capabilities";

dotenv.config({ path: process.env.CARD_RULES_ENV_FILE ?? ".env", quiet: true });
async function main() {
  await dbConnect();
  const fields: Record<string, string[]> = {
    "006": ["descricao"],
    "026": [
      "custoMana",
      "hp",
      "ataque",
      "manaGerada",
      "elemento",
      "resistencia",
      "fraqueza",
      "direcaoAtaque",
      "subtipo",
      "descricao",
      "habilidadesAtivas",
      "habilidadesPassivas",
    ],
    "030": [
      "custoMana",
      "elemento",
      "alvo",
      "publicado",
      "descricao",
      "efeitos",
      "habilidadesPassivas",
    ],
    "037": [
      "custoMana",
      "elemento",
      "publicado",
      "bonusHp",
      "bonusAtaque",
      "descricao",
      "habilidadesPassivas",
    ],
    "045": [
      "custoMana",
      "elemento",
      "alvo",
      "publicado",
      "descricao",
      "efeitos",
    ],
  };
  const plans: { record: any; patch: Record<string, unknown> }[] = [];
  for (const [id, keys] of Object.entries(fields)) {
    const local = cardSchema.parse(
      initial.find((c) => c.numeroCatalogo === id),
    );
    const record = await CardModel.findOne({ numeroCatalogo: id }).lean();
    if (!record) {
      console.log(
        JSON.stringify({ card: id, source: "local", changedFields: [] }),
      );
      continue;
    }
    const old = cleanCard(record as any),
      patch: Record<string, unknown> = {};
    for (const key of keys)
      if (
        JSON.stringify((old as any)[key]) !==
        JSON.stringify((local as any)[key])
      )
        patch[key] = (local as any)[key];
    const candidate = cardSchema.parse({ ...old, ...patch });
    const errors = playableErrors(candidate);
    if (errors.length) {
      console.log(JSON.stringify({ card: id, errors }));
      throw Error("Definição inválida.");
    }
    console.log(
      JSON.stringify({
        card: id,
        version: old.versao,
        changedFields: Object.keys(patch),
      }),
    );
    if (Object.keys(patch).length) plans.push({ record, patch });
  }
  const applied = process.argv.includes("--apply");
  if (applied && plans.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/water-cards-${Date.now()}.json`,
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
        throw Error("Carta mudou durante a atualização.");
    }
  }
  console.log(JSON.stringify({ applied, changed: plans.length }));
}
void main()
  .catch(() => {
    console.error("Atualização falhou; nenhum segredo foi exibido.");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
