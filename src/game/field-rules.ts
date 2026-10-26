import type { Card } from "../types/card";
import type { State } from "./state";
import { slotCards } from "./state";
export function fieldVariant<T extends Card>(
  card: T,
  state?: State,
  ownerId?: string,
): T {
  const v = card.varianteCampo;
  if (
    !state ||
    !v ||
    !state.slots.some(
      (s) =>
        (v.escopo === "qualquer" ||
          (v.escopo === "aliado"
            ? s.ownerId === ownerId
            : s.ownerId !== ownerId)) &&
        slotCards(s).some(
          (c) =>
            (c.hp === undefined || c.hpAtual > 0) &&
            c.tipo === v.filtro.tipo &&
            (c.elemento ?? "Neutro") === v.filtro.elemento,
        ),
    )
  )
    return card;
  return {
    ...card,
    custoMana: v.custoMana,
    efeitos: structuredClone(v.efeitos),
  };
}
export function fieldDiscount(card: Card, state?: State) {
  return (state?.ruleFields ?? [])
    .filter((f) => f.rounds > 0)
    .flatMap((f) => f.rules.descontos ?? [])
    .filter((r) => r.elemento === (card.elemento ?? "Neutro"))
    .reduce((n, r) => n + r.valor, 0);
}
export function normalElementDamage(element: Card["elemento"], state: State) {
  return (
    !!element &&
    (state.ruleFields ?? []).some(
      (f) => f.rounds > 0 && f.rules.danoNormal?.includes(element),
    )
  );
}
export function cancelledByField(card: Card, targets: string[], state: State) {
  return (
    card.tipo === "Feitico" &&
    !!card.elemento &&
    (state.ruleFields ?? []).some(
      (f) => f.rounds > 0 && f.rules.anularFeiticos?.includes(card.elemento!),
    ) &&
    state.slots.some((s) =>
      slotCards(s).some(
        (c) => targets.includes(c.id) && ["Tropa", "Mago"].includes(c.tipo),
      ),
    )
  );
}
