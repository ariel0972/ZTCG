import type { Effect } from "../types/card";
import type { State } from "./state";
import { slotCards } from "./state";
export function selectField(
  state: State,
  owner: string,
  query: NonNullable<Effect["selecao"]>,
) {
  return state.slots
    .flatMap(slotCards)
    .filter(
      (c) =>
        c.hpAtual > 0 &&
        (query.jogador === "qualquer" ||
          (c.ownerId === owner) === (query.jogador === "aliado")) &&
        (!query.tipo || c.tipo === query.tipo) &&
        (!query.grupo || c.grupos?.includes(query.grupo)),
    );
}
export function enoughInField(
  state: State,
  owner: string,
  query: NonNullable<Effect["requerCampo"]>,
) {
  return selectField(state, owner, query).length >= query.minimo;
}
