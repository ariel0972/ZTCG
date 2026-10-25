import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import type { Card } from "../src/types/card";
import { cleanCard } from "../src/services/catalog";
import { playableErrors } from "../src/game/capabilities";
const ids = ["108"];
export function necroRevivePatch(record: Record<string, unknown>) {
  const current = cleanCard(record);
  if (!ids.includes(current.numeroCatalogo))
    throw Error("Carta fora da atualização de ressurreição do Necromante.");
  const local = cardSchema.parse(
    initial.find((c) => c.numeroCatalogo === current.numeroCatalogo),
  );
  if (current.tipo !== local.tipo)
    throw Error("O tipo da carta persistida exige revisão.");
  const desired = structuredClone(current);
  const ability = desired.habilidadesAtivas.find(
    (h) => h.id === "enganarAMorte",
  );
  const expected = local.habilidadesAtivas.find(
    (h) => h.id === "enganarAMorte",
  )!;
  if (!ability)
    throw Error("Habilidade removida ou renomeada; revisão necessária.");
  ability.custoMana = 0;
  ability.custoVida = 5;
  ability.alvo = "Cemiterio";
  ability.filtroAlvo = { tipo: "Tropa" };
  delete ability.maxAlvos;
  ability.efeitos = [{ id: "revive" }];
  ability.descricao = expected.descricao;
  const keys: (keyof Card)[] = ["habilidadesAtivas"];
  const patch = Object.fromEntries(
    keys
      .filter(
        (key) => JSON.stringify(current[key]) !== JSON.stringify(desired[key]),
      )
      .map((key) => [key, desired[key]]),
  );
  const unset: Record<string, number> = {};
  const candidate = { ...current, ...patch };
  for (const key of Object.keys(unset))
    delete (candidate as Record<string, unknown>)[key];
  const checked = cardSchema.parse(candidate);
  if (playableErrors(checked).length)
    throw Error("A definição final não é executável.");
  return {
    card: current.numeroCatalogo,
    patch,
    unset,
    version: current.versao,
  };
}
async function main() {
  dotenv.config({ path: process.env.CATALOG_ENV_FILE ?? ".env", quiet: true });
  await dbConnect();
  const plans: {
    record: any;
    plan: ReturnType<typeof necroRevivePatch>;
  }[] = [];
  for (const id of ids) {
    const record = await CardModel.findOne({ numeroCatalogo: id }).lean();
    if (!record) {
      console.log(
        JSON.stringify({ card: id, source: "local", changed: false }),
      );
      continue;
    }
    const plan = necroRevivePatch(record as unknown as Record<string, unknown>);
    const fields = [...Object.keys(plan.patch), ...Object.keys(plan.unset)];
    console.log(
      JSON.stringify({
        card: id,
        changed: !!fields.length,
        version: plan.version,
        fields,
      }),
    );
    if (fields.length) plans.push({ record, plan });
  }
  if (process.argv.includes("--apply") && plans.length) {
    await mkdir("backups", { recursive: true });
    const backup = "backups/necro-revive-" + Date.now() + ".json";
    await writeFile(
      backup,
      JSON.stringify(
        plans.map((p) => p.record),
        null,
        2,
      ),
      { flag: "wx" },
    );
    console.log(JSON.stringify({ backup }));
    for (const { record, plan } of plans) {
      const result = await CardModel.updateOne(
        { _id: record._id, versao: plan.version },
        {
          $set: plan.patch,
          ...(Object.keys(plan.unset).length ? { $unset: plan.unset } : {}),
          $inc: { versao: 1 },
        },
        { runValidators: true },
      );
      if (result.matchedCount !== 1)
        throw Error(
          "Carta alterada durante a sincronização; confira as versões antes de retomar.",
        );
      console.log(
        JSON.stringify({
          card: plan.card,
          applied: true,
          version: plan.version + 1,
        }),
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
if (require.main === module)
  void main()
    .catch(() => {
      console.error(
        "Atualização das regras de ressurreição do Necromante não concluída. Revise versões e catálogo; nenhum segredo foi exibido.",
      );
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
