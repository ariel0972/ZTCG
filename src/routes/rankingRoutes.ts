import { Router } from "express";
import { z } from "zod";
import User from "../db/models/user";
import { deckDTO } from "../services/decks";
import { rankingCache } from "../services/ranking-cache";
import { monthlyDeckRanking } from "../services/monthly-deck-ranking";
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
  const started = performance.now();
  const loadRanking = async () => {
    const minimum = mode === "wins" ? 1 : 10;
    const monthly =
      mode === "decks" ? await monthlyDeckRanking(page) : undefined;
    const filter = { "ranking.partidas": { $gte: minimum } };
    const sort: Record<string, 1 | -1> =
      mode === "wins"
        ? { "ranking.vitorias": -1, "ranking.rate": -1, _id: 1 }
        : { "ranking.rate": -1, "ranking.vitorias": -1, _id: 1 };
    const read = (skip: number, limit: number) =>
      User.find(filter)
        .select("nome avatarURL +ranking")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();
    const [podium, rows, total] = monthly
      ? [monthly.podium, monthly.rows, monthly.total]
      : await Promise.all([
          read(0, 3),
          read(3 + page * 20, 20),
          User.countDocuments(filter),
        ]);
    const dto = (row: any, position: number) => {
      const rank = row.ranking;
      const common = {
        id: String(row._id),
        nome: row.nome,
        partidas: rank.partidas,
        vitorias: rank.vitorias,
        taxaVitorias: Math.round(rank.rate * 1000) / 10,
        position,
      };
      return mode === "decks"
        ? {
            ...common,
            icone: deckDTO(row).icone,
            dono: { id: String(row.userId), nome: row.ownerName },
          }
        : {
            ...common,
            avatarURL: row.avatarURL,
            nivel: rank.stats.nivel,
            titulo: rank.stats.titulo,
            xp: rank.stats.xp,
          };
    };
    return {
      success: true,
      mode,
      page,
      minimumMatches: minimum,
      ...(monthly
        ? { month: monthly.month.key, timeZone: monthly.month.timeZone }
        : {}),
      total,
      hasMore: 3 + (page + 1) * 20 < total,
      podium: podium.map((r: any, i: number) => dto(r, i + 1)),
      [mode === "decks" ? "decks" : "players"]: rows.map((r: any, i: number) =>
        dto(r, 4 + page * 20 + i),
      ),
    };
  };
  const data =
    mode === "decks"
      ? await loadRanking()
      : await rankingCache.get(mode + ":" + page, loadRanking);
  res.setHeader(
    "Server-Timing",
    "ranking;dur=" + (performance.now() - started).toFixed(1),
  );
  res.setHeader(
    "Cache-Control",
    mode === "decks" ? "no-store" : "public, max-age=15, s-maxage=30",
  );
  res.json(data);
});
