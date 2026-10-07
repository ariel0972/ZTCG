import type { Card } from "../types/card";
import type { Status } from "./status";

export interface Instance extends Card {
  id: string;
  ownerId: string;
  hpAtual: number;
  attacked: boolean;
  usedAbility: boolean;
  moved?: boolean;
  revivedFromGraveyard?: boolean;
  appliedElement?: string;
  statuses: Status[];
  fireSpellsCast?: number;
  fireDamageBonus?: number;
  passiveCounters?: Record<string, number>;
  killedBy?: { ownerId: string; cardId: string };
}
export interface Slot {
  id: string;
  ownerId: string;
  kind: "Tropa" | "Mago" | "Armamento";
  column: number;
  card: Instance | null;
  structure: Instance | null;
  terrain?: { nome: "Lama"; rodadasRestantes: number };
  appliedElement?: string;
}
export interface Player {
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
export interface State {
  ongoingSpells?: {
    id: string;
    ownerId: string;
    kind: "tornado" | "arrowRain" | "sandstorm";
    rounds: number;
    damage: number;
    element?: Card["elemento"];
  }[];
  pendingSpell?: {
    casterId: string;
    card: Instance;
    targets: string[];
    bonus: number;
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
  events?: {
    sequence: number;
    kind: string;
    message?: string;
    card: { id: string; nome: string; imgURL: string; ownerId: string };
  }[];
  eventSequence?: number;
}
export interface DeckDefinition {
  nome: string;
  mago: string | null;
  cartas: string[];
  icone?: string;
  verso?: string;
}
