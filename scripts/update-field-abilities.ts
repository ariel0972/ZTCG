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
  const plans: { record: any; patch: Record<string, unknown> }[] = [];
  for (const id of ["005", "075", "111"]) {
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
    if (id === "005") patch.descricao = local.descricao;
    else {
      const ids = new Set(local.habilidadesAtivas.map((h) => h.id));
      patch.habilidadesAtivas = [
        ...old.habilidadesAtivas.filter((h) => !ids.has(h.id)),
        ...local.habilidadesAtivas,
      ].map((h) => ({ ...h, efeitos: h.efeitos ?? [] }));
    }
    const candidate = cardSchema.parse({ ...old, ...patch });
    const errors = playableErrors(candidate);
    if (errors.length) {
      console.log(JSON.stringify({ card: id, errors }));
      throw Error("Definição inválida.");
    }
    const changedFields = Object.keys(patch).filter(
      (key) => JSON.stringify((old as any)[key]) !== JSON.stringify(patch[key]),
    );
    console.log(
      JSON.stringify({ card: id, changedFields, version: old.versao }),
    );
    if (changedFields.length) plans.push({ record, patch });
  }
  if (process.argv.includes("--apply") && plans.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/field-abilities-${Date.now()}.json`,
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
  console.log(
    JSON.stringify({
      applied: process.argv.includes("--apply"),
      changed: plans.length,
    }),
  );
}
void main()
  .catch(() => {
    console.error("Atualização falhou; nenhum segredo foi exibido.");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
