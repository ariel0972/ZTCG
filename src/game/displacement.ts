import type { Effect } from "../types/card";
import type { Slot } from "./state";
import { AppError } from "../lib/errors";
export function planDisplacement(
  effect: Effect,
  source: Slot | undefined,
  targetId: string,
  slots: Slot[],
  destinationId?: string,
) {
  const fail = (message: string): never => {
    throw new AppError(400, message);
  };
  if (
    !source ||
    source.kind !== "Tropa" ||
    source.card?.tipo !== "Tropa" ||
    ![source.id, source.card.id, source.rider?.id].includes(targetId)
  )
    return fail("Deslocamento exige uma tropa inimiga em campo.");
  if (source.structure) {
    if (effect.estrutura !== "manter")
      return fail("A estrutura impede o empurrão.");
    if (destinationId)
      return fail("A tropa protegida por estrutura não será movida.");
    return { source, destination: undefined, bounce: false, stationary: true };
  }
  if (effect.direcao !== "vizinho" && destinationId)
    return fail("Este deslocamento usa direção automática.");
  if (effect.direcao === "direita" && source.column === 2) {
    if (effect.borda === "manter")
      return {
        source,
        destination: undefined,
        bounce: false,
        stationary: true,
      };
    if (effect.borda !== "mao") return fail("Não há espaço à direita.");
    return { source, destination: undefined, bounce: true, stationary: false };
  }
  if (
    effect.direcao === "vizinho" &&
    effect.semDestino === "manter" &&
    !slots.some(
      (s) =>
        s.ownerId === source.ownerId &&
        s.kind === "Tropa" &&
        Math.abs(s.column - source.column) === 1 &&
        !s.card &&
        !s.rider &&
        !s.terrain,
    )
  ) {
    if (destinationId)
      return fail("Não há vizinho livre para o destino informado.");
    return { source, destination: undefined, bounce: false, stationary: true };
  }
  const destination = slots.find(
    (s) =>
      s.ownerId === source.ownerId &&
      s.kind === "Tropa" &&
      (effect.direcao === "direita"
        ? s.column === source.column + 1
        : s.id === destinationId && Math.abs(s.column - source.column) === 1),
  );
  if (!destination)
    return fail("Escolha um espaço vizinho vazio para o deslocamento.");
  if (destination.card || destination.rider)
    return fail("O espaço do deslocamento está ocupado.");
  if (destination.terrain)
    return fail("Nenhuma tropa pode se mover para um pântano.");
  return { source, destination, bounce: false, stationary: false };
}
