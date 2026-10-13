import dotenv from "dotenv";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema, Card } from "../src/types/card";
import { cleanCard } from "../src/services/catalog";
import { playableErrors } from "../src/game/capabilities";

dotenv.config({ path: process.env.CARD_RULES_ENV_FILE ?? ".env", quiet: true });
async function main() {
  await dbConnect();
  const plans: { record: any; patch: Record<string, unknown> }[] = [];
  for (const id of ["005", "008", "016", "028"]) {
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
    if (["005", "008"].includes(id)) patch.efeitos = local.efeitos;
    if (id !== "005") patch.descricao = local.descricao;
    if (id === "016") {
      let found = false;
      patch.habilidadesPassivas = old.habilidadesPassivas.map(
        (passive): Card["habilidadesPassivas"][number] => {
          if ("efeito" in passive && passive.efeito === "acumularDanoFogo") {
            found = true;
            return local.habilidadesPassivas[0];
          }
          if (
            "efeitos" in passive &&
            passive.efeitos.some(
              (e) => e.id === "spellDamageBonus" && e.elemento === "Fogo",
            )
          ) {
            found = true;
            return {
              ...passive,
              descricao: local.habilidadesPassivas[0].descricao,
              filtroEvento: {
                ...passive.filtroEvento,
                elemento: "Fogo",
                tipo: "Feitico",
              },
              efeitos: passive.efeitos.map((e) =>
                e.id === "spellDamageBonus" && e.elemento === "Fogo"
                  ? { ...e, aCada: 1, valor: 1 }
                  : e,
              ),
            };
          }
          return passive;
        },
      );
      if (!found) throw Error("Passiva de Fogo esperada não encontrada.");
    }
    if (id === "028") {
      let found = false;
      const description = local.habilidadesPassivas.find(
        (h) =>
          "efeitos" in h && h.efeitos.some((e) => e.id === "reflectAttack"),
      )!.descricao;
      patch.habilidadesPassivas = old.habilidadesPassivas.map((passive) => {
        if (
          "efeitos" in passive &&
          passive.efeitos.some((e) => e.id === "reflectAttack")
        ) {
          found = true;
          return {
            ...passive,
            descricao: description,
            efeitos: passive.efeitos.map((e) =>
              e.id === "reflectAttack" ? { ...e, esperaRodadas: 1 } : e,
            ),
          };
        }
        return passive;
      });
      if (!found) throw Error("Reação esperada não encontrada.");
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
  const applied = process.argv.includes("--apply");
  if (applied && plans.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/configurable-spells-${Date.now()}.json`,
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
  .catch((error) => {
    if (error instanceof ZodError)
      console.error(
        JSON.stringify({
          validation: error.issues.map((i) => ({
            path: i.path,
            code: i.code,
            message: i.message,
          })),
        }),
      );
    console.error("Atualização falhou; nenhum segredo foi exibido.");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
