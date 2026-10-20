// Uma rodada de duração equivale ao encerramento de dois turnos desde a ativação.
export interface EffectClock {
  nextTickTurn?: number;
}
export function nextEffectRound(turn: number) {
  return turn + 1;
}
export function effectRoundDue(clock: EffectClock, turn: number) {
  clock.nextTickTurn ??= nextEffectRound(turn);
  if (turn < clock.nextTickTurn) return false;
  clock.nextTickTurn = turn + 2;
  return true;
}
