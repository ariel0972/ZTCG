import { z } from "zod";
import User from "../db/models/user";
import { AdminAudit } from "../db/models/admin";
import { AppError } from "../lib/errors";
import { accountRestriction, assertAccountAccess } from "./account-access";
import { withResultControl } from "./result-control";
import { memberIdSchema, adminMemberDTO } from "./admin-members";
export async function requireActingAdmin(id: string) {
  const actor = await User.findById(id).select("admin moderation").lean();
  if (!actor?.admin)
    throw new AppError(403, "Acesso restrito a administradores.");
  assertAccountAccess(actor);
}
export const moderationSchema = z
  .object({
    actionId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    action: z.enum([
      "ban",
      "unban",
      "suspend",
      "unsuspend",
      "promote",
      "demote",
    ]),
    hours: z
      .union([z.literal(2), z.literal(12), z.literal(24), z.literal(72)])
      .optional(),
    reason: z.string().trim().max(500).default(""),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === "suspend") !== (v.hours !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Informe o prazo somente para suspensão.",
      });
  });
export async function moderateMember(
  actorId: string,
  rawId: unknown,
  input: unknown,
  now = Date.now(),
) {
  const id = memberIdSchema.parse(rawId),
    body = moderationSchema.parse(input);
  if (id === actorId)
    throw new AppError(409, "Você não pode moderar a própria conta.");
  return withResultControl(async () => {
    await requireActingAdmin(actorId);
    const target = await User.findById(id)
      .select(
        "nome email avatarURL admin moderation managementVersion +managementLastActionId",
      )
      .lean();
    if (!target) throw new AppError(404, "Conta não encontrada.");
    const audit = await AdminAudit.findById(body.actionId).lean();
    if (
      audit &&
      (audit.actorId !== actorId ||
        audit.targetId !== id ||
        audit.action !== body.action)
    )
      throw new AppError(409, "Identificador de operação já utilizado.");
    if (audit || target.managementLastActionId === body.actionId)
      return { user: adminMemberDTO(target), duplicate: true };
    const version = target.managementVersion ?? 0;
    if (version !== body.expectedVersion)
      throw new AppError(
        409,
        "A conta foi alterada. Recarregue antes de continuar.",
        "CONFLICT",
      );
    if (
      target.admin &&
      !accountRestriction(target, now) &&
      ["ban", "suspend", "demote"].includes(body.action)
    ) {
      const admins = await User.find({ admin: true })
        .select("moderation")
        .lean();
      if (admins.filter((u) => !accountRestriction(u, now)).length <= 1)
        throw new AppError(
          409,
          "Não é possível bloquear ou remover o último administrador ativo.",
        );
    }
    let moderation = {
      ...(target.moderation ?? {}),
      reason: body.reason,
      by: actorId,
      at: new Date(now),
    };
    let role = target.admin;
    switch (body.action) {
      case "ban":
        moderation = { ...moderation, banned: true, suspendedUntil: null };
        break;
      case "unban":
        moderation.banned = false;
        break;
      case "suspend":
        if (moderation.banned)
          throw new AppError(
            409,
            "Desfaça o banimento antes de aplicar uma suspensão.",
          );
        moderation.suspendedUntil = new Date(now + body.hours! * 3600000);
        break;
      case "unsuspend":
        moderation.suspendedUntil = null;
        break;
      case "promote":
        role = true;
        break;
      case "demote":
        role = false;
        break;
    }
    const updated = await User.findOneAndUpdate(
      {
        _id: id,
        ...(version
          ? { managementVersion: version }
          : {
              $or: [
                { managementVersion: 0 },
                { managementVersion: { $exists: false } },
              ],
            }),
      },
      {
        $set: {
          admin: role,
          moderation,
          managementLastActionId: body.actionId,
        },
        $inc: { managementVersion: 1, sessionVersion: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!updated)
      throw new AppError(
        409,
        "A conta foi alterada. Recarregue antes de continuar.",
        "CONFLICT",
      );
    await AdminAudit.create({
      _id: body.actionId,
      actorId,
      targetId: id,
      action: body.action,
      reason: body.reason,
      createdAt: new Date(now),
    });
    return { user: adminMemberDTO(updated), duplicate: false };
  });
}
