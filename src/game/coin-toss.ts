import type { State } from "./state";
export type CoinFace = "heads" | "tails";
export const COIN_CHOICE_MS = 20_000;
export const COIN_REVEAL_MS = 2_500;
export interface CoinToss {
  chooserId: string;
  choices: Record<string, CoinFace>;
  result?: CoinFace;
  winnerId?: string;
}
export function createCoinToss(
  players: State["players"],
  random: () => number,
): CoinToss {
  return { chooserId: players[random() < 0.5 ? 0 : 1].id, choices: {} };
}
export function resolveCoinToss(
  toss: CoinToss,
  players: State["players"],
  face: CoinFace,
  random: () => number,
) {
  const other = players.find((p) => p.id !== toss.chooserId)!;
  toss.choices = {
    [toss.chooserId]: face,
    [other.id]: face === "heads" ? "tails" : "heads",
  };
  toss.result = random() < 0.5 ? "heads" : "tails";
  toss.winnerId = players.find((p) => toss.choices[p.id] === toss.result)!.id;
}
export function phaseDuration(state: State) {
  return state.phase === "COIN_TOSS"
    ? state.coinToss?.result
      ? COIN_REVEAL_MS
      : COIN_CHOICE_MS
    : 120_000;
}
