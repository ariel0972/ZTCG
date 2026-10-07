import { Router } from "express";
import { z } from "zod";
import User from "../db/models/user";
import CardModel from "../db/models/Card";
import { cardSchema } from "../types/card";
import { getCatalog, catalogWithDiagnostics } from "../services/catalog";
import { playableErrors } from "../game/capabilities";
import { AppError } from "../lib/errors";
const router = Router();
router.get("/users", async (_req, res) => {
  const users = await User.find().select("-senha").limit(100);
  res.json({ success: true, users });
});
router.get("/cards", async (_req, res) => {
  res.json({ success: true, ...(await catalogWithDiagnostics()) });
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
  res.json({
    success: true,
    card: next,
    content: "Carta salva. Partidas em curso mantêm sua versão.",
  });
});
export default router;
