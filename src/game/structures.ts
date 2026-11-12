import type { Instance, Slot } from "./state";
export const structureOperator = (slot: Slot) => slot.rider ?? slot.card;
export function storedAttackBonus(card: Instance) {
  const charge = card.estrutura?.carga;
  return charge ? Math.floor((card.storedMana ?? 0) / charge.manaPorDano) : 0;
}
export const offensiveStructure = (card: Instance | null | undefined) =>
  !!card &&
  card.tipo === "Estrutura" &&
  ((card.ataque ?? 0) > 0 || !!card.estrutura?.carga);
export function structureCooldown(card: Instance, round: number) {
  return (
    card.structureAttackRound !== undefined &&
    card.estrutura?.esperaRodadas !== undefined &&
    round - card.structureAttackRound <= (card.estrutura?.esperaRodadas ?? 0)
  );
}
