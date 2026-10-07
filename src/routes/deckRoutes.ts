import { Router } from "express";
import { Types } from "mongoose";
import Deck from "../db/models/decks";
import { AuthRequest } from "../types";
import { deckInput, validateDeck } from "../domain/deck";
import { getCatalog } from "../services/catalog";
import { deckDTO, ownedDeck } from "../services/decks";
import { AppError } from "../lib/errors";
const router = Router();
async function list(req: AuthRequest) {
  const rows = await Deck.collection
    .find({ userId: new Types.ObjectId(req.userId) })
    .toArray();
  return rows.map((row) => deckDTO(row));
}
router.get("/", async (req: AuthRequest, res) => {
  res.json({ success: true, decks: await list(req) });
});
router.get("/user/:id", async (req: AuthRequest, res) => {
  if (req.params.id !== req.userId) throw new AppError(403, "Acesso negado.");
  res.json({ success: true, decks: await list(req) });
});
router.post("/user", async (req: AuthRequest, res) => {
  const input = deckInput.parse(req.body),
    errors = validateDeck(input, await getCatalog());
  if (errors.length)
    throw new AppError(422, "Deck inválido.", "INVALID_DECK", errors);
  const deck = await Deck.create({ ...input, userId: req.userId, revisao: 0 });
  res.status(201).json({
    success: true,
    deck: deckDTO(deck.toObject()),
    content: "Deck criado.",
  });
});
router.get("/:id/play", async (req: AuthRequest, res) => {
  const { deck, catalog } = await ownedDeck(
    String(req.params.id),
    req.userId!,
    true,
  );
  const byId = new Map(catalog.map((c) => [c.numeroCatalogo, c]));
  res.json({
    success: true,
    deck: {
      ...deck,
      mago: byId.get(deck.mago!),
      cartas: deck.cartas.map((id) => byId.get(id)),
    },
  });
});
router.put("/:id", async (req: AuthRequest, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id)))
    throw new AppError(422, "ID inválido.");
  const input = deckInput.parse(req.body),
    errors = validateDeck(input, await getCatalog());
  if (input.revisao === undefined)
    throw new AppError(
      422,
      "Informe revisao para evitar sobrescrever alterações.",
    );
  if (errors.length)
    throw new AppError(422, "Deck inválido.", "INVALID_DECK", errors);
  const { revisao, ...data } = input;
  const revisionFilter =
    revisao === 0
      ? { $or: [{ revisao: 0 }, { revisao: { $exists: false } }] }
      : { revisao };
  const deck = await Deck.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, ...revisionFilter },
    { $set: data, $inc: { revisao: 1 } },
    { new: true, runValidators: true },
  );
  if (!deck) {
    const exists = await Deck.exists({
      _id: req.params.id,
      userId: req.userId,
    });
    throw new AppError(
      exists ? 409 : 404,
      exists
        ? "Deck mudou em outra aba. Recarregue antes de salvar."
        : "Deck não encontrado.",
      exists ? "CONFLICT" : "NOT_FOUND",
    );
  }
  res.json({
    success: true,
    deck: deckDTO(deck.toObject()),
    content: "Deck salvo.",
  });
});
router.delete("/:id", async (req: AuthRequest, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id)))
    throw new AppError(422, "ID inválido.");
  const deck = await Deck.findOneAndDelete({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!deck) throw new AppError(404, "Deck não encontrado.");
  res.json({ success: true, content: "Deck excluído." });
});
export default router;
