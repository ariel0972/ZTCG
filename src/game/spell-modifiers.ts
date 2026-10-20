import type { Card, Effect } from "../types/card";
import { canonicalStatus } from "./status";
import type { Instance } from "./state";
export function spellModifier(card: Card, mage: Instance) {
  const buffs = mage.statuses.filter(
    (s) =>
      s.turnosRestantes > 0 &&
      s.spellBoost?.elementos.includes(card.elemento ?? "Neutro"),
  );
  return {
    bonus: buffs.reduce((n, s) => n + (s.spellBoost?.bonus ?? 0), 0),
    discount: buffs.reduce((n, s) => n + (s.spellBoost?.descontoMana ?? 0), 0),
  };
}
export function currentSpellCost(card: Card, mage: Instance) {
  return card.tipo === "Feitico"
    ? Math.max(0, card.custoMana - spellModifier(card, mage).discount)
    : card.custoMana;
}
const values = new Set([
  "damage",
  "heal",
  "draw",
  "mana",
  "stealMana",
  "attachMana",
  "periodicDamage",
  "attackField",
  "arrowRain",
  "stoneVolley",
  "tornado",
  "tremor",
  "lightOrb",
  "sandstorm",
  "meteors",
  "zarcosTear",
  "strongFlow",
  "bloodScent",
  "protectionShield",
]);
const damagingStatus = new Set([
  "Envenenado",
  "Queimado",
  "Sangrando",
  "Peste Negra",
  "Leptospirose",
]);
const statusValues = new Set([
  "Escudo",
  "EscudoProtecao",
  "BonusAtaque",
  "ReducaoDano",
  "ReducaoAtaqueTropa",
]);
const defaultDuration: Record<string, number> = {
  protectionShield: 2,
  tremor: 2,
  tornado: 2,
  revealStealHand: 1,
};
export function modifiedSpell<T extends Card>(card: T, mage: Instance): T {
  if (card.tipo !== "Feitico") return card;
  const { bonus } = spellModifier(card, mage);
  const copy = structuredClone(card);
  copy.custoMana = currentSpellCost(card, mage);
  if (!bonus) return copy;
  Object.assign(copy, { appliedSpellBonus: bonus });
  copy.efeitos = copy.efeitos.map((original) => {
    const e: Effect = structuredClone(original);
    if (e.duracao !== undefined) e.duracao += bonus;
    else if (defaultDuration[e.id]) e.duracao = defaultDuration[e.id] + bonus;
    if (
      e.valor !== undefined &&
      (values.has(e.id) ||
        (e.id === "status" && statusValues.has(e.status ?? "")))
    )
      e.valor += bonus;
    if (
      e.id === "status" &&
      damagingStatus.has(canonicalStatus(e.status ?? ""))
    )
      e.valor =
        (original.valor ??
          (["Peste Negra", "Leptospirose"].includes(e.status ?? "") ? 2 : 1)) +
        bonus;
    if (e.valorEstrutura !== undefined) e.valorEstrutura += bonus;
    if (e.bonusAtaque !== undefined) e.bonusAtaque += bonus;
    if (e.bonusHp !== undefined) e.bonusHp += bonus;
    if (e.id === "bloodScent")
      e.bonusAtaque = (original.bonusAtaque ?? 1) + bonus;
    // spellBoost changes its duration only: each copy keeps its own +1 / -2.
    if (e.variantesMago)
      e.variantesMago = e.variantesMago.map((v) => ({
        ...v,
        ...(v.duracao !== undefined ? { duracao: v.duracao + bonus } : {}),
        ...(v.efeitos
          ? {
              efeitos: v.efeitos.map((s) => ({
                ...s,
                duracao: s.duracao + bonus,
                ...(damagingStatus.has(canonicalStatus(s.status))
                  ? {
                      valor:
                        (s.valor ??
                          (["Peste Negra", "Leptospirose"].includes(s.status)
                            ? 2
                            : 1)) + bonus,
                    }
                  : s.valor !== undefined && statusValues.has(s.status)
                    ? { valor: s.valor + bonus }
                    : {}),
              })),
            }
          : {}),
      }));
    return e;
  });
  return copy;
}
