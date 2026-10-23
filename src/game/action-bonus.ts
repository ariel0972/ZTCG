import type { Effect } from "../types/card";
export const nextActionBonusStatus = "Dano da próxima ação";
export function addActionDamage(effects: Effect[], bonus: number): Effect[] {
  if (!bonus) return effects;
  return effects.map((effect) =>
    ["damage", "attackField", "periodicDamage", "trap"].includes(effect.id)
      ? {
          ...effect,
          valor: (effect.valor ?? 0) + bonus,
          ...(effect.valorEstrutura === undefined
            ? {}
            : { valorEstrutura: effect.valorEstrutura + bonus }),
        }
      : effect,
  );
}
