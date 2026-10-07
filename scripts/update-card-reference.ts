import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import { cleanCard } from "../src/services/catalog";
import { playableErrors } from "../src/game/capabilities";

dotenv.config({ path: process.env.CATALOG_ENV_FILE ?? ".env", quiet: true });
async function main() {
  await dbConnect();
  const old = await CardModel.findOne({ numeroCatalogo: "900098" }).lean();
  const current = await CardModel.findOne({ numeroCatalogo: "107" }).lean();
  if (!old) {
    console.log(JSON.stringify({ changed: false, card: "107" }));
    return;
  }
  if (current)
    throw Error("Há dois registros; revise o conflito antes de migrar.");
  const card = cleanCard(old as unknown as Record<string, unknown>);
  if (
    card.numeroCatalogo !== "107" ||
    card.nome !== "Médico da Peste" ||
    (card.publicado && playableErrors(card).length)
  )
    throw Error("Registro exige revisão.");
  console.log(
    JSON.stringify({
      changed: true,
      from: "900098",
      to: "107",
      version: old.versao,
    }),
  );
  if (!process.argv.includes("--apply")) return;
  await mkdir("backups", { recursive: true });
  await writeFile(
    `backups/card-reference-${Date.now()}.json`,
    JSON.stringify(old, null, 2),
  );
  const result = await CardModel.updateOne(
    { _id: old._id, numeroCatalogo: "900098", versao: old.versao },
    { $set: { numeroCatalogo: "107" }, $inc: { versao: 1 } },
  );
  if (result.matchedCount !== 1)
    throw Error("Carta alterada durante a migração.");
  console.log(JSON.stringify({ applied: true, card: "107" }));
}
void main()
  .catch(() => {
    console.error(
      "Migração de referência não concluída. Revise conflito/versão; nenhum segredo foi exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
