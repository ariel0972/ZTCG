import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import Match from "../db/models/match";
import User from "../db/models/user";
import { AdminAudit } from "../db/models/admin";
import { AppError } from "../lib/errors";
import { memberIdSchema } from "./admin-members";
import { requireActingAdmin } from "./admin-moderation";
import { withResultControl } from "./result-control";
import {
  addAffected,
  reconcileResultPolicies,
  refreshAffectedRankings,
} from "./result-settlement";
const selectionSchema = z
  .object({
    all: z.boolean(),
    matchIds: z.array(z.string().min(1).max(80)).max(200).default([]),
  })
  .strict()
  .refine(
    (v) => (v.all ? v.matchIds.length === 0 : v.matchIds.length > 0),
    "Escolha batalhas ou todo o histórico.",
  );
const hashIds = (ids: string[]) =>
  createHash("sha256")
    .update(JSON.stringify([...ids].sort()))
    .digest("hex");
async function selectedMatches(
  id: string,
  selection: z.infer<typeof selectionSchema>,
) {
  return Match.find({
    "players.userId": id,
    deletedAt: { $exists: false },
    ...(selection.all ? {} : { matchId: { $in: selection.matchIds } }),
  })
    .select("matchId players")
    .lean();
}
export async function previewHistoryDeletion(
  actorId: string,
  rawId: unknown,
  input: unknown,
) {
  const id = memberIdSchema.parse(rawId),
    selection = selectionSchema.parse(input);
  await requireActingAdmin(actorId);
  if (!(await User.exists({ _id: id })))
    throw new AppError(404, "Conta não encontrada.");
  const rows = await selectedMatches(id, selection);
  if (!rows.length)
    throw new AppError(409, "Nenhuma batalha disponível para excluir.");
  if (!selection.all && rows.length !== new Set(selection.matchIds).size)
    throw new AppError(
      409,
      "Uma batalha não pertence à conta ou já foi excluída. Recarregue.",
    );
  const ids = rows.map((m) => m.matchId),
    players = new Map<string, string>();
  rows.forEach((m) =>
    m.players.forEach((p) =>
      players.set(String(p.userId), p.nome ?? "Jogador"),
    ),
  );
  const token = jwt.sign(
    {
      purpose: "admin:delete-history",
      actorId,
      targetId: id,
      selection,
      hash: hashIds(ids),
      actionId: randomUUID(),
    },
    process.env.SECRET!,
    { algorithm: "HS256", expiresIn: "5m" },
  );
  return {
    count: ids.length,
    players: [...players].map(([id, nome]) => ({ id, nome })),
    token,
  };
}
type DeletionOperation = {
  _id?: string | null;
  actorId?: string | null;
  targetId?: string | null;
  action?: string | null;
  selectionHash?: string | null;
  status?: string | null;
  matchIds?: string[] | null;
  count?: number | null;
};
async function finishDeletion(operation: DeletionOperation) {
  const ids = operation.matchIds ?? [];
  const rows = await Match.find({ matchId: { $in: ids } })
    .select("matchId players")
    .lean();
  await Match.updateMany(
    { matchId: { $in: ids }, deletedAt: { $exists: false } },
    {
      $set: {
        deletedAt: new Date(),
        deletedBy: operation.actorId,
        deletionAction: String(operation._id),
      },
    },
  );
  const affected = await reconcileResultPolicies([
    ...new Set(rows.flatMap((r) => r.players.map((p) => String(p.userId)))),
  ]);
  rows.forEach((r) => addAffected(affected, r.players));
  await refreshAffectedRankings(affected);
  await AdminAudit.updateOne(
    { _id: operation._id },
    { $set: { status: "complete" } },
  );
  return {
    count: operation.count ?? ids.length,
    affectedPlayers: affected.size,
  };
}
export async function applyHistoryDeletion(
  actorId: string,
  rawId: unknown,
  input: unknown,
) {
  const id = memberIdSchema.parse(rawId),
    body = z
      .object({ token: z.string().max(40000) })
      .strict()
      .parse(input);
  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(body.token, process.env.SECRET!, {
      algorithms: ["HS256"],
      ignoreExpiration: true,
    });
    if (typeof verified === "string") throw Error();
    payload = verified;
  } catch {
    throw new AppError(422, "Confirmação de exclusão inválida.");
  }
  if (
    payload.purpose !== "admin:delete-history" ||
    payload.actorId !== actorId ||
    payload.targetId !== id ||
    !z.uuid().safeParse(payload.actionId).success
  )
    throw new AppError(403, "A confirmação não pertence a esta operação.");
  return withResultControl(async () => {
    await requireActingAdmin(actorId);
    let operation: DeletionOperation | null = await AdminAudit.findById(
      payload.actionId,
    ).lean();
    if (
      operation &&
      (operation.actorId !== actorId ||
        operation.targetId !== id ||
        operation.action !== "deleteMatches" ||
        operation.selectionHash !== payload.hash)
    )
      throw new AppError(409, "Identificador de operação já utilizado.");
    if (operation?.status === "complete")
      return { count: operation.count ?? 0, duplicate: true };
    if (!operation) {
      if (!payload.exp || payload.exp * 1000 < Date.now())
        throw new AppError(
          409,
          "A confirmação expirou. Revise o histórico novamente.",
        );
      const selection = selectionSchema.parse(payload.selection),
        rows = await selectedMatches(id, selection),
        ids = rows.map((m) => m.matchId);
      if (!ids.length || hashIds(ids) !== payload.hash)
        throw new AppError(
          409,
          "O histórico mudou. Revise a seleção antes de excluir.",
          "CONFLICT",
        );
      operation = (
        await AdminAudit.create({
          _id: payload.actionId,
          actorId,
          targetId: id,
          action: "deleteMatches",
          count: ids.length,
          status: "pending",
          matchIds: ids,
          selectionHash: payload.hash,
          createdAt: new Date(),
        })
      ).toObject();
    }
    return { ...(await finishDeletion(operation!)), duplicate: false };
  });
}
export async function recoverHistoryDeletions() {
  const pending = await AdminAudit.find({
    action: "deleteMatches",
    status: "pending",
  })
    .limit(5)
    .lean();
  for (const operation of pending)
    await withResultControl(async () => {
      const current = await AdminAudit.findById(operation._id).lean();
      if (current?.status === "pending") await finishDeletion(current);
    });
  return pending.length;
}
