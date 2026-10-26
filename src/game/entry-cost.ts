import type { Card } from "../types/card";
import type { Instance, State } from "./state";
import { slotCards } from "./state";
export const invocationCost: NonNullable<Card["custoEntrada"]> = {
  quantidade: 1,
  tiposCarta: ["Tropa", "Feitico"],
  origens: ["mao", "campo"],
  mesmoElemento: true,
};
export function entryCost(card: Pick<Card, "custoEntrada" | "subtipo">) {
  return (
    card.custoEntrada ??
    (card.subtipo === "Invocação" ? invocationCost : undefined)
  );
}
export function materialOptions(
  state: State,
  ownerId: string,
  source: Instance,
) {
  const cost = entryCost(source);
  if (!cost) return [];
  const player = state.players.find((p) => p.id === ownerId)!;
  const options = new Map<
    string,
    { card: Instance; origem: "mao" | "campo"; slotId?: string }
  >();
  const add = (card: Instance, origem: "mao" | "campo", slotId?: string) => {
    if (
      card.id === source.id ||
      card.ownerId !== ownerId ||
      card.tipo === "Mago" ||
      !cost.origens.includes(origem) ||
      !cost.tiposCarta.includes(card.tipo) ||
      (origem === "campo" && card.hp !== undefined && card.hpAtual <= 0) ||
      (cost.mesmoElemento &&
        (card.elemento ?? "Neutro") !== (source.elemento ?? "Neutro")) ||
      (cost.elementos && !cost.elementos.includes(card.elemento ?? "Neutro"))
    )
      return;
    options.set(card.id, { card, origem, slotId });
  };
  for (const c of player.hand) add(c, "mao");
  for (const slot of state.slots.filter((s) => s.ownerId === ownerId))
    for (const c of slotCards(slot)) add(c, "campo", slot.id);
  for (const slot of state.slots)
    if (slot.ownerId === ownerId && slot.summonCircle)
      add(slot.summonCircle.card, "campo", slot.id);
  for (const a of state.attachments ?? [])
    if (a.ownerId === ownerId) add(a.source, "campo");
  const active = new Set([
    ...(state.ruleFields ?? [])
      .filter((f) => f.ownerId === ownerId && f.rounds > 0)
      .map((f) => f.id),
    ...(state.ongoingSpells ?? [])
      .filter((s) => s.ownerId === ownerId && s.rounds > 0)
      .map((s) => s.id),
    ...(state.fieldEffects ?? [])
      .filter((s) => s.ownerId === ownerId && s.rounds > 0)
      .map((s) => s.card.id),
    ...state.slots
      .filter((s) => s.ownerId === ownerId)
      .flatMap(slotCards)
      .flatMap((c) =>
        c.statuses
          .filter(
            (s) => s.spellBoost && s.sourceCardId && s.turnosRestantes > 0,
          )
          .map((s) => s.sourceCardId!),
      ),
  ]);
  for (const c of player.graveyard) if (active.has(c.id)) add(c, "campo");
  return [...options.values()];
}
