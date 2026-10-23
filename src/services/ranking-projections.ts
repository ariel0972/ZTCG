import User from "../db/models/user";
import Deck from "../db/models/decks";
import Match from "../db/models/match";
import { experienceHistory, EXPERIENCE_FIELDS } from "./experience";
import { invalidateRankings } from "./ranking-cache";

// Rebuild ONLY affected participants when a result is committed. No work on active moves.
// Full replay per participant preserves chronological XP/streaks, late results and retries.
export async function refreshPlayerRanking(userId: string, force = false) {
  const matches = await Match.find({ "players.userId": userId })
    .select(EXPERIENCE_FIELDS)
    .lean();
  const stats = experienceHistory(userId, matches).stats;
  const ranking = {
    partidas: stats.partidasClassificadas,
    vitorias: stats.vitorias,
    rate: stats.partidasClassificadas
      ? stats.vitorias / stats.partidasClassificadas
      : 0,
    stats,
    updatedAt: new Date(),
  };
  await User.updateOne(
    {
      _id: userId,
      ...(force
        ? {}
        : {
            $or: [
              { "ranking.partidas": { $exists: false } },
              { "ranking.partidas": { $lte: stats.partidasClassificadas } },
            ],
          }),
    },
    { $set: { ranking } },
    { writeConcern: { w: "majority", wtimeout: 5000 } },
  );
  return ranking;
}
export async function refreshDeckRanking(
  deckId: string,
  userId: string,
  force = false,
) {
  const filter = {
    players: { $elemMatch: { userId, deckId } },
    deletedAt: { $exists: false },
    ranked: { $ne: false },
  };
  const records = await Match.find(filter).select("winner").lean();
  const partidas = records.length,
    vitorias = records.filter((r) => r.winner === userId).length;
  const ranking = {
    partidas,
    vitorias,
    rate: partidas ? vitorias / partidas : 0,
    updatedAt: new Date(),
  };
  await Deck.updateOne(
    {
      _id: deckId,
      userId,
      ...(force
        ? {}
        : {
            $or: [
              { "ranking.partidas": { $exists: false } },
              { "ranking.partidas": { $lte: partidas } },
            ],
          }),
    },
    { $set: { ranking } },
    { writeConcern: { w: "majority", wtimeout: 5000 } },
  );
  return ranking;
}
export async function projectMatchRankings(
  players: { userId: string; deckId?: string }[],
) {
  for (const player of players) {
    await refreshPlayerRanking(player.userId);
    if (player.deckId && /^[a-f\d]{24}$/i.test(player.deckId))
      await refreshDeckRanking(player.deckId, player.userId);
  }
  invalidateRankings();
}
// Offline reconciliation/migration; never called by ranking reads or active commands.
export async function rebuildRankings(
  force = false,
  checkpoint: () => Promise<void> = async () => {},
) {
  const users = await User.find().select("_id").lean();
  const decks = await Deck.find().select("_id userId").lean();
  const owners = new Set(users.map((u) => String(u._id)));
  for (const user of users) {
    await checkpoint();
    await refreshPlayerRanking(String(user._id), force);
  }
  for (const deck of decks) {
    await checkpoint();
    if (owners.has(String(deck.userId)))
      await refreshDeckRanking(String(deck._id), String(deck.userId), force);
    else await Deck.updateOne({ _id: deck._id }, { $unset: { ranking: "" } });
  }
  invalidateRankings();
  return { users: users.length, decks: decks.length };
}

export async function createRankingIndexes() {
  for (const model of [User, Deck])
    for (const [keys, options] of model.schema.indexes()) {
      if (!String(options.name).startsWith("ranking_")) continue;
      await model.collection.createIndex(keys as Record<string, 1 | -1>, {
        name: options.name,
        ...(options.partialFilterExpression
          ? { partialFilterExpression: options.partialFilterExpression }
          : {}),
      });
    }
}
