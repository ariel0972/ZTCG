export const RESULT_RULES_VERSION = 2;
export const DURATION_XP_BANDS = [
  { min: 5, max: 9, multiplier: 1.3 },
  { min: 10, max: 19, multiplier: 1.8 },
  { min: 20, max: 29, multiplier: 2.2 },
  { min: 30, max: null, multiplier: 1.7 },
] as const;
export type ResultPolicyMatch = {
  mode?: string | null;
  rulesVersion?: number | null;
  reason?: string | null;
  turns?: number | null;
  surrenderStreak?: number | null;
  deletedAt?: Date | string | null;
  resultReady?: boolean | null;
};
export function isSurrender(reason?: string | null) {
  return /desistencia/i.test(
    (reason ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
}
export function durationMultiplier(turns: number | null | undefined = 0) {
  turns ??= 0;
  return (
    DURATION_XP_BANDS.find(
      (b) => turns >= b.min && (b.max === null || turns <= b.max),
    )?.multiplier ?? 1
  );
}
export function resultEligibility(m: ResultPolicyMatch) {
  if (m.deletedAt || m.resultReady === false)
    return {
      historyVisible: false,
      ranked: false,
      countGame: false,
      awardXp: false,
    };
  if (m.rulesVersion !== RESULT_RULES_VERSION)
    return {
      historyVisible: true,
      ranked: m.mode !== "ai",
      countGame: true,
      awardXp: true,
    };
  if (isSurrender(m.reason) && (m.turns ?? 0) < 6)
    return {
      historyVisible: false,
      ranked: false,
      countGame: false,
      awardXp: false,
    };
  if (isSurrender(m.reason) && (m.surrenderStreak ?? 0) > 3)
    return {
      historyVisible: false,
      ranked: false,
      countGame: true,
      awardXp: true,
    };
  return {
    historyVisible: true,
    ranked: m.mode !== "ai",
    countGame: true,
    awardXp: true,
  };
}
