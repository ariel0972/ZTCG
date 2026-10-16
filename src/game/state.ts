import type { Card, Effect } from "../types/card";
import type { Status } from "./status";
import type { ReactionName } from "./reactions";

export interface BattleDamage {
  amount: number;
  element?: Card["elemento"];
  modifiers?: ("weakness" | "resistance")[];
}
export interface BattleEvent {
  sequence: number;
  kind: string;
  message?: string;
  summary?: string;
  originOwnerId?: string;
  card: { id: string; nome: string; imgURL: string; ownerId: string };
  slotId?: string;
  reaction?: ReactionName;
  damage?: BattleDamage;
  mana?: { amount: number };
}

export interface Instance extends Card {
  id: string;
  ownerId: string;
  hpAtual: number;
  attacked: boolean;
  attacksMade?: number;
  usedAbility: boolean;
  moved?: boolean;
  revivedFromGraveyard?: boolean;
  appliedElement?: string;
  statuses: Status[];
  scheduledStatuses?: { round: number; status: Status }[];
  scheduledHeals?: {
    round: number;
    amount: number;
    sourceId?: string;
    ownerId: string;
    origin: string;
  }[];
  fireSpellsCast?: number;
  fireDamageBonus?: number;
  passiveCounters?: Record<string, number>;
  reflectedAttackRound?: number;
  dodgedRound?: number;
  abilityRounds?: Record<string, number>;
  killedBy?: { ownerId: string; cardId: string };
}
export interface Slot {
  id: string;
  ownerId: string;
  kind: "Tropa" | "Mago" | "Armamento";
  column: number;
  card: Instance | null;
  rider?: Instance | null;
  structure: Instance | null;
  terrain?: { nome: "Lama"; rodadasRestantes: number };
  appliedElement?: string;
}
export const slotCards = (slot: Slot): Instance[] =>
  [slot.card, slot.rider, slot.structure].filter((c): c is Instance => !!c);
export const troopPositions = (slots: Slot[]): Slot[] =>
  slots.flatMap((s) =>
    s.rider ? [s, { ...s, card: s.rider, rider: null, structure: null }] : [s],
  );
export interface Player {
  revealHandRound?: number;
  piranhaBleedingBonus?: number;
  castCards?: string[];
  lastTroopAttacker?: { cardId: string; turn: number };
  roundSpells?: string[];
  comboTriggered?: boolean;
  zarcosWatchers?: { cardId: string; kind: "flow" | "tear" }[];
  zarcosTriggered?: string[];
  id: string;
  nome: string;
  deckAppearance: { nome: string; icone: string; verso: string };
  mana: number;
  mage: Instance;
  deck: Instance[];
  hand: Instance[];
  graveyard: Instance[];
  banished: Instance[];
  forgotten: Instance[];
  preparation: {
    ready: boolean;
    redraws: number;
    started: boolean;
    bonusDraws: number;
  };
  combatStarted: boolean;
  inactivityStreak: number;
  turnActions: number;
  counters: {
    summons: number;
    attacks: number;
    spells: number;
    unique: number;
  };
}
export interface AttackField {
  id: string;
  ownerId: string;
  affectedOwnerId: string;
  rounds: number;
  damage: number;
  element?: Card["elemento"];
  piercing?: boolean;
  reactions: NonNullable<Effect["reacoesElemento"]>;
  card: Pick<Instance, "id" | "ownerId" | "numeroCatalogo" | "nome" | "imgURL">;
}
export interface State {
  fieldEffects?: AttackField[];
  pendingImpact?: {
    base: State;
    operation:
      | { user: string; command: unknown }
      | { automatic: "timeout" | "spell" | "attack"; reflect?: boolean };
    decisions: Record<string, boolean>;
    randoms: number[];
    request: { key: string; ownerId: string; cardId: string; source: string };
  };
  pendingHandChoice?: { ownerId: string; opponentId: string; source: string };
  pendingAttack?: {
    attackerOwnerId: string;
    attackerId: string;
    targetSlotId: string;
    defenderId: string;
    damage: number;
    element?: Card["elemento"];
    interception?: { cardId: string; valor: number; origin: string };
  };
  ongoingSpells?: {
    id: string;
    ownerId: string;
    kind: "tornado" | "arrowRain" | "sandstorm";
    rounds: number;
    damage: number;
    element?: Card["elemento"];
    card?: Pick<Card, "numeroCatalogo" | "nome" | "imgURL">;
  }[];
  pendingSpell?: {
    casterId: string;
    card: Instance;
    targets: string[];
    bonus: number;
    actionBonus?: number;
    destinationId?: string;
  };
  version: number;
  turn: number;
  round: number;
  phase: "PREPARATION" | "BATTLE";
  current: string;
  status: "ACTIVE" | "FINISHED";
  winner: string | null;
  reason: string | null;
  players: Player[];
  slots: Slot[];
  log: string[];
  events?: BattleEvent[];
  eventSequence?: number;
}
export interface DeckDefinition {
  nome: string;
  mago: string | null;
  cartas: string[];
  icone?: string;
  verso?: string;
}
