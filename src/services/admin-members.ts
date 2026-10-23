import { z } from "zod";
import User from "../db/models/user";
import Match from "../db/models/match";
import { profileExperience } from "./profiles";
import { resultEligibility } from "./result-policy";
import { AppError } from "../lib/errors";
const pageSchema = z.coerce.number().int().min(0).max(10000).default(0);
export const memberIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export function adminMemberDTO(user: {
  _id: unknown;
  nome: string;
  email: string;
  avatarURL?: string;
  admin?: boolean;
  moderation?: {
    banned?: boolean;
    suspendedUntil?: Date | null;
    reason?: string;
    by?: string;
    at?: Date;
  };
  managementVersion?: number;
}) {
  return {
    id: String(user._id),
    nome: user.nome,
    email: user.email,
    avatarURL: user.avatarURL ?? "/assets/avatar.png",
    admin: !!user.admin,
    managementVersion: user.managementVersion ?? 0,
    moderation: {
      banned: !!user.moderation?.banned,
      suspendedUntil: user.moderation?.suspendedUntil ?? null,
      reason: user.moderation?.reason ?? "",
    },
  };
}
export async function listAdminMembers(query: unknown) {
  const { q, page } = z
    .object({ q: z.string().trim().max(100).default(""), page: pageSchema })
    .strict()
    .parse(query);
  const search = q.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const filter = q
    ? {
        $or: [
          { nome: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }
    : {};
  const rows = await User.find(filter)
    .select("_id nome email avatarURL admin managementVersion moderation")
    .sort({ _id: 1 })
    .skip(page * 50)
    .limit(51)
    .lean();
  return {
    users: rows.slice(0, 50).map(adminMemberDTO),
    page,
    hasMore: rows.length > 50,
  };
}
export async function adminMemberMatches(rawId: unknown, rawPage: unknown) {
  const id = memberIdSchema.parse(rawId),
    page = pageSchema.parse(rawPage);
  const user = await User.findById(id)
    .select("_id nome email avatarURL admin managementVersion moderation")
    .lean();
  if (!user) throw new AppError(404, "Conta não encontrada.");
  const matches = await Match.find({
    "players.userId": id,
    deletedAt: { $exists: false },
  })
    .select(
      "matchId players winner reason turns finishedAt rulesVersion surrenderStreak resultReady",
    )
    .sort({ finishedAt: -1, matchId: -1 })
    .skip(page * 20)
    .limit(21)
    .lean();
  const experience = await profileExperience(id);
  return {
    stats: experience.stats,
    user: adminMemberDTO(user),
    page,
    hasMore: matches.length > 20,
    matches: matches.slice(0, 20).map((m) => ({
      matchId: m.matchId,
      players: m.players.map((p) => ({ id: String(p.userId), nome: p.nome })),
      winner: m.winner,
      reason: m.reason,
      ...resultEligibility(m),
      ...experience.awards.get(m.matchId),
      turns: m.turns,
      finishedAt: m.finishedAt,
    })),
  };
}
