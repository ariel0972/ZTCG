import type { Instance, Slot } from "./state";
import { normalizePassive } from "./legacy-passives";
import { passiveMatches } from "./passives";
import { canonicalStatus, hasStatus } from "./status";
const negative = new Set([
  "Cego",
  "Envenenado",
  "Queimado",
  "Sangrando",
  "Congelado",
  "Incapacitado",
  "Atordoado",
  "SemAtaque",
  "Abalo",
  "ReducaoAtaqueTropa",
  "Peste Negra",
  "Leptospirose",
  "Erosão",
  "Vapor",
  "Explosão",
]);
export function blocksStatus(
  card: Instance,
  name: string,
  slots: Slot[],
  structureOnly = false,
) {
  const status = canonicalStatus(name);
  if (!negative.has(status)) return false;
  const slot = slots.find((s) =>
    [s.card?.id, s.rider?.id, s.structure?.id].includes(card.id),
  );
  const structure = slot?.structure;
  if (
    structureOnly &&
    structure &&
    structure.hpAtual > 0 &&
    !hasStatus(structure.statuses, ["Abalo"]) &&
    structure.id !== card.id
  )
    return true;
  return [
    card,
    ...(structure && structure.id !== card.id ? [structure] : []),
  ].some(
    (source) =>
      source.hpAtual > 0 &&
      !hasStatus(source.statuses, ["Abalo"]) &&
      source.habilidadesPassivas
        .map(normalizePassive)
        .some(
          (rule) =>
            rule.gatilho === "continuous" &&
            passiveMatches(
              rule,
              source,
              { ownerId: source.ownerId, cardId: source.id, card: source },
              slots,
            ) &&
            rule.efeitos.some(
              (action) =>
                action.id === "statusWard" &&
                !action.excecoes.map(canonicalStatus).includes(status),
            ),
        ),
  );
}
