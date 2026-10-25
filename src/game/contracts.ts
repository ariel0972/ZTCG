import { z } from "zod";
const id = z.string().min(1).max(80);
const base = { actionId: z.uuid(), version: z.number().int().min(0) };
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("chooseCoin"),
      face: z.enum(["heads", "tails"]),
    })
    .strict(),
  z.object({ ...base, type: z.literal("discardHand"), cardId: id }).strict(),
  z
    .object({ ...base, type: z.literal("withdrawPreparation"), slotId: id })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("chooseRevive"),
      cardId: id.optional(),
      destinationId: id.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("respondDodge"),
      dodge: z.boolean(),
      choiceKey: id.optional(),
    })
    .strict(),
  z
    .object({ ...base, type: z.literal("chooseHand"), cardId: id.optional() })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("mount"),
      slotId: id,
      destinationId: id,
    })
    .strict(),
  z.object({ ...base, type: z.literal("dismount"), slotId: id }).strict(),
  z
    .object({ ...base, type: z.literal("respondAttack"), reflect: z.boolean() })
    .strict(),
  z
    .object({ ...base, type: z.literal("respondSpell"), cardId: id.optional() })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("play"),
      mode: id.optional(),
      cardId: id,
      slotId: id.optional(),
      destinationId: id.optional(),
      targets: z.array(id).max(3).default([]),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("attack"),
      slotId: id,
      targetId: id,
      source: z.enum(["card", "structure", "rider"]).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("ability"),
      slotId: id,
      abilityId: id,
      destinationId: id.optional(),
      source: z.enum(["card", "structure", "rider"]).optional(),
      targets: z.array(id).max(3).default([]),
      mode: id.optional(),
    })
    .strict(),
  z
    .object({ ...base, type: z.literal("move"), slotId: id, destinationId: id })
    .strict(),
  z.object({ ...base, type: z.literal("endTurn") }).strict(),
  z.object({ ...base, type: z.literal("surrender") }).strict(),
  z.object({ ...base, type: z.literal("mulligan") }).strict(),
  z
    .object({
      ...base,
      type: z.literal("preparationBonus"),
      accept: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("sacrifice"),
      slotId: id,
      source: z.enum(["card", "rider"]).optional(),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
