import type { Effect } from "../types/card";
import type { Instance, Slot, State } from "./state";
export function deploymentAllowed(card: Instance, effect: Effect) {
  return (
    (effect.tiposCarta ?? ["Tropa"]).includes(card.tipo) &&
    !effect.excluirSubtipos?.includes(card.subtipo!) &&
    (!effect.carta || card.numeroCatalogo === effect.carta)
  );
}
export function deploymentDestinations(
  slots: Slot[],
  ownerId: string,
  kind = "Tropa",
) {
  return slots.filter(
    (s) =>
      s.ownerId === ownerId &&
      s.kind === "Tropa" &&
      (kind === "Estrutura"
        ? s.card?.tipo === "Tropa" && !s.structure
        : !s.card && !s.rider && !s.terrain),
  );
}
export function circleWaiver(slot: Slot | undefined, card: Instance) {
  return (
    !!slot?.summonCircle &&
    card.tipo === "Tropa" &&
    card.subtipo === "Invocação"
  );
}
export function deploymentCards(
  state: State,
  choice: NonNullable<State["pendingRevives"]>[number],
) {
  const player = state.players.find((p) => p.id === choice.ownerId)!;
  return (
    choice.deployment ? [...player.deck, ...player.graveyard] : player.graveyard
  ).filter((c) => choice.cards.includes(c.id));
}
