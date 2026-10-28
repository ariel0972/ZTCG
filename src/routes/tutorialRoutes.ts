import { Router } from "express";
import { z } from "zod";
import { checkToken } from "../middlewares/checkToken";
import { rateLimit } from "../middlewares/rateLimit";
import type { AuthRequest } from "../types";
import {
  tutorialState,
  tutorialAction,
  restartTutorial,
} from "../services/tutorial";
const router = Router();
router.use(checkToken);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const base = { actionId: z.uuid(), version: z.number().int().min(0) };
const input = z
  .object({
    ...base,
    type: z.enum([
      "continue",
      "inspect",
      "play",
      "endTurn",
      "chooseCoin",
      "ability",
      "attack",
      "inspectGraveyard",
      "skip",
    ]),
    cardId: z.string().min(1).max(80).optional(),
    slotId: z.string().min(1).max(100).optional(),
    targetId: z.string().min(1).max(100).optional(),
    abilityId: z.string().min(1).max(80).optional(),
    targets: z.array(z.string().min(1).max(80)).max(1).optional(),
    face: z.enum(["heads", "tails"]).optional(),
  })
  .strict();
router.get("/state", async (req: AuthRequest, res) =>
  res.json(await tutorialState(req.userId!)),
);
router.post("/action", rateLimit(90), async (req: AuthRequest, res) =>
  res.json(await tutorialAction(req.userId!, input.parse(req.body))),
);
router.post("/restart", rateLimit(12), async (req: AuthRequest, res) => {
  const data = z.object(base).strict().parse(req.body);
  res.json(await restartTutorial(req.userId!, data.version, data.actionId));
});
export default router;
