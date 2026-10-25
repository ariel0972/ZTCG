import Match from "../db/models/match";
import Deck from "../db/models/decks";
import User from "../db/models/user";

export function rankingMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  // São Paulo has used UTC−3 year-round since 2019.
  return {
    key: String(year) + "-" + String(month).padStart(2, "0"),
    start: new Date(Date.UTC(year, month - 1, 1, 3)),
    end: new Date(Date.UTC(year, month, 1, 3)),
    timeZone: "America/Sao_Paulo",
  };
}
export async function monthlyDeckRanking(page: number, now = new Date()) {
  const month = rankingMonth(now);
  const [result] = await Match.aggregate([
    {
      $match: {
        finishedAt: { $gte: month.start, $lt: month.end },
        deletedAt: { $exists: false },
        ranked: { $ne: false },
        resultReady: { $ne: false },
      },
    },
    { $unwind: "$players" },
    {
      $group: {
        _id: { deckId: "$players.deckId", userId: "$players.userId" },
        partidas: { $sum: 1 },
        vitorias: {
          $sum: {
            $cond: [
              { $eq: ["$winner", { $toString: "$players.userId" }] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $match: { partidas: { $gte: 10 } } },
    {
      $set: {
        deckObjectId: {
          $convert: {
            input: "$_id.deckId",
            to: "objectId",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: Deck.collection.name,
        localField: "deckObjectId",
        foreignField: "_id",
        as: "deck",
      },
    },
    { $unwind: "$deck" },
    {
      $match: {
        "deck.publico": true,
        $expr: { $eq: ["$deck.userId", "$_id.userId"] },
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_id.userId",
        foreignField: "_id",
        as: "owner",
      },
    },
    { $unwind: "$owner" },
    {
      $project: {
        _id: "$deck._id",
        nome: "$deck.nome",
        icone: "$deck.icone",
        userId: "$deck.userId",
        ownerName: "$owner.nome",
        createdAt: "$deck.createdAt",
        ranking: {
          partidas: "$partidas",
          vitorias: "$vitorias",
          rate: { $divide: ["$vitorias", "$partidas"] },
        },
      },
    },
    {
      $sort: {
        "ranking.rate": -1,
        "ranking.vitorias": -1,
        createdAt: 1,
        _id: 1,
      },
    },
    {
      $facet: {
        podium: [{ $limit: 3 }],
        rows: [{ $skip: 3 + page * 20 }, { $limit: 20 }],
        count: [{ $count: "total" }],
      },
    },
  ]).option({ maxTimeMS: 10000 });
  return { ...result, total: result?.count[0]?.total ?? 0, month };
}
