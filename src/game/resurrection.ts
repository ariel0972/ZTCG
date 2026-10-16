import type { Slot } from "./state";
export const spellTurnBonusStatus = "Bônus de dano de feitiço";
export function reviveDestinations(slots: Slot[], ownerId: string) {
  return slots.filter(
    (s) =>
      s.ownerId === ownerId &&
      s.kind === "Tropa" &&
      !s.card &&
      !s.rider &&
      !s.terrain,
  );
}
