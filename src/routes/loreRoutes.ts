import { Router } from "express";
import { loreSlug, saveLoreSchema } from "../types/lore";
import {
  publicLore,
  listPublicLore,
  editorLore,
  listEditorLore,
  loreCards,
  saveLore,
} from "../services/lore";
import { AppError } from "../lib/errors";

export const loreRoutes = Router();
loreRoutes.use((_req, res, next) => {
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  next();
});
loreRoutes.get("/", async (_req, res) =>
  res.json({ success: true, entries: await listPublicLore() }),
);
loreRoutes.get("/:slug", async (req, res) => {
  if (!loreSlug.safeParse(req.params.slug).success)
    throw new AppError(404, "História não encontrada.", "NOT_FOUND");
  res.json({ success: true, entry: await publicLore(req.params.slug) });
});
export const adminLoreRoutes = Router();
adminLoreRoutes.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
adminLoreRoutes.get("/", async (_req, res) => {
  const [entries, cards] = await Promise.all([listEditorLore(), loreCards()]);
  res.json({ success: true, entries, cards });
});
adminLoreRoutes.get("/:slug", async (req, res) => {
  const entry = await editorLore(loreSlug.parse(req.params.slug));
  if (!entry) throw new AppError(404, "História não encontrada.", "NOT_FOUND");
  res.json({ success: true, entry });
});
adminLoreRoutes.put("/:slug", async (req, res) =>
  res.json({
    success: true,
    entry: await saveLore(
      loreSlug.parse(req.params.slug),
      saveLoreSchema.parse(req.body),
    ),
  }),
);
