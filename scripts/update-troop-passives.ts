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
dotenv.config({ path: process.env.PASSIVE_ENV_FILE ?? ".env", quiet: true });
async function main() {
  await dbConnect();
  const ids = new Set([
      "020",
      "021",
      "023",
      "024",
      "027",
      "041",
      "044",
      "110",
      "111",
      "117",
    ]),
    plans: { record: any; passives: any[] }[] = [];
  for (const raw of initial.filter((c) => ids.has(c.numeroCatalogo))) {
    const local = cardSchema.parse(raw),
      record = await CardModel.findOne({
        numeroCatalogo: raw.numeroCatalogo,
      }).lean();
    if (!record) {
      console.log(
        JSON.stringify({ card: raw.numeroCatalogo, source: "local" }),
      );
      continue;
    }
    const old = cleanCard(record as any);
    const key = (h: (typeof local.habilidadesPassivas)[number]) => {
      const rule = normalizePassive(h);
      return rule.gatilho + ":" + rule.efeitos.map((e) => e.id).join(",");
    };
    const effects = new Set(local.habilidadesPassivas.map(key));
    const passives = [
      ...old.habilidadesPassivas.filter((h) => !effects.has(key(h))),
      ...local.habilidadesPassivas,
    ];
    const candidate = cardSchema.parse({
      ...old,
      habilidadesPassivas: passives,
    });
    if (playableErrors(candidate).length)
      throw Error("Configuração exige revisão");
    const changed =
      JSON.stringify(old.habilidadesPassivas) !== JSON.stringify(passives);
    console.log(
      JSON.stringify({
        card: raw.numeroCatalogo,
        changed,
        existingPassives: old.habilidadesPassivas.length,
        newPassives: passives.length,
      }),
    );
    if (changed) plans.push({ record, passives });
  }
  if (process.argv.includes("--apply") && plans.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/troop-passives-${Date.now()}.json`,
      JSON.stringify(
        plans.map((p) => p.record),
        null,
        2,
      ),
    );
    for (const { record, passives } of plans) {
      const result = await CardModel.updateOne(
        { _id: record._id, versao: record.versao },
        { $set: { habilidadesPassivas: passives }, $inc: { versao: 1 } },
      );
      if (result.matchedCount !== 1)
        throw Error("Carta alterada durante a sincronização");
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
      "Não foi possível sincronizar as passivas. Revise o catálogo; nenhum segredo foi exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
