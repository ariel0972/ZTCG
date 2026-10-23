import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import dbConnect from "../src/lib/mongodb";
import Match from "../src/db/models/match";
import User from "../src/db/models/user";
import Deck from "../src/db/models/decks";
import { AdminAudit } from "../src/db/models/admin";
import { withResultControl } from "../src/services/result-control";
import { rebuildRankings } from "../src/services/ranking-projections";
import {
  planResultRecalculation,
  recalculationSummary,
} from "./lib/recalculate-results-plan";
import { experienceHistory } from "../src/services/experience";
async function snapshot() {
  const [matches, users, decks] = await Promise.all([
    Match.find().lean(),
    User.find().select({ _id: 1, ranking: 1 }).lean(),
    Deck.find().select("_id userId +ranking").lean(),
  ]);
  return { matches, users, decks };
}
export async function recalculateAllResults(apply = false) {
  const run = async (checkpoint: () => Promise<void>) => {
    const original = await snapshot(),
      plan = planResultRecalculation(original.matches);
    const ids = original.users.map((u) => String(u._id));
    const summary = recalculationSummary(original.matches, plan.matches, ids);
    console.log(
      JSON.stringify({
        mode: apply ? "apply" : "preview",
        ...summary,
        updates: plan.updates.length,
      }),
    );
    if (!apply) return summary;
    await checkpoint();
    await mkdir("backups", { recursive: true });
    const operationId = randomUUID(),
      backup =
        "backups/result-recalculation-" +
        Date.now() +
        "-" +
        operationId +
        ".json";
    await writeFile(
      backup,
      JSON.stringify({ operationId, at: new Date(), ...original }, null, 2),
      { flag: "wx" },
    );
    console.log(JSON.stringify({ backup, operationId }));
    await checkpoint();
    await AdminAudit.create({
      _id: operationId,
      actorId: "authorized-maintenance",
      action: "recalculateResults",
      status: "pending",
      count: plan.updates.length,
      createdAt: new Date(),
      reason:
        "Aplicar regras atuais a todo o histórico por solicitação do proprietário.",
    });
    for (let i = 0; i < plan.updates.length; i++) {
      await checkpoint();
      const change = plan.updates[i],
        result = await Match.updateOne(
          { matchId: change.matchId, deletedAt: { $exists: false } },
          { $set: change.set },
          {
            writeConcern: { w: "majority", wtimeout: 5000 },
            runValidators: true,
          },
        );
      if (result.matchedCount !== 1)
        throw Error("Partida alterada durante o recálculo: " + change.matchId);
      if ((i + 1) % 100 === 0)
        console.log(
          JSON.stringify({ updated: i + 1, total: plan.updates.length }),
        );
    }
    await checkpoint();
    const verified = await Match.find().lean(),
      remaining = planResultRecalculation(verified).updates;
    if (remaining.length)
      throw Error("Verificação encontrou partidas ainda não recalculadas.");
    await rebuildRankings(true, checkpoint);
    const projected = await User.find().select({ _id: 1, ranking: 1 }).lean();
    for (const user of projected) {
      const id = String(user._id),
        expected = experienceHistory(
          id,
          verified.filter((r) =>
            r.players.some((p) => String(p.userId) === id),
          ),
        ).stats;
      if (JSON.stringify(user.ranking?.stats) !== JSON.stringify(expected))
        throw Error("Projeção divergente para uma conta.");
    }
    await checkpoint();
    await AdminAudit.updateOne(
      { _id: operationId },
      { $set: { status: "complete" } },
    );
    console.log(JSON.stringify({ applied: true, verified: true, ...summary }));
    return summary;
  };
  return apply ? withResultControl(run) : run(async () => {});
}
if (require.main === module) {
  dotenv.config({ path: process.env.RESULTS_ENV_FILE ?? ".env", quiet: true });
  void dbConnect()
    .then(() => recalculateAllResults(process.argv.includes("--apply")))
    .catch((error) => {
      // Avoid driver errors containing connection strings or credentials.
      console.error(
        JSON.stringify({
          failed: true,
          type: error instanceof Error ? error.name : "Unknown",
          message:
            "Recálculo não concluído; preserve o backup e execute novamente após verificar a causa.",
        }),
      );
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
