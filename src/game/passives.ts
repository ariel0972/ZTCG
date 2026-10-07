import type {
  DeclarativePassive,
  PassiveFilter,
  PassiveAction,
} from "../types/card";
import type { Instance, Slot } from "./state";
import { normalizePassive, legacyFireCounter } from "./legacy-passives";
import { canonicalStatus, hasStatus } from "./status";

export interface PassiveEvent {
  ownerId: string;
  cardId?: string;
  card?: Instance;
  element?: Instance["elemento"];
  status?: string;
  attackerId?: string;
  targetId?: string;
  targetCard?: Instance;
  slotId?: string;
}
export const passiveActionIds = [
  "damage",
  "heal",
  "growMaxHp",
  "status",
  "mana",
  "draw",
  "recover",
  "spellDamageBonus",
  "attackAura",
  "blockAttack",
  "attackBonus",
  "summonFromDeck",
  "move",
] as const;
export const passiveEventTriggers = [
  "onDeath",
  "onStructureDestroyed",
  "onHeal",
  "onHealed",
  "onKill",
  "onSpellCast",
  "onDamageTaken",
  "onAttacked",
  "onEquip",
  "onAttack",
  "onTurnStart",
  "onTurnEnd",
  "onSummon",
  "onRevive",
  "onSacrifice",
  "onStatusApplied",
] as const;
export function describePassiveActions(actions: PassiveAction[]) {
  return actions
    .map((a) => {
      switch (a.id) {
        case "damage":
          return `Causou ${a.valor} de dano`;
        case "heal":
          return `Curou ${a.valor} de vida`;
        case "growMaxHp":
          return `Ganhou ${a.valor} de vida máxima`;
        case "status":
          return `Aplicou ${a.status}`;
        case "mana":
          return `Recuperou ${a.valor} de mana`;
        case "draw":
          return `Comprou ${a.valor} carta(s)`;
        case "recover":
          return `Recuperou ${a.valor} carta(s) do cemitério`;
        case "spellDamageBonus":
          return "Avançou o bônus de dano de feitiços";
        case "summonFromDeck":
          return "Mobilizou uma carta do baralho";
        case "move":
          return "Ocupou o espaço da tropa morta";
        case "attackAura":
          return `Aura de ataque +${a.valor}`;
        case "attackBonus":
          return `Bônus de ataque +${a.valor}`;
        case "blockAttack":
          return "Impediu o ataque básico";
      }
    })
    .join(" · ");
}

// Fields in a filter are AND; blockAttack alternatives are OR.
export function matchesPassiveFilter(
  card: Instance | undefined,
  filter?: PassiveFilter,
  event?: PassiveEvent,
) {
  if (!filter) return true;
  return (
    (!filter.tipo || card?.tipo === filter.tipo) &&
    (!filter.elemento ||
      (event?.element ?? card?.elemento) === filter.elemento) &&
    (!filter.direcao ||
      (!!card && (card.direcaoAtaque ?? "Frente") === filter.direcao)) &&
    (!filter.status ||
      (event?.status
        ? canonicalStatus(event.status) === canonicalStatus(filter.status)
        : !!card && hasStatus(card.statuses, [filter.status])))
  );
}
export function passiveMatches(
  rule: DeclarativePassive,
  source: Instance,
  event: PassiveEvent,
  slots: Slot[],
) {
  if (rule.escopo === "proprio" && source.id !== event.cardId) return false;
  if (rule.escopo === "aliado" && source.ownerId !== event.ownerId)
    return false;
  if (rule.escopo === "inimigo" && source.ownerId === event.ownerId)
    return false;
  if (rule.excluirFonte && source.id === event.cardId) return false;
  if (!matchesPassiveFilter(event.card, rule.filtroEvento, event)) return false;
  if (rule.filtroAlvo) {
    if (
      !event.targetCard ||
      !matchesPassiveFilter(event.targetCard, rule.filtroAlvo)
    )
      return false;
    if (
      rule.filtroAlvo.relacao &&
      (event.targetCard.ownerId === source.ownerId) !==
        (rule.filtroAlvo.relacao === "aliado")
    )
      return false;
  }
  return (rule.condicoes ?? []).every((condition) => {
    if (condition.tipo === "vidaPercentual") {
      const card = condition.alvo === "fonte" ? source : event.card;
      if (!card || !card.hp || card.hpAtual <= 0) return false;
      const left = card.hpAtual * 100,
        right = card.hp * condition.percentual;
      return condition.comparacao === "menor" ? left < right : left <= right;
    }
    const allied = condition.jogador === "aliado";
    return !slots.some(
      (s) =>
        s.kind === "Tropa" &&
        (s.ownerId === source.ownerId) === allied &&
        s.card,
    );
  });
}
export function restrictedBasicAttack(
  defender: Instance,
  attacker: Instance,
  slots: Slot[] = [],
) {
  return defender.habilidadesPassivas.some((h) => {
    const rule = normalizePassive(h);
    const event: PassiveEvent = {
      ownerId: defender.ownerId,
      cardId: defender.id,
      card: defender,
      attackerId: attacker.id,
    };
    if (
      rule.gatilho !== "onTargeted" ||
      !passiveMatches(rule, defender, event, slots)
    )
      return false;
    return rule.efeitos.some(
      (action) =>
        action.id === "blockAttack" &&
        matchesPassiveFilter(attacker, action.filtro) &&
        (!action.qualquerDe ||
          action.qualquerDe.some((filter) =>
            matchesPassiveFilter(attacker, filter),
          )),
    );
  });
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
      const rule = normalizePassive(h);
      if (
        rule.gatilho !== "continuous" ||
        !passiveMatches(
          rule,
          source.card,
          {
            ownerId: source.ownerId,
            cardId: source.card.id,
            card: source.card,
          },
          slots,
        )
      )
        continue;
      for (const action of rule.efeitos) {
        if (action.id === "attackBonus") {
          if (source.card.id === card.id) bonus += action.valor;
          continue;
        }
        if (action.id !== "attackAura") continue;
        const neighbors = slots.filter(
          (s) =>
            s.kind === "Tropa" &&
            s.ownerId === source.ownerId &&
            Math.abs(s.column - source.column) === 1 &&
            s.card?.tipo === "Tropa" &&
            s.card.hpAtual > 0 &&
            matchesPassiveFilter(s.card, action.filtro),
        );
        if (
          source.card.id === card.id &&
          action.fonteRecebe !== false &&
          neighbors.length
        )
          bonus +=
            action.valor * (action.porVizinho === false ? 1 : neighbors.length);
        else if (neighbors.some((s) => s.card?.id === card.id))
          bonus += action.valor;
      }
    }
  }
  return bonus;
}
export function spellDamageBonus(
  card: Instance,
  element?: Instance["elemento"],
) {
  if (!element) return 0;
  return card.habilidadesPassivas
    .flatMap((h) => normalizePassive(h).efeitos)
    .reduce(
      (sum, action) =>
        action.id === "spellDamageBonus" && action.elemento === element
          ? sum +
            Math.floor(
              (card.passiveCounters?.[action.contador] ??
                (action.contador === legacyFireCounter
                  ? (card.fireSpellsCast ?? 0)
                  : 0)) / action.aCada,
            ) *
              action.valor
          : sum,
      0,
    );
}
export function continuousPassiveActive(
  source: Instance,
  rule: DeclarativePassive,
  slots: Slot[],
) {
  if (
    source.hpAtual <= 0 ||
    !passiveMatches(
      rule,
      source,
      { ownerId: source.ownerId, cardId: source.id, card: source },
      slots,
    )
  )
    return false;
  const position = slots.find(
    (s) => s.card?.id === source.id && s.kind === "Tropa",
  );
  if (!position) return false;
  return rule.efeitos.some(
    (action) =>
      action.id === "attackBonus" ||
      (action.id === "attackAura" &&
        slots.some(
          (s) =>
            s.kind === "Tropa" &&
            s.ownerId === source.ownerId &&
            Math.abs(s.column - position.column) === 1 &&
            s.card?.tipo === "Tropa" &&
            s.card.hpAtual > 0 &&
            matchesPassiveFilter(s.card, action.filtro),
        )),
  );
}
export const passiveTemplates: { nome: string; passiva: DeclarativePassive }[] =
  [
    {
      nome: "Ao receber ataque: aplicar status ao atacante",
      passiva: {
        gatilho: "onAttacked",
        escopo: "proprio",
        efeitos: [
          { id: "status", alvo: "atacante", status: "Envenenado", duracao: 3 },
        ],
      },
    },
    {
      nome: "Ao curar um aliado: recuperar mana",
      passiva: {
        gatilho: "onHeal",
        escopo: "aliado",
        efeitos: [{ id: "mana", jogador: "aliado", valor: 1 }],
      },
    },
    {
      nome: "Ao morrer um aliado: comprar carta",
      passiva: {
        gatilho: "onDeath",
        escopo: "aliado",
        excluirFonte: true,
        efeitos: [{ id: "draw", jogador: "aliado", valor: 1 }],
      },
    },
    {
      nome: "Ao morrer uma tropa aliada: mobilizar cópia do baralho",
      passiva: {
        gatilho: "onDeath",
        escopo: "aliado",
        excluirFonte: true,
        filtroEvento: { tipo: "Tropa" },
        efeitos: [
          { id: "summonFromDeck", carta: "mesmaCarta", destino: "slotEvento" },
        ],
      },
    },
    {
      nome: "Ao morrer uma tropa aliada: mover a fonte ao espaço vazio",
      passiva: {
        gatilho: "onDeath",
        escopo: "aliado",
        excluirFonte: true,
        filtroEvento: { tipo: "Tropa" },
        efeitos: [{ id: "move", destino: "slotEvento" }],
      },
    },
    {
      nome: "Ao destruir uma estrutura inimiga: curar a fonte",
      passiva: {
        gatilho: "onStructureDestroyed",
        escopo: "inimigo",
        efeitos: [{ id: "heal", alvo: "fonte", valor: 2 }],
      },
    },
    {
      nome: "Com metade ou menos de vida: bônus de ataque",
      passiva: {
        gatilho: "continuous",
        escopo: "proprio",
        condicoes: [
          {
            tipo: "vidaPercentual",
            alvo: "fonte",
            percentual: 50,
            comparacao: "menorOuIgual",
          },
        ],
        efeitos: [{ id: "attackBonus", valor: 1 }],
      },
    },
    {
      nome: "Ao sacrificar: mana e cura",
      passiva: {
        gatilho: "onSacrifice",
        escopo: "aliado",
        efeitos: [
          { id: "mana", jogador: "aliado", valor: 2 },
          { id: "heal", alvo: "magoAliado", valor: 2 },
        ],
      },
    },
    {
      nome: "Aura: ataque entre tropas vizinhas",
      passiva: {
        gatilho: "continuous",
        escopo: "proprio",
        efeitos: [
          {
            id: "attackAura",
            valor: 2,
            filtro: { elemento: "Fogo" },
            porVizinho: true,
          },
        ],
      },
    },
    {
      nome: "Restringir ataque: tipo e alternativas",
      passiva: {
        gatilho: "onTargeted",
        escopo: "proprio",
        efeitos: [
          {
            id: "blockAttack",
            filtro: { tipo: "Tropa" },
            qualquerDe: [{ elemento: "Agua" }, { direcao: "Frente" }],
          },
        ],
      },
    },
  ];
