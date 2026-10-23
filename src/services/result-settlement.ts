import Match from "../db/models/match";
import {
  isSurrender,
  resultEligibility,
  RESULT_RULES_VERSION,
} from "./result-policy";
import {
  refreshPlayerRanking,
  refreshDeckRanking,
} from "./ranking-projections";
import { invalidateRankings } from "./ranking-cache";
import { withResultControl } from "./result-control";
import type { DurableRoom } from "../game/store";
export type AffectedRankings = Map<string, Set<string>>;
export function addAffected(
  affected: AffectedRankings,
  players: { userId?: unknown; deckId?: string | null }[],
) {
  for (const p of players) {
    const id = String(p.userId);
    if (!/^[a-f\d]{24}$/i.test(id)) continue;
    const decks = affected.get(id) ?? new Set<string>();
    if (p.deckId && /^[a-f\d]{24}$/i.test(p.deckId)) decks.add(p.deckId);
    affected.set(id, decks);
  }
}
export async function reconcileResultPolicies(ids: string[]) {
  const affected: AffectedRankings = new Map(
    ids.map((id) => [id, new Set<string>()]),
  );
  for (const id of new Set(ids)) {
    const rows = await Match.find({
      "players.userId": id,
      deletedAt: { $exists: false },
    })
      .sort({ finishedAt: 1, matchId: 1 })
      .lean();
    let streak = 0;
    for (const row of rows) {
      if (row.rulesVersion !== RESULT_RULES_VERSION) {
        streak = 0;
        continue;
      }
      const ownSurrender = isSurrender(row.reason) && row.surrenderedBy === id;
      streak = ownSurrender ? streak + 1 : 0;
      if (row.surrenderedBy && row.surrenderedBy !== id) continue;
      const planned = {
          ...row,
          surrenderStreak: ownSurrender ? streak : 0,
          resultReady: true,
        },
        eligibility = resultEligibility(planned);
      if (
        row.surrenderStreak === planned.surrenderStreak &&
        row.resultReady === true &&
        Object.entries(eligibility).every(([k, v]) => (row as any)[k] === v)
      )
        continue;
      await Match.updateOne(
        { matchId: row.matchId, deletedAt: { $exists: false } },
        {
          $set: {
            surrenderStreak: planned.surrenderStreak,
            resultReady: true,
            ...eligibility,
          },
        },
      );
      addAffected(affected, row.players);
    }
  }
  return affected;
}
export async function refreshAffectedRankings(affected: AffectedRankings) {
  for (const [id, decks] of affected) {
    await refreshPlayerRanking(id, true);
    for (const deck of decks) await refreshDeckRanking(deck, id, true);
  }
  invalidateRankings();
}
export async function recordMatchResult(room: DurableRoom) {
  await withResultControl(async () => {
    const state = room.game.state,
      version = room.resultRulesVersion;
    const loser = isSurrender(state.reason)
      ? room.entries.find((e) => e.id !== state.winner)?.id
      : undefined;
    await Match.updateOne(
      { matchId: room.id },
      {
        $setOnInsert: {
          matchId: room.id,
          players: room.entries.map((e) => ({
            userId: e.id,
            nome: e.nome,
            deckId: e.deckId,
          })),
          winner: state.winner,
          reason: state.reason,
          turns: state.turn,
          finishedAt: new Date(room.finishedAt!),
          ...(version === RESULT_RULES_VERSION
            ? {
                rulesVersion: version,
                surrenderedBy: loser,
                surrenderStreak: 0,
                resultReady: false,
                historyVisible: false,
                ranked: false,
                countGame: false,
                awardXp: false,
              }
            : {}),
        },
      },
      { upsert: true, writeConcern: { w: "majority", wtimeout: 5000 } },
    );
    const affected = await reconcileResultPolicies(
      room.entries.map((e) => e.id),
    );
    addAffected(
      affected,
      room.entries.map((e) => ({ userId: e.id, deckId: e.deckId })),
    );
    await refreshAffectedRankings(affected);
  });
}
