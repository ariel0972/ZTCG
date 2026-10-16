import type {
  DeclarativePassive,
  PassiveFilter,
  PassiveAction,
} from "../types/card";
import type { Instance, Slot } from "./state";
import { troopPositions, slotCards } from "./state";
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
  "dodgeImpact",
  "attackLifesteal",
  "discardMana",
  "counterAttack",
  "interceptAttack",
  "blockOwnAttack",
  "attackLimit",
  "damage",
  "heal",
  "growMaxHp",
  "growAttack",
  "manaRecovery",
  "reflectAttack",
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
        case "dodgeImpact":
          return "Pode desviar de um golpe por rodada, anulando dano e efeitos";
        case "attackLifesteal":
          return `Ataques curam o dano efetivo, até ${a.excedente ?? 0} de sobrevida`;
        case "discardMana":
          return `Recupera ${a.valor} mana ao ser descartada da mão`;
        case "counterAttack":
          return "Retaliou com seu ataque básico";
        case "interceptAttack":
          return "Interceptou um ataque básico";
        case "blockOwnAttack":
          return "Não pode atacar sem a condição exigida";
        case "attackLimit":
          return `Pode atacar até ${a.valor} vezes por rodada`;
        case "damage":
          return `Causou ${a.valor} de dano`;
        case "heal":
          return `Curou ${a.valor} de vida`;
        case "growMaxHp":
          return `Ganhou ${a.valor} de vida máxima`;
        case "growAttack":
          return `Ganhou ${a.valor} de ataque básico`;
        case "manaRecovery":
          return `Recuperação de mana definida em ${a.valor}`;
        case "reflectAttack":
          return a.esperaRodadas
            ? `Pode devolver um ataque básico; aguarda ${a.esperaRodadas} rodada(s) completa(s) entre usos`
            : "Pode devolver um ataque básico por rodada";
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
    (!filter.numeroCatalogo ||
      card?.numeroCatalogo === filter.numeroCatalogo) &&
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
    if (condition.tipo === "cartaEmCampo") {
      const found = slots.some(
        (s) =>
          (s.ownerId === source.ownerId) === (condition.jogador === "aliado") &&
          slotCards(s).some(
            (c) =>
              (c.hp === undefined || c.hpAtual > 0) &&
              matchesPassiveFilter(c, condition.filtro),
          ),
      );
      return found === condition.presente;
    }
    if (condition.tipo === "vidaPercentual") {
      const card =
        condition.alvo === "fonte"
          ? source
          : condition.alvo === "alvoAtaque"
            ? event.targetCard
            : event.card;
      if (!card || !card.hp || card.hpAtual <= 0) return false;
      const position = slots.find((s) =>
        slotCards(s).some((c) => c.id === card.id),
      );
      const arms =
        card.tipo === "Mago"
          ? ["back-left", "back-right"]
          : card.tipo === "Tropa" && position?.column === 0
            ? ["front-left"]
            : card.tipo === "Tropa" && position?.column === 2
              ? ["front-right"]
              : [];
      const maxHp =
        card.hp +
        slots
          .filter(
            (s) =>
              s.ownerId === card.ownerId &&
              arms.some((a) => s.id.endsWith(`:${a}`)),
          )
          .reduce((sum, s) => sum + (s.card?.bonusHp ?? 0), 0);
      const left = card.hpAtual * 100,
        right = maxHp * condition.percentual;
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
export function basicAttackLimit(card: Instance, slots: Slot[]) {
  return card.habilidadesPassivas
    .map(normalizePassive)
    .reduce((limit, rule) => {
      if (
        rule.gatilho !== "continuous" ||
        !passiveMatches(
          rule,
          card,
          { ownerId: card.ownerId, cardId: card.id, card },
          slots,
        )
      )
        return limit;
      return rule.efeitos.reduce(
        (value, action) =>
          action.id === "attackLimit" ? Math.max(value, action.valor) : value,
        limit,
      );
    }, 1);
}
export function blockedOwnAttack(card: Instance, slots: Slot[]) {
  return card.habilidadesPassivas
    .map(normalizePassive)
    .some(
      (rule) =>
        rule.gatilho === "continuous" &&
        rule.efeitos.some((e) => e.id === "blockOwnAttack") &&
        passiveMatches(
          rule,
          card,
          { ownerId: card.ownerId, cardId: card.id, card },
          slots,
        ),
    );
}
export function canMount(
  mount: Instance | null,
  rider: Instance,
  occupied = false,
) {
  return (
    !!mount &&
    !occupied &&
    mount.hpAtual > 0 &&
    rider.hpAtual > 0 &&
    mount.ownerId === rider.ownerId &&
    mount.tipo === "Tropa" &&
    rider.tipo === "Tropa" &&
    mount.id !== rider.id &&
    mount.palavrasChave.includes("Montaria") &&
    matchesPassiveFilter(rider, mount.montaria?.filtro)
  );
}
export function attackInterceptor(
  attacker: Instance,
  target: Slot,
  slots: Slot[],
  boundOnly = false,
) {
  const position = slots.find(
    (s) => s.card?.id === attacker.id || s.rider?.id === attacker.id,
  );
  for (const s of slots
    .filter((s) => s.ownerId === target.ownerId && s.kind === "Tropa")
    .sort((a, b) => a.column - b.column)) {
    for (const source of [s.card, s.rider]) {
      if (!source || source.hpAtual <= 0) continue;
      const protection = source.statuses.find(
        (status) =>
          status.nome === "Interceptar" &&
          status.turnosRestantes > 0 &&
          (status.protegidoId
            ? status.protegidoId === target.card?.id
            : !boundOnly && attacker.tipo === "Tropa"),
      );
      if (protection) return { slot: s, card: source, protection };
      if (boundOnly || attacker.tipo !== "Tropa") continue;
      for (const rule of source.habilidadesPassivas.map(normalizePassive)) {
        if (
          rule.gatilho !== "onTargeted" ||
          !passiveMatches(
            rule,
            source,
            {
              ownerId: target.ownerId,
              cardId: target.card?.id,
              card: target.card ?? undefined,
              attackerId: attacker.id,
            },
            slots,
          )
        )
          continue;
        if (
          rule.efeitos.some(
            (e) =>
              e.id === "interceptAttack" &&
              (e.colunaAtacante === undefined ||
                e.colunaAtacante === position?.column),
          )
        )
          return { slot: s, card: source };
      }
    }
  }
  return undefined;
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
  slots = troopPositions(slots);
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
export function targetAttackBonus(
  card: Instance,
  target: Instance,
  slots: Slot[],
) {
  return card.habilidadesPassivas
    .map(normalizePassive)
    .reduce((bonus, rule) => {
      if (
        rule.gatilho !== "continuous" ||
        !rule.condicoes?.some(
          (c) => c.tipo === "vidaPercentual" && c.alvo === "alvoAtaque",
        ) ||
        !passiveMatches(
          rule,
          card,
          {
            ownerId: card.ownerId,
            cardId: card.id,
            card,
            targetCard: target,
            targetId: target.id,
          },
          slots,
        )
      )
        return bonus;
      return (
        bonus +
        rule.efeitos.reduce(
          (sum, action) =>
            sum + (action.id === "attackBonus" ? action.valor : 0),
          0,
        )
      );
    }, 0);
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
  slots = troopPositions(slots);
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
      nome: "Atacar duas vezes por rodada",
      passiva: {
        gatilho: "continuous",
        escopo: "proprio",
        efeitos: [{ id: "attackLimit", valor: 2 }],
      },
    },
    {
      nome: "Desviar opcionalmente de um golpe por rodada",
      passiva: {
        gatilho: "onTargeted",
        escopo: "proprio",
        efeitos: [{ id: "dodgeImpact" }],
      },
    },
    {
      nome: "Retaliar cada ataque básico contra o mago aliado",
      passiva: {
        gatilho: "onAttack",
        escopo: "inimigo",
        filtroAlvo: { tipo: "Mago", relacao: "aliado" },
        efeitos: [{ id: "counterAttack", alvo: "cartaEvento" }],
      },
    },
    {
      nome: "Interceptar ataques básicos vindos da coluna central",
      passiva: {
        gatilho: "onTargeted",
        escopo: "aliado",
        efeitos: [{ id: "interceptAttack", colunaAtacante: 1 }],
      },
    },
    {
      nome: "Não atacar sem uma carta específica aliada em campo",
      passiva: {
        gatilho: "continuous",
        escopo: "proprio",
        condicoes: [
          {
            tipo: "cartaEmCampo",
            jogador: "aliado",
            filtro: { numeroCatalogo: "021" },
            presente: false,
          },
        ],
        efeitos: [{ id: "blockOwnAttack" }],
      },
    },
    {
      nome: "Ataque básico contra alvo abaixo de metade da vida",
      passiva: {
        gatilho: "continuous",
        escopo: "proprio",
        condicoes: [
          {
            tipo: "vidaPercentual",
            alvo: "alvoAtaque",
            percentual: 50,
            comparacao: "menor",
          },
        ],
        efeitos: [{ id: "attackBonus", valor: 1 }],
      },
    },
    {
      nome: "Aura para uma carta específica nos slots vizinhos",
      passiva: {
        gatilho: "continuous",
        escopo: "proprio",
        efeitos: [
          {
            id: "attackAura",
            valor: 2,
            filtro: { numeroCatalogo: "021" },
            fonteRecebe: false,
          },
        ],
      },
    },
    {
      nome: "Ao reviver uma tropa aliada: ganhar ataque acumulável",
      passiva: {
        gatilho: "onRevive",
        escopo: "aliado",
        filtroEvento: { tipo: "Tropa" },
        efeitos: [{ id: "growAttack", alvo: "fonte", valor: 1 }],
      },
    },
    {
      nome: "Ao morrer outra tropa: ganhar vida máxima e atual",
      passiva: {
        gatilho: "onDeath",
        escopo: "qualquer",
        excluirFonte: true,
        filtroEvento: { tipo: "Tropa" },
        efeitos: [{ id: "growMaxHp", alvo: "fonte", valor: 1 }],
      },
    },
    {
      nome: "Campo inimigo vazio: substituir recuperação do mago",
      passiva: {
        gatilho: "continuous",
        escopo: "proprio",
        condicoes: [{ tipo: "campoVazio", jogador: "inimigo" }],
        efeitos: [{ id: "manaRecovery", valor: 5 }],
      },
    },
    {
      nome: "Reação opcional: devolver um ataque básico por rodada",
      passiva: {
        gatilho: "onTargeted",
        escopo: "proprio",
        efeitos: [{ id: "reflectAttack" }],
      },
    },
    {
      nome: "Reação opcional: aguardar uma rodada completa entre devoluções",
      passiva: {
        gatilho: "onTargeted",
        escopo: "proprio",
        efeitos: [
          { id: "reflectAttack", esperaRodadas: 1, filtro: { tipo: "Tropa" } },
        ],
      },
    },
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
