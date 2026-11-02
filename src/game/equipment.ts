import type { Card } from "../types/card";
import type { Instance, Slot } from "./state";
export function equipmentMode(card: Instance) {
  return card.modosEquipamento?.find((m) => m.id === card.equipmentMode);
}
export function cardPassives(card: Instance) {
  const extra = equipmentMode(card)?.habilidadesPassivas;
  return extra
    ? [...card.habilidadesPassivas, ...extra]
    : card.habilidadesPassivas;
}
export function equipmentAttack(card: Instance) {
  return (card.bonusAtaque ?? 0) + (equipmentMode(card)?.bonusAtaque ?? 0);
}
export function equipmentAllowed(
  weapon: Card | null | undefined,
  receiver: Card | null | undefined,
) {
  if (!weapon) return false;
  const r = weapon.restricaoEquipamento;
  return (
    !!receiver &&
    (!r ||
      (r.tipos.includes(receiver.tipo as "Tropa" | "Mago") &&
        (!r.direcoes ||
          r.direcoes.includes(receiver.direcaoAtaque ?? "Frente")) &&
        !r.excluirSubtipos?.includes(receiver.subtipo!)))
  );
}
export function equipmentReceiver(weapon: Instance, slots: Slot[]) {
  const position = slots.find(
    (s) => s.card?.id === weapon.id && s.kind === "Armamento",
  );
  if (!position) return;
  const target = slots.find(
    (s) =>
      s.ownerId === weapon.ownerId &&
      (position.id.includes(":arm:back-")
        ? s.kind === "Mago"
        : s.kind === "Tropa" && s.column === position.column),
  );
  const receiver = target?.rider ?? target?.card;
  return equipmentAllowed(weapon, receiver)
    ? (receiver ?? undefined)
    : undefined;
}

export function clearOffFieldEquipmentModes(state: import("./state").State) {
  for (const p of state.players)
    for (const c of [
      ...p.hand,
      ...p.deck,
      ...p.graveyard,
      ...p.banished,
      ...p.forgotten,
    ])
      delete c.equipmentMode;
}
