import express, { Router } from "express";
import { rateLimit } from "../middlewares/rateLimit";
import { cardImageLibrary, storeCardImage } from "../services/card-images";
import { z } from "zod";
import CardModel from "../db/models/Card";
import { cardSchema } from "../types/card";
import {
  getCatalog,
  catalogWithDiagnostics,
  invalidateCatalog,
} from "../services/catalog";
import { playableErrors } from "../game/capabilities";
import { AppError } from "../lib/errors";
const router = Router();
router.get("/card-images", async (req, res) => {
  const { page, q } = z
    .object({
      page: z.coerce.number().int().min(0).max(10000).default(0),
      q: z.string().trim().max(80).default(""),
    })
    .parse(req.query);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, ...(await cardImageLibrary(page, q)) });
});
router.post(
  "/card-images",
  rateLimit(20),
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: "2mb",
  }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body))
      throw new AppError(422, "Envie uma imagem PNG, JPG ou WebP.");
    const name = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("Imagem de carta")
      .parse(req.query.nome);
    res.json({ success: true, image: await storeCardImage(req.body, name) });
  },
);
router.get("/cards", async (_req, res) => {
  res.json({ success: true, ...(await catalogWithDiagnostics(true)) });
});
router.put("/cards/:catalog", async (req, res) => {
  const body = z
    .object({ card: cardSchema, expectedVersion: z.number().int().min(1) })
    .strict()
    .parse(req.body);
  if (body.card.numeroCatalogo !== req.params.catalog)
    throw new AppError(422, "Número do catálogo não corresponde à URL.");
  const errors = playableErrors(body.card);
  if (body.card.publicado && errors.length)
    throw new AppError(
      422,
      "Carta não pode ser publicada.",
      "UNIMPLEMENTED_EFFECT",
      errors,
    );
  const current = (await getCatalog()).find(
    (c) => c.numeroCatalogo === body.card.numeroCatalogo,
  );
  if (current && current.versao !== body.expectedVersion)
    throw new AppError(409, "A carta foi alterada. Recarregue.", "CONFLICT");
  const existing = await CardModel.findOne({
    numeroCatalogo: body.card.numeroCatalogo,
  });
  const next = { ...body.card, versao: body.expectedVersion + 1 };
  if (existing) {
    const versionFilter =
      body.expectedVersion === 1
        ? { $or: [{ versao: 1 }, { versao: { $exists: false } }] }
        : { versao: body.expectedVersion };
    const updated = await CardModel.findOneAndUpdate(
      {
        numeroCatalogo: body.card.numeroCatalogo,
        ...versionFilter,
      },
      { $set: next },
      { new: true, runValidators: true },
    );
    if (!updated)
      throw new AppError(409, "A carta foi alterada. Recarregue.", "CONFLICT");
  } else await CardModel.create(next);
  invalidateCatalog();
  res.json({
    success: true,
    card: next,
    content: "Carta salva. Partidas em curso mantêm sua versão.",
  });
});
export default router;
