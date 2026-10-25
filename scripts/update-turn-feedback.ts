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
const ids = ["008", "009", "019", "094"];
export function turnFeedbackPatch(record: Record<string, unknown>) {
  const current = cleanCard(record);
  if (!ids.includes(current.numeroCatalogo))
    throw Error("Carta fora da atualização de Ar e Luz.");
  const local = cardSchema.parse(
    initial.find((c) => c.numeroCatalogo === current.numeroCatalogo),
  );
  if (current.tipo !== local.tipo)
    throw Error("O tipo da carta persistida exige revisão.");
  const desired = structuredClone(current);
  desired.descricao = local.descricao;
  const keys: (keyof Card)[] = ["descricao"];
  if (current.numeroCatalogo === "019") {
    keys.push("habilidadesAtivas");
    const h = desired.habilidadesAtivas.find((h) => h.id === "moverLivremente");
    if (
      !h?.efeitos?.some((e) => e.id === "status" && e.status === "Campo livre")
    )
      throw Error("Habilidade de Ar alterada: revisão necessária.");
    h.efeitos = h.efeitos.map((e) =>
      e.id === "status" && e.status === "Campo livre"
        ? { ...e, trocaAliada: true }
        : e,
    );
    h.descricao = local.habilidadesAtivas.find(
      (h) => h.id === "moverLivremente",
    )?.descricao;
  } else {
    keys.push("efeitos");
    if (current.numeroCatalogo === "094") {
      if (!desired.efeitos.some((e) => e.id === "displace"))
        throw Error("Deslocamento alterado: revisão necessária.");
      desired.efeitos = desired.efeitos.map((e) =>
        e.id === "displace" ? { ...e, semDestino: "manter" } : e,
      );
    } else if (current.numeroCatalogo === "009") {
      desired.efeitos = desired.efeitos.filter(
        (e) => !(e.id === "stealDeck" && e.elementoMago === "Ar"),
      );
      desired.efeitos.push({ id: "stealDeck", valor: 1, elementoMago: "Ar" });
    } else {
      const e = desired.efeitos.find((e) => e.id === "lightOrb");
      if (!e) throw Error("Bola de Luz alterada: revisão necessária.");
      const old = e.variantesMago;
      e.variantesMago = (
        ["Fogo", "Agua", "Terra", "Ar", "Zarcos", "Neutro"] as const
      ).map((elemento) => {
        const v = old?.find((v) => v.elemento === elemento);
        return {
          ...v,
          elemento,
          causaDano: v?.causaDano ?? (old === undefined && elemento === "Fogo"),
          efeitos: [
            ...(v?.efeitos ?? []).filter(
              (s) => !["Queimado", "Queimando", "Queimacao"].includes(s.status),
            ),
            {
              id: "status" as const,
              alvo: "TodosInimigos" as const,
              status: "Queimado",
              duracao: 2,
              valor: 1,
            },
          ],
        };
      });
    }
  }
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
    plan: ReturnType<typeof turnFeedbackPatch>;
  }[] = [];
  for (const id of ids) {
    const record = await CardModel.findOne({ numeroCatalogo: id }).lean();
    if (!record) {
      console.log(
        JSON.stringify({ card: id, source: "local", changed: false }),
      );
      continue;
    }
    const plan = turnFeedbackPatch(
      record as unknown as Record<string, unknown>,
    );
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
    const backup = "backups/turn-feedback-" + Date.now() + ".json";
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
        "Atualização das regras de Ar e Luz não concluída. Revise versões e catálogo; nenhum segredo foi exibido.",
      );
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
