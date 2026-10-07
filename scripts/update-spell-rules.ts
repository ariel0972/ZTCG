import dotenv from "dotenv";
import mongoose from "mongoose";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { playableErrors } from "../src/game/capabilities";
// Somente regras dos 12 feitiços solicitados; preserva nome, arte e demais cartas.
dotenv.config({ path: process.env.SPELL_ENV_FILE ?? ".env", quiet: true });
const ids = new Set([
  "001",
  "002",
  "003",
  "004",
  "005",
  "006",
  "007",
  "008",
  "009",
  "010",
  "040",
  "090",
]);
async function main() {
  await dbConnect();
  let updated = 0,
    unchanged = 0,
    localOnly = 0;
  for (const raw of initial.filter((c) => ids.has(c.numeroCatalogo))) {
    const c = cardSchema.parse(raw);
    const errors = playableErrors(c);
    if (errors.length) throw new Error(`Regra inválida ${c.numeroCatalogo}`);
    const record = await CardModel.findOne({
      numeroCatalogo: c.numeroCatalogo,
    }).lean();
    if (!record) {
      localOnly++;
      continue;
    }
    const rules = {
      custoMana: c.custoMana,
      elemento: c.elemento,
      alvo: c.alvo,
      efeitos: c.efeitos,
      descricao: c.descricao,
      maxAlvos: c.maxAlvos,
      publicado: true,
    };
    const differs = Object.entries(rules).some(
      ([key, value]) =>
        JSON.stringify((record as any)[key]) !== JSON.stringify(value),
    );
    if (!differs) {
      unchanged++;
      continue;
    }
    if (process.argv.includes("--apply")) {
      const result = await CardModel.updateOne(
        { _id: record._id, versao: record.versao },
        { $set: rules, $inc: { versao: 1 } },
      );
      if (result.matchedCount !== 1)
        throw new Error(
          `Carta ${c.numeroCatalogo} mudou durante atualização. Execute novamente.`,
        );
    }
    updated++;
  }
  console.log(
    JSON.stringify({
      applied: process.argv.includes("--apply"),
      updated,
      unchanged,
      localOnly,
    }),
  );
}
void main()
  .catch(() => {
    console.error(
      "Não foi possível atualizar as regras. Nenhum segredo é exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
