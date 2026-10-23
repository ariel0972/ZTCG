import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { AuthRequest } from "../types";
import type { DurableGame } from "../game/durable";
import {
  listAdminMembers,
  adminMemberMatches,
} from "../services/admin-members";
import { moderateMember } from "../services/admin-moderation";
import {
  previewHistoryDeletion,
  applyHistoryDeletion,
} from "../services/admin-history";
export function adminMemberRoutes(game: DurableGame) {
  const router = Router();
  router.get("/", async (req, res) =>
    res.json({ success: true, ...(await listAdminMembers(req.query)) }),
  );
  router.get("/:id/matches", async (req, res) =>
    res.json({
      success: true,
      ...(await adminMemberMatches(req.params.id, req.query.page)),
    }),
  );
  router.post("/:id/moderation", async (req: AuthRequest, res) => {
    const result = await moderateMember(req.userId!, req.params.id, req.body);
    if (["ban", "suspend"].includes(req.body.action))
      await game.cancel(String(req.params.id), randomUUID());
    res.json({
      success: true,
      ...result,
      content: "Conta atualizada. As sessões anteriores foram encerradas.",
    });
  });
  router.post("/:id/history-preview", async (req: AuthRequest, res) =>
    res.json({
      success: true,
      ...(await previewHistoryDeletion(req.userId!, req.params.id, req.body)),
    }),
  );
  router.post("/:id/history-delete", async (req: AuthRequest, res) =>
    res.json({
      success: true,
      ...(await applyHistoryDeletion(req.userId!, req.params.id, req.body)),
      content:
        "Batalhas excluídas. XP, estatísticas e rankings dos dois jogadores foram recalculados.",
    }),
  );
  return router;
}
