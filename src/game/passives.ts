import type { Card } from "../types/card";
import type { Instance, Slot } from "./state";
// These rules depend on configuration and live positions, never catalog numbers.
export function restrictedBasicAttack(defender: Instance, attacker: Instance) {
  return defender.habilidadesPassivas.some(
    (h) =>
      h.efeito === "restringirAtaqueBasico" &&
      h.gatilho === "onTargeted" &&
      (!h.tipoAtacante || attacker.tipo === h.tipoAtacante) &&
      ((!h.elemento && !h.direcao) ||
        (!!h.elemento && attacker.elemento === h.elemento) ||
        (!!h.direcao && (attacker.direcaoAtaque ?? "Frente") === h.direcao)),
  );
}
export function adjacentAttackBonus(card: Instance, slots: Slot[]) {
  const target = slots.find(
    (s) => s.card?.id === card.id && s.kind === "Tropa",
  );
  if (!target || card.tipo !== "Tropa" || card.hpAtual <= 0) return 0;
  let bonus = 0;
  for (const source of slots) {
    if (
      source.kind !== "Tropa" ||
      source.ownerId !== target.ownerId ||
      source.card?.tipo !== "Tropa" ||
      source.card.hpAtual <= 0
    )
      continue;
    for (const h of source.card.habilidadesPassivas) {
      if (h.efeito !== "bonusAtaqueAdjacente" || h.gatilho !== "continuous")
        continue;
      const neighbors = slots.filter(
        (s) =>
          s.kind === "Tropa" &&
          s.ownerId === source.ownerId &&
          Math.abs(s.column - source.column) === 1 &&
          s.card?.tipo === "Tropa" &&
          s.card.hpAtual > 0 &&
          (!h.elemento || s.card.elemento === h.elemento),
      );
      if (source.card.id === card.id && neighbors.length)
        bonus +=
          (h.valor ?? 0) * (h.porVizinho === false ? 1 : neighbors.length);
      else if (neighbors.some((s) => s.card?.id === card.id))
        bonus += h.valor ?? 0;
    }
  }
  return bonus;
}
export const passiveTemplates: {
  nome: string;
  passiva: Card["habilidadesPassivas"][number];
}[] = [
  {
    nome: "Envenenar quem ataca",
    passiva: {
      gatilho: "onAttacked",
      efeito: "aplicarStatusAtacante",
      status: "Envenenado",
      duracao: 3,
      descricao:
        "Quando recebe um ataque básico, envenena o atacante, mesmo sem sofrer dano ou se o golpe for fatal.",
    },
  },
  {
    nome: "Queimar quem ataca",
    passiva: {
      gatilho: "onAttacked",
      efeito: "aplicarStatusAtacante",
      status: "Queimado",
      duracao: 2,
      descricao:
        "Quando recebe um ataque básico, queima o atacante, mesmo sem sofrer dano ou se o golpe for fatal.",
    },
  },
  {
    nome: "Aura de ataque entre vizinhos",
    passiva: {
      gatilho: "continuous",
      efeito: "bonusAtaqueAdjacente",
      elemento: "Fogo",
      valor: 2,
      porVizinho: true,
      descricao:
        "Esta carta e suas tropas de Fogo vizinhas ganham +2 de ataque básico por ligação. Bônus de outras auras se acumulam.",
    },
  },
  {
    nome: "Bloquear tipos de ataque básico",
    passiva: {
      gatilho: "onTargeted",
      efeito: "restringirAtaqueBasico",
      tipoAtacante: "Tropa",
      elemento: "Agua",
      direcao: "Frente",
      descricao:
        "Não pode ser alvo de ataques básicos de tropas de Água ou de tropas com direção Frontal. Feitiços e habilidades não são bloqueados.",
    },
  },
];
