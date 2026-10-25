import { cardSchema } from "../types/card";
import type { Slot } from "./state";
export function cardBackImage(back: string) {
  return (
    "/assets/card-backs/" +
    (["common", "zarcos", "water", "air", "fire", "earth"].includes(back)
      ? back
      : "common") +
    ".png"
  );
}
/** A identidade real de uma armadilha nunca integra o snapshot público. */
export function hiddenFieldCard(slot: Slot, back: string) {
  return {
    ...cardSchema.parse({
      numeroCatalogo: "000",
      nome: "Carta oculta",
      tipo: "Feitico",
      custoMana: 0,
      alvo: "Global",
      imgURL: cardBackImage(back),
    }),
    id: "oculta:" + slot.id,
    ownerId: slot.ownerId,
    hpAtual: 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
    oculta: true as const,
    manaRecovery: 0,
    manaAttachments: [],
    limiteAtaques: 0,
    bonusAtaquePassivo: 0,
  };
}
