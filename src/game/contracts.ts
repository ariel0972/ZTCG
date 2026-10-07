import { z } from "zod";
const id = z.string().min(1).max(80);
const base = { actionId: z.uuid(), version: z.number().int().min(0) };
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({ ...base, type: z.literal("respondSpell"), cardId: id.optional() })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("play"),
      cardId: id,
      slotId: id.optional(),
      targets: z.array(id).max(3).default([]),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("attack"),
      slotId: id,
      targetId: id,
      source: z.enum(["card", "structure"]).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("ability"),
      slotId: id,
      abilityId: id,
      source: z.enum(["card", "structure"]).optional(),
      targets: z.array(id).max(3).default([]),
      mode: z.enum(["cura", "escudo"]).optional(),
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
  z.object({ ...base, type: z.literal("sacrifice"), slotId: id }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
