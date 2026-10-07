import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import User from "../db/models/user";
import { Friendship, Invitation } from "../db/models/social";
import { AuthRequest } from "../types";
import { checkToken } from "../middlewares/checkToken";
import { AppError } from "../lib/errors";
import { rateLimit } from "../middlewares/rateLimit";
import { DurableGame } from "../game/durable";
import { ownedDeck } from "../services/decks";
const id = z.string().regex(/^[a-f\d]{24}$/i);
const key = (a: string, b: string) => [a, b].sort().join(":");
export function friendRoutes(game: DurableGame) {
  const router = Router();
  router.use(checkToken);
  router.get("/search", rateLimit(30), async (req: AuthRequest, res) => {
    const q = z.string().trim().min(3).max(80).parse(req.query.q);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await User.find({
      nome: { $regex: escaped, $options: "i" },
      _id: { $ne: req.userId },
    })
      .select("nome avatarURL")
      .limit(20)
      .lean();
    res.json({
      success: true,
      users: users.map((u) => ({
        id: String(u._id),
        nome: u.nome,
        avatarURL: u.avatarURL,
      })),
    });
  });
  router.get("/", async (req: AuthRequest, res) => {
    const relations = await Friendship.find({ members: req.userId }).lean();
    const otherIds = relations.flatMap((r) =>
      r.members.filter((v) => v !== req.userId),
    );
    const users = await User.find({ _id: { $in: otherIds } })
      .select("nome avatarURL")
      .lean();
    const names = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      success: true,
      relations: relations.map((r) => {
        const friendId = r.members.find((v) => v !== req.userId)!;
        const user = names.get(friendId);
        return {
          id: friendId,
          nome: user?.nome ?? "Conta indisponível",
          avatarURL: user?.avatarURL,
          status: r.status,
          incoming: r.requestedBy !== req.userId,
        };
      }),
    });
  });
  router.post("/requests", rateLimit(20), async (req: AuthRequest, res) => {
    const { userId } = z.object({ userId: id }).strict().parse(req.body),
      user = req.userId!;
    if (user === userId)
      throw new AppError(422, "Você não pode adicionar a si mesmo.");
    if (!(await User.exists({ _id: userId })))
      throw new AppError(404, "Jogador não encontrado.");
    await Friendship.findOneAndUpdate(
      { key: key(user, userId) },
      {
        $setOnInsert: {
          members: [user, userId],
          requestedBy: user,
          status: "pending",
        },
      },
      { upsert: true },
    );
    res.json({ success: true, content: "Pedido de amizade enviado." });
  });
  router.post("/requests/:id/accept", async (req: AuthRequest, res) => {
    const other = id.parse(req.params.id),
      user = req.userId!;
    const relation = await Friendship.findOneAndUpdate(
      { key: key(user, other), requestedBy: other, status: "pending" },
      { $set: { status: "accepted" } },
    );
    if (
      !relation &&
      !(await Friendship.exists({ key: key(user, other), status: "accepted" }))
    )
      throw new AppError(404, "Pedido recebido não encontrado.");
    res.json({ success: true, content: "Amizade aceita." });
  });
  router.delete("/:id", async (req: AuthRequest, res) => {
    await Friendship.deleteOne({
      key: key(req.userId!, id.parse(req.params.id)),
    });
    res.json({ success: true, content: "Amizade ou pedido removido." });
  });
  router.get("/invites", async (req: AuthRequest, res) => {
    const invites = await Invitation.find({
      $or: [{ from: req.userId }, { to: req.userId }],
      expires: { $gt: new Date() },
      status: { $in: ["pending", "starting", "accepted"] },
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    const people = await User.find({
      _id: { $in: invites.flatMap((i) => [i.from, i.to]) },
    })
      .select("nome")
      .lean();
    const names = new Map(people.map((p) => [String(p._id), p.nome]));
    res.json({
      success: true,
      invites: invites.map((i) => ({
        id: i.invitationId,
        from: i.from,
        to: i.to,
        fromName: names.get(i.from),
        toName: names.get(i.to),
        expires: i.expires,
        status: i.status,
        matchId: i.matchId,
      })),
    });
  });
  router.post("/invites", rateLimit(10), async (req: AuthRequest, res) => {
    const { userId, deckId } = z
      .object({ userId: id, deckId: id })
      .strict()
      .parse(req.body);
    if (
      !(await Friendship.exists({
        key: key(req.userId!, userId),
        status: "accepted",
      }))
    )
      throw new AppError(403, "Vocês precisam aceitar a amizade primeiro.");
    await ownedDeck(deckId, req.userId!, true);
    const invite = await Invitation.create({
      invitationId: randomUUID(),
      from: req.userId,
      to: userId,
      deckId,
      expires: new Date(Date.now() + 300000),
    });
    res.json({
      success: true,
      id: invite.invitationId,
      content: "Convite enviado. Válido por 5 minutos.",
    });
  });
  router.post("/invites/:id/accept", async (req: AuthRequest, res) => {
    const invitationId = z.uuid().parse(req.params.id),
      { deckId } = z.object({ deckId: id }).strict().parse(req.body);
    let invite = await Invitation.findOne({ invitationId, to: req.userId });
    if (!invite) throw new AppError(404, "Convite não encontrado.");
    if (invite.status === "accepted") {
      res.json({ success: true, matchId: invite.matchId });
      return;
    }
    if (
      !["pending", "starting"].includes(invite.status!) ||
      invite.expires.getTime() <= Date.now()
    )
      throw new AppError(409, "Convite encerrado ou expirado.");
    if (
      !(await Friendship.exists({
        key: key(invite.from, invite.to),
        status: "accepted",
      }))
    )
      throw new AppError(403, "Amizade não está mais ativa.");
    if (invite.status === "pending") {
      const reserved = await Invitation.findOneAndUpdate(
        { invitationId, status: "pending" },
        { $set: { status: "starting", chosenDeckId: deckId } },
        { new: true },
      );
      invite =
        reserved ??
        (await Invitation.findOne({ invitationId, to: req.userId }));
    }
    if (!invite || invite.status !== "starting")
      throw new AppError(409, "Convite mudou. Atualize a página.");
    const from = await User.findById(invite.from),
      to = await User.findById(invite.to);
    if (!from || !to) throw new AppError(404, "Jogador não encontrado.");
    try {
      const result = await game.startPrivate(invitationId, [
        { id: invite.from, nome: from.nome, deckId: invite.deckId },
        { id: invite.to, nome: to.nome, deckId: invite.chosenDeckId! },
      ]);
      await Invitation.updateOne(
        { invitationId, status: "starting" },
        { $set: { status: "accepted", matchId: result.matchId } },
      );
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof AppError && error.status < 500)
        await Invitation.updateOne(
          { invitationId, status: "starting" },
          { $set: { status: "pending" }, $unset: { chosenDeckId: "" } },
        );
      throw error;
    }
  });
  router.post("/invites/:id/decline", async (req: AuthRequest, res) => {
    const invitationId = z.uuid().parse(req.params.id);
    const result = await Invitation.updateOne(
      {
        invitationId,
        status: "pending",
        $or: [{ to: req.userId }, { from: req.userId }],
      },
      { $set: { status: "declined" } },
    );
    if (!result.matchedCount)
      throw new AppError(409, "Convite não está disponível.");
    res.json({ success: true, content: "Convite encerrado." });
  });
  return router;
}
