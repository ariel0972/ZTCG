import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { playableErrors } from "../src/game/capabilities";
import { normalizePassive } from "../src/game/legacy-passives";
import { cleanCard } from "../src/services/catalog";

dotenv.config({ path: process.env.CARD_RULES_ENV_FILE ?? ".env", quiet: true });
const ids = ["025", "063", "074", "075"];
async function main() {
  await dbConnect();
  const plans: { record: any; patch: Record<string, unknown> }[] = [];
  for (const id of ids) {
    const local = cardSchema.parse(
      initial.find((c) => c.numeroCatalogo === id),
    );
    const record = await CardModel.findOne({ numeroCatalogo: id }).lean();
    if (!record) {
      console.log(
        JSON.stringify({ card: id, source: "catalog.json", changedFields: [] }),
      );
      continue;
    }
    const old = cleanCard(record as any);
    const ours = (p: (typeof old.habilidadesPassivas)[number]) => {
      const rule = normalizePassive(p);
      if (id === "025")
        return (
          rule.efeitos.some((e) => e.id === "attackBonus") &&
          rule.condicoes?.some(
            (c) => c.tipo === "vidaPercentual" && c.alvo === "alvoAtaque",
          )
        );
      if (id === "063")
        return rule.efeitos.some((e) => e.id === "counterAttack");
      if (id === "074")
        return rule.efeitos.some((e) => e.id === "blockOwnAttack");
      return rule.efeitos.some(
        (e) =>
          e.id === "interceptAttack" ||
          (e.id === "attackAura" && e.filtro?.numeroCatalogo === "021"),
      );
    };
    const patch: Record<string, unknown> = {
      habilidadesPassivas: [
        ...old.habilidadesPassivas.filter((p) => !ours(p)),
        ...local.habilidadesPassivas,
      ],
    };
    if (id === "074") {
      patch.palavrasChave = [
        ...new Set([...old.palavrasChave, ...local.palavrasChave]),
      ];
      patch.montaria = local.montaria;
    }
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
      JSON.stringify({
        card: id,
        published: old.publicado,
        changedFields,
        existingPassiveKinds: old.habilidadesPassivas.map((p) =>
          normalizePassive(p).efeitos.map((e) => e.id),
        ),
        preservedAbilities: old.habilidadesAtivas.map((a) => a.id),
      }),
    );
    if (changedFields.length) plans.push({ record, patch });
  }
  const apply = process.argv.includes("--apply");
  if (apply && plans.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/mounted-passives-${Date.now()}.json`,
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
          "Carta mudou durante a atualização; revise antes de repetir.",
        );
    }
  }
  console.log(JSON.stringify({ applied: apply, changed: plans.length }));
}
void main()
  .catch(() => {
    console.error(
      "Atualização das passivas falhou; nenhum segredo foi exibido.",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
