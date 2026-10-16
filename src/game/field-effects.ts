import type { AttackField } from "./state";
import type { Elemento } from "../types/card";
export function fieldElementResult(field: AttackField, element?: Elemento) {
  const rule = field.reactions.find((r) => r.elemento === element);
  return {
    remove: rule?.remover === true,
    damage: Math.max(0, Math.floor(field.damage * (rule?.multiplicador ?? 1))),
    changed: !!rule,
  };
}
