import { Router } from "express";
import { z } from "zod";
import User from "../db/models/user";
import Match from "../db/models/match";
import Deck from "../db/models/decks";
import { deckDTO } from "../services/decks";
import { experienceHistory, ExperienceMatch } from "../services/experience";

export const rankingRoutes = Router();
rankingRoutes.get("/", async (req, res) => {
  const mode = z
    .enum(["wins", "rate", "decks"])
    .default("wins")
    .parse(req.query.mode);
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(0)
    .parse(req.query.page);
  if (mode === "decks") {
    const [result] = await Deck.aggregate([
      { $match: { publico: true } },
      {
        $lookup: {
          from: User.collection.name,
          localField: "userId",
          foreignField: "_id",
          as: "owner",
        },
      },
      { $unwind: "$owner" },
      { $set: { deckKey: { $toString: "$_id" } } },
      {
        $lookup: {
          from: Match.collection.name,
          localField: "deckKey",
          foreignField: "players.deckId",
          let: { ownerId: { $toString: "$userId" }, deckId: "$deckKey" },
          pipeline: [
            // Owner and deck must belong to the SAME participant in the match.
            {
              $match: {
                $expr: {
                  $anyElementTrue: [
                    {
                      $map: {
                        input: { $ifNull: ["$players", []] },
                        as: "player",
                        in: {
                          $and: [
                            { $eq: ["$$player.deckId", "$$deckId"] },
                            {
                              $eq: [
                                { $toString: "$$player.userId" },
                                "$$ownerId",
                              ],
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                partidas: { $sum: 1 },
                vitorias: {
                  $sum: { $cond: [{ $eq: ["$winner", "$$ownerId"] }, 1, 0] },
                },
              },
            },
          ],
          as: "stats",
        },
      },
      {
        $set: {
          partidas: { $ifNull: [{ $first: "$stats.partidas" }, 0] },
          vitorias: { $ifNull: [{ $first: "$stats.vitorias" }, 0] },
        },
      },
      { $match: { partidas: { $gte: 10 } } },
      { $set: { rate: { $divide: ["$vitorias", "$partidas"] } } },
      { $sort: { rate: -1, vitorias: -1, createdAt: 1, _id: 1 } },
      {
        $project: {
          _id: 1,
          nome: 1,
          icone: 1,
          partidas: 1,
          vitorias: 1,
          rate: 1,
          "owner._id": 1,
          "owner.nome": 1,
        },
      },
      {
        $facet: {
          podium: [{ $limit: 3 }],
          decks: [{ $skip: 3 + page * 20 }, { $limit: 20 }],
          total: [{ $count: "count" }],
        },
      },
    ]);
    const total = result.total[0]?.count ?? 0;
    const dto = (row: any, position: number) => ({
      id: String(row._id),
      nome: row.nome,
      icone: deckDTO(row).icone,
      partidas: row.partidas,
      vitorias: row.vitorias,
      taxaVitorias: Math.round(row.rate * 1000) / 10,
      position,
      dono: { id: String(row.owner._id), nome: row.owner.nome },
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      mode,
      page,
      minimumMatches: 10,
      total,
      hasMore: 3 + (page + 1) * 20 < total,
      podium: result.podium.map((row: any, i: number) => dto(row, i + 1)),
      decks: result.decks.map((row: any, i: number) =>
        dto(row, 4 + page * 20 + i),
      ),
    });
    return;
  }
  // Match records are the source of truth; account counters can be stale.
  const [result] = await User.aggregate([
    {
      $lookup: {
        from: Match.collection.name,
        localField: "_id",
        foreignField: "players.userId",
        let: { id: "$_id" },
        pipeline: [
          {
            $group: {
              _id: null,
              partidas: { $sum: 1 },
              vitorias: {
                $sum: {
                  $cond: [{ $eq: ["$winner", { $toString: "$$id" }] }, 1, 0],
                },
              },
            },
          },
        ],
        as: "stats",
      },
    },
    {
      $set: {
        partidas: { $ifNull: [{ $first: "$stats.partidas" }, 0] },
        vitorias: { $ifNull: [{ $first: "$stats.vitorias" }, 0] },
      },
    },
    {
      $set: {
        rate: {
          $cond: [
            { $gt: ["$partidas", 0] },
            { $divide: ["$vitorias", "$partidas"] },
            0,
          ],
        },
      },
    },
    { $match: { partidas: { $gte: mode === "rate" ? 10 : 1 } } },
    {
      $sort:
        mode === "rate"
          ? { rate: -1 as const, vitorias: -1 as const, _id: 1 as const }
          : { vitorias: -1 as const, rate: -1 as const, _id: 1 as const },
    },
    {
      $project: {
        _id: 1,
        nome: 1,
        avatarURL: 1,
        partidas: 1,
        vitorias: 1,
        rate: 1,
      },
    },
    {
      $facet: {
        podium: [{ $limit: 3 }],
        players: [{ $skip: 3 + page * 20 }, { $limit: 20 }],
        total: [{ $count: "count" }],
      },
    },
  ]);
  const displayed = [...result.podium, ...result.players];
  const histories = new Map<string, ExperienceMatch[]>(
    displayed.map((r: any) => [String(r._id), []]),
  );
  if (displayed.length) {
    const records = await Match.find({
      "players.userId": { $in: [...histories.keys()] },
    })
      .select("matchId players.userId winner reason finishedAt createdAt")
      .lean();
    for (const record of records)
      for (const participant of record.players)
        histories.get(String(participant.userId))?.push(record);
  }
  const player = (row: any, position: number) => {
    const stats = experienceHistory(
      String(row._id),
      histories.get(String(row._id)) || [],
    ).stats;
    return {
      id: String(row._id),
      nome: row.nome,
      avatarURL: row.avatarURL,
      partidas: row.partidas,
      vitorias: row.vitorias,
      taxaVitorias: Math.round(row.rate * 1000) / 10,
      nivel: stats.nivel,
      titulo: stats.titulo,
      xp: stats.xp,
      position,
    };
  };
  const total = result.total[0]?.count ?? 0;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    mode,
    page,
    minimumMatches: mode === "rate" ? 10 : 1,
    total,
    hasMore: 3 + (page + 1) * 20 < total,
    podium: result.podium.map((row: any, i: number) => player(row, i + 1)),
    players: result.players.map((row: any, i: number) =>
      player(row, 4 + page * 20 + i),
    ),
  });
});
