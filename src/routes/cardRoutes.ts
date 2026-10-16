import { Router } from "express";
import { z } from "zod";
import { getCatalog } from "../services/catalog";
import {
  cardSchema,
  cardTypes,
  elements,
  targets,
  triggers,
} from "../types/card";
import { deckRules } from "../domain/deck";
import { passiveTemplates } from "../game/passives";
import {
  effectIds,
  abilityIds,
  passiveIds,
  legacyPassiveIds,
  playableErrors,
} from "../game/capabilities";
export const cardRoutes = Router();
cardRoutes.get("/", async (_req, res) => {
  const cards = await getCatalog();
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.json({ success: true, cards, rules: deckRules });
});
cardRoutes.get("/schema", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    success: true,
    tipos: cardTypes,
    elementos: elements,
    alvos: targets,
    gatilhos: triggers,
    efeitos: effectIds,
    habilidades: abilityIds,
    passivas: passiveIds,
    passivasLegadas: legacyPassiveIds,
    modelosPassivos: passiveTemplates,
    schema: z.toJSONSchema(cardSchema, { unrepresentable: "any" }),
  });
});
cardRoutes.post("/validate", async (req, res) => {
  const card = cardSchema.parse(req.body);
  res.json({ success: true, card, publicationErrors: playableErrors(card) });
});
