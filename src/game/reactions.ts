export type ReactionName =
  | "Vapor"
  | "Erosão"
  | "Lama"
  | "Lava"
  | "Explosão"
  | "Congelar"
  | "Zarconizado"
  | "Florescer";
export const reactionDescriptions: Record<
  ReactionName,
  { elements: string; description: string }
> = {
  Vapor: {
    elements: "Fogo + Água",
    description:
      "O alvo perde sua resistência elemental até o fim deste turno.",
  },
  Erosão: {
    elements: "Ar + Terra",
    description:
      "As duas cartas do topo do baralho do dono do alvo vão ao cemitério.",
  },
  Lama: {
    elements: "Água + Terra",
    description:
      "O campo de tropa fica bloqueado para ocupação por duas rodadas. A Lama permanece pelo tempo restante mesmo após Florescer.",
  },
  Lava: {
    elements: "Fogo + Terra",
    description:
      "As tropas adjacentes ao campo atingido recebem 2 de dano perfurante, ignorando estruturas.",
  },
  Explosão: {
    elements: "Fogo + Ar",
    description:
      "Até o fim deste turno, o dano excedente ao eliminar a tropa atingida é causado ao mago do dono dela.",
  },
  Congelar: {
    elements: "Água + Ar",
    description:
      "O alvo fica Congelado: não pode atacar nem usar habilidades até o fim do próximo turno.",
  },
  Zarconizado: {
    elements: "Zarcos + Zarcos",
    description:
      "O jogador que ativou a reação recupera 2 de mana, até o limite de 20.",
  },
  Florescer: {
    elements: "Lama + Água",
    description:
      "A planta atingida ganha +1 de vida máxima e atual. Uma carta de outro tipo recebe Envenenado por 3 rodadas. A Lama continua no campo.",
  },
};
export function elementalReaction(
  existing: string,
  incoming: string,
): ReactionName | null {
  if (existing === "Lama" && incoming === "Agua") return "Florescer";
  const pair = [existing, incoming].sort().join("+");
  const reactions: Record<string, ReactionName> = {
    "Agua+Fogo": "Vapor",
    "Ar+Terra": "Erosão",
    "Agua+Terra": "Lama",
    "Fogo+Terra": "Lava",
    "Ar+Fogo": "Explosão",
    "Agua+Ar": "Congelar",
    "Zarcos+Zarcos": "Zarconizado",
  };
  return reactions[pair] ?? null;
}
