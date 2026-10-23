import {
  durationMultiplier,
  resultEligibility,
  RESULT_RULES_VERSION,
  isSurrender,
  DURATION_XP_BANDS,
  type ResultPolicyMatch,
} from "./result-policy";
export const LEVEL_TITLES = [
  { min: 1, max: 1, title: "Noviço em Mana" },
  { min: 2, max: 3, title: "Aprendiz de thumos" },
  { min: 4, max: 6, title: "Thumo praticante" },
  { min: 7, max: 10, title: "Tumociente" },
  { min: 11, max: 15, title: "Thumista Avançado" },
  { min: 16, max: 20, title: "Alto Mago" },
  { min: 21, max: 25, title: "Mago Experiente" },
  { min: 26, max: 30, title: "Dominante da Mana" },
  { min: 31, max: Infinity, title: "Alto Sacerdote Thumista" },
] as const;

export function levelTitle(level: number) {
  const value = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return LEVEL_TITLES.find((range) => value >= range.min && value <= range.max)!
    .title;
}

export const XP_RULES = {
  base: 30,
  winBonus: 10,
  lossBonus: 2,
  interrupted: 20,
  streakStep: 0.1,
  maximumMultiplier: 1.5,
} as const;

export function levelThreshold(level: number) {
  const n = Math.max(1, Math.floor(level));
  if (n <= 5) return [0, 100, 240, 560, 980][n - 1];
  const steps = n - 5;
  return 980 + 520 * steps + 100 * steps * steps;
}

export function experienceProgress(total: number) {
  const xp = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  let nivel = 1;
  while (xp >= levelThreshold(nivel + 1)) nivel++;
  const start = levelThreshold(nivel),
    next = levelThreshold(nivel + 1);
  return {
    nivel,
    titulo: levelTitle(nivel),
    xp,
    progresso: xp - start,
    proximoNivel: next - start,
    xpInicioNivel: start,
    xpProximoNivel: next,
    xpParaProximoNivel: next - xp,
  };
}

export const EXPERIENCE_FIELDS =
  "matchId winner reason turns finishedAt createdAt rulesVersion surrenderedBy surrenderStreak deletedAt resultReady";
export type ExperienceMatch = ResultPolicyMatch & {
  surrenderedBy?: string | null;
  matchId: string;
  winner?: string | null;
  reason?: string | null;
  finishedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
export function streakMultiplier(length: number) {
  return (10 + Math.min(5, Math.max(0, length - 1))) / 10;
}

// Replaying the unique Match ledger makes old results and retries consistent.
export function experienceHistory(userId: string, matches: ExperienceMatch[]) {
  const chronological = [...matches].sort((a, b) => {
    const time = (m: ExperienceMatch) => {
      const value = new Date(m.finishedAt ?? m.createdAt ?? 0).getTime();
      return Number.isFinite(value) ? value : 0;
    };
    return (
      time(a) - time(b) ||
      (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0)
    );
  });
  let xp = 0,
    vitorias = 0,
    empates = 0,
    derrotas = 0,
    partidas = 0,
    historicoCount = 0,
    partidasClassificadas = 0,
    sequenciaVitorias = 0,
    sequenciaDerrotas = 0,
    maiorSequenciaVitorias = 0,
    sequenciaDesistencias = 0;
  const awards = new Map<
    string,
    {
      xpGanho: number;
      multiplicadorXp: number;
      multiplicadorDuracao: number;
      multiplicadorSequencia: number;
      contaHistorico: boolean;
      contaResultado: boolean;
    }
  >();
  for (const match of chronological) {
    if (match.deletedAt) continue;
    const win = match.winner === userId,
      draw = !match.winner,
      eligible = resultEligibility(match);
    if (match.rulesVersion === RESULT_RULES_VERSION) {
      if (isSurrender(match.reason) && match.surrenderedBy === userId)
        sequenciaDesistencias++;
      else sequenciaDesistencias = 0;
    } else sequenciaDesistencias = 0;
    if (eligible.countGame) partidas++;
    if (eligible.historyVisible) historicoCount++;
    if (eligible.ranked) {
      partidasClassificadas++;
      if (win) vitorias++;
      else if (draw) empates++;
      else derrotas++;
    }
    const interrupted =
      /desist[eê]ncia|desconex[aã]o|desconectad[oa]s?|inatividade/i.test(
        match.reason || "",
      );
    let base: number,
      multiplier = 1;
    if (interrupted || draw) {
      sequenciaVitorias = sequenciaDerrotas = 0;
      base = interrupted ? XP_RULES.interrupted : XP_RULES.base;
    } else if (win) {
      sequenciaDerrotas = 0;
      sequenciaVitorias++;
      maiorSequenciaVitorias = Math.max(
        maiorSequenciaVitorias,
        sequenciaVitorias,
      );
      base = XP_RULES.base + XP_RULES.winBonus;
      multiplier = streakMultiplier(sequenciaVitorias);
    } else {
      sequenciaVitorias = 0;
      sequenciaDerrotas++;
      base = XP_RULES.base + XP_RULES.lossBonus;
      multiplier = streakMultiplier(sequenciaDerrotas);
    }
    const duration =
      match.rulesVersion === RESULT_RULES_VERSION
        ? durationMultiplier(match.turns)
        : 1;
    const combined = Number((multiplier * duration).toFixed(6)),
      earned = eligible.awardXp ? Math.round(base * combined) : 0;
    xp += earned;
    awards.set(match.matchId, {
      xpGanho: earned,
      multiplicadorXp: combined,
      multiplicadorDuracao: duration,
      multiplicadorSequencia: multiplier,
      contaHistorico: eligible.historyVisible,
      contaResultado: eligible.ranked,
    });
  }
  return {
    awards,
    stats: {
      ...experienceProgress(xp),
      partidas,
      vitorias,
      empates,
      derrotas,
      historicoCount,
      partidasClassificadas,
      partidasSemClassificacao: partidas - partidasClassificadas,
      taxaVitorias: partidasClassificadas
        ? Math.round((vitorias / partidasClassificadas) * 100)
        : 0,
      sequenciaVitorias,
      sequenciaDerrotas,
      sequenciaDesistencias,
      maiorSequenciaVitorias,
      multiplicadorProximaVitoria: streakMultiplier(sequenciaVitorias + 1),
      multiplicadorProximaDerrota: streakMultiplier(sequenciaDerrotas + 1),
    },
  };
}

export function experienceRules() {
  return {
    ...XP_RULES,
    durationBands: DURATION_XP_BANDS,
    surrenderMinimumTurns: 6,
    maximumRatedSurrenders: 3,
    prospective: true,
    thresholds: Array.from({ length: 31 }, (_, i) => ({
      level: i + 1,
      xp: levelThreshold(i + 1),
    })),
    titles: LEVEL_TITLES.map((r) => ({
      ...r,
      max: Number.isFinite(r.max) ? r.max : null,
    })),
  };
}
