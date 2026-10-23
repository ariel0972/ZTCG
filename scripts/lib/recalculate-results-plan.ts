import {
  experienceHistory,
  type ExperienceMatch,
} from "../../src/services/experience";
import {
  isSurrender,
  resultEligibility,
  RESULT_RULES_VERSION,
} from "../../src/services/result-policy";
export type RecalculationMatch = ExperienceMatch & {
  [K in keyof ReturnType<typeof resultEligibility>]?: boolean | null;
} & {
  players: { userId?: unknown; deckId?: string | null }[];
};
function time(row: RecalculationMatch) {
  const value = new Date(row.finishedAt ?? row.createdAt ?? 0).getTime();
  if (!Number.isFinite(value))
    throw Error("Data inválida na partida " + row.matchId);
  return value;
}
/** Pure simulation. Deleted records are never revived; immutable combat results remain unchanged. */
export function planResultRecalculation(records: RecalculationMatch[]) {
  const ids = new Set<string>(),
    streaks = new Map<string, number>();
  const matches = [...records].sort(
    (a, b) =>
      time(a) - time(b) ||
      (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0),
  );
  const updates: {
    matchId: string;
    set: ReturnType<typeof resultEligibility> & {
      rulesVersion: number;
      surrenderStreak: number;
      surrenderedBy: string | null;
      resultReady: boolean;
    };
  }[] = [];
  const planned = matches.map((row) => {
    if (!row.matchId || ids.has(row.matchId))
      throw Error("Identificador de partida ausente ou repetido.");
    ids.add(row.matchId);
    if (row.deletedAt) return row;
    const players = [...new Set(row.players.map((p) => String(p.userId)))];
    if (
      players.length !== 2 ||
      players.some((id) => !/^[a-f\d]{24}$/i.test(id))
    )
      throw Error("Participantes inválidos na partida " + row.matchId);
    if (
      row.turns !== undefined &&
      row.turns !== null &&
      (!Number.isInteger(row.turns) || row.turns < 0)
    )
      throw Error("Contador de turnos inválido na partida " + row.matchId);
    let surrenderedBy: string | null = null;
    if (isSurrender(row.reason)) {
      if (!row.winner || !players.includes(row.winner))
        throw Error("Desistência sem vencedor válido: " + row.matchId);
      if (row.turns === undefined || row.turns === null)
        throw Error("Desistência sem contador de turnos: " + row.matchId);
      surrenderedBy = players.find((id) => id !== row.winner)!;
    }
    for (const id of players)
      streaks.set(id, id === surrenderedBy ? (streaks.get(id) ?? 0) + 1 : 0);
    const metadata = {
      rulesVersion: RESULT_RULES_VERSION,
      surrenderedBy,
      surrenderStreak: surrenderedBy ? streaks.get(surrenderedBy)! : 0,
      resultReady: true,
    };
    const set = { ...metadata, ...resultEligibility({ ...row, ...metadata }) };
    if (
      Object.entries(set).some(
        ([key, value]) =>
          (row as unknown as Record<string, unknown>)[key] !== value,
      )
    )
      updates.push({ matchId: row.matchId, set });
    return { ...row, ...set };
  });
  return { matches: planned, updates };
}
export function recalculationSummary(
  before: RecalculationMatch[],
  after: RecalculationMatch[],
  userIds: string[],
) {
  let xpBefore = 0,
    xpAfter = 0,
    changedAccounts = 0;
  for (const id of userIds) {
    const own = (rows: RecalculationMatch[]) =>
      rows.filter((r) => r.players.some((p) => String(p.userId) === id));
    const old = experienceHistory(id, own(before)).stats,
      next = experienceHistory(id, own(after)).stats;
    xpBefore += old.xp;
    xpAfter += next.xp;
    if (
      old.xp !== next.xp ||
      old.vitorias !== next.vitorias ||
      old.derrotas !== next.derrotas ||
      old.partidas !== next.partidas
    )
      changedAccounts++;
  }
  const active = after.filter((r) => !r.deletedAt);
  return {
    matches: active.length,
    shortSurrenders: active.filter(
      (r) => isSurrender(r.reason) && (r.turns ?? 0) < 6,
    ).length,
    excessiveSurrenders: active.filter(
      (r) =>
        isSurrender(r.reason) &&
        (r.turns ?? 0) >= 6 &&
        (r.surrenderStreak ?? 0) > 3,
    ).length,
    publicMatches: active.filter((r) => resultEligibility(r).historyVisible)
      .length,
    accounts: userIds.length,
    changedAccounts,
    xpBefore,
    xpAfter,
  };
}
