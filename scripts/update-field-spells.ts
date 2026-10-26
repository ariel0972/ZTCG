import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import dbConnect from "../src/lib/mongodb";
import CardModel from "../src/db/models/Card";
import initial from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { cleanCard } from "../src/services/catalog";
import { playableErrors } from "../src/game/capabilities";
const ids = ["004", "035", "136"];
export function fieldSpellPatch(record: Record<string, unknown>) {
  const current = cleanCard(record);
  if (!ids.includes(current.numeroCatalogo))
    throw Error("Carta fora desta atualização.");
  const local = cardSchema.parse(
    initial.find((c) => c.numeroCatalogo === current.numeroCatalogo),
  );
  if (
    current.tipo !== local.tipo ||
    (current.numeroCatalogo === "136" && current.nome !== local.nome)
  )
    throw Error("Identidade persistida exige revisão.");
  const keys: (keyof Card)[] = [
    "custoMana",
    "alvo",
    "maxAlvos",
    "tiposAlvo",
    "efeitos",
    "varianteCampo",
    "descricao",
    "publicado",
  ];
  const patch = Object.fromEntries(
    keys
      .filter(
        (k) =>
          local[k] !== undefined &&
          JSON.stringify(current[k]) !== JSON.stringify(local[k]),
      )
      .map((k) => [k, local[k]]),
  );
  const unset = Object.fromEntries(
    [
      ...keys.filter((k) => local[k] === undefined && current[k] !== undefined),
      ...["alvoAutomatico", "ignoraEsconder", "opcoes"].filter((k) =>
        Object.prototype.hasOwnProperty.call(current, k),
      ),
    ].map((k) => [k, 1]),
  );
  const candidate = { ...current, ...patch };
  for (const k of Object.keys(unset))
    delete (candidate as Record<string, unknown>)[k];
  const checked = cardSchema.parse(candidate);
  if (playableErrors(checked).length) throw Error("Definição não executável.");
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
    card: Card;
    plan?: ReturnType<typeof fieldSpellPatch>;
  }[] = [];
  for (const id of ids) {
    const record = await CardModel.findOne({ numeroCatalogo: id }).lean();
    const card = cardSchema.parse(initial.find((c) => c.numeroCatalogo === id));
    if (!record) {
      if (id !== "136") {
        console.log(
          JSON.stringify({ card: id, source: "local", changed: false }),
        );
        continue;
      }
      if (playableErrors(card).length) throw Error("Nova carta inválida.");
      plans.push({ record: null, card });
      console.log(JSON.stringify({ card: id, create: true }));
      continue;
    }
    const plan = fieldSpellPatch(record as unknown as Record<string, unknown>);
    const fields = [...Object.keys(plan.patch), ...Object.keys(plan.unset)];
    console.log(
      JSON.stringify({
        card: id,
        changed: !!fields.length,
        version: plan.version,
        fields,
      }),
    );
    if (fields.length) plans.push({ record, card, plan });
  }
  if (process.argv.includes("--apply") && plans.length) {
    await mkdir("backups", { recursive: true });
    const backup = "backups/field-spells-" + Date.now() + ".json";
    await writeFile(
      backup,
      JSON.stringify(
        plans.map((p) => ({
          numeroCatalogo: p.card.numeroCatalogo,
          record: p.record,
        })),
        null,
        2,
      ),
      { flag: "wx" },
    );
    console.log(JSON.stringify({ backup }));
    for (const { record, card, plan } of plans) {
      if (!record) {
        await CardModel.create(card);
        console.log(
          JSON.stringify({ card: card.numeroCatalogo, created: true }),
        );
        continue;
      }
      const result = await CardModel.updateOne(
        { _id: record._id, versao: plan!.version },
        {
          $set: plan!.patch,
          ...(Object.keys(plan!.unset).length ? { $unset: plan!.unset } : {}),
          $inc: { versao: 1 },
        },
        { runValidators: true },
      );
      if (result.matchedCount !== 1)
        throw Error("Versão alterada durante a atualização.");
      console.log(
        JSON.stringify({
          card: plan!.card,
          applied: true,
          version: plan!.version + 1,
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
        "Atualização de feitiços não concluída. Confira versões e catálogo; nenhum segredo foi exibido.",
      );
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
