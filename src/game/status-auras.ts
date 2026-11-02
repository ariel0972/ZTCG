import type { State } from "./state";
import { slotCards } from "./state";
export function synchronizeStatusAuras(state: State) {
  const cards = state.slots.flatMap(slotCards);
  if (
    !state.statusAuras?.length &&
    !cards.some((c) =>
      c.fieldModifiers?.some((m) => m.source.startsWith("status-aura:")),
    )
  )
    return;
  for (const card of cards)
    card.fieldModifiers = (card.fieldModifiers ?? []).filter(
      (m) => !m.source.startsWith("status-aura:"),
    );
  state.statusAuras = (state.statusAuras ?? []).filter((a) =>
    cards.some(
      (c) =>
        c.ownerId !== a.ownerId &&
        c.hpAtual > 0 &&
        c.statuses.some(
          (s) =>
            s.nome === a.status &&
            s.turnosRestantes > 0 &&
            s.originOwnerId === a.ownerId,
        ),
    ),
  );
  for (const aura of state.statusAuras)
    for (const card of cards.filter(
      (c) =>
        c.ownerId === aura.ownerId &&
        c.hpAtual > 0 &&
        c.grupos?.includes(aura.grupo),
    ))
      (card.fieldModifiers ??= []).push({
        source: "status-aura:" + aura.id,
        grant: { bonusAtaque: aura.valor },
      });
}
