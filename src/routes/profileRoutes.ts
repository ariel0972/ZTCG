import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import User from "../db/models/user";
import Deck from "../db/models/decks";
import Match from "../db/models/match";
import { AuthRequest } from "../types";
import { AppError } from "../lib/errors";
import { profileStats } from "../services/profiles";
import { deckDTO } from "../services/decks";
export const profileRoutes = Router();
profileRoutes.get("/:id", async (req: AuthRequest, res) => {
  const id = z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(req.params.id);
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(0)
    .parse(req.query.page);
  const owner = id === req.userId;
  const user = await User.findById(id).select("nome avatarURL").lean();
  if (!user) throw new AppError(404, "Jogador não encontrado.");
  const [stats, decks, matches] = await Promise.all([
    profileStats(id),
    Deck.collection
      .find({
        userId: new Types.ObjectId(id),
        ...(owner ? {} : { publico: true }),
      })
      .toArray(),
    Match.find({ "players.userId": id })
      .sort({ finishedAt: -1, matchId: -1 })
      .skip(page * 20)
      .limit(20)
      .lean(),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    owner,
    user: { id, nome: user.nome, avatarURL: user.avatarURL },
    stats,
    decks: decks.map((row) => {
      const deck = deckDTO(row);
      return owner
        ? deck
        : {
            _id: deck._id,
            nome: deck.nome,
            icone: deck.icone,
            verso: deck.verso,
            mago: deck.mago,
            cartas: deck.cartas,
          };
    }),
    matches: matches.map((m) => ({
      matchId: m.matchId,
      players: m.players.map((p) => ({ id: String(p.userId), nome: p.nome })),
      winner: m.winner,
      turns: m.turns,
      finishedAt: m.finishedAt,
      reason: m.reason,
    })),
    page,
    hasMore: (page + 1) * 20 < stats.partidas,
  });
});
