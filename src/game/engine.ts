import { modifiedSpell, currentSpellCost } from "./spell-modifiers";
import { createCoinToss, resolveCoinToss, type CoinFace } from "./coin-toss";
import { effectRoundDue, nextEffectRound } from "./effect-clock";
import { reviveDestinations, spellTurnBonusStatus } from "./resurrection";
import { fieldElementResult } from "./field-effects";
import { nextActionBonusStatus, addActionDamage } from "./action-bonus";
import {
  abilityManaCost,
  currentBasicAttack,
  fieldAttackBonus,
  fieldKeywords,
} from "./passives";
import { planDisplacement } from "./displacement";
import { playableErrors } from "./capabilities";
import { hiddenFieldCard } from "./hidden-cards";
import { chooseAction } from "./action-options";
import type { Instance, Slot, Player, State, DeckDefinition } from "./state";
import type { BattleEvent, BattleDamage } from "./state";
import { slotCards } from "./state";
import {
  adjacentAttackBonus,
  targetAttackBonus,
  blockedOwnAttack,
  basicAttackLimit,
  basicAttackElement,
  canMount,
  attackInterceptor,
  restrictedBasicAttack,
  passiveMatches,
  matchesPassiveFilter,
  spellDamageBonus,
  temporarySpellDamageBonus,
  describePassiveActions,
  continuousPassiveActive,
  type PassiveEvent,
} from "./passives";
import {
  normalizePassive,
  initializeLegacyCounters,
  synchronizeLegacyCounters,
} from "./legacy-passives";
import { randomUUID } from "node:crypto";
import {
  Card,
  Effect,
  TipoAlvoFeitico,
  type PassiveAction,
} from "../types/card";
import { validateDeck } from "../domain/deck";
import { AppError } from "../lib/errors";
import { Command, commandSchema } from "./contracts";
import {
  Status,
  applyStatus,
  canonicalStatus,
  hasStatus,
  tickRound,
} from "./status";
import {
  elementalReaction,
  ReactionName,
  reactionDescriptions,
} from "./reactions";
export type { Status } from "./status";
type Resolution = NonNullable<State["pendingImpact"]>;
class ImpactChoice extends Error {
  constructor(
    readonly request: Resolution["request"],
    readonly preview: State,
  ) {
    super("Resposta de desvio pendente.");
  }
}
export class Game {
  public state: State;
  private deferMageDefeat = false;
  private processed = new Map<string, number>();
  private passiveDepth = 0;
  private passiveSteps = 0;
  private resolution?: {
    decisions: Record<string, boolean>;
    randoms: number[];
    randomIndex: number;
    impactIndex: number;
  };
  private impact?: {
    key: number;
    dodgeKey: number;
    kind: "attack" | "spell" | "ability";
    name: string;
    blocked: Map<string, boolean>;
  };
  private random() {
    const r = this.resolution;
    if (!r) return this.rng();
    const index = r.randomIndex++;
    return r.randoms[index] ?? (r.randoms[index] = this.rng());
  }
  private inImpact<T>(
    kind: "attack" | "spell" | "ability",
    name: string,
    operation: () => T,
    { shareDodgeWithParent = false }: { shareDodgeWithParent?: boolean } = {},
  ): T {
    const previous = this.impact;
    const key = this.resolution ? this.resolution.impactIndex++ : 0;
    this.impact = {
      key,
      dodgeKey: shareDodgeWithParent && previous ? previous.dodgeKey : key,
      kind,
      name,
      blocked: new Map(),
    };
    try {
      return operation();
    } finally {
      this.impact = previous;
    }
  }
  private impactAllowed(id: string, banishment = false): boolean {
    const impact = this.impact;
    if (!impact) return true;
    const target = this.findCard(id) ?? this.targetSlot(id)?.card;
    if (!target || target.hpAtual <= 0) return true;
    const cached = impact.blocked.get(target.id);
    // Banishment bypasses the spell shield, but never a chosen dodge.
    if (cached !== undefined && !banishment) return !cached;
    const key = `${impact.dodgeKey}:${target.id}`;
    const dodge = target.habilidadesPassivas
      .map(normalizePassive)
      .some(
        (p) =>
          p.gatilho === "onTargeted" &&
          p.efeitos.some(
            (e) =>
              e.id === "dodgeImpact" &&
              (target.dodgedRound === undefined ||
                this.state.round - target.dodgedRound > (e.esperaRodadas ?? 0)),
          ) &&
          passiveMatches(
            p,
            target,
            { ownerId: target.ownerId, cardId: target.id, card: target },
            this.state.slots,
          ),
      );
    let decision = this.resolution?.decisions[key];
    // Resume pending volleys saved before shared dodge decisions were introduced.
    if (
      decision === undefined &&
      this.resolution &&
      impact.dodgeKey !== impact.key
    ) {
      decision = this.resolution.decisions[`${impact.key}:${target.id}`];
      if (decision !== undefined) this.resolution.decisions[key] = decision;
    }
    if (dodge && target.dodgedRound !== this.state.round && this.resolution) {
      if (decision === undefined)
        throw new ImpactChoice(
          {
            key,
            ownerId: target.ownerId,
            cardId: target.id,
            source: impact.name,
          },
          structuredClone(this.state),
        );
      if (decision) {
        target.dodgedRound = this.state.round;
        impact.blocked.set(target.id, true);
        this.event(
          "block",
          target,
          `${target.nome} desviou de ${impact.name}, anulando dano e efeitos do golpe.`,
        );
        return false;
      }
    }
    if (decision === true) return false;
    if (impact.kind === "spell" && !banishment) {
      const shield = target.statuses.find(
        (s) =>
          s.nome === "EscudoProtecao" &&
          s.turnosRestantes > 0 &&
          (s.valor ?? 0) > 0,
      );
      if (shield) {
        shield.valor!--;
        if (!shield.valor)
          target.statuses = target.statuses.filter((s) => s !== shield);
        impact.blocked.set(target.id, true);
        this.event(
          "block",
          target,
          `${impact.name} foi bloqueado por ${shield.origin ?? "Escudo de Proteção"} em ${target.nome}.`,
        );
        return false;
      }
    }
    if (!banishment) impact.blocked.set(target.id, false);
    return true;
  }
  private runResolution(
    operation: Resolution["operation"],
    resume?: Resolution,
    version = this.state.version,
  ) {
    if (this.resolution) return this.performResolution(operation);
    const base = structuredClone(resume?.base ?? this.state);
    this.resolution = {
      decisions: { ...resume?.decisions },
      randoms: [...(resume?.randoms ?? [])],
      randomIndex: 0,
      impactIndex: 0,
    };
    this.state = structuredClone(base);
    for (const p of this.state.players) {
      const mage = this.state.slots.find(
        (s) => s.kind === "Mago" && s.ownerId === p.id,
      )?.card;
      if (mage) p.mage = mage;
    }
    try {
      const result = this.performResolution(operation);
      this.state.version = version + 1;
      return result ?? { duplicate: false, version: this.state.version };
    } catch (error) {
      if (!(error instanceof ImpactChoice)) {
        this.state = base;
        throw error;
      }
      this.state = error.preview;
      this.state.pendingImpact = {
        base,
        operation,
        decisions: this.resolution.decisions,
        randoms: this.resolution.randoms,
        request: error.request,
      };
      this.state.version = version + 1;
      return { duplicate: false, version: this.state.version };
    } finally {
      this.resolution = undefined;
      this.impact = undefined;
      this.deferMageDefeat = false;
    }
  }
  private performResolution(operation: Resolution["operation"]) {
    if ("user" in operation)
      return this.executeOnce(operation.user, operation.command);
    if (operation.automatic === "timeout") return this.timeoutOnce();
    if (operation.automatic === "attack")
      return this.resolvePendingAttackOnce(operation.reflect);
    return this.resolvePendingSpellOnce();
  }
  responseKey() {
    return this.state.pendingImpact
      ? `dodge:${this.state.pendingImpact.request.key}`
      : this.state.pendingHandChoice
        ? `hand:${this.state.pendingHandChoice.ownerId}`
        : this.state.pendingAttack
          ? `attack:${this.state.pendingAttack.attackerId}`
          : this.state.pendingSpell
            ? `spell:${this.state.pendingSpell.card.id}`
            : this.state.pendingRevives?.length
              ? `revive:${this.state.pendingRevives[0].id}`
              : "";
  }
  resolvePendingChoice() {
    if (this.state.pendingImpact)
      this.respondDodge(this.state.pendingImpact.request.ownerId, false);
    else if (this.state.pendingHandChoice) {
      delete this.state.pendingHandChoice;
      this.log(
        "Olho da Verdade: tempo de escolha esgotado, nenhuma carta transferida.",
      );
      this.state.version++;
    } else if (this.state.pendingRevives?.length) {
      const choice = this.state.pendingRevives.shift()!;
      this.log(
        choice.source + ": tempo de escolha esgotado; nenhuma tropa revivida.",
      );
      this.state.version++;
    }
  }
  private respondDodge(user: string, dodge: boolean, choiceKey?: string) {
    const pending = this.state.pendingImpact;
    if (!pending || pending.request.ownerId !== user)
      this.fail("Não há desvio disponível para você.");
    if (choiceKey !== undefined && choiceKey !== pending.request.key)
      throw new AppError(
        409,
        "Essa escolha de desvio já mudou. Confira a carta indicada no menu.",
        "STALE_CHOICE",
      );
    const current = this.state;
    const resume = {
      ...pending,
      decisions: { ...pending.decisions, [pending.request.key]: dodge },
    };
    // Original receipts remain idempotent; only this persisted operation may be replayed.
    const operation = pending.operation;
    const key =
      "user" in operation
        ? `${operation.user}:${(operation.command as Command).actionId}`
        : undefined;
    const receipt = key ? this.processed.get(key) : undefined;
    if (key) this.processed.delete(key);
    try {
      this.runResolution(operation, resume, current.version);
    } catch (error) {
      this.state = current;
      throw error;
    } finally {
      if (key && receipt !== undefined) this.processed.set(key, receipt);
    }
  }
  execute(user: string, raw: unknown) {
    const cmd = commandSchema.parse(raw),
      key = `${user}:${cmd.actionId}`;
    this.player(user);
    if (this.processed.has(key))
      return { duplicate: true, version: this.processed.get(key)! };
    if (cmd.version !== this.state.version)
      throw new AppError(409, "Estado mudou. Tente novamente.", "STALE_STATE");
    if (this.state.status !== "ACTIVE") this.fail("Esta partida já terminou.");
    if (this.state.pendingImpact || this.state.pendingHandChoice) {
      if (cmd.type === "surrender")
        this.finish(this.opponent(user).id, "Desistência.");
      else if (cmd.type === "respondDodge")
        this.respondDodge(user, cmd.dodge, cmd.choiceKey);
      else if (cmd.type === "chooseHand") this.chooseHand(user, cmd.cardId);
      else this.fail("Aguarde a resposta à ação pendente.");
      if (cmd.type !== "respondDodge") this.state.version++;
    } else {
      if (["respondDodge", "chooseHand"].includes(cmd.type))
        this.fail("Não há resposta disponível.");
      this.runResolution({ user, command: cmd });
    }
    this.processed.set(key, this.state.version);
    if (this.processed.size > 1000)
      this.processed.delete(this.processed.keys().next().value!);
    return { duplicate: false, version: this.state.version };
  }
  exportState() {
    return structuredClone({
      format: 1 as const,
      id: this.id,
      state: this.state,
      processed: [...this.processed],
    });
  }
  static restore(saved: ReturnType<Game["exportState"]>) {
    if (saved.format !== 1)
      throw new AppError(503, "Versão de partida incompatível.", "GAME_FORMAT");
    const game = Object.create(Game.prototype) as Game;
    game.id = saved.id;
    game.state = structuredClone(saved.state);
    for (const slot of game.state.slots) {
      if (slot.appliedElement === "Neutro") delete slot.appliedElement;
      for (const card of slotCards(slot))
        if (card?.appliedElement === "Neutro") delete card.appliedElement;
    }
    // BSON/JSON preserve values, but not shared references between mage and slot.
    for (const player of game.state.players) {
      const mage = game.state.slots.find(
        (slot) => slot.ownerId === player.id && slot.kind === "Mago",
      )?.card;
      if (mage && mage.id === player.mage.id) player.mage = mage;
    }
    game.processed = new Map(saved.processed);
    game.rng = Math.random;
    return game;
  }
  drawByDisconnection() {
    this.finish(
      null,
      "Empate: ambos desconectados além do prazo de reconexão.",
    );
    this.state.version++;
  }
  constructor(
    public id: string,
    participants: { id: string; nome: string; deck: DeckDefinition }[],
    catalog: Card[],
    private rng = Math.random,
  ) {
    if (participants.length !== 2 || participants[0].id === participants[1].id)
      throw new AppError(422, "São necessários dois jogadores diferentes.");
    const byId = new Map(catalog.map((c) => [c.numeroCatalogo, c]));
    const players = participants.map((p) => {
      const errors = validateDeck(p.deck, catalog, true);
      for (const id of [p.deck.mago!, ...p.deck.cartas])
        if (byId.has(id)) errors.push(...playableErrors(byId.get(id)!));
      if (errors.length)
        throw new AppError(
          422,
          "Deck não está pronto para jogar.",
          "INVALID_DECK",
          [...new Set(errors)],
        );
      const instance = (id: string): Instance => ({
        ...structuredClone(byId.get(id)!),
        id: randomUUID(),
        ownerId: p.id,
        hpAtual: byId.get(id)!.hp ?? 0,
        attacked: false,
        usedAbility: false,
        statuses: [],
      });
      return {
        id: p.id,
        nome: p.nome,
        deckAppearance: {
          nome: p.deck.nome,
          icone: p.deck.icone ?? "/assets/icons/neutro.svg",
          verso: p.deck.verso ?? "common",
        },
        mage: instance(p.deck.mago!),
        deck: this.shuffle(p.deck.cartas.map(instance)),
        hand: [],
        graveyard: [],
        banished: [],
        forgotten: [],
        preparation: {
          ready: false,
          redraws: 0,
          started: false,
          bonusDraws: 0,
        },
        combatStarted: false,
        inactivityStreak: 0,
        turnActions: 0,
        mana: 5,
        counters: {
          summons: 0,
          attacks: 0,
          spells: 0,
          unique: 0,
          equipment: 0,
        },
      } as Player;
    });
    const slots: Slot[] = [];
    for (const p of players) {
      for (let column = 0; column < 3; column++)
        slots.push({
          id: `${p.id}:front:${column}`,
          ownerId: p.id,
          kind: "Tropa",
          column,
          card: null,
          structure: null,
        });
      for (const position of [
        "front-left",
        "front-right",
        "back-left",
        "back-right",
      ])
        slots.push({
          id: `${p.id}:arm:${position}`,
          ownerId: p.id,
          kind: "Armamento",
          column: position.endsWith("left") ? 0 : 2,
          card: null,
          structure: null,
        });
      slots.push({
        id: `${p.id}:mage`,
        ownerId: p.id,
        kind: "Mago",
        column: 1,
        card: p.mage,
        structure: null,
      });
    }
    this.state = {
      version: 0,
      turn: 1,
      round: 1,
      phase: "PREPARATION",
      current: players[this.random() < 0.5 ? 0 : 1].id,
      status: "ACTIVE",
      winner: null,
      reason: null,
      players,
      slots,
      log: [
        "Partida iniciada. Os dois jogadores preparam seus campos ao mesmo tempo.",
      ],
    };
    for (const p of players) {
      this.draw(p, 5);
    }
  }
  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  private fail(message: string): never {
    throw new AppError(422, message, "ILLEGAL_ACTION");
  }
  player(id: string) {
    const p = this.state.players.find((p) => p.id === id);
    if (!p)
      throw new AppError(403, "Você não participa desta partida.", "FORBIDDEN");
    return p;
  }
  private opponent(id: string) {
    this.player(id);
    return this.state.players.find((p) => p.id !== id)!;
  }
  private front(id: string) {
    return this.state.slots.filter(
      (s) => s.ownerId === id && s.kind === "Tropa",
    );
  }
  private ownSlot(id: string, owner: string) {
    const slot = this.state.slots.find(
      (s) => s.id === id && s.ownerId === owner,
    );
    if (!slot) this.fail("Slot inválido.");
    return slot;
  }
  private findCard(id: string) {
    return (
      this.state.slots.flatMap(slotCards).find((c) => c?.id === id) ?? null
    );
  }
  private targetSlot(id: string) {
    return this.state.slots.find(
      (s) => s.id === id || slotCards(s).some((c) => c.id === id),
    );
  }
  private fieldView(card: Instance) {
    return {
      ...card,
      palavrasChave: fieldKeywords(card),
      habilidadesAtivas: card.habilidadesAtivas.map((h) => ({
        ...h,
        custoMana: abilityManaCost(card, h.custoMana, this.state.slots),
      })),
    };
  }
  private has(card: Instance, word: string) {
    return (
      fieldKeywords(card).includes(word) ||
      card.statuses.some((s) => s.nome === word && s.turnosRestantes > 0)
    );
  }
  private draw(player: Player, count: number) {
    for (let i = 0; i < count; i++) {
      const card = player.deck.pop();
      if (!card) {
        this.finish(this.opponent(player.id).id, "Fadiga: baralho vazio.");
        return;
      }
      player.hand.push(card);
    }
  }
  private log(text: string) {
    this.state.log.push(text);
    this.state.log = this.state.log.slice(-100);
  }
  private spend(player: Player, cost: number) {
    if (player.mana < cost) this.fail("Mana insuficiente.");
    player.mana -= cost;
  }
  private finish(winner: string | null, reason: string) {
    if (this.state.status === "FINISHED") return;
    this.state.status = "FINISHED";
    delete this.state.pendingSpell;
    delete this.state.pendingAttack;
    delete this.state.pendingImpact;
    delete this.state.pendingHandChoice;
    delete this.state.pendingRevives;
    this.state.winner = winner;
    this.state.reason = reason;
    this.log(reason);
  }
  public abandon(user: string, reason: string) {
    this.player(user);
    this.finish(this.opponent(user).id, reason);
    this.state.version++;
  }
  public timeout() {
    return this.runResolution({ automatic: "timeout" });
  }
  private timeoutOnce() {
    if (this.state.status !== "ACTIVE") return;
    const record = (p: Player) => {
      if (p.turnActions === 0) {
        p.inactivityStreak++;
        this.log(
          `${p.nome} não fez nada, turno passado. Inatividade ${p.inactivityStreak}/3.`,
        );
      } else {
        p.inactivityStreak = 0;
        this.log(`${p.nome}: tempo esgotado, turno passado.`);
      }
    };
    if (this.state.phase === "COIN_TOSS") {
      if (!this.state.coinToss?.result)
        this.chooseCoin(this.state.coinToss!.chooserId, "heads");
      else this.beginBattle();
    } else if (this.state.phase === "PREPARATION") {
      for (const p of this.state.players) {
        if (!p.preparation.ready || p.preparation.bonusDraws > 0) {
          record(p);
          p.preparation.bonusDraws = 0;
          p.preparation.ready = true;
        }
      }
      this.tryStartBattle();
    } else {
      const p = this.player(this.state.current);
      record(p);
      if (p.inactivityStreak >= 3)
        this.finish(
          this.opponent(p.id).id,
          "Derrota por três turnos consecutivos de inatividade.",
        );
      else this.endTurn(p.id);
    }
    this.state.version++;
  }
  private openingBlocked() {
    return this.state.phase === "PREPARATION" || this.state.turn <= 1;
  }
  private manaRecovery(mage: Instance) {
    const attached = (this.state.attachments ?? [])
      .filter((a) => a.targetId === mage.id)
      .reduce((n, a) => n + a.manaBonus, 0);
    if (mage.tipo !== "Mago") return (mage.manaGerada ?? 0) + attached;
    const player = this.player(mage.ownerId);
    let recovery = mage.recuperacaoMana ?? 0;
    for (const passive of mage.habilidadesPassivas) {
      const rule = normalizePassive(passive);
      if (
        rule.gatilho !== "continuous" ||
        !passiveMatches(
          rule,
          mage,
          { ownerId: player.id, cardId: mage.id, card: mage },
          this.state.slots,
        )
      )
        continue;
      for (const action of rule.efeitos)
        if (action.id === "manaRecovery") recovery = action.valor;
    }
    return recovery + attached;
  }
  private recoverMana(player: Player) {
    this.gainMana(
      player,
      this.manaRecovery(player.mage) +
        this.state.slots
          .filter((s) => s.ownerId === player.id)
          .flatMap(slotCards)
          .reduce(
            (sum, c) =>
              sum + (c && c.tipo !== "Mago" ? this.manaRecovery(c) : 0),
            0,
          ),
    );
  }
  private gainMana(player: Player, amount: number) {
    const before = player.mana;
    player.mana = Math.min(20, player.mana + amount);
    const recovered = player.mana - before;
    if (recovered > 0)
      this.event("mana", player.mage, undefined, {
        mana: { amount: recovered },
        slotId: this.state.slots.find(
          (s) => s.ownerId === player.id && s.kind === "Mago",
        )?.id,
        originOwnerId: player.id,
        summary: `${player.nome} recuperou ${recovered} de mana.`,
      });
    return recovered;
  }
  private revive(
    user: string,
    cardId: string,
    destinationId: string | undefined,
    options: Pick<
      Effect,
      "bonusHp" | "bonusAtaque" | "recompensaMorteRodada"
    > = {},
    source = "Ressurreição",
  ) {
    const player = this.player(user);
    const index = player.graveyard.findIndex(
      (c) => c.id === cardId && c.tipo === "Tropa",
    );
    const slot = reviveDestinations(this.state.slots, user).find(
      (s) => s.id === destinationId,
    );
    if (index < 0) this.fail("Escolha uma tropa do seu cemitério.");
    if (!slot) this.fail("Escolha um espaço de tropa livre e sem Lama.");
    const card = player.graveyard.splice(index, 1)[0];
    this.resetCard(card);
    card.hp = (card.hp ?? 0) + (options.bonusHp ?? 0);
    card.ataque = (card.ataque ?? 0) + (options.bonusAtaque ?? 0);
    card.reviveBonuses = {
      hp: options.bonusHp ?? 0,
      ataque: options.bonusAtaque ?? 0,
    };
    slot.card = card;
    card.hpAtual =
      card.hp +
      this.weapons(slot, card).reduce((n, w) => n + (w.bonusHp ?? 0), 0);
    if (options.recompensaMorteRodada)
      card.deathReward = {
        round: this.state.round,
        mana: options.recompensaMorteRodada.mana,
        ownerId: user,
        source,
      };
    this.event(
      "summon",
      card,
      source + ": " + card.nome + " voltou do cemitério ao campo.",
      { slotId: slot.id },
    );
    this.trigger("onSummon", {
      ownerId: user,
      cardId: card.id,
      card,
      slotId: slot.id,
      element: card.elemento,
    });
    this.trigger("onRevive", {
      ownerId: user,
      cardId: card.id,
      card,
      slotId: slot.id,
      element: card.elemento,
    });
    this.log(source + ": " + card.nome + " foi revivida.");
  }
  private queueRevive(user: string, source: string) {
    const cards = this.player(user)
      .graveyard.filter((c) => c.tipo === "Tropa")
      .map((c) => c.id);
    if (!cards.length || !reviveDestinations(this.state.slots, user).length)
      return false;
    if ((this.state.pendingRevives?.length ?? 0) >= 32)
      this.fail("Limite de escolhas de ressurreição excedido.");
    (this.state.pendingRevives ??= []).push({
      id: randomUUID(),
      ownerId: user,
      cards,
      source,
    });
    return true;
  }
  private chooseRevive(user: string, cardId?: string, destinationId?: string) {
    const choice = this.state.pendingRevives?.[0];
    if (!choice || choice.ownerId !== user)
      this.fail("Não há ressurreição disponível para você.");
    if (!cardId || !destinationId || !choice.cards.includes(cardId))
      this.fail("Escolha uma tropa oferecida e um espaço para reviver.");
    this.state.pendingRevives!.shift();
    this.revive(user, cardId, destinationId, {}, choice.source);
  }
  private findSourceCard(id: string) {
    return (
      this.findCard(id) ??
      this.state.players
        .flatMap((p) => [
          ...p.hand,
          ...p.deck,
          ...p.graveyard,
          ...p.banished,
          ...p.forgotten,
        ])
        .find((c) => c.id === id)
    );
  }
  private reactFields(element: Card["elemento"]) {
    for (const field of this.state.fieldEffects ?? []) {
      const result = fieldElementResult(field, element);
      if (!result.changed) continue;
      field.damage = result.damage;
      if (result.remove) field.rounds = 0;
      this.event(
        "notice",
        field.card,
        result.remove
          ? `${field.card.nome} foi removida por ${element}.`
          : `${field.card.nome}: dano alterado para ${field.damage} por ${element}.`,
      );
    }
    this.state.fieldEffects = this.state.fieldEffects?.filter(
      (f) => f.rounds > 0,
    );
  }
  private afterAttackFields(card: Instance) {
    for (const field of this.state.fieldEffects ?? []) {
      if (
        field.affectedOwnerId !== card.ownerId ||
        field.rounds <= 0 ||
        card.hpAtual <= 0 ||
        !this.targetSlot(card.id)
      )
        continue;
      const result = fieldElementResult(
        {
          ...field,
          damage:
            field.damage +
            temporarySpellDamageBonus(this.player(field.ownerId).mage),
        },
        this.attackElement(card),
      );
      if (result.remove) {
        field.rounds = 0;
        this.event(
          "notice",
          field.card,
          `${card.nome} removeu ${field.card.nome} com seu ataque de ${this.attackElement(card)}.`,
        );
        continue;
      }
      this.inImpact("spell", field.card.nome, () =>
        this.damage(
          card.id,
          result.damage,
          undefined,
          field.piercing,
          field.element,
          this.findSourceCard(field.card.id),
          `${field.card.nome} após o ataque de ${card.nome}`,
          field.ownerId,
        ),
      );
    }
    this.state.fieldEffects = this.state.fieldEffects?.filter(
      (f) => f.rounds > 0,
    );
  }
  private takeActionBonus(user: string) {
    const mage = this.player(user).mage;
    const status = mage.statuses.find(
      (s) => s.nome === nextActionBonusStatus && s.turnosRestantes > 0,
    );
    if (!status) return 0;
    mage.statuses = mage.statuses.filter((s) => s !== status);
    const bonus = status.valor ?? 0;
    this.event(
      "notice",
      mage,
      `${status.origin ?? mage.nome}: +${bonus} de dano nesta ação.`,
    );
    return bonus;
  }
  private openingHarm(
    effects: Effect[] = [],
    id?: string,
    element?: Card["elemento"],
  ) {
    return (
      this.causesDamage(effects, id, element) ||
      effects.some((e) => e.id === "sacrifice")
    );
  }
  private causesDamage(
    effects: Effect[] = [],
    abilityId?: string,
    mageElement?: Card["elemento"],
  ) {
    return (
      ["ataqueFurtivo", "ordemDaEspada", "deslocar"].includes(
        abilityId ?? "",
      ) ||
      effects.some((e) =>
        e.id === "lightOrb"
          ? (e.variantesMago?.find((v) => v.elemento === mageElement)
              ?.causaDano ??
              (e.variantesMago === undefined && mageElement === "Fogo")) ||
            [
              e.variantesMago?.find((v) => v.elemento === mageElement)
                ?.status ??
                e.status ??
                "Cego",
              ...(
                e.variantesMago?.find((v) => v.elemento === mageElement)
                  ?.efeitos ?? []
              ).map((s) => s.status),
            ].some((s) =>
              [
                "Envenenado",
                "Queimado",
                "Sangrando",
                "Peste Negra",
                "Leptospirose",
              ].includes(canonicalStatus(s)),
            )
          : [
              "damage",
              "trap",
              "attackField",
              "periodicDamage",
              "stoneVolley",
              "tornado",
              "arrowRain",
              "tremor",
              "lightOrb",
              "sandstorm",
              "meteors",
            ].includes(e.id) ||
            (e.id === "status" &&
              [
                "Envenenado",
                "Queimado",
                "Sangrando",
                "Peste Negra",
                "Leptospirose",
              ].includes(canonicalStatus(e.status ?? ""))),
      )
    );
  }
  private mulligan(user: string) {
    const p = this.player(user);
    if (
      this.state.phase !== "PREPARATION" ||
      p.preparation.started ||
      p.preparation.redraws >= 3 ||
      p.hand.some((c) => c.tipo === "Tropa")
    )
      this.fail(
        "Reembaralhe apenas uma mão inicial sem tropa, até três vezes, antes de jogar.",
      );
    p.deck.push(...p.hand.splice(0));
    this.shuffle(p.deck);
    this.draw(p, 5);
    p.preparation.redraws++;
    this.opponent(user).preparation.bonusDraws++;
    this.log(
      `${p.nome} reembaralhou a mão inicial (${p.preparation.redraws}/3).`,
    );
  }
  private preparationBonus(user: string, accept: boolean) {
    const p = this.player(user);
    if (this.state.phase !== "PREPARATION" || !p.preparation.bonusDraws)
      this.fail("Não há compra extra de preparação pendente.");
    const count = 1;
    p.preparation.bonusDraws--;
    if (accept) this.draw(p, count);
    this.log(
      `${p.nome} ${accept ? "comprou" : "recusou"} ${count} carta(s) extra(s) por reembaralhamento.`,
    );
  }
  private weapons(slot: Slot, beneficiary?: Instance) {
    if (beneficiary && slot.rider && slot.card?.id === beneficiary.id)
      return [];
    const position =
      slot.kind === "Mago"
        ? ["back-left", "back-right"]
        : slot.column === 0
          ? ["front-left"]
          : slot.column === 2
            ? ["front-right"]
            : [];
    return this.state.slots
      .filter(
        (s) =>
          s.ownerId === slot.ownerId &&
          position.some((p) => s.id.endsWith(`:${p}`)),
      )
      .flatMap((s) => (s.card ? [s.card] : []));
  }
  private damage(
    id: string,
    value: number,
    attacker?: Instance,
    piercing = false,
    element = attacker?.elemento,
    source?: Instance,
    cause?: string,
    originOwnerId?: string,
    interception?: { cardId: string; valor: number; origin: string },
  ): { target: Instance; amount: number; killed: boolean } | undefined {
    const slot = this.targetSlot(id);
    if (!slot) this.fail("Alvo não encontrado.");
    const protectedCard = this.findCard(id) ?? slot.card;
    if (attacker && protectedCard && !interception) {
      const defender = attackInterceptor(
        attacker,
        { ...slot, card: protectedCard, rider: null },
        this.state.slots,
        true,
      );
      if (
        defender?.protection?.protegidoId === protectedCard.id &&
        defender.card.id !== protectedCard.id
      ) {
        const origin = defender.protection.origin ?? "Em Guarda";
        this.event(
          "passive",
          defender.card,
          `${defender.card.nome} interceptou ${slot.rider?.id === id ? "o dano excedente" : "o ataque básico"} destinado a ${protectedCard.nome} pela habilidade ${origin}.`,
        );
        return this.damage(
          defender.card.id,
          value,
          attacker,
          false,
          element,
          source,
          cause,
          originOwnerId,
          {
            cardId: defender.card.id,
            valor: defender.protection.valor ?? 0,
            origin,
          },
        );
      }
    }
    // A estrutura absorve o golpe inteiro, inclusive o excedente.
    // Sem tropa vinculada, ela não protege o mago.
    const protectedByStructure =
      slot.structure &&
      slot.structure.hpAtual > 0 &&
      slot.card?.tipo === "Tropa" &&
      id !== slot.structure.id &&
      !hasStatus(slot.structure!.statuses, ["Abalo"]) &&
      !piercing;
    const target =
      id === slot.structure?.id
        ? slot.structure
        : protectedByStructure
          ? slot.structure!
          : ((id === slot.rider?.id ? slot.rider : slot.card) ??
            this.player(slot.ownerId).mage);
    if (target.hpAtual <= 0 || !this.impactAllowed(target.id)) return;
    const origin =
      cause ??
      (attacker
        ? `Ataque de ${attacker.nome}`
        : source
          ? `Efeito de ${source.nome}`
          : "Dano");
    let remaining = value;
    const protection = target.statuses.find(
      (s) =>
        s.nome === "EscudoProtecao" &&
        (s.valor ?? 0) > 0 &&
        s.turnosRestantes > 0,
    );
    if (protection && remaining > 0) {
      protection.valor!--;
      if (protection.valor! <= 0)
        target.statuses = target.statuses.filter((s) => s !== protection);
      this.reportDamage(
        target,
        0,
        origin,
        target.hpAtual,
        `bloqueado por ${protection.origin ?? `Escudo de Proteção de ${target.nome}`}`,
        undefined,
        target.ownerId,
      );
      return;
    }
    const weakness = !!element && target.fraqueza.includes(element);
    const blockers: string[] = [];
    const resistance =
      !!element &&
      target.resistencia.includes(element) &&
      !this.has(target, "Vapor");
    if (weakness) remaining *= 2;
    if (resistance) remaining = Math.floor(remaining / 2);
    if (interception?.cardId === target.id) {
      blockers.push(interception.origin);
      remaining = Math.max(0, remaining - interception.valor);
    }
    if (this.has(target, "armaduraPoderosa")) {
      blockers.push(`Armadura Poderosa de ${target.nome}`);
      remaining = Math.max(0, remaining - 2);
    }
    for (const reduction of target.statuses.filter(
      (s) =>
        (s.nome === "ReducaoDano" ||
          (s.nome === "ReducaoAtaqueTropa" && attacker?.tipo === "Tropa")) &&
        s.turnosRestantes > 0 &&
        (!s.requerStatus || this.has(target, s.requerStatus)),
    )) {
      if ((reduction.valor ?? 0) > 0)
        blockers.push(reduction.origin ?? `redução de dano de ${target.nome}`);
      remaining = Math.max(0, remaining - (reduction.valor ?? 0));
    }
    const shield = target.statuses.find(
      (s) => s.nome === "Escudo" && (s.valor ?? 0) > 0,
    );
    if (shield) {
      const absorbed = Math.min(remaining, shield.valor!);
      if (absorbed > 0)
        blockers.push(shield.origin ?? `Escudo de ${target.nome}`);
      shield.valor! -= absorbed;
      remaining -= absorbed;
    }
    const excess =
      ((attacker && this.has(attacker, "Sobrepujar")) ||
        this.has(target, "Explosão")) &&
      target.tipo === "Tropa" &&
      !(target.id === slot.card?.id && slot.rider)
        ? Math.max(0, remaining - target.hpAtual)
        : 0;
    const hpBefore = target.hpAtual;
    const riderExcess =
      target.id === slot.card?.id && slot.rider
        ? Math.max(0, remaining - hpBefore)
        : 0;
    target.hpAtual -= remaining;
    if (attacker?.tipo === "Tropa" && attacker.hpAtual > 0) {
      const position = this.targetSlot(attacker.id);
      const lifesteal =
        position &&
        this.weapons(position, attacker)
          .flatMap((w) =>
            w.habilidadesPassivas
              .map(normalizePassive)
              .filter(
                (p) =>
                  p.gatilho === "continuous" &&
                  passiveMatches(
                    p,
                    w,
                    { ownerId: w.ownerId, cardId: w.id, card: w },
                    this.state.slots,
                  ),
              )
              .flatMap((p) => p.efeitos),
          )
          .find((e) => e.id === "attackLifesteal");
      if (lifesteal?.id === "attackLifesteal")
        this.heal(
          attacker,
          Math.min(Math.max(0, hpBefore), remaining),
          lifesteal.excedente ?? 0,
          attacker,
        );
    }
    this.reportDamage(
      target,
      remaining,
      origin,
      hpBefore,
      [
        remaining === 0 && value > 0
          ? `bloqueado por ${[...new Set(blockers)].join(" e ") || `resistência de ${target.nome}`}`
          : "",
        weakness ? `fraqueza a ${element === "Agua" ? "Água" : element}` : "",
        resistance
          ? `resistência a ${element === "Agua" ? "Água" : element}`
          : "",
      ]
        .filter(Boolean)
        .join("; ") || undefined,
      {
        element,
        modifiers: [
          ...(weakness ? ["weakness" as const] : []),
          ...(resistance ? ["resistance" as const] : []),
        ],
      },
      originOwnerId ?? source?.ownerId ?? attacker?.ownerId,
    );
    const killer = source ?? attacker;
    if (hpBefore > 0 && target.hpAtual <= 0 && killer)
      target.killedBy = { ownerId: killer.ownerId, cardId: killer.id };
    if (remaining)
      this.trigger("onDamageTaken", {
        cardId: target.id,
        ownerId: target.ownerId,
        card: target,
        attackerId: killer?.id,
      });
    if (riderExcess && slot.rider && slot.rider.hpAtual > 0)
      this.damage(
        slot.rider.id,
        riderExcess,
        attacker,
        true,
        element,
        source,
        `Excedente de ${target.nome} (${origin})`,
        originOwnerId,
      );
    if (excess) {
      const mage = this.player(target.ownerId).mage;
      const before = mage.hpAtual;
      mage.hpAtual -= excess;
      this.reportDamage(
        mage,
        excess,
        `${this.has(target, "Explosão") ? "Explosão" : "Sobrepujar"} de ${target.nome} (${origin})`,
        before,
        undefined,
        undefined,
        originOwnerId ?? source?.ownerId ?? attacker?.ownerId,
      );
    }
    return {
      target,
      amount: Math.min(Math.max(0, hpBefore), remaining),
      killed: hpBefore > 0 && target.hpAtual <= 0,
    };
  }
  private reportDamage(
    target: Instance,
    value: number,
    origin: string,
    before: number,
    detail?: string,
    elemental?: Omit<BattleDamage, "amount">,
    originOwnerId?: string,
  ) {
    const message = `${origin}: ${target.nome} (${this.player(target.ownerId).nome}) recebeu ${value} de dano${detail ? `, ${detail}` : ""}. Vida: ${Math.max(0, before)} → ${Math.max(0, target.hpAtual)}.`;
    this.log(message);
    const blocked = value === 0 && !!detail && origin.startsWith("Ataque de ");
    const summary = blocked
      ? `Ataque ${origin.slice(10)} foi bloqueado por ${detail!.split(";")[0].replace(/^bloqueado por /, "")} (${this.player(target.ownerId).nome}).`
      : `${origin}: ${target.nome} (${this.player(target.ownerId).nome}) recebeu ${value} de dano${elemental?.modifiers?.length ? ` (${elemental.modifiers.map((m) => (m === "weakness" ? "fraqueza" : "resistência")).join(" e ")})` : ""}.`;
    this.event(blocked ? "block" : "damage", target, message, {
      summary,
      originOwnerId: blocked ? target.ownerId : originOwnerId,
      slotId: this.targetSlot(target.id)?.id,
      damage: { amount: value, ...elemental },
    });
  }
  private heal(
    card: Instance,
    value: number,
    excess?: number,
    source?: Instance,
  ) {
    if (card.hp === undefined)
      this.fail("Este alvo não possui vida para curar.");
    const slot = this.targetSlot(card.id);
    const bonus = slot
      ? this.weapons(slot, card).reduce((n, w) => n + (w.bonusHp ?? 0), 0)
      : 0;
    const previous = card.hpAtual;
    card.hpAtual = Math.max(
      card.hpAtual,
      Math.min((card.hp ?? 0) + bonus + (excess ?? 0), card.hpAtual + value),
    );
    if (card.hpAtual > 0) delete card.killedBy;
    const healed = card.hpAtual > previous;
    if (healed) {
      this.trigger("onHealed", {
        ownerId: card.ownerId,
        cardId: card.id,
        card,
      });
      if (source)
        this.trigger("onHeal", {
          ownerId: source.ownerId,
          cardId: source.id,
          card: source,
          targetId: card.id,
          targetCard: card,
        });
    }
    return healed;
  }
  private equipmentGrant(user: string, slot: Slot) {
    const grant = this.player(user).equipmentGrant;
    if (grant?.turn !== this.state.turn) return undefined;
    return this.weaponBeneficiaries(slot).some((s) =>
      grant.destinatarios.includes(
        (s.rider ?? s.card)?.tipo as "Tropa" | "Mago",
      ),
    )
      ? grant
      : undefined;
  }
  private equipmentPlacementError(user: string, slot: Slot) {
    if (this.state.phase === "BATTLE" && this.state.turn <= 2)
      return "Armamentos são bloqueados nos dois primeiros turnos após a preparação.";
    if (slot.ownerId !== user || slot.kind !== "Armamento" || slot.card)
      return "Escolha um espaço de armamento aliado vazio.";
    if (
      (this.player(user).counters.equipment ?? 0) >= 1 &&
      !this.equipmentGrant(user, slot)?.ignorarLimite
    )
      return "Você só pode jogar um armamento por turno.";
    if (
      !this.weaponBeneficiaries(slot).some((s) => {
        const receiver = s.rider ?? s.card;
        return (
          receiver &&
          receiver.hpAtual > 0 &&
          ["Tropa", "Mago"].includes(receiver.tipo)
        );
      })
    )
      return "Este espaço precisa de uma tropa ou mago em campo para receber o armamento.";
    return "";
  }
  private weaponBeneficiaries(weaponSlot: Slot) {
    if (weaponSlot.id.includes(":arm:back-"))
      return this.state.slots.filter(
        (s) => s.ownerId === weaponSlot.ownerId && s.kind === "Mago",
      );
    return this.front(weaponSlot.ownerId).filter(
      (s) => s.column === weaponSlot.column,
    );
  }
  private removeFieldBonuses(card: Instance) {
    delete card.fieldModifiers;
    if (!card.reviveBonuses) return;
    card.hp = Math.max(0, (card.hp ?? 0) - card.reviveBonuses.hp);
    card.ataque = Math.max(0, (card.ataque ?? 0) - card.reviveBonuses.ataque);
    card.hpAtual = Math.min(card.hpAtual, card.hp);
    delete card.reviveBonuses;
  }
  private resetCard(card: Instance) {
    this.clearAttachments(card.id);
    this.removeFieldBonuses(card);
    card.hpAtual = card.hp ?? 0;
    card.statuses = [];
    card.attacked = false;
    card.attacksMade = 0;
    delete card.scheduledStatuses;
    delete card.scheduledHeals;
    card.usedAbility = false;
    card.moved = false;
    delete card.appliedElement;
    delete card.revivedFromGraveyard;
    delete card.deathReward;
    delete card.killedBy;
    delete card.concealedTrap;
  }
  private event(
    kind: string,
    card: Pick<Instance, "id" | "nome" | "imgURL" | "ownerId">,
    message?: string,
    details?: Pick<
      BattleEvent,
      "slotId" | "reaction" | "damage" | "mana" | "originOwnerId" | "summary"
    >,
  ) {
    this.state.eventSequence = (this.state.eventSequence ?? 0) + 1;
    (this.state.events ??= []).push({
      sequence: this.state.eventSequence,
      kind,
      ...details,
      ...(message ? { message } : {}),
      card: {
        id: card.id,
        nome: card.nome,
        imgURL: card.imgURL ?? "",
        ownerId: card.ownerId,
      },
    });
    this.state.events = this.state.events.slice(-40);
  }
  private resolve() {
    let changed = true,
      guard = 0;
    while (changed && guard++ < 100) {
      changed = false;
      for (const slot of this.state.slots) {
        const player = this.player(slot.ownerId);
        if (slot.structure && slot.structure.hpAtual <= 0) {
          const dead = slot.structure;
          this.removeFieldBonuses(dead);
          this.event("death", dead);
          player.graveyard.push(dead);
          slot.structure = null;
          changed = true;
          this.trigger("onStructureDestroyed", {
            ownerId: player.id,
            cardId: dead.id,
            card: dead,
            element: dead.elemento,
            slotId: slot.id,
          });
          this.trigger("onDeath", {
            ownerId: player.id,
            cardId: dead.id,
            card: dead,
            element: dead.elemento,
            slotId: slot.id,
          });
        }
        for (const dead of [slot.card, slot.rider].filter(
          (c): c is Instance => !!c && c.tipo === "Tropa" && c.hpAtual <= 0,
        )) {
          this.clearAttachments(dead.id);
          const killedBy = dead.killedBy;
          this.event("death", dead);
          if (slot.rider?.id === dead.id) {
            slot.rider = null;
            if (slot.card && slot.card.hpAtual > 0)
              slot.card.hpAtual += this.weapons(slot).reduce(
                (n, w) => n + (w.bonusHp ?? 0),
                0,
              );
          } else {
            slot.card = slot.rider ?? null;
            slot.rider = null;
          }
          this.removeFieldBonuses(dead);
          player.graveyard.push(dead);
          const reward = dead.deathReward;
          delete dead.deathReward;
          if (reward?.round === this.state.round) {
            const recovered = this.gainMana(
              this.player(reward.ownerId),
              reward.mana,
            );
            this.event(
              "notice",
              dead,
              reward.source +
                ": morte nesta rodada recuperou " +
                recovered +
                " de mana.",
            );
          }
          changed = true;
          for (const weapon of slot.card ? [] : this.weapons(slot)) {
            if (this.has(weapon, "Herança")) continue;
            const weaponSlot = this.targetSlot(weapon.id)!;
            player.graveyard.push(weapon);
            weaponSlot.card = null;
          }
          this.trigger("onDeath", {
            ownerId: player.id,
            cardId: dead.id,
            card: dead,
            slotId: slot.id,
            element: dead.elemento,
          });
          if (killedBy) {
            const killer = this.findCard(killedBy.cardId);
            if (killer)
              this.trigger("onKill", {
                ownerId: killer.ownerId,
                cardId: killer.id,
                card: killer,
                targetId: dead.id,
                targetCard: dead,
                slotId: slot.id,
              });
          }
          this.log(`${dead.nome} foi para o cemitério.`);
        }
      }
    }
    for (const a of [...(this.state.attachments ?? [])])
      if (
        !this.targetSlot(a.targetId) ||
        !this.findCard(a.targetId) ||
        this.findCard(a.targetId)!.hpAtual <= 0
      )
        this.removeAttachment(a);
    if (guard >= 100) this.fail("Ciclo de efeitos excedeu o limite.");
    this.state.pendingRevives = this.state.pendingRevives?.filter(
      (choice) =>
        reviveDestinations(this.state.slots, choice.ownerId).length &&
        this.player(choice.ownerId).graveyard.some(
          (c) => c.tipo === "Tropa" && choice.cards.includes(c.id),
        ),
    );
    const dead = this.state.players.filter((p) => p.mage.hpAtual <= 0);
    if (dead.length && !this.deferMageDefeat)
      this.finish(
        dead.length === 2 ? null : this.opponent(dead[0].id).id,
        dead.length === 2
          ? "Empate: os dois magos foram derrotados."
          : "Mago derrotado.",
      );
  }
  private trigger(trigger: string, context: PassiveEvent) {
    const root = !(this.passiveDepth ?? 0);
    if (root) this.passiveSteps = 0;
    this.passiveDepth = (this.passiveDepth ?? 0) + 1;
    try {
      if (this.passiveDepth > 32)
        this.fail("Ciclo de passivas excedeu o limite.");
      const event: PassiveEvent = {
        ...context,
        card:
          context.card ??
          (context.cardId
            ? (this.findCard(context.cardId) ??
              this.state.players
                .flatMap((p) => [...p.hand, ...p.deck, ...p.graveyard])
                .find((c) => c.id === context.cardId))
            : undefined),
      };
      // Freeze participants, rules and eligibility before any effect changes zones.
      const listeners = this.state.slots.flatMap(slotCards);
      if (
        event.card &&
        ["onDeath", "onStructureDestroyed"].includes(trigger) &&
        !listeners.some((c) => c.id === event.cardId)
      )
        listeners.push(event.card);
      const activations = listeners.flatMap((source) =>
        source.habilidadesPassivas
          .map(normalizePassive)
          .filter(
            (rule) =>
              rule.gatilho === trigger &&
              (source.hpAtual > 0 || source.id === event.cardId) &&
              passiveMatches(rule, source, event, this.state.slots),
          )
          .map((rule) => ({ source, rule })),
      );
      for (const { source, rule } of activations) {
        let activated = false;
        const counters = new Set<string>();
        for (const action of rule.efeitos) {
          if (++this.passiveSteps > 256)
            this.fail("Ciclo de passivas excedeu o limite.");
          if (action.id === "spellDamageBonus") {
            initializeLegacyCounters(source);
            if (!counters.has(action.contador)) {
              const values = (source.passiveCounters ??= {});
              values[action.contador] = (values[action.contador] ?? 0) + 1;
              counters.add(action.contador);
            }
            synchronizeLegacyCounters(source);
            activated = true;
          } else
            activated = this.passiveEffect(source, action, event) || activated;
        }
        if (activated)
          this.event("passive", source, describePassiveActions(rule.efeitos));
      }
    } finally {
      this.passiveDepth--;
    }
  }
  private passiveEffect(
    source: Instance,
    action: PassiveAction,
    event: PassiveEvent,
  ): boolean {
    const owner = this.player(source.ownerId);
    if (action.id === "revive")
      return this.queueRevive(
        action.jogador === "aliado" ? owner.id : this.opponent(owner.id).id,
        source.nome,
      );
    if (action.id === "spellDamageTurn") {
      const previous = source.statuses.find(
        (s) => s.nome === spellTurnBonusStatus && s.turnosRestantes > 0,
      );
      const value = action.acumulavel
        ? (previous?.valor ?? 0) + action.valor
        : Math.max(previous?.valor ?? 0, action.valor);
      const status = applyStatus(
        source.statuses,
        spellTurnBonusStatus,
        1,
        value,
        this.state.turn,
        "turno",
      );
      status.origin = source.nome;
      status.originOwnerId = owner.id;
      return true;
    }
    if (action.id === "counterAttack") {
      const targetId =
        action.alvo === "atacante" ? event.attackerId : event.cardId;
      const target = targetId && this.targetSlot(targetId);
      const attacker = targetId && this.findCard(targetId);
      if (
        !target ||
        !attacker ||
        attacker.hpAtual <= 0 ||
        source.hpAtual <= 0 ||
        hasStatus(source.statuses, [
          "Atordoado",
          "Incapacitado",
          "Congelado",
        ]) ||
        this.state.phase === "PREPARATION" ||
        blockedOwnAttack(source, this.state.slots)
      )
        return false;
      const defender = this.basicAttackDefender(target);
      if (restrictedBasicAttack(defender, source, this.state.slots))
        return false;
      this.log(
        `${source.nome} retaliou contra ${attacker.nome}, sem consumir seu ataque normal.`,
      );
      this.event(
        "attack",
        source,
        `Ataque: ${source.nome} (${this.player(source.ownerId).nome}) atacou ${defender.nome} (${this.player(defender.ownerId).nome}) por retaliação.`,
      );
      source.palavrasChave = source.palavrasChave.filter(
        (k) => k !== "Esconder",
      );
      source.statuses = source.statuses.filter((s) => s.nome !== "Esconder");
      if (hasStatus(source.statuses, ["Cego"]) && this.random() < 0.5) {
        this.log(`${source.nome} errou a retaliação por cegueira.`);
        return true;
      }
      this.completeAttack(
        source,
        target,
        this.basicAttackDamage(source, defender),
        this.attackElement(source),
      );
      return true;
    }
    if (
      action.id === "mana" ||
      action.id === "draw" ||
      action.id === "recover"
    ) {
      const player =
        action.jogador === "aliado" ? owner : this.opponent(owner.id);
      if (!action.valor) return false;
      if (action.id === "mana") {
        const before = player.mana;
        this.gainMana(player, action.valor);
        return player.mana !== before;
      }
      if (action.id === "draw") {
        this.draw(player, action.valor);
        return true;
      }
      let recovered = false;
      for (let i = 0; i < action.valor; i++) {
        const card = player.graveyard.pop();
        if (!card) break;
        this.resetCard(card);
        player.hand.push(card);
        recovered = true;
      }
      return recovered;
    }
    if (action.id === "move" || action.id === "summonFromDeck") {
      const destination = this.state.slots.find(
        (s) =>
          s.id === event.slotId && s.ownerId === owner.id && s.kind === "Tropa",
      );
      if (!destination || destination.card || destination.terrain) return false;
      if (action.id === "move") {
        const from = this.state.slots.find(
          (s) => s.card?.id === source.id && s.kind === "Tropa",
        );
        if (
          !from ||
          source.hpAtual <= 0 ||
          hasStatus(source.statuses, ["Congelado", "Incapacitado", "Cego"])
        )
          return false;
        this.relocateTroops(from, destination);
        return true;
      }
      const id =
        action.carta === "mesmaCarta" ? source.numeroCatalogo : action.carta;
      const index = owner.deck.findIndex(
        (c) => c.numeroCatalogo === id && c.tipo === "Tropa",
      );
      if (index < 0) return false;
      const card = owner.deck.splice(index, 1)[0];
      card.hpAtual += this.weapons(destination).reduce(
        (n, w) => n + (w.bonusHp ?? 0),
        0,
      );
      destination.card = card;
      this.event("summon", card);
      this.trigger("onSummon", {
        ownerId: owner.id,
        cardId: card.id,
        card,
        slotId: destination.id,
      });
      return true;
    }
    if (!("alvo" in action)) return false; // Continuous effects are queried, never dispatched.
    const id =
      action.alvo === "fonte"
        ? source.id
        : action.alvo === "magoAliado"
          ? owner.mage.id
          : action.alvo === "magoInimigo"
            ? this.opponent(owner.id).mage.id
            : action.alvo === "atacante"
              ? event.attackerId
              : action.alvo === "alvoAtaque"
                ? event.targetId
                : event.cardId;
    const target = id ? (this.findCard(id) ?? this.targetSlot(id)?.card) : null;
    if (!target) return false;
    switch (action.id) {
      case "damage":
        if (!action.valor) return false;
        this.damage(
          target.id,
          action.valor,
          undefined,
          false,
          action.elemento,
          source,
          `Passiva de ${source.nome}`,
        );
        return true;
      case "heal": {
        return this.heal(target, action.valor, action.excedente, source);
      }
      case "growAttack":
        if (!action.valor || target.hpAtual <= 0) return false;
        target.ataque = (target.ataque ?? 0) + action.valor;
        return true;
      case "growMaxHp":
        if (!action.valor || target.hpAtual <= 0) return false;
        target.hp = (target.hp ?? 0) + action.valor;
        target.hpAtual += action.valor;
        if (target.hpAtual > 0) delete target.killedBy;
        return true;
      case "status":
        this.effects(
          owner.id,
          [
            {
              id: "status",
              status: action.status,
              duracao: action.duracao,
              valor: action.valor,
            },
          ],
          [target.id],
        );
        return true;
    }
    return false;
  }
  private validateTargets(
    owner: string,
    type: TipoAlvoFeitico | undefined,
    ids: string[],
    max = 1,
    ignoreHidden = false,
  ): string[] {
    if (!type) this.fail("Tipo de alvo não definido.");
    if (new Set(ids).size !== ids.length || ids.length > max)
      this.fail("Alvos repetidos ou acima do limite.");
    const me = this.player(owner),
      enemy = this.opponent(owner);
    if (
      type === "Global" ||
      type === "TodosInimigos" ||
      type === "TodasTropasInimigas" ||
      type === "TodosAliados"
    ) {
      if (ids.length) this.fail("Esta ação não aceita seleção de alvos.");
      if (type === "TodosAliados")
        return this.state.slots
          .filter((s) => s.ownerId === owner)
          .flatMap(slotCards)
          .filter(
            (c) =>
              ["Tropa", "Mago", "Estrutura"].includes(c.tipo) && c.hpAtual > 0,
          )
          .map((c) => c.id);
      if (type === "TodasTropasInimigas")
        return this.state.slots
          .filter((s) => s.ownerId === enemy.id)
          .flatMap((s) =>
            slotCards(s)
              .filter((c) => c.tipo === "Tropa")
              .map((c) => c.id),
          );
      return type === "TodosInimigos"
        ? this.state.slots
            .filter(
              (s) =>
                s.ownerId === enemy.id &&
                (s.card?.tipo === "Tropa" || s.kind === "Mago"),
            )
            .flatMap((s) =>
              [s.card, s.rider]
                .filter((c): c is Instance => !!c)
                .map((c) => c.id),
            )
        : [];
    }
    if (!ids.length) this.fail("Selecione pelo menos um alvo.");
    if (
      type === "Deck" ||
      type === "DeckOponente" ||
      type === "Cemiterio" ||
      type === "Mao"
    ) {
      const zone =
        type === "Mao"
          ? me.hand
          : type === "Deck"
            ? me.deck
            : type === "DeckOponente"
              ? enemy.deck
              : me.graveyard;
      if (ids.some((id) => !zone.some((c) => c.id === id)))
        this.fail("A carta não pertence à zona selecionada.");
      return ids;
    }
    for (const id of ids) {
      const slot = this.targetSlot(id);
      if (type === "CampoAliado" || type === "CampoInimigo") {
        if (
          !slot ||
          slot.kind !== "Tropa" ||
          (type === "CampoAliado"
            ? slot.ownerId !== owner
            : slot.ownerId === owner)
        )
          this.fail("Escolha um campo frontal do lado indicado.");
        continue;
      }
      if (!slot || (!slot.card && !slot.structure))
        this.fail("Alvo vazio ou inexistente.");
      const card = this.findCard(id) ?? slot.card;
      if (card?.concealedTrap)
        this.fail("Cartas ocultas não podem ser selecionadas por este efeito.");
      if (type === "UnicoAliado" && slot.ownerId !== owner)
        this.fail("Selecione um aliado.");
      if (
        (type === "UnicoInimigo" || type === "MultiplosInimigos") &&
        slot.ownerId === owner
      )
        this.fail("Selecione um inimigo.");
      if (type === "Estrutura" && !slot.structure)
        this.fail("Selecione uma estrutura.");
      if (
        !ignoreHidden &&
        slot.ownerId !== owner &&
        card &&
        this.has(card, "Esconder")
      )
        this.fail("Esta carta está escondida.");
    }
    return type === "Estrutura"
      ? ids.map((id) => this.targetSlot(id)!.structure!.id)
      : ids;
  }
  private relocateTroops(
    from: Slot,
    to: Slot,
    carryStructure = true,
    consumeMove = true,
  ) {
    const before = this.weapons(from).reduce((n, w) => n + (w.bonusHp ?? 0), 0);
    const after = this.weapons(to).reduce((n, w) => n + (w.bonusHp ?? 0), 0);
    const leaving = from.rider ?? from.card,
      arriving = to.rider ?? to.card;
    if (leaving) leaving.hpAtual += after - before;
    if (arriving) arriving.hpAtual += before - after;
    [from.card, to.card] = [to.card, from.card];
    if (carryStructure)
      [from.structure, to.structure] = [to.structure, from.structure];
    [from.rider, to.rider] = [to.rider, from.rider];
    if (to.card && consumeMove) to.card.moved = true;
  }
  private mountActionError(
    user: string,
    slot: Slot,
    card: Instance | null | undefined,
  ) {
    if (this.state.phase !== "BATTLE" || this.openingBlocked())
      return "Montar e desmontar são bloqueados na preparação e no primeiro turno.";
    return this.attackSourceError(user, slot, card ?? null);
  }
  private spendMountAttack(user: string, card: Instance) {
    card.attacked = true;
    card.attacksMade = basicAttackLimit(card, this.state.slots);
    this.player(user).counters.attacks++;
    this.player(user).combatStarted = true;
  }
  private chooseHand(user: string, cardId?: string) {
    const choice = this.state.pendingHandChoice;
    if (!choice || choice.ownerId !== user)
      this.fail("Não há escolha de carta disponível para você.");
    if (cardId) {
      const enemy = this.player(choice.opponentId),
        index = enemy.hand.findIndex((c) => c.id === cardId);
      if (index < 0) this.fail("Escolha uma carta da mão adversária.");
      const stolen = enemy.hand.splice(index, 1)[0];
      stolen.ownerId = user;
      this.player(user).hand.push(stolen);
      this.log(
        `${this.player(user).nome} transferiu ${stolen.nome} para sua mão com ${choice.source}.`,
      );
    }
    delete this.state.pendingHandChoice;
  }
  private removeAttachment(
    attachment: NonNullable<State["attachments"]>[number],
  ) {
    this.state.attachments = this.state.attachments?.filter(
      (a) => a !== attachment,
    );
    this.player(attachment.ownerId).graveyard.push(attachment.source);
    this.event(
      "notice",
      attachment.source,
      "Vínculo encerrado; a carta foi para o cemitério.",
    );
  }
  private clearAttachments(targetId: string) {
    for (const a of [...(this.state.attachments ?? [])])
      if (a.targetId === targetId) this.removeAttachment(a);
  }
  private manaAttachments(card: Instance) {
    return (this.state.attachments ?? [])
      .filter((a) => a.targetId === card.id)
      .map((a) => ({
        id: a.source.id,
        nome: a.source.nome,
        mana: a.manaBonus,
      }));
  }
  private canDiscard(card: Instance) {
    return card.habilidadesPassivas
      .map(normalizePassive)
      .some(
        (p) =>
          p.gatilho === "continuous" &&
          p.efeitos.some((e) => e.id === "discardMana"),
      );
  }
  private discardHand(user: string, cardId: string) {
    const p = this.player(user),
      index = p.hand.findIndex((c) => c.id === cardId),
      card = p.hand[index];
    if (
      this.state.phase !== "BATTLE" ||
      this.state.turn < 2 ||
      this.state.current !== user
    )
      this.fail(
        "Descarte voluntário só é permitido no seu turno a partir do segundo turno após a preparação.",
      );
    if (!card || !this.canDiscard(card))
      this.fail("Esta carta não permite descarte voluntário.");
    const discarded = this.discardFromHand(p, index);
    this.log(`${p.nome} descartou ${discarded.nome} da mão.`);
  }
  private discardFromHand(player: Player, index: number) {
    const card = player.hand.splice(index, 1)[0];
    player.graveyard.push(card);
    for (const passive of card.habilidadesPassivas.map(normalizePassive)) {
      if (
        passive.gatilho !== "continuous" ||
        !passiveMatches(
          passive,
          card,
          { ownerId: player.id, cardId: card.id, card },
          this.state.slots,
        )
      )
        continue;
      for (const effect of passive.efeitos)
        if (effect.id === "discardMana") {
          const recovered = this.gainMana(
            player,
            effect.custoAtual
              ? currentSpellCost(card, player.mage)
              : effect.valor,
          );
          this.event(
            "passive",
            card,
            `Recuperou ${recovered} mana ao ser descartada da mão.`,
          );
        }
    }
    return card;
  }
  private mount(user: string, fromId: string, toId: string) {
    const from = this.ownSlot(fromId, user),
      to = this.ownSlot(toId, user),
      rider = from.card;
    const error = this.mountActionError(user, from, rider);
    if (error) this.fail(error);
    if (
      !rider ||
      from === to ||
      from.rider ||
      from.kind !== "Tropa" ||
      to.kind !== "Tropa" ||
      to.terrain ||
      !canMount(to.card, rider, !!to.rider)
    )
      this.fail("Selecione uma montaria aliada válida e sem cavaleiro.");
    if (from.structure && to.structure)
      this.fail("Não é possível combinar duas estruturas no mesmo slot.");
    const oldBonus = this.weapons(from).reduce(
        (n, w) => n + (w.bonusHp ?? 0),
        0,
      ),
      newBonus = this.weapons(to).reduce((n, w) => n + (w.bonusHp ?? 0), 0);
    rider.hpAtual += newBonus - oldBonus;
    if (to.card) to.card.hpAtual -= newBonus;
    from.card = null;
    to.rider = rider;
    if (from.structure) {
      to.structure = from.structure;
      from.structure = null;
    }
    this.spendMountAttack(user, rider);
    this.log(
      `${rider.nome} montou em ${to.card!.nome}, consumindo seu ataque e um uso do limite de ataques.`,
    );
    this.event("mount", rider, `Montou em ${to.card!.nome}.`);
  }
  private dismountDestination(slot: Slot) {
    return this.state.slots.find(
      (s) =>
        s.ownerId === slot.ownerId &&
        s.kind === "Tropa" &&
        s.column === slot.column + 1 &&
        !s.card &&
        !s.rider &&
        !s.terrain,
    );
  }
  private dismount(user: string, id: string) {
    const from = this.ownSlot(id, user),
      rider = from.rider;
    const error = this.mountActionError(user, from, rider);
    if (error) this.fail(error);
    const to = this.dismountDestination(from);
    if (!rider || !to)
      this.fail(
        "Desmontar exige um slot livre imediatamente à direita, sem Lama.",
      );
    const before = this.weapons(from).reduce((n, w) => n + (w.bonusHp ?? 0), 0),
      after = this.weapons(to).reduce((n, w) => n + (w.bonusHp ?? 0), 0);
    rider.hpAtual += after - before;
    from.rider = null;
    if (from.card) from.card.hpAtual += before;
    to.card = rider;
    this.spendMountAttack(user, rider);
    this.log(
      `${rider.nome} desmontou para a direita, consumindo seu ataque e um uso do limite de ataques.`,
    );
    this.event("mount", rider, "Desmontou para o slot à direita.");
  }
  private effects(
    ownerId: string,
    effects: Effect[],
    selection: string[],
    element?: Card["elemento"],
    source?: Instance,
    cause?: string,
    destinationId?: string,
  ) {
    const player = this.player(ownerId);
    if (
      destinationId &&
      !effects.some((e) =>
        ["displace", "revive", "control", "relocate"].includes(e.id),
      )
    )
      this.fail("Este efeito não aceita destino de deslocamento.");
    for (const effect of effects) {
      if (effect.alvo === "Proprio" && (!source || !this.targetSlot(source.id)))
        this.fail(
          "Efeito na própria carta exige uma habilidade de origem em campo.",
        );
      const ids = (effect.alvo === "Proprio" ? [source!.id] : selection).filter(
        (id) =>
          !effect.filtroAlvo ||
          matchesPassiveFilter(
            this.findCard(id) ?? this.targetSlot(id)?.card ?? undefined,
            effect.filtroAlvo,
          ),
      );
      switch (effect.id) {
        case "fieldModifier":
          for (const id of ids) {
            const target = this.findCard(id);
            if (
              !target ||
              !["Tropa", "Mago", "Estrutura"].includes(target.tipo)
            )
              this.fail("Concessão exige carta em campo.");
            if (!this.impactAllowed(target.id)) continue;
            (target.fieldModifiers ??= []).push({
              source: source?.nome ?? cause ?? "Concessão",
              grant: structuredClone(effect.concessao!),
            });
            this.event(
              "notice",
              target,
              "Recebeu bônus e propriedades enquanto permanecer em campo.",
            );
          }
          break;
        case "relocate": {
          const from =
            effect.origem === "alvo"
              ? this.targetSlot(ids[0])
              : source && this.targetSlot(source.id);
          const to = this.state.slots.find(
            (s) =>
              s.id ===
              (effect.origem === "alvo"
                ? destinationId
                : (destinationId ?? ids[0])),
          );
          if (
            !from ||
            !to ||
            from === to ||
            from.kind !== "Tropa" ||
            from.card?.tipo !== "Tropa" ||
            to.kind !== "Tropa" ||
            from.ownerId !== ownerId ||
            to.ownerId !== ownerId
          )
            this.fail("Escolha outro espaço de tropa aliado.");
          if (to.card && to.card.tipo !== "Tropa")
            this.fail("Troca de lugar exige uma tropa aliada.");
          if (
            [from.card, from.rider, to.card, to.rider].some(
              (c) =>
                c &&
                hasStatus(c.statuses, [
                  "Congelado",
                  "Incapacitado",
                  "Cego",
                  "Atordoado",
                ]),
            )
          )
            this.fail("Estas tropas não podem se mover.");
          if (to.terrain || (to.card && from.terrain))
            this.fail("Nenhuma tropa pode se mover para um pântano.");
          this.relocateTroops(from, to, false, false);
          this.event("notice", source!, "Trocou de posição no campo aliado.", {
            slotId: to.id,
          });
          break;
        }
        case "equipmentGrant":
          player.equipmentGrant = {
            turn: this.state.turn,
            destinatarios: effect.destinatarios!,
            ignorarLimite: !!effect.ignorarLimite,
          };
          this.event(
            "notice",
            source ?? player.mage,
            "Armamentos gratuitos neste turno para os destinatários indicados.",
          );
          break;
        case "resetAttacks":
          player.counters.attacks = 0;
          for (const card of this.state.slots
            .filter((s) => s.ownerId === ownerId)
            .flatMap(slotCards)) {
            if (!["Tropa", "Mago"].includes(card.tipo)) continue;
            card.attacked = false;
            card.attacksMade = 0;
          }
          this.event(
            "notice",
            source ?? player.mage,
            "Contador de ataques restaurado; tropas podem atacar novamente neste turno.",
          );
          break;
        case "sacrifice": {
          const dead =
            ids.length === 1
              ? (this.findCard(ids[0]) ?? this.targetSlot(ids[0])?.card)
              : undefined;
          if (
            dead?.tipo !== "Tropa" ||
            dead.ownerId !== ownerId ||
            dead.hpAtual <= 0
          )
            this.fail("Escolha uma tropa aliada viva para sacrificar.");
          dead.hpAtual = 0;
          delete dead.killedBy;
          this.trigger("onSacrifice", {
            ownerId,
            cardId: dead.id,
            card: dead,
            element: dead.elemento,
          });
          const reward = effect.recompensaSacrificio!;
          this.gainMana(player, reward.mana);
          this.heal(
            player.mage,
            reward.subtipos?.includes(dead.subtipo!)
              ? (reward.vidaEspecial ?? reward.vida)
              : reward.vida,
            undefined,
            source,
          );
          this.event(
            "notice",
            source ?? player.mage,
            `${dead.nome} foi sacrificada.`,
          );
          break;
        }
        case "control": {
          const from = ids.length === 1 ? this.targetSlot(ids[0]) : undefined;
          const victim =
            ids.length === 1
              ? (this.findCard(ids[0]) ?? from?.card)
              : undefined;
          if (!from || victim?.tipo !== "Tropa" || from.ownerId === ownerId)
            this.fail("Escolha uma tropa inimiga em campo.");
          if (!this.impactAllowed(victim.id)) break;
          const destinations = reviveDestinations(this.state.slots, ownerId);
          const to = destinations.find((s) => s.id === destinationId);
          if (destinations.length && !to)
            this.fail("Escolha um espaço aliado livre e sem Lama.");
          if (!destinations.length && destinationId)
            this.fail("Não há destino disponível para essa troca de controle.");
          if (!destinations.length && this.front(ownerId).some((s) => !s.card))
            this.fail("Um espaço com Lama não permite receber a tropa.");
          const group = [from.card, from.rider].filter(
            (c): c is Instance => c?.tipo === "Tropa",
          );
          if (to) this.relocateTroops(from, to, false, false);
          else {
            from.card = null;
            from.rider = null;
          }
          for (const card of group) {
            card.ownerId = ownerId;
            if (!to) {
              this.resetCard(card);
              player.hand.push(card);
            }
          }
          this.event(
            "notice",
            source ?? player.mage,
            group.map((c) => c.nome).join(" e ") +
              (to
                ? " passou para o seu campo."
                : " foi para sua mão porque seu campo está cheio."),
          );
          break;
        }
        case "trap": {
          const slot =
            ids.length === 1 ? this.ownSlot(ids[0], ownerId) : undefined;
          if (
            !source ||
            !slot ||
            slot.kind !== "Tropa" ||
            slot.card ||
            slot.rider ||
            slot.terrain
          )
            this.fail(
              "A armadilha exige um espaço frontal aliado vazio e sem Lama.",
            );
          const physical =
            source.tipo === "Feitico"
              ? player.graveyard.find((c) => c.id === source.id)
              : undefined;
          const marker: Instance = physical ?? {
            ...structuredClone(source),
            id: randomUUID(),
            tipo: "Feitico",
            hp: undefined,
            ataque: undefined,
            hpAtual: 0,
            efeitos: [],
            habilidadesAtivas: [],
            habilidadesPassivas: [],
          };
          marker.concealedTrap = {
            effect: structuredClone(effect),
            generated: !physical,
          };
          if (physical)
            player.graveyard = player.graveyard.filter(
              (c) => c.id !== physical.id,
            );
          slot.card = marker;
          break;
        }
        case "spellBoost":
          player.mage.statuses.push({
            nome: source?.nome ?? "Amplificação",
            valor: effect.valor,
            turnosRestantes: effect.duracao!,
            unidade: "rodada",
            nextTickTurn: nextEffectRound(this.state.turn),
            spellBoost: {
              elementos: effect.elementos!,
              bonus: effect.valor!,
              descontoMana: effect.descontoMana!,
            },
          });
          break;
        case "stealMana": {
          const enemy = this.opponent(ownerId);
          const amount = Math.min(
            enemy.mana,
            20 - player.mana,
            Math.floor(enemy.mana * effect.fracao!) + (effect.valor ?? 0),
          );
          enemy.mana -= amount;
          const gained = this.gainMana(player, amount);
          this.event(
            "notice",
            source ?? player.mage,
            `Roubou ${gained} de mana de ${enemy.nome}.`,
          );
          break;
        }
        case "returnOnElement":
          if (
            source &&
            (player.returnUsedUntil?.[source.id] ?? -1) < this.state.turn
          )
            (player.zarcosWatchers ??= []).push({
              cardId: source.id,
              kind: "return",
              elemento: effect.elemento,
              throughTurn: this.state.turn + (effect.janelaTurnos ?? 2) - 1,
            });
          break;
        case "attachMana": {
          const target = this.findCard(ids[0]) ?? this.targetSlot(ids[0])?.card;
          if (
            ids.length !== 1 ||
            !target ||
            target.ownerId !== ownerId ||
            !["Tropa", "Mago"].includes(target.tipo) ||
            !this.targetSlot(target.id)
          )
            this.fail("Vínculo de mana exige tropa ou mago aliado em campo.");
          if (!source) this.fail("Vínculo exige carta de origem.");
          const index = player.graveyard.findIndex((c) => c.id === source.id);
          if (index < 0) this.fail("Origem do vínculo ausente.");
          if ((this.state.attachments?.length ?? 0) >= 32)
            this.fail("Limite de vínculos em campo atingido.");
          (this.state.attachments ??= []).push({
            source: player.graveyard.splice(index, 1)[0],
            targetId: target.id,
            ownerId,
            manaBonus: effect.valor!,
            removerAoUsarElemento: effect.removerAoUsarElemento,
            watchThroughTurn: this.state.turn + effect.janelaTurnos! - 1,
          });
          break;
        }
        case "periodicDamage":
          if (!source) this.fail("Dano periódico exige carta de origem.");
          if (
            this.state.ongoingSpells?.some(
              (s) =>
                s.ownerId === ownerId &&
                s.card?.numeroCatalogo === source.numeroCatalogo &&
                s.rounds > 0,
            )
          )
            this.fail("Você já tem este feitiço ativo em campo.");
          (this.state.ongoingSpells ??= []).push({
            id: source.id,
            ownerId,
            kind: "periodicDamage",
            target: source.alvo as "TodosInimigos",
            rounds: effect.duracao!,
            damage: effect.valor!,
            nextTickTurn: nextEffectRound(this.state.turn),
            element: effect.elemento ?? element,
            card: {
              numeroCatalogo: source.numeroCatalogo,
              nome: source.nome,
              imgURL: source.imgURL,
            },
          });
          break;
        case "displace": {
          if (ids.length !== 1)
            this.fail("Deslocamento exige uma única tropa.");
          const plan = planDisplacement(
            effect,
            this.targetSlot(ids[0]),
            ids[0],
            this.state.slots,
            destinationId,
          );
          const troop = this.findCard(ids[0]) ?? plan.source.card!;
          if (plan.stationary || !this.impactAllowed(troop.id)) break;
          const group = [plan.source.card, plan.source.rider].filter(
            (c): c is Instance => !!c,
          );
          if (plan.bounce) {
            plan.source.card = null;
            plan.source.rider = null;
            for (const member of group) {
              this.resetCard(member);
              this.player(member.ownerId).hand.push(member);
            }
          } else
            this.relocateTroops(plan.source, plan.destination!, false, false);
          const message =
            cause +
            ": " +
            group.map((c) => c.nome).join(" e ") +
            (plan.bounce
              ? " voltou para a mão ao sair pela borda direita."
              : " foi deslocada para o espaço " +
                (plan.destination!.column + 1) +
                ".");
          this.log(message);
          this.event("notice", troop, message);
          break;
        }
        case "shuffleGraveyard": {
          if (
            !ids.length ||
            ids.length > effect.valor! ||
            new Set(ids).size !== ids.length
          )
            this.fail("Escolha até " + effect.valor + " cartas diferentes.");
          const cards = ids.map((id) =>
            player.graveyard.find(
              (c) =>
                c.id === id &&
                (effect.tiposCarta ?? ["Tropa"]).includes(c.tipo),
            ),
          );
          if (cards.some((c) => !c))
            this.fail(
              "Escolha somente cartas do tipo permitido no seu cemitério.",
            );
          for (const card of cards as Instance[]) {
            this.resetCard(card);
            player.deck.push(card);
          }
          player.graveyard = player.graveyard.filter(
            (c) => !ids.includes(c.id),
          );
          this.shuffle(player.deck);
          break;
        }
        case "revive":
          if (ids.length !== 1) this.fail("Escolha uma tropa para reviver.");
          this.revive(
            ownerId,
            ids[0],
            destinationId,
            effect,
            cause ?? source?.nome,
          );
          break;
        case "attackField": {
          if (!source) this.fail("Efeito de campo exige uma carta de origem.");
          if (
            this.state.fieldEffects?.some(
              (f) =>
                f.ownerId === ownerId &&
                f.card.numeroCatalogo === source.numeroCatalogo &&
                f.rounds > 0,
            )
          )
            this.fail("Esta carta já possui um efeito de campo ativo.");
          (this.state.fieldEffects ??= []).push({
            id: source.id,
            ownerId,
            affectedOwnerId: this.opponent(ownerId).id,
            rounds: effect.duracao!,
            nextTickTurn: nextEffectRound(this.state.turn),
            damage: effect.valor!,
            element: effect.elemento ?? element,
            piercing: effect.perfurante,
            reactions: effect.reacoesElemento ?? [],
            card: {
              id: source.id,
              ownerId,
              numeroCatalogo: source.numeroCatalogo,
              nome: source.nome,
              imgURL: source.imgURL,
            },
          });
          break;
        }
        case "nextActionDamage": {
          const status = applyStatus(
            player.mage.statuses,
            nextActionBonusStatus,
            effect.duracao ?? 1,
            effect.valor,
            this.state.turn,
            "turno",
          );
          status.origin = cause ?? source?.nome;
          status.originOwnerId = ownerId;
          break;
        }
        case "spendAttack":
          if (!source) this.fail("Consumir ataque exige a carta de origem.");
          const position = this.targetSlot(source.id)!;
          const blocked = this.attackSourceError(ownerId, position, source);
          if (blocked) this.fail(blocked);
          this.spendMountAttack(ownerId, source);
          break;
        case "guardTarget": {
          if (!source || source.tipo !== "Tropa" || ids.length !== 1)
            this.fail(
              "Proteção exige uma tropa de origem e um aliado selecionado.",
            );
          const protectedCard = this.findCard(ids[0]);
          if (
            !protectedCard ||
            protectedCard.ownerId !== ownerId ||
            protectedCard.tipo !== "Tropa"
          )
            this.fail("Escolha uma tropa aliada para proteger.");
          const status = applyStatus(
            source.statuses,
            "Interceptar",
            effect.duracao!,
            effect.valor,
            this.state.turn,
            effect.unidade ?? "rodada",
          );
          status.protegidoId = protectedCard.id;
          status.origin = cause ?? source.nome;
          status.originOwnerId = ownerId;
          break;
        }
        case "damage":
          for (const id of ids) {
            const structure =
              effect.valorEstrutura !== undefined
                ? this.targetSlot(id)?.structure
                : undefined;
            const outcome = this.damage(
              structure?.id ?? id,
              structure ? effect.valorEstrutura! : effect.valor!,
              undefined,
              effect.perfurante ?? false,
              effect.elemento ?? element,
              source,
              cause,
            );
            if (
              outcome &&
              effect.curaPosterior &&
              outcome.amount > 0 &&
              !outcome.killed
            ) {
              (outcome.target.scheduledHeals ??= []).push({
                round: this.state.round + effect.curaPosterior.rodadas,
                turn: this.state.turn + 2 * effect.curaPosterior.rodadas,
                amount: outcome.amount * effect.curaPosterior.multiplicador,
                sourceId: source?.id,
                ownerId,
                origin: cause ?? source?.nome ?? "Cura programada",
              });
            }
            const reward = effect.recompensaAoEliminar;
            if (
              outcome?.killed &&
              reward &&
              (!reward.tipo || reward.tipo === outcome.target.tipo)
            ) {
              if (reward.mana) this.gainMana(player, reward.mana);
              if (reward.compra) this.draw(player, reward.compra);
            }
          }
          break;
        case "heal":
          for (const id of ids) {
            const card = this.findCard(id) ?? this.targetSlot(id)?.card;
            if (!card) this.fail("Não é possível curar este alvo.");
            if (!this.impactAllowed(card.id)) continue;
            if (effect.inicio) {
              const until =
                effect.inicio === "proximoTurnoAliado"
                  ? this.state.current === card.ownerId
                    ? 2
                    : 1
                  : 2;
              (card.scheduledHeals ??= []).push({
                round: this.state.round + 1,
                turn: this.state.turn + until,
                amount: effect.valor!,
                sourceId: source?.id,
                ownerId,
                origin: cause ?? source?.nome ?? "Cura programada",
              });
              this.event(
                "notice",
                card,
                "Cura de " + effect.valor + " programada para o próximo turno.",
              );
            } else
              this.heal(card, effect.valor!, undefined, source ?? player.mage);
          }
          break;
        case "status":
          for (const id of ids) {
            const card = this.findCard(id) ?? this.targetSlot(id)?.card;
            if (!card) this.fail("Status exige uma carta.");
            if (!this.impactAllowed(card.id)) continue;
            if (effect.inicio === "proximaRodada") {
              const round = this.state.round + 1;
              const turn = this.state.turn + 2;
              const scheduled = (card.scheduledStatuses ??= []);
              const status: Status = {
                requerStatus: effect.requerStatus,
                nome: canonicalStatus(effect.status!),
                valor: effect.valor,
                turnosRestantes: effect.duracao!,
                unidade: "rodada",
                originOwnerId: source?.ownerId ?? ownerId,
                origin: cause ?? source?.nome,
              };
              const existing = scheduled.find(
                (s) => s.turn === turn && s.status.nome === status.nome,
              );
              if (existing) {
                status.turnosRestantes = Math.max(
                  existing.status.turnosRestantes,
                  status.turnosRestantes,
                );
                existing.status = status;
              } else scheduled.push({ round, turn, status });
              continue;
            }
            const applied = applyStatus(
              card.statuses,
              effect.status!,
              effect.duracao!,
              effect.status === "Escudo" ? (effect.valor ?? 3) : effect.valor,
              this.state.turn,
              effect.unidade,
            );
            if (
              source?.appliedSpellBonus &&
              [
                "Envenenado",
                "Queimado",
                "Sangrando",
                "Peste Negra",
                "Leptospirose",
              ].includes(canonicalStatus(effect.status!))
            ) {
              applied.turnosRestantes = Math.max(
                applied.turnosRestantes,
                effect.duracao!,
              );
              applied.valor = Math.max(applied.valor ?? 0, effect.valor ?? 0);
            }
            if (applied && effect.requerStatus)
              applied.requerStatus = effect.requerStatus;
            applied.originOwnerId = source?.ownerId ?? ownerId;
            applied.origin =
              cause ?? (source ? `Efeito de ${source.nome}` : undefined);
            this.trigger("onStatusApplied", {
              ownerId: card.ownerId,
              cardId: card.id,
              status: effect.status,
            });
          }
          break;
        case "draw":
          this.draw(player, effect.valor!);
          break;
        case "mana":
          this.gainMana(player, effect.valor!);
          break;
        case "searchElemental": {
          const i = player.deck.findIndex(
            (c) =>
              c.id === ids[0] &&
              c.tipo === "Feitico" &&
              !!c.elemento &&
              c.elemento !== "Neutro" &&
              c.elemento !== "Zarcos",
          );
          if (i < 0) this.fail("Escolha um feitiço elemental do seu deck.");
          player.hand.push(player.deck.splice(i, 1)[0]);
          this.shuffle(player.deck);
          break;
        }
        case "searchNamed": {
          if (
            effect.seNaoUsada &&
            player.castCards?.includes(effect.seNaoUsada)
          )
            break;
          const index = player.deck.findIndex(
            (c) => c.numeroCatalogo === effect.carta,
          );
          if (index < 0) {
            const message = `${player.nome}: a busca por carta ${effect.carta} não encontrou nenhuma cópia. O baralho permanece igual.`;
            this.log(message);
            this.event("notice", source ?? player.mage, message);
          } else {
            const found = player.deck.splice(index, 1)[0];
            player.hand.push(found);
            this.shuffle(player.deck);
            this.log(
              `${player.nome} buscou ${found.nome} e embaralhou o baralho.`,
            );
          }
          break;
        }
        case "banish":
        case "forget":
          for (const id of ids) this.removePermanently(ownerId, id, effect.id);
          break;
        case "field":
          break; // O elemento e a reação do campo são resolvidos antes dos efeitos.
        default:
          this.fail("Efeito não implementado.");
      }
    }
  }
  private removePermanently(
    ownerId: string,
    id: string,
    kind: "banish" | "forget",
  ) {
    const slot = this.targetSlot(id);
    let card = this.findCard(id) ?? slot?.card ?? null;
    if (slot && card) {
      if (!this.impactAllowed(card.id, kind === "banish")) return;
      if (card.tipo === "Mago")
        this.fail("Remoção definitiva não pode remover o mago.");
      if (slot.structure?.id === card.id) slot.structure = null;
      else if (slot.rider?.id === card.id) {
        slot.rider = null;
        if (slot.card && slot.card.hpAtual > 0)
          slot.card.hpAtual += this.weapons(slot).reduce(
            (n, w) => n + (w.bonusHp ?? 0),
            0,
          );
      } else {
        if (card.tipo === "Armamento")
          for (const beneficiary of this.weaponBeneficiaries(slot))
            for (const troop of [beneficiary.rider ?? beneficiary.card])
              if (troop) troop.hpAtual -= card.bonusHp ?? 0;
        if (card.tipo === "Tropa" && !slot.rider)
          for (const weapon of this.weapons(slot)) {
            if (this.has(weapon, "Herança")) continue;
            this.player(card.ownerId).graveyard.push(weapon);
            this.targetSlot(weapon.id)!.card = null;
          }
        slot.card = slot.rider ?? null;
        slot.rider = null;
      }
    } else {
      const p = this.player(ownerId),
        index = p.graveyard.findIndex((c) => c.id === id);
      if (index < 0)
        this.fail("Selecione uma carta em campo ou no seu cemitério.");
      card = p.graveyard.splice(index, 1)[0];
    }
    this.removeFieldBonuses(card);
    delete card.deathReward;
    this.player(card.ownerId)[
      kind === "banish" ? "banished" : "forgotten"
    ].push(card);
    this.log(
      `${card.nome} foi ${kind === "banish" ? "banida" : "esquecida"} e não pode retornar nesta partida.`,
    );
  }
  private react(ownerId: string, ids: string[], incoming: string) {
    if (incoming === "Neutro") return;
    for (const id of ids) {
      const slot = this.targetSlot(id);
      if (!slot) continue;
      const card =
        id === slot.structure?.id
          ? slot.structure
          : (slot.structure ?? this.findCard(id) ?? slot.card);
      if (card && !this.impactAllowed(card.id)) continue;
      const existing =
        slot.terrain?.nome === "Lama"
          ? "Lama"
          : (card?.appliedElement ??
            slot.appliedElement ??
            card?.elemento ??
            "Neutro");
      const reaction = elementalReaction(existing, incoming);
      slot.appliedElement = reaction ? undefined : incoming;
      if (card) card.appliedElement = slot.appliedElement;
      if (!reaction) continue;
      if (
        this.state.phase === "PREPARATION" &&
        ["Lava", "Explosão", "Florescer"].includes(reaction)
      )
        this.fail(
          "Esta reação pode causar dano e não pode ser ativada na preparação.",
        );
      this.event(
        "elementalReaction",
        card ?? {
          id: slot.id,
          nome: `Campo ${slot.column + 1}`,
          imgURL: "",
          ownerId: slot.ownerId,
        },
        `${reaction} ativado.`,
        { slotId: slot.id, reaction, originOwnerId: ownerId },
      );
      this.resolveReaction(reaction, ownerId, card, slot);
      this.trigger("onElementalReaction", {
        ownerId: slot.ownerId,
        originOwnerId: ownerId,
        cardId: card?.id,
        card: card ?? undefined,
        reaction,
        slotId: slot.id,
        element: incoming as Card["elemento"],
      });
      this.log(
        `${reaction} foi ativado em ${card?.nome ?? `campo ${slot.column + 1}`}.`,
      );
    }
  }
  private resolveReaction(
    reaction: ReactionName,
    ownerId: string,
    card: Instance | null,
    slot: Slot,
  ) {
    switch (reaction) {
      case "Vapor":
      case "Explosão":
        if (!card) break;
        card.statuses = card.statuses.filter((s) => s.nome !== reaction);
        card.statuses.push({
          nome: reaction,
          turnosRestantes: 1,
          unidade: "turno",
          expiraNoTurno: this.state.turn,
        });
        break;
      case "Erosão": {
        const owner = this.player(slot.ownerId);
        for (let i = 0; i < 2; i++) {
          const discarded = owner.deck.pop();
          if (discarded) owner.graveyard.push(discarded);
        }
        break;
      }
      case "Lama":
        if (slot.kind === "Tropa")
          slot.terrain = {
            nome: "Lama",
            rodadasRestantes: 2,
            nextTickTurn: nextEffectRound(this.state.turn),
          };
        break;
      case "Lava":
        for (const adjacent of this.front(slot.ownerId))
          if (Math.abs(adjacent.column - slot.column) === 1 && adjacent.card)
            this.damage(
              adjacent.card.id,
              2,
              undefined,
              true,
              undefined,
              undefined,
              "Lava",
              ownerId,
            );
        break;
      case "Congelar":
        if (card)
          applyStatus(
            card.statuses,
            "Congelado",
            2,
            undefined,
            this.state.turn,
          );
        break;
      case "Zarconizado":
        this.gainMana(this.player(ownerId), 2);
        break;
      case "Florescer":
        if (!card) break;
        if (card.subtipo === "Planta") {
          card.hp = (card.hp ?? 0) + 1;
          card.hpAtual++;
        } else {
          applyStatus(
            card.statuses,
            "Envenenado",
            3,
            undefined,
            this.state.turn,
          ).originOwnerId = ownerId;
          this.trigger("onStatusApplied", {
            ownerId: card.ownerId,
            cardId: card.id,
            status: "Envenenado",
          });
        }
        break;
    }
  }
  private play(user: string, cmd: Extract<Command, { type: "play" }>) {
    const player = this.player(user),
      index = player.hand.findIndex((c) => c.id === cmd.cardId),
      physical = player.hand[index];
    if (!physical) this.fail("Carta não está na sua mão.");
    if (physical.tipo === "Feitico" && this.state.phase === "PREPARATION")
      this.fail("Feitiços são bloqueados durante a preparação.");
    const card = chooseAction(modifiedSpell(physical, player.mage), cmd.mode);
    if (
      cmd.destinationId &&
      !card.efeitos.some((e) =>
        ["displace", "revive", "control", "relocate"].includes(e.id),
      )
    )
      this.fail("Esta carta não aceita destino de deslocamento.");
    const limits = player.mage.limites[0];
    if (card.tipo === "Feitico" && this.state.phase === "PREPARATION")
      this.fail("Feitiços são bloqueados durante a preparação.");
    const openingReason = this.openingCardBlockReason(card);
    if (openingReason) this.fail(openingReason);
    if (
      card.efeitos.some(
        (e) =>
          e.id === "stealMana" &&
          e.limiteManaOrigem !== undefined &&
          player.mana > e.limiteManaOrigem,
      )
    )
      this.fail("Mana acima do limite permitido para usar este efeito.");
    if (card.tipo === "Feitico") {
      if (
        card.requerElementoMago &&
        player.mage.elemento !== card.requerElementoMago
      )
        this.fail(`Este feitiço exige mago de ${card.requerElementoMago}.`);
      if (hasStatus(player.mage.statuses, ["Cego"]))
        this.fail("Um mago Cego não pode conjurar feitiços.");
      if (
        this.state.turn <= 2 &&
        this.openingHarm(card.efeitos, undefined, player.mage.elemento)
      )
        this.fail(
          "Feitiços que causam dano são bloqueados nos dois primeiros turnos após a preparação.",
        );
      if (
        (card.assinatura ? player.counters.unique : player.counters.spells) >=
        (card.assinatura ? limits.feiticosUnicos : limits.feiticosUsados)
      )
        this.fail("Limite de feitiços atingido.");
      const selection = this.spellSelection(card, user, cmd.targets);
      const ids = this.validateTargets(
        user,
        this.spellTarget(card, user),
        selection,
        card.maxAlvos,
        card.ignoraEsconder,
      );
      if (
        card.tiposAlvo &&
        ids.some((id) => {
          const s = this.targetSlot(id);
          const target = this.findCard(id) ?? s?.card;
          return !target || !card.tiposAlvo!.includes(target.tipo);
        })
      )
        this.fail("Tipo de alvo não permitido por este feitiço.");
      this.spend(player, card.custoMana);
      const bonus = spellDamageBonus(player.mage, card.elemento);
      const temporaryBonus = temporarySpellDamageBonus(player.mage);
      const actionBonus = this.causesDamage(
        card.efeitos,
        undefined,
        player.mage.elemento,
      )
        ? this.takeActionBonus(user)
        : 0;
      player.hand.splice(index, 1);
      player[
        physical.destinoAposUso === "banido" ? "banished" : "graveyard"
      ].push(physical);
      (player.castCards ??= []).push(card.numeroCatalogo);
      player.castCards = [...new Set(player.castCards)];
      this.event(
        "spell",
        card.efeitos.some((e) => e.id === "trap")
          ? hiddenFieldCard(
              { id: ids[0], ownerId: user } as Slot,
              player.deckAppearance.verso,
            )
          : card,
      );
      if (card.assinatura) player.counters.unique++;
      else player.counters.spells++;
      this.trigger("onSpellCast", {
        ownerId: user,
        element: card.elemento,
        cardId: card.id,
      });
      this.reactFields(card.elemento);
      if (
        this.state.phase === "BATTLE" &&
        card.elemento === "Fogo" &&
        !card.assinatura &&
        ids.some((id) => {
          const s = this.targetSlot(id);
          const target = this.findCard(id) ?? s?.card;
          return target?.tipo === "Tropa" || target?.tipo === "Mago";
        }) &&
        this.canRespondWithWater(this.opponent(user).id)
      ) {
        this.state.pendingSpell = {
          casterId: user,
          card,
          targets: ids,
          bonus,
          actionBonus,
          temporaryBonus,
          destinationId: cmd.destinationId,
        };
        this.log(
          `${player.nome} conjurou ${card.nome}. Aguardando reação de Água.`,
        );
        return;
      }
      this.resolveSpell(
        user,
        card,
        ids,
        bonus,
        cmd.destinationId,
        actionBonus,
        temporaryBonus,
      );
    } else {
      if (!cmd.slotId) this.fail("Selecione um slot.");
      const slot = this.ownSlot(cmd.slotId, user);
      if (card.tipo === "Mago") this.fail("O mago já está em campo.");
      if (card.tipo === "Armamento") {
        const blocked = this.equipmentPlacementError(user, slot);
        if (blocked) this.fail(blocked);
      }
      if (card.tipo === "Tropa" && player.combatStarted)
        this.fail(
          "Não é possível mobilizar tropas após iniciar os ataques neste turno.",
        );
      if (card.tipo === "Tropa" && slot.terrain?.nome === "Lama")
        this.fail("Não é possível mobilizar tropas em um pântano.");
      if (card.tipo === "Estrutura") {
        if (
          slot.kind !== "Tropa" ||
          slot.structure ||
          slot.card?.tipo !== "Tropa"
        )
          this.fail(
            "Estruturas exigem uma tropa em um slot frontal sem estrutura.",
          );
      } else if (
        (slot.kind !== card.tipo &&
          !(
            card.tipo === "Tropa" &&
            slot.kind === "Armamento" &&
            this.has(card, "Flanquear")
          )) ||
        (slot.card &&
          !(
            card.tipo === "Tropa" &&
            slot.kind === "Tropa" &&
            canMount(slot.card, card, !!slot.rider)
          ))
      )
        this.fail("Slot ocupado ou de outro tipo.");
      if (
        card.tipo === "Tropa" &&
        player.counters.summons >= limits.tropasMobilizadas
      )
        this.fail("Limite de mobilização atingido.");
      this.spend(
        player,
        this.state.phase === "PREPARATION" && card.tipo === "Tropa"
          ? 0
          : card.tipo === "Armamento" && this.equipmentGrant(user, slot)
            ? 0
            : card.custoMana,
      );
      player.hand.splice(index, 1);
      this.event("summon", card);
      if (card.tipo === "Estrutura") slot.structure = card;
      else if (card.tipo === "Tropa" && slot.card) {
        slot.card.hpAtual -= this.weapons(slot).reduce(
          (n, w) => n + (w.bonusHp ?? 0),
          0,
        );
        slot.rider = card;
      } else slot.card = card;
      if (card.tipo === "Tropa") {
        card.hpAtual += this.weapons(slot, card).reduce(
          (n, w) => n + (w.bonusHp ?? 0),
          0,
        );
        player.counters.summons++;
        this.trigger("onSummon", {
          ownerId: user,
          cardId: card.id,
          element: card.elemento,
        });
        if (card.revivedFromGraveyard) {
          delete card.revivedFromGraveyard;
          this.trigger("onRevive", { ownerId: user, cardId: card.id });
        }
      }
      if (card.tipo === "Armamento") {
        player.counters.equipment = (player.counters.equipment ?? 0) + 1;
        for (const beneficiary of this.weaponBeneficiaries(slot))
          for (const troop of [beneficiary.rider ?? beneficiary.card])
            if (troop) troop.hpAtual += card.bonusHp ?? 0;
        this.trigger("onEquip", { ownerId: user, cardId: card.id });
      }
    }
    if (card.tipo !== "Feitico") this.zarcosPlayed(user, card);
    this.log(
      `${player.nome} jogou ${card.efeitos.some((e) => e.id === "trap") ? "uma carta oculta" : card.nome}.`,
    );
  }
  private waterReactionAllowed(player: Player, card: Instance) {
    return (
      this.state.phase !== "PREPARATION" &&
      card.tipo === "Feitico" &&
      card.elemento === "Agua" &&
      card.palavrasChave.includes("Reação") &&
      (!card.requerElementoMago ||
        card.requerElementoMago === player.mage.elemento) &&
      !hasStatus(player.mage.statuses, ["Cego"]) &&
      player.mana >= card.custoMana &&
      (card.assinatura
        ? player.counters.unique < player.mage.limites[0].feiticosUnicos
        : player.counters.spells < player.mage.limites[0].feiticosUsados)
    );
  }
  canRespondWithWater(user: string) {
    const player = this.player(user);
    return player.hand.some((card) => this.waterReactionAllowed(player, card));
  }
  private resolveSpell(
    user: string,
    card: Instance,
    ids: string[],
    bonus: number,
    destinationId?: string,
    actionBonus = 0,
    temporaryBonus = 0,
  ) {
    return this.inImpact("spell", card.nome, () =>
      this.resolveSpellOnce(
        user,
        card,
        ids,
        bonus,
        destinationId,
        actionBonus,
        temporaryBonus,
      ),
    );
  }
  private resolveSpellOnce(
    user: string,
    card: Instance,
    ids: string[],
    bonus: number,
    destinationId?: string,
    actionBonus = 0,
    temporaryBonus = 0,
  ) {
    if (
      !this.specialSpell(user, card, ids, bonus, actionBonus, temporaryBonus)
    ) {
      if (card.elemento) this.react(user, ids, card.elemento);
      this.effects(
        user,
        addActionDamage(card.efeitos, bonus + actionBonus).map((e) =>
          ["attackField", "periodicDamage", "trap"].includes(e.id)
            ? {
                ...e,
                valor: e.valor! - temporaryBonus,
              }
            : e,
        ),
        ids,
        card.elemento,
        card,
        `${card.nome} (${this.player(user).nome})`,
        destinationId,
      );
    }
    const player = this.player(user);
    player.roundSpells ??= [];
    player.roundSpells.push(card.numeroCatalogo);
    if (
      !player.comboTriggered &&
      player.roundSpells.includes("001") &&
      player.roundSpells.includes("004")
    ) {
      if (this.state.phase === "PREPARATION")
        this.fail("Combinação de dano bloqueada na preparação.");
      player.comboTriggered = true;
      for (const id of this.enemyTargets(user, true))
        this.damage(
          id,
          6,
          undefined,
          false,
          "Fogo",
          undefined,
          "Combinação Bola de Fogo + Furacão",
          user,
        );
      this.log(
        "Bola de Fogo + Furacão: 6 de dano adicionais em todos os inimigos.",
      );
    }
    this.zarcosPlayed(user, card);
  }
  private enemyTargets(user: string, mage = false) {
    return this.state.slots
      .filter(
        (s) =>
          s.ownerId === this.opponent(user).id &&
          (s.card?.tipo === "Tropa" || (mage && s.kind === "Mago")),
      )
      .flatMap((s) =>
        [s.card, s.rider].filter((c): c is Instance => !!c).map((c) => c.id),
      );
  }
  private spellSelection(card: Instance, user: string, ids: string[]) {
    if (!card.alvoAutomatico) return ids;
    if (ids.length) this.fail("Este feitiço usa alvo automático.");
    const last = this.player(user).lastTroopAttacker;
    const target = last && this.findCard(last.cardId);
    if (
      !last ||
      last.turn !== this.state.turn - 1 ||
      target?.tipo !== "Tropa" ||
      target.hpAtual <= 0 ||
      target.ownerId === user ||
      !this.state.slots.some(
        (s) => s.card?.id === target.id || s.rider?.id === target.id,
      )
    )
      this.fail(
        "A última tropa que atacou uma tropa sua no turno anterior não está disponível.",
      );
    return [target.id];
  }
  private openingCardBlockReason(card: Instance) {
    if (this.state.phase !== "BATTLE") return "";
    if (this.state.turn === 1 && card.tipo !== "Tropa")
      return "No primeiro turno após a preparação, só é permitido mobilizar tropas.";
    if (this.state.turn <= 2 && ["Armamento", "Estrutura"].includes(card.tipo))
      return "Armamentos e estruturas são bloqueados nos dois primeiros turnos após a preparação.";
    return "";
  }
  private abilityOpeningReason(
    effects: Card["efeitos"] | undefined,
    id: string,
    element?: Card["elemento"],
  ) {
    if (this.openingBlocked())
      return "Habilidades bloqueadas na preparação e no primeiro turno após ela.";
    if (this.state.turn <= 2 && this.openingHarm(effects, id, element))
      return "Habilidades que causam dano são bloqueadas nos dois primeiros turnos após a preparação.";
    return "";
  }
  private spellBlockReason(card: Instance, user: string) {
    if (card.tipo !== "Feitico") return "";
    if (this.state.phase === "PREPARATION")
      return "Feitiços são bloqueados durante a preparação.";
    if (
      card.efeitos.some(
        (e) =>
          e.id === "stealMana" &&
          e.limiteManaOrigem !== undefined &&
          this.player(user).mana > e.limiteManaOrigem,
      )
    )
      return "Mana acima do limite permitido para usar este efeito.";
    const openingReason = this.openingCardBlockReason(card);
    if (openingReason) return openingReason;
    if (
      this.state.phase === "BATTLE" &&
      this.state.turn <= 2 &&
      this.openingHarm(card.efeitos, undefined, this.player(user).mage.elemento)
    )
      return "Feitiços que causam dano são bloqueados nos dois primeiros turnos após a preparação.";
    if (
      card.requerElementoMago &&
      this.player(user).mage.elemento !== card.requerElementoMago
    )
      return `Este feitiço exige mago de ${card.requerElementoMago}.`;
    if (
      card.efeitos.some((e) => e.id === "attackField") &&
      this.state.fieldEffects?.some(
        (f) =>
          f.ownerId === user &&
          f.card.numeroCatalogo === card.numeroCatalogo &&
          f.rounds > 0,
      )
    )
      return `Você já tem ${card.nome} ativo em campo.`;
    if (
      card.efeitos?.some((e) =>
        this.state.ongoingSpells?.some(
          (s) =>
            s.ownerId === user &&
            s.rounds > 0 &&
            (e.id === "periodicDamage"
              ? s.card?.numeroCatalogo === card.numeroCatalogo
              : s.kind === e.id),
        ),
      )
    )
      return `Você já tem ${card.nome} ativo em campo.`;
    if (!card.alvoAutomatico) return "";
    try {
      this.spellSelection(card, user, []);
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  }
  private earthGolem(user: string) {
    return this.state.slots.some(
      (s) =>
        s.ownerId === user &&
        slotCards(s).some(
          (c) =>
            c.tipo === "Tropa" &&
            c.hpAtual > 0 &&
            (c.numeroCatalogo === "025" ||
              (c.elemento === "Terra" &&
                /golem/i.test(
                  c.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
                ))),
        ),
    );
  }
  private spellTarget(card: Card, user: string) {
    return card.efeitos.some((e) => e.id === "meteors") && this.earthGolem(user)
      ? ("TodasTropasInimigas" as const)
      : card.alvo;
  }
  private zarcosPlayed(user: string, card: Instance) {
    for (const attachment of [...(this.state.attachments ?? [])])
      if (
        attachment.source.id !== card.id &&
        attachment.removerAoUsarElemento &&
        attachment.removerAoUsarElemento === card.elemento &&
        this.state.turn <= attachment.watchThroughTurn
      )
        this.removeAttachment(attachment);
    const player = this.player(user),
      watchers = player.zarcosWatchers ?? [];
    const triggered = watchers.filter(
      (w) =>
        w.cardId !== card.id &&
        (w.elemento ?? "Zarcos") === card.elemento &&
        (w.throughTurn === undefined || w.throughTurn >= this.state.turn),
    );
    player.zarcosWatchers = watchers.filter(
      (w) =>
        !triggered.includes(w) &&
        (w.throughTurn === undefined || w.throughTurn >= this.state.turn),
    );
    for (const watcher of triggered) {
      if (watcher.kind === "return")
        (player.returnUsedUntil ??= {})[watcher.cardId] =
          watcher.throughTurn ?? this.state.turn;
      (player.zarcosTriggered ??= []).push(watcher.cardId);
      if (watcher.kind === "flow") this.draw(player, 1);
      else {
        const index = player.graveyard.findIndex(
          (c) => c.id === watcher.cardId,
        );
        if (index >= 0) player.hand.push(player.graveyard.splice(index, 1)[0]);
      }
    }
  }
  private specialSpell(
    user: string,
    card: Instance,
    ids: string[],
    bonus: number,
    actionBonus = 0,
    temporaryBonus = 0,
  ) {
    const player = this.player(user),
      enemy = this.opponent(user),
      mageElement = player.mage.elemento;
    const effect = card.efeitos.find((e) =>
      [
        "stoneVolley",
        "tornado",
        "arrowRain",
        "protectionShield",
        "tremor",
        "lightOrb",
        "sandstorm",
        "meteors",
        "zarcosTear",
        "strongFlow",
        "revealStealHand",
        "bloodScent",
      ].includes(e.id),
    );
    if (!effect) return false;
    const hit = (
      targets: string[],
      damage: number,
      element = card.elemento,
    ) => {
      if (element) this.react(user, targets, element);
      for (const target of targets)
        this.damage(
          target,
          damage + bonus + actionBonus,
          undefined,
          false,
          element,
          undefined,
          card.nome,
          user,
        );
    };
    const ongoing = (
      kind: "tornado" | "arrowRain" | "sandstorm",
      damage: number,
      rounds = 2,
    ) => {
      this.state.ongoingSpells ??= [];
      if (
        this.state.ongoingSpells.some(
          (s) => s.kind === kind && s.ownerId === user && s.rounds > 0,
        )
      )
        this.fail(`Você já tem ${card.nome} ativo em campo.`);
      this.state.ongoingSpells.push({
        id: card.id,
        ownerId: user,
        kind,
        rounds,
        nextTickTurn: nextEffectRound(this.state.turn),
        damage: damage + bonus - temporaryBonus + actionBonus,
        element: card.elemento,
        card: {
          numeroCatalogo: card.numeroCatalogo,
          nome: card.nome,
          imgURL: card.imgURL,
        },
      });
    };
    const status = (
      targets: string[],
      name: string,
      duration: number,
      value?: number,
      configured = false,
      unit?: "turno" | "rodada",
    ) => {
      for (const id of targets) {
        const s = this.targetSlot(id),
          target = this.findCard(id) ?? s?.card;
        if (target && this.impactAllowed(target.id)) {
          const previous = target.statuses.find(
            (s) => canonicalStatus(s.nome) === canonicalStatus(name),
          );
          const previousDuration = previous?.turnosRestantes ?? 0;
          const previousUnit = previous?.unidade ?? "rodada";
          const applied = applyStatus(
            target.statuses,
            name,
            duration,
            value,
            this.state.turn,
          );
          if (configured) {
            const durationUnit =
              unit ??
              (canonicalStatus(name) === "Congelado" ? "turno" : "rodada");
            applied.unidade = durationUnit;
            applied.turnosRestantes = Math.max(
              duration,
              previousUnit === durationUnit ? previousDuration : 0,
            );
            if (durationUnit === "turno")
              applied.expiraNoTurno =
                this.state.turn + applied.turnosRestantes - 1;
            else {
              delete applied.expiraNoTurno;
              applied.nextTickTurn = nextEffectRound(this.state.turn);
            }
            if (value !== undefined)
              applied.valor = [
                "Envenenado",
                "Queimado",
                "Sangrando",
                "Peste Negra",
                "Leptospirose",
              ].includes(canonicalStatus(name))
                ? Math.max(applied.valor ?? 0, value)
                : value;
          }
          applied.originOwnerId = user;
          applied.origin = card.nome;
          this.trigger("onStatusApplied", {
            ownerId: target.ownerId,
            cardId: target.id,
            status: canonicalStatus(name),
          });
        }
      }
    };
    switch (effect.id) {
      case "revealStealHand":
        player.revealHandRound = this.state.round;
        player.revealHandUntilTurn =
          this.state.turn + 2 * (effect.duracao ?? 1);
        if (enemy.hand.length)
          this.state.pendingHandChoice = {
            ownerId: user,
            opponentId: enemy.id,
            source: card.nome,
          };
        else this.log(`${card.nome}: a mão adversária está vazia.`);
        break;
      case "bloodScent":
        for (const id of this.enemyTargets(user)) {
          const target = this.findCard(id)!;
          const bleeding = target.statuses.find(
            (s) =>
              canonicalStatus(s.nome) === "Sangrando" && s.turnosRestantes > 0,
          );
          if (bleeding && this.impactAllowed(id))
            bleeding.valor = (bleeding.valor ?? 1) + (effect.valor ?? 2);
        }
        player.piranhaBleedingBonus = Math.max(
          player.piranhaBleedingBonus ?? 0,
          effect.bonusAtaque ?? 1,
        );
        break;
      case "stoneVolley":
        let nextColumn = 0;
        for (let i = 0; i < 5 && this.state.status === "ACTIVE"; i++) {
          const troops = this.enemyTargets(user).sort(
            (a, b) => this.targetSlot(a)!.column - this.targetSlot(b)!.column,
          );
          const target =
            troops.find((id) => this.targetSlot(id)!.column >= nextColumn) ??
            troops[0];
          if (target) nextColumn = this.targetSlot(target)!.column + 1;
          this.inImpact(
            "spell",
            card.nome,
            () => hit([target ?? enemy.mage.id], 1),
            { shareDodgeWithParent: true },
          );
          this.resolve();
        }
        break;
      case "tornado": {
        const slot = this.targetSlot(ids[0]);
        if (
          !slot ||
          slot.card?.tipo !== "Tropa" ||
          ids[0] === slot.structure?.id
        )
          this.fail("Furacão exige uma tropa inimiga.");
        if (card.elemento) this.react(user, ids, card.elemento);
        if (slot.structure && this.impactAllowed(slot.structure.id)) {
          slot.structure.hpAtual = 0;
          this.resolve();
        }
        const troop = this.findCard(ids[0]) ?? slot.card;
        if (troop && this.impactAllowed(troop.id)) {
          if (slot.rider?.id === troop.id) {
            slot.rider = null;
            if (slot.card && slot.card.hpAtual > 0)
              slot.card.hpAtual += this.weapons(slot).reduce(
                (n, w) => n + (w.bonusHp ?? 0),
                0,
              );
          } else {
            slot.card = slot.rider ?? null;
            slot.rider = null;
          }
          this.resetCard(troop);
          enemy.hand.push(troop);
        }
        ongoing("tornado", 3);
        break;
      }
      case "arrowRain": {
        const variant = effect.variantesMago?.find(
          (v) => v.elemento === mageElement,
        );
        const legacy = effect.variantesMago === undefined;
        ongoing(
          "arrowRain",
          (effect.valor ?? 3) +
            (variant?.bonusDano ?? (legacy && mageElement === "Fogo" ? 2 : 0)),
          variant?.duracao ?? effect.duracao ?? 2,
        );
        if (legacy) {
          if (mageElement === "Agua")
            status(this.enemyTargets(user), "Congelado", 2);
          if (mageElement === "Ar")
            status(this.enemyTargets(user, true), "Sangrando", 3);
          if (mageElement === "Terra")
            status(this.enemyTargets(user, true), "Cego", 2);
        }
        for (const extra of variant?.efeitos ?? [])
          status(
            this.enemyTargets(user, extra.alvo === "TodosInimigos"),
            extra.status,
            extra.duracao,
            extra.valor,
            true,
            extra.unidade,
          );
        break;
      }
      case "protectionShield":
        status(ids, "EscudoProtecao", effect.duracao ?? 2, effect.valor ?? 3);
        break;
      case "tremor": {
        const targets = this.enemyTargets(user, mageElement === "Terra");
        for (const id of this.enemyTargets(user)) {
          const structure = this.targetSlot(id)?.structure;
          if (structure)
            structure.statuses.push({
              nome: "Abalo",
              turnosRestantes: 1,
              unidade: "turno",
              expiraNoTurno: this.state.turn,
            });
        }
        hit(targets, (effect.valor ?? 4) + (mageElement === "Terra" ? 2 : 0));
        status(
          this.enemyTargets(user),
          mageElement === "Terra" ? "Atordoado" : "Incapacitado",
          effect.duracao ?? 2,
        );
        break;
      }
      case "lightOrb": {
        const variant = effect.variantesMago?.find(
          (v) => v.elemento === mageElement,
        );
        const damages =
          variant?.causaDano ??
          (effect.variantesMago === undefined && mageElement === "Fogo");
        if (card.elemento) this.react(user, ids, card.elemento);
        if (damages)
          for (const id of ids)
            this.damage(
              id,
              (effect.valor ?? 3) +
                (variant?.bonusDano ?? 0) +
                bonus +
                actionBonus,
              undefined,
              false,
              card.elemento,
              undefined,
              card.nome,
            );
        const name = variant?.status ?? effect.status ?? "Cego";
        if (name)
          status(
            ids,
            name,
            variant?.duracao ?? effect.duracao ?? 1,
            undefined,
            true,
            effect.unidade,
          );
        for (const extra of variant?.efeitos ?? [])
          status(
            this.enemyTargets(user, extra.alvo === "TodosInimigos"),
            extra.status,
            extra.duracao,
            extra.valor,
            true,
            extra.unidade,
          );
        break;
      }
      case "sandstorm":
        if (card.elemento) this.react(user, ids, card.elemento);
        status(ids, "Cego", effect.duracao ?? 2);
        ongoing("sandstorm", effect.valor ?? 2, effect.duracao ?? 2);
        break;
      case "meteors":
        if (ids.some((id) => this.targetSlot(id)?.card?.tipo !== "Tropa"))
          this.fail("Chuva de Meteoros atinge somente tropas.");
        hit(ids, effect.valor ?? 2);
        break;
      case "zarcosTear":
        this.gainMana(player, effect.valor ?? 3);
        if (!player.zarcosTriggered?.includes(card.id))
          (player.zarcosWatchers ??= []).push({
            cardId: card.id,
            kind: "tear",
          });
        break;
      case "strongFlow":
        this.draw(player, effect.valor ?? 3);
        if (!player.zarcosTriggered?.includes(card.id))
          (player.zarcosWatchers ??= []).push({
            cardId: card.id,
            kind: "flow",
          });
        break;
    }
    return true;
  }
  private tickOngoingSpells() {
    if (!this.state.ongoingSpells?.length) return;
    this.deferMageDefeat = true;
    try {
      for (const spell of this.state.ongoingSpells ?? []) {
        if (this.state.status !== "ACTIVE") break;
        if (!effectRoundDue(spell, this.state.turn)) continue;
        const targets =
          spell.kind === "tornado"
            ? [this.opponent(spell.ownerId).mage.id]
            : this.enemyTargets(
                spell.ownerId,
                spell.target !== "TodasTropasInimigas",
              );
        const name =
          spell.card?.nome ??
          (spell.kind === "tornado"
            ? "Furacão"
            : spell.kind === "arrowRain"
              ? "Chuva de Flechas"
              : "Furacão de Areia");
        this.inImpact("spell", name, () => {
          if (spell.element) this.react(spell.ownerId, targets, spell.element);
          for (const id of targets)
            this.damage(
              id,
              spell.damage +
                temporarySpellDamageBonus(this.player(spell.ownerId).mage),
              undefined,
              false,
              spell.element,
              undefined,
              `${name} (${this.player(spell.ownerId).nome}, fim do ciclo)`,
              spell.ownerId,
            );
        });
        spell.rounds--;
        this.log(`${name} causou dano no fim do ciclo.`);
        this.resolve();
      }
      this.state.ongoingSpells = this.state.ongoingSpells?.filter(
        (s) => s.rounds > 0,
      );
    } finally {
      this.deferMageDefeat = false;
    }
    this.resolve();
  }
  resolvePendingSpell() {
    if (this.state.pendingSpell)
      return this.runResolution({ automatic: "spell" });
  }
  private resolvePendingSpellOnce() {
    const pending = this.state.pendingSpell;
    if (!pending || this.state.status !== "ACTIVE") return;
    delete this.state.pendingSpell;
    this.resolveSpell(
      pending.casterId,
      pending.card,
      pending.targets,
      pending.bonus,
      pending.destinationId,
      pending.actionBonus,
      pending.temporaryBonus,
    );
    this.log(`${pending.card.nome} resolveu sem cancelamento.`);
    this.resolve();
    this.state.version++;
  }
  private respondSpell(user: string, cardId?: string) {
    const pending = this.state.pendingSpell;
    if (!pending || user === pending.casterId)
      this.fail("Não há resposta disponível para você.");
    if (!cardId) {
      this.resolvePendingSpell();
      return;
    }
    const player = this.player(user),
      card = player.hand.find((c) => c.id === cardId);
    if (!card || !this.waterReactionAllowed(player, card))
      this.fail(
        "Este feitiço de Água com Reação não está disponível para responder.",
      );
    this.spend(player, card.custoMana);
    player.hand.splice(player.hand.indexOf(card), 1);
    player[card.destinoAposUso === "banido" ? "banished" : "graveyard"].push(
      card,
    );
    if (card.assinatura) player.counters.unique++;
    else player.counters.spells++;
    player.castCards = [
      ...new Set([...(player.castCards ?? []), card.numeroCatalogo]),
    ];
    delete this.state.pendingSpell;
    this.trigger("onSpellCast", {
      ownerId: user,
      element: card.elemento,
      cardId: card.id,
    });
    this.reactFields(card.elemento);
    this.log(`${player.nome} cancelou ${pending.card.nome} com ${card.nome}.`);
  }
  private attackSourceError(user: string, slot: Slot, card: Instance | null) {
    const p = this.player(user);
    if (!card || !["Tropa", "Mago", "Estrutura"].includes(card.tipo))
      return "Selecione uma tropa, mago ou estrutura.";
    if (blockedOwnAttack(card, this.state.slots))
      return "Uma condição da passiva desta carta impede o ataque básico.";
    if (
      card.tipo === "Mago" &&
      this.state.slots.some(
        (s) => s.ownerId === user && s.card?.tipo === "Tropa",
      )
    )
      return "O mago não pode atacar enquanto tiver tropas em campo.";
    if (
      card.tipo === "Estrutura" &&
      (!slot.card ||
        hasStatus(slot.card.statuses, [
          "Atordoado",
          "Incapacitado",
          "SemAtaque",
          "Cego",
          "Congelado",
        ]))
    )
      return "A tropa protegida não pode atacar com a estrutura neste estado.";
    if (
      card.attacked ||
      (card.attacksMade ?? 0) >= basicAttackLimit(card, this.state.slots) ||
      (card.tipo !== "Mago" &&
        p.counters.attacks >= p.mage.limites[0].tropaAtacam)
    )
      return "Limite de ataque atingido.";
    if (
      card.statuses.some((s) =>
        [
          "Incapacitado",
          "SemAtaque",
          "Atordoamento",
          "Atordoado",
          "Congelado",
          "Congelamento",
        ].includes(s.nome),
      )
    )
      return "Tropa incapacitada.";
    return "";
  }
  private attackTargetError(slot: Slot, card: Instance, target: Slot) {
    if (target.card?.concealedTrap && card.tipo !== "Tropa")
      return "Somente tropas podem atacar este espaço ocupado por carta oculta.";
    if (
      target.card &&
      restrictedBasicAttack(target.card, card, this.state.slots)
    )
      return "A passiva desta carta impede este ataque básico.";
    const enemyId = target.ownerId;
    const guards = this.state.slots.filter(
      (s) =>
        s.ownerId === enemyId &&
        s.card &&
        this.has(s.card, "Guardar") &&
        !hasStatus(s.card.statuses, ["Congelado"]),
    );
    if (guards.length) {
      if (!guards.includes(target)) return "Você precisa atacar um Guardião.";
    } else if (target.kind === "Mago") {
      if (
        this.state.slots.some(
          (s) => s.ownerId === enemyId && s.card?.tipo === "Tropa",
        )
      )
        return "O mago ainda está protegido por tropas.";
    } else {
      if (target.kind !== "Tropa") return "Ataque um slot da linha de frente.";
      const straight = 2 - slot.column,
        difference = Math.abs(target.column - straight);
      const direction =
        card.tipo === "Mago"
          ? "Universal"
          : (card.direcaoAtaque ?? slot.card?.direcaoAtaque ?? "Frente");
      if (
        (direction === "Frente" && difference !== 0) ||
        (direction === "Diagonal" && difference !== 1) ||
        (direction === "Universal" && difference > 1)
      )
        return "Alvo fora do alcance.";
    }
    if (target.card && this.has(target.card, "Esconder"))
      return "Alvo escondido.";
    return "";
  }
  private attackTargets(user: string, slot: Slot, card: Instance | null) {
    if (
      this.state.status !== "ACTIVE" ||
      this.openingBlocked() ||
      this.state.current !== user ||
      this.attackSourceError(user, slot, card) ||
      !card
    )
      return [];
    const enemy = this.opponent(user);
    const exposed = !this.state.slots.some(
      (s) => s.ownerId === enemy.id && s.card?.tipo === "Tropa",
    );
    const guarded = this.state.slots.some(
      (s) =>
        s.ownerId === enemy.id &&
        s.card &&
        this.has(s.card, "Guardar") &&
        !hasStatus(s.card.statuses, ["Congelado"]),
    );
    return this.state.slots
      .filter(
        (target) =>
          target.ownerId === enemy.id &&
          (!exposed ||
            guarded ||
            target.kind === "Mago" ||
            !!target.card?.concealedTrap) &&
          !this.attackTargetError(slot, card, target),
      )
      .map((target) => target.id);
  }
  private attackBlockReasons(user: string, card: Instance | null) {
    if (!card) return {};
    return Object.fromEntries(
      this.state.slots
        .filter(
          (target) =>
            target.ownerId !== user &&
            target.card &&
            restrictedBasicAttack(target.card, card, this.state.slots),
        )
        .map((target) => [
          target.id,
          `Ataque ${card.nome} foi bloqueado pela passiva de ${target.card!.nome} (${this.player(target.ownerId).nome}).`,
        ]),
    );
  }
  private attack(user: string, cmd: Extract<Command, { type: "attack" }>) {
    if (this.openingBlocked())
      this.fail(
        "Ataques bloqueados na preparação e no primeiro turno após ela.",
      );
    const p = this.player(user),
      slot = this.ownSlot(cmd.slotId, user),
      card =
        cmd.source === "structure"
          ? slot.structure
          : cmd.source === "rider"
            ? (slot.rider ?? null)
            : slot.card;
    const sourceError = this.attackSourceError(user, slot, card);
    if (sourceError) this.fail(sourceError);
    if (!card) this.fail("Carta ausente.");
    const enemy = this.opponent(user);
    let target = this.state.slots.find(
      (s) => s.id === cmd.targetId && s.ownerId === enemy.id,
    );
    if (!target) this.fail("Selecione um slot inimigo.");
    const targetError = this.attackTargetError(slot, card, target);
    if (targetError) this.fail(targetError);
    let interception = "";
    let interceptionProtection:
      { cardId: string; valor: number; origin: string } | undefined;
    {
      const interceptor = attackInterceptor(card, target, this.state.slots);
      if (interceptor && interceptor.card.id !== target.card?.id) {
        const protection = interceptor.protection?.origin;
        if (interceptor.protection?.protegidoId)
          interceptionProtection = {
            cardId: interceptor.card.id,
            valor: interceptor.protection.valor ?? 0,
            origin: protection ?? "Em Guarda",
          };
        interception = ` Alvo escolhido: ${target.card?.nome ?? enemy.mage.nome} (${enemy.nome}). ${interceptor.card.nome} (${enemy.nome}) interceptou ${protection ? `pela habilidade ${protection}` : "pela sua passiva"}.`;
        this.log(
          `${interceptor.card.nome} interceptou o ataque de ${card.nome} destinado a ${target.card?.nome ?? enemy.mage.nome}.`,
        );
        target =
          interceptor.slot.rider?.id === interceptor.card.id
            ? { ...interceptor.slot, card: interceptor.card, rider: null }
            : interceptor.slot;
      }
      if (card.tipo === "Tropa" && target.card?.tipo === "Tropa")
        enemy.lastTroopAttacker = { cardId: card.id, turn: this.state.turn };
    }
    const actionBonus = this.takeActionBonus(user);
    const announcedDefender = this.basicAttackDefender(target);
    this.event(
      "attack",
      card,
      `Ataque: ${card.nome} (${p.nome}) atacou ${announcedDefender.nome} (${this.player(announcedDefender.ownerId).nome}).${interception}`,
    );
    card.attacksMade = (card.attacksMade ?? 0) + 1;
    card.attacked =
      card.attacksMade >= basicAttackLimit(card, this.state.slots);
    p.combatStarted = true;
    if (card.tipo !== "Mago") p.counters.attacks++;
    if (card.tipo === "Tropa" && target.card?.concealedTrap) {
      const trap = target.card;
      const spec = trap.concealedTrap!;
      this.inImpact("spell", trap.nome, () => {
        target.card = null;
        delete trap.concealedTrap;
        if (!spec.generated) this.player(target.ownerId).graveyard.push(trap);
        this.event(
          "reaction",
          trap,
          `${trap.nome} foi revelada e cancelou o ataque de ${card.nome}.`,
          { slotId: target.id },
        );
        this.damage(
          card.id,
          spec.effect.valor! +
            (spec.effect.bonusContraSubtipos?.subtipos.includes(card.subtipo!)
              ? spec.effect.bonusContraSubtipos.valor
              : 0),
          undefined,
          spec.effect.perfurante ?? true,
          spec.effect.elemento ?? trap.elemento,
          trap,
          `Armadilha: ${trap.nome}`,
        );
        this.effects(
          trap.ownerId,
          [
            {
              id: "status",
              status: spec.effect.status,
              duracao: spec.effect.duracao,
            },
          ],
          [card.id],
          trap.elemento,
          trap,
          trap.nome,
        );
      });
      this.afterAttackFields(card);
      return;
    }
    card.palavrasChave = card.palavrasChave.filter((k) => k !== "Esconder");
    card.statuses = card.statuses.filter((s) => s.nome !== "Esconder");
    card.statuses = card.statuses.filter(
      (s) => !s.requerStatus || this.has(card, s.requerStatus),
    );
    if (this.has(card, "Cegueira") || this.has(card, "Cego")) {
      if (this.random() < 0.5) {
        if (target.card)
          this.trigger("onAttacked", {
            ownerId: target.card.ownerId,
            cardId: target.card.id,
            attackerId: card.id,
          });
        const missedDefender = this.basicAttackDefender(target);
        this.trigger("onAttack", {
          ownerId: user,
          cardId: card.id,
          card,
          targetId: missedDefender.id,
          targetCard: missedDefender,
          slotId: target.id,
        });
        this.log(`${card.nome} errou por cegueira.`);
        this.afterAttackFields(card);
        return;
      }
    }
    const defender = this.basicAttackDefender(target);
    const bonusOnTarget = targetAttackBonus(card, defender, this.state.slots);
    if (bonusOnTarget)
      this.log(
        `${card.nome} ganhou +${bonusOnTarget} neste ataque contra ${defender.nome} pela vida do alvo.`,
      );
    const damage = this.basicAttackDamage(card, defender) + actionBonus;
    if (this.canReflectAttack(defender, card)) {
      this.state.pendingAttack = {
        attackerOwnerId: user,
        attackerId: card.id,
        targetSlotId: target.id,
        defenderId: defender.id,
        damage,
        element: this.attackElement(card),
        interception: interceptionProtection,
      };
      this.log(`${defender.nome} pode devolver o ataque de ${card.nome}.`);
      return;
    }
    this.completeAttack(
      card,
      target,
      damage,
      this.attackElement(card),
      false,
      undefined,
      interceptionProtection,
    );
  }
  private attackElement(card: Instance) {
    const slot = this.targetSlot(card.id);
    return basicAttackElement(
      card,
      slot && card.tipo !== "Estrutura" ? this.weapons(slot, card) : [],
      this.state.slots,
    );
  }
  private basicAttackDamage(card: Instance, defender: Instance) {
    return (
      currentBasicAttack(card, this.state.slots) +
      targetAttackBonus(card, defender, this.state.slots) +
      (card.numeroCatalogo === "041" &&
      defender.tipo === "Tropa" &&
      this.has(defender, "Sangrando")
        ? (this.player(card.ownerId).piranhaBleedingBonus ?? 0)
        : 0)
    );
  }
  private basicAttackDefender(target: Slot): Instance {
    if (
      target.structure &&
      target.structure.hpAtual > 0 &&
      target.card?.tipo === "Tropa" &&
      !hasStatus(target.structure.statuses, ["Abalo"])
    )
      return target.structure;
    return target.card ?? this.player(target.ownerId).mage;
  }
  private canReflectAttack(card: Instance, attacker: Instance) {
    return (
      card.hpAtual > 0 &&
      card.reflectedAttackRound !== this.state.round &&
      !hasStatus(card.statuses, ["Atordoado", "Congelado", "Cego"]) &&
      card.habilidadesPassivas.some((passive) => {
        const rule = normalizePassive(passive);
        return (
          rule.gatilho === "onTargeted" &&
          rule.efeitos.some(
            (a) =>
              a.id === "reflectAttack" &&
              (card.reflectedAttackRound === undefined ||
                this.state.round - card.reflectedAttackRound >
                  (a.esperaRodadas ?? 0)) &&
              matchesPassiveFilter(attacker, a.filtro),
          ) &&
          passiveMatches(
            rule,
            card,
            { ownerId: card.ownerId, cardId: card.id, card },
            this.state.slots,
          )
        );
      })
    );
  }
  private completeAttack(
    card: Instance,
    target: Slot,
    damage: number,
    element?: Card["elemento"],
    reflect = false,
    reactionCard?: Instance,
    interception?: { cardId: string; valor: number; origin: string },
  ) {
    return this.inImpact("attack", `Ataque de ${card.nome}`, () =>
      this.completeAttackOnce(
        card,
        target,
        damage,
        element,
        reflect,
        reactionCard,
        interception,
      ),
    );
  }
  private completeAttackOnce(
    card: Instance,
    target: Slot,
    damage: number,
    element?: Card["elemento"],
    reflect = false,
    reactionCard?: Instance,
    interception?: { cardId: string; valor: number; origin: string },
  ) {
    const user = card.ownerId,
      enemy = this.opponent(user);
    const attackedCard = target.card;
    const effectiveDefender = this.basicAttackDefender(target);
    if (reflect && reactionCard) {
      reactionCard.reflectedAttackRound = this.state.round;
      this.damage(
        card.id,
        damage,
        undefined,
        false,
        element,
        reactionCard,
        `Ataque devolvido por ${reactionCard.nome}`,
      );
      this.event(
        "reaction",
        reactionCard,
        `Devolveu o ataque de ${card.nome}.`,
      );
      this.log(`${reactionCard.nome} devolveu o ataque de ${card.nome}.`);
    } else
      this.damage(
        effectiveDefender.id,
        damage,
        card,
        false,
        element,
        undefined,
        undefined,
        undefined,
        interception,
      );
    if (attackedCard)
      this.trigger("onAttacked", {
        ownerId: attackedCard.ownerId,
        cardId: attackedCard.id,
        attackerId: card.id,
      });
    this.trigger("onAttack", {
      ownerId: user,
      cardId: card.id,
      card,
      targetId: effectiveDefender.id,
      targetCard: effectiveDefender,
      slotId: target.id,
    });
    this.log(`${card.nome} atacou a coluna ${target.column + 1}.`);
    this.afterAttackFields(card);
  }
  resolvePendingAttack(reflect = false) {
    if (this.state.pendingAttack)
      return this.runResolution({ automatic: "attack", reflect });
  }
  private resolvePendingAttackOnce(reflect = false) {
    const pending = this.state.pendingAttack;
    if (!pending || this.state.status !== "ACTIVE") return;
    const card = this.findCard(pending.attackerId);
    const position = this.state.slots.find(
      (s) => s.id === pending.targetSlotId,
    );
    const target =
      position?.rider?.id === pending.defenderId
        ? { ...position, card: position.rider, rider: null }
        : position;
    if (
      !card ||
      !target ||
      this.basicAttackDefender(target).id !== pending.defenderId
    )
      this.fail("Ataque pendente inválido.");
    const defender = this.basicAttackDefender(target);
    if (reflect && !this.canReflectAttack(defender, card))
      this.fail("Reação já utilizada ou indisponível.");
    delete this.state.pendingAttack;
    this.completeAttack(
      card,
      target,
      pending.damage,
      pending.element,
      reflect,
      defender,
      pending.interception,
    );
    this.resolve();
    this.state.version++;
  }
  private respondAttack(user: string, reflect: boolean) {
    const pending = this.state.pendingAttack;
    if (!pending || this.findCard(pending.defenderId)?.ownerId !== user)
      this.fail("Não há reação de ataque disponível para você.");
    this.resolvePendingAttack(reflect);
  }
  private ability(user: string, cmd: Extract<Command, { type: "ability" }>) {
    return this.inImpact("ability", `Habilidade ${cmd.abilityId}`, () =>
      this.abilityOnce(user, cmd),
    );
  }
  private abilityOnce(
    user: string,
    cmd: Extract<Command, { type: "ability" }>,
  ) {
    const p = this.player(user),
      slot = this.ownSlot(cmd.slotId, user),
      card =
        cmd.source === "structure"
          ? slot.structure
          : cmd.source === "rider"
            ? (slot.rider ?? null)
            : slot.card;
    if (!card || card.usedAbility)
      this.fail("Carta ausente ou habilidade já utilizada.");
    if (hasStatus(card.statuses, ["Atordoado", "Congelado", "Cego"]))
      this.fail(
        "Esta carta não pode usar habilidades enquanto estiver atordoada, congelada ou cega.",
      );
    const originalAbility = card.habilidadesAtivas.find(
      (h) => h.id === cmd.abilityId,
    );
    const ability = originalAbility
      ? chooseAction(
          originalAbility,
          originalAbility.opcoes ? cmd.mode : undefined,
        )
      : undefined;
    if (!ability) this.fail("Esta carta não possui a habilidade.");
    if (
      cmd.mode &&
      !originalAbility?.opcoes &&
      ability.id !== "protecaoAquatica"
    )
      this.fail("Esta habilidade não aceita escolha de efeito.");
    if (
      cmd.destinationId &&
      !ability.efeitos?.some((e) =>
        ["displace", "revive", "control", "relocate"].includes(e.id),
      )
    )
      this.fail("Esta habilidade não aceita destino de deslocamento.");
    if (
      ability.esperaRodadas &&
      card.abilityRounds?.[ability.id] !== undefined &&
      this.state.round - card.abilityRounds[ability.id] <= ability.esperaRodadas
    )
      this.fail(
        "Esta habilidade ainda aguarda uma rodada completa entre usos.",
      );
    const openingReason = this.abilityOpeningReason(
      ability.efeitos,
      ability.id,
      p.mage.elemento,
    );
    if (openingReason) this.fail(openingReason);
    if (ability.custoVida) {
      if (card.hpAtual <= ability.custoVida)
        this.fail(
          "Vida insuficiente: o custo não pode derrotar a própria carta.",
        );
      card.hpAtual -= ability.custoVida;
      this.event(
        "notice",
        card,
        ability.nome + ": pagou " + ability.custoVida + " de vida.",
      );
    }
    const actionBonus = this.causesDamage(
      ability.efeitos,
      ability.id,
      p.mage.elemento,
    )
      ? this.takeActionBonus(user)
      : 0;
    if (ability.efeitos?.length) {
      let selected = cmd.targets;
      if (ability.alvoAutomatico) {
        if (selected.length)
          this.fail("Esta habilidade não aceita seleção de alvos.");
        if (ability.alvoAutomatico === "Proprio") selected = [card.id];
        else {
          const front = this.front(this.opponent(user).id).find(
            (s) =>
              s.column === 2 - slot.column &&
              s.card?.tipo === "Tropa" &&
              s.card.hpAtual > 0,
          );
          if (!front?.card)
            this.fail("Não há tropa inimiga diretamente à frente.");
          selected = [front.card.id];
        }
      }
      let targets = this.validateTargets(
        user,
        ability.alvo,
        selected,
        ability.maxAlvos ?? 1,
      ).map((id) =>
        [
          "CampoAliado",
          "CampoInimigo",
          "Deck",
          "DeckOponente",
          "Mao",
          "Cemiterio",
        ].includes(ability.alvo ?? "")
          ? id
          : (this.findCard(id)?.id ?? this.targetSlot(id)?.card?.id ?? id),
      );
      if (new Set(targets).size !== targets.length)
        this.fail("Selecione alvos diferentes.");
      if (
        ability.tiposAlvo &&
        targets.some(
          (id) => !ability.tiposAlvo!.includes(this.findCard(id)?.tipo!),
        )
      )
        this.fail("Tipo de alvo não permitido por esta habilidade.");
      if (ability.filtroAlvo) {
        const matches = (id: string) =>
          matchesPassiveFilter(this.findSourceCard(id), ability.filtroAlvo);
        if (
          ["TodosAliados", "TodasTropasInimigas"].includes(ability.alvo ?? "")
        )
          targets = targets.filter(matches);
        else if (targets.some((id) => !matches(id)))
          this.fail("O alvo não corresponde ao filtro desta habilidade.");
      }
      this.spend(p, abilityManaCost(card, ability.custoMana, this.state.slots));
      if (ability.efeitos.some((e) => e.id === "field")) {
        const fieldOwner = ["CampoInimigo", "TodasTropasInimigas"].includes(
          ability.alvo ?? "",
        )
          ? this.opponent(user).id
          : user;
        const field = this.state.slots.filter(
          (s) => s.ownerId === fieldOwner && s.kind === "Tropa",
        );
        for (const effect of ability.efeitos.filter((e) => e.id === "field"))
          this.react(
            user,
            field.map((s) => s.id),
            effect.elemento ?? card.elemento ?? "Neutro",
          );
        targets = field.flatMap((s) =>
          [s.card, s.rider].filter((c): c is Instance => !!c).map((c) => c.id),
        );
      }
      this.effects(
        user,
        addActionDamage(ability.efeitos, actionBonus),
        targets,
        card.elemento,
        card,
        `${ability.nome} de ${card.nome}`,
        cmd.destinationId,
      );
    } else {
      switch (ability.id) {
        case "refazerCaminhos": {
          this.validateTargets(user, "Cemiterio", cmd.targets);
          const index = p.graveyard.findIndex(
            (c) => c.id === cmd.targets[0] && c.tipo === "Feitico",
          );
          if (index < 0) this.fail("Escolha um feitiço do seu cemitério.");
          this.spend(
            p,
            abilityManaCost(card, ability.custoMana, this.state.slots),
          );
          const spell = p.graveyard.splice(index, 1)[0];
          this.resetCard(spell);
          p.hand.push(spell);
          this.log(`${card.nome} recuperou ${spell.nome} do cemitério.`);
          break;
        }
        case "deslocar": {
          if (cmd.targets.length)
            this.fail("Deslocar usa um alvo frontal automático.");
          const target = this.state.slots.find(
            (s) =>
              s.ownerId === this.opponent(user).id &&
              s.kind === "Tropa" &&
              s.column === 2 - slot.column &&
              s.card?.tipo === "Tropa" &&
              s.card.hpAtual > 0,
          );
          if (!target?.card)
            this.fail("Não há tropa inimiga diretamente à frente.");
          this.spend(
            p,
            abilityManaCost(card, ability.custoMana, this.state.slots),
          );
          this.damage(
            target.id,
            3 + actionBonus,
            undefined,
            false,
            card.elemento,
            card,
            `${ability.nome} de ${card.nome}`,
            user,
          );
          this.effects(
            user,
            [{ id: "status", status: "Atordoado", duracao: 1 }],
            [target.card.id],
            card.elemento,
            card,
          );
          break;
        }
        case "recuperarEnergia": {
          if (card.tipo !== "Mago") this.fail("Esta habilidade exige um mago.");
          this.validateTargets(user, "Mao", cmd.targets);
          const i = p.hand.findIndex(
            (c) => c.id === cmd.targets[0] && c.tipo === "Feitico",
          );
          if (i < 0) this.fail("Escolha um feitiço da sua mão.");
          this.spend(
            p,
            abilityManaCost(card, ability.custoMana, this.state.slots),
          );
          const discarded = this.discardFromHand(p, i);
          const recovered = this.gainMana(p, 3);
          this.log(
            `${card.nome} sacrificou ${discarded.nome} da mão e recuperou ${recovered} mana.`,
          );
          break;
        }
        case "protecaoAquatica": {
          const ids = this.validateTargets(user, "UnicoAliado", cmd.targets);
          const target = this.findCard(ids[0]) ?? this.targetSlot(ids[0])?.card;
          if (!target || !["cura", "escudo"].includes(cmd.mode ?? ""))
            this.fail("Escolha alvo aliado e modo.");
          this.spend(
            p,
            abilityManaCost(card, ability.custoMana, this.state.slots),
          );
          if (cmd.mode === "cura") this.heal(target, 3, undefined, card);
          else applyStatus(target.statuses, "Escudo", 2, 3, this.state.turn);
          break;
        }
        case "ataqueFurtivo":
          this.spend(
            p,
            abilityManaCost(card, ability.custoMana, this.state.slots),
          );
          this.damage(
            this.opponent(user).mage.id,
            2 + actionBonus,
            undefined,
            false,
            undefined,
            undefined,
            `${ability.nome} de ${card.nome}`,
            user,
          );
          break;
        case "ordemDaEspada":
          this.spend(
            p,
            abilityManaCost(card, ability.custoMana, this.state.slots),
          );
          for (const s of this.state.slots.filter(
            (s) =>
              s.ownerId === this.opponent(user).id && s.card?.tipo === "Tropa",
          ))
            this.damage(
              s.id,
              3 + actionBonus,
              undefined,
              false,
              undefined,
              card,
              `${ability.nome} de ${card.nome}`,
            );
          break;
        case "armaduraPoderosa":
          this.spend(
            p,
            abilityManaCost(card, ability.custoMana, this.state.slots),
          );
          card.attacked = true;
          applyStatus(card.statuses, "Guardar", 2, undefined, this.state.turn);
          applyStatus(
            card.statuses,
            "armaduraPoderosa",
            2,
            undefined,
            this.state.turn,
          );
          break;
        default:
          this.fail("Habilidade ainda não implementada.");
      }
    }
    card.usedAbility = true;
    (card.abilityRounds ??= {})[ability.id] = this.state.round;
    this.event("ability", card, ability.nome);
    this.log(`${card.nome} usou ${ability.nome}.`);
  }
  private abilityAttackBlockReasons(
    user: string,
    slot: Slot,
    card: Instance | null | undefined,
  ) {
    return Object.fromEntries(
      (card?.habilidadesAtivas ?? [])
        .filter(
          (h) =>
            this.abilityOpeningReason(
              h.efeitos,
              h.id,
              this.player(user).mage.elemento,
            ) ||
            h.custoVida ||
            h.esperaRodadas ||
            h.efeitos?.some((e) => e.id === "spendAttack"),
        )
        .map((h) => [
          h.id,
          this.abilityOpeningReason(
            h.efeitos,
            h.id,
            this.player(user).mage.elemento,
          ) ||
            (h.custoVida && (card?.hpAtual ?? 0) <= h.custoVida
              ? "Vida insuficiente para pagar a habilidade sem morrer."
              : h.esperaRodadas &&
                  card?.abilityRounds?.[h.id] !== undefined &&
                  this.state.round - card.abilityRounds[h.id] <= h.esperaRodadas
                ? "Aguarda uma rodada completa entre usos."
                : h.efeitos?.some((e) => e.id === "spendAttack")
                  ? this.attackSourceError(user, slot, card ?? null)
                  : ""),
        ]),
    );
  }
  private beginTurn() {
    const p = this.player(this.state.current);
    p.combatStarted = false;
    delete p.equipmentGrant;
    p.turnActions = 0;
    p.counters = { summons: 0, attacks: 0, spells: 0, unique: 0, equipment: 0 };
    for (const c of this.state.slots
      .filter((s) => s.ownerId === p.id)
      .flatMap(slotCards))
      if (c) {
        c.attacked = false;
        c.attacksMade = 0;
        c.usedAbility = false;
        c.moved = false;
      }
    this.recoverMana(p);
    this.trigger("onTurnStart", { ownerId: p.id });
    if (this.state.status === "ACTIVE") this.draw(p, 1);
  }
  private sacrifice(user: string, slotId: string, source?: "card" | "rider") {
    const p = this.player(user),
      slot = this.ownSlot(slotId, user);
    if (p.mage.numeroCatalogo !== "108")
      this.fail("Sacrificar tropas é uma habilidade exclusiva do Necromante.");
    if (this.state.phase === "PREPARATION" || this.state.turn <= 2)
      this.fail(
        "Sacrifício bloqueado na preparação e nos dois primeiros turnos de combate.",
      );
    if (
      p.mage.usedAbility ||
      hasStatus(p.mage.statuses, ["Congelado", "Atordoado", "Cego"])
    )
      this.fail("O mago não pode usar a habilidade de sacrifício agora.");
    const dead = source === "rider" ? slot.rider : slot.card;
    if (dead?.tipo !== "Tropa")
      this.fail("Escolha uma tropa sua para sacrificar.");
    dead.hpAtual = 0;
    p.mage.usedAbility = true;
    this.trigger("onSacrifice", {
      ownerId: user,
      cardId: dead.id,
      element: dead.elemento,
    });
    this.log(`${p.nome} sacrificou ${dead.nome}.`);
  }
  private tryStartBattle() {
    if (
      this.state.status !== "ACTIVE" ||
      this.state.phase !== "PREPARATION" ||
      !this.state.players.every(
        (p) => p.preparation.ready && !p.preparation.bonusDraws,
      )
    )
      return;
    this.state.phase = "COIN_TOSS";
    this.state.coinToss = createCoinToss(this.state.players, () =>
      this.random(),
    );
    this.log(
      `${this.player(this.state.coinToss.chooserId).nome} escolhe cara ou coroa.`,
    );
  }
  private chooseCoin(user: string, face: CoinFace) {
    const toss = this.state.coinToss;
    if (this.state.phase !== "COIN_TOSS" || !toss || toss.result)
      this.fail("Não há escolha de moeda disponível.");
    if (toss.chooserId !== user)
      this.fail("Aguarde o jogador sorteado escolher cara ou coroa.");
    resolveCoinToss(toss, this.state.players, face, () => this.random());
    this.log(
      `${toss.result === "heads" ? "Cara" : "Coroa"}: ${this.player(toss.winnerId!).nome} começa a partida.`,
    );
  }
  private beginBattle() {
    const winner = this.state.coinToss?.winnerId;
    if (!winner) this.fail("Aguarde o resultado da moeda.");
    this.state.current = winner;
    this.state.phase = "BATTLE";
    this.state.round = 2;
    for (const p of this.state.players) {
      p.roundSpells = [];
      p.comboTriggered = false;
      p.zarcosWatchers = [];
      p.zarcosTriggered = [];
    }
    this.state.turn = 1;
    this.log("Preparação concluída. Começou a rodada 2.");
    this.beginTurn();
  }
  private endTurn(user: string) {
    if (this.state.phase === "PREPARATION") {
      const p = this.player(user);
      if (p.preparation.bonusDraws)
        this.fail(
          "Aceite ou recuse a compra extra antes de confirmar a preparação.",
        );
      p.preparation.ready = true;
      this.log(`${p.nome} confirmou sua preparação.`);
      this.tryStartBattle();
      return;
    }
    this.trigger("onTurnEnd", { ownerId: this.state.current });
    const roundEnded = this.state.turn % 2 === 0;
    this.tickOngoingSpells();
    for (const field of this.state.fieldEffects ?? [])
      if (effectRoundDue(field, this.state.turn)) field.rounds--;
    this.state.fieldEffects = this.state.fieldEffects?.filter(
      (f) => f.rounds > 0,
    );
    if (roundEnded) {
      for (const player of this.state.players) {
        player.roundSpells = [];
        player.comboTriggered = false;
        player.zarcosWatchers =
          player.zarcosWatchers?.filter(
            (w) =>
              w.throughTurn !== undefined && w.throughTurn > this.state.turn,
          ) ?? [];
        player.zarcosTriggered = [];
      }
    }
    for (const slot of this.state.slots)
      if (
        slot.terrain &&
        effectRoundDue(slot.terrain, this.state.turn) &&
        --slot.terrain.rodadasRestantes <= 0
      )
        delete slot.terrain;
    for (const card of this.state.slots
      .flatMap(slotCards)
      .filter((c): c is Instance => c !== null)) {
      tickRound(
        card.statuses,
        (status, value) => {
          if (card.hpAtual <= 0) return;
          const before = card.hpAtual;
          card.hpAtual -= value;
          this.reportDamage(
            card,
            value,
            `${status.nome} (fim do ciclo)`,
            before,
            undefined,
            undefined,
            status.originOwnerId,
          );
          const position = this.targetSlot(card.id);
          if (
            position?.card?.id === card.id &&
            position.rider &&
            value > before
          )
            this.damage(
              position.rider.id,
              value - before,
              undefined,
              true,
              undefined,
              undefined,
              `Excedente de ${status.nome} em ${card.nome}`,
              status.originOwnerId,
            );
        },
        this.state.turn,
      );
      for (const status of card.statuses)
        if (status.unidade === "turno") {
          status.turnosRestantes = Math.max(
            0,
            (status.expiraNoTurno ?? this.state.turn) - this.state.turn,
          );
        }
      card.statuses = card.statuses.filter(
        (s) =>
          s.turnosRestantes > 0 && (s.nome !== "Escudo" || (s.valor ?? 0) > 0),
      );
    }
    this.resolve();
    if (this.state.status === "FINISHED") return;
    this.state.current = this.opponent(this.state.current).id;
    this.state.turn++;
    if (roundEnded) this.state.round++;
    for (const card of this.state.slots.flatMap(slotCards)) {
      const heals = (card.scheduledHeals ?? []).filter((h) =>
        h.turn !== undefined
          ? h.turn <= this.state.turn
          : roundEnded && h.round <= this.state.round,
      );
      card.scheduledHeals = card.scheduledHeals?.filter((h) =>
        h.turn !== undefined
          ? h.turn > this.state.turn
          : !roundEnded || h.round > this.state.round,
      );
      for (const scheduled of heals) {
        const source =
          this.findCard(scheduled.sourceId ?? "") ??
          this.state.players
            .flatMap((p) => [
              ...p.hand,
              ...p.deck,
              ...p.graveyard,
              ...p.banished,
              ...p.forgotten,
            ])
            .find((c) => c.id === scheduled.sourceId) ??
          this.player(scheduled.ownerId).mage;
        const healed = this.heal(card, scheduled.amount, undefined, source);
        this.event(
          "notice",
          card,
          `${scheduled.origin}: ${card.nome} recuperou ${healed} de vida após o ciclo completo.`,
        );
      }
      const due = (card.scheduledStatuses ?? []).filter((s) =>
        s.turn !== undefined
          ? s.turn <= this.state.turn
          : roundEnded && s.round <= this.state.round,
      );
      card.scheduledStatuses = card.scheduledStatuses?.filter((s) =>
        s.turn !== undefined
          ? s.turn > this.state.turn
          : !roundEnded || s.round > this.state.round,
      );
      for (const { status } of due) {
        const applied = applyStatus(
          card.statuses,
          status.nome,
          status.turnosRestantes,
          status.valor,
          this.state.turn,
          status.unidade,
        );
        applied.origin = status.origin;
        applied.originOwnerId = status.originOwnerId;
        applied.requerStatus = status.requerStatus;
        this.trigger("onStatusApplied", {
          ownerId: card.ownerId,
          cardId: card.id,
          status: status.nome,
        });
        this.event(
          "notice",
          card,
          (status.origin ?? "Efeito programado") +
            ": " +
            card.nome +
            " recebeu " +
            status.nome +
            " por " +
            status.turnosRestantes +
            " rodada(s).",
        );
      }
    }
    this.beginTurn();
  }
  private executeOnce(user: string, raw: unknown) {
    this.player(user);
    const cmd = commandSchema.parse(raw),
      key = `${user}:${cmd.actionId}`;
    if (this.processed.has(key))
      return { duplicate: true, version: this.processed.get(key)! };
    if (this.state.status !== "ACTIVE") this.fail("Esta partida já terminou.");
    if (cmd.version !== this.state.version)
      throw new AppError(409, "Estado mudou. Tente novamente.", "STALE_STATE");
    if (
      (this.state.pendingSpell || this.state.pendingAttack) &&
      ![
        this.state.pendingSpell ? "respondSpell" : "respondAttack",
        "surrender",
      ].includes(cmd.type)
    )
      this.fail("Aguarde a resposta à ação pendente.");
    if (
      this.state.pendingRevives?.length &&
      !this.state.pendingSpell &&
      !this.state.pendingAttack &&
      !["chooseRevive", "surrender"].includes(cmd.type)
    )
      this.fail("Aguarde a escolha da tropa a reviver.");
    if (
      !["surrender", "respondSpell", "respondAttack", "chooseRevive"].includes(
        cmd.type,
      ) &&
      this.state.phase === "BATTLE" &&
      this.state.current !== user
    )
      this.fail("Aguarde o seu turno.");
    if (
      this.state.phase === "PREPARATION" &&
      this.player(user).preparation.ready &&
      !["surrender", "preparationBonus"].includes(cmd.type)
    )
      this.fail("Você já confirmou a preparação. Aguarde o oponente.");
    if (
      this.state.phase === "BATTLE" &&
      this.state.turn === 1 &&
      !["play", "endTurn", "surrender"].includes(cmd.type)
    )
      this.fail(
        "No primeiro turno após a preparação, só é permitido mobilizar tropas.",
      );
    if (
      this.state.phase === "COIN_TOSS" &&
      !["chooseCoin", "surrender"].includes(cmd.type)
    )
      this.fail("Aguarde o sorteio de cara ou coroa.");
    const previous = this.state;
    this.state = structuredClone(previous);
    try {
      switch (cmd.type) {
        case "discardHand":
          this.discardHand(user, cmd.cardId);
          break;
        case "chooseCoin":
          this.chooseCoin(user, cmd.face);
          break;
        case "chooseRevive":
          this.chooseRevive(user, cmd.cardId, cmd.destinationId);
          break;
        case "mount":
          this.mount(user, cmd.slotId, cmd.destinationId);
          break;
        case "dismount":
          this.dismount(user, cmd.slotId);
          break;
        case "respondAttack":
          this.respondAttack(user, cmd.reflect);
          break;
        case "respondSpell":
          this.respondSpell(user, cmd.cardId);
          break;
        case "play":
          this.play(user, cmd);
          break;
        case "attack":
          this.attack(user, cmd);
          break;
        case "ability":
          this.ability(user, cmd);
          break;
        case "move": {
          const from = this.ownSlot(cmd.slotId, user),
            to = this.ownSlot(cmd.destinationId, user);
          if (
            this.state.phase !== "PREPARATION" &&
            (!from.card ||
              !this.has(from.card, "Campo livre") ||
              from.card.moved)
          )
            this.fail("Campo livre permite um movimento por turno.");
          if (this.state.phase !== "PREPARATION" && to.card)
            this.fail("Escolha um slot livre para mover a tropa.");
          if (from.kind !== "Tropa" || to.kind !== "Tropa")
            this.fail("Reposicione somente tropas.");
          if (
            !from.card ||
            [from.card, to.card].some(
              (c) =>
                c &&
                hasStatus(c.statuses, ["Congelado", "Incapacitado", "Cego"]),
            )
          )
            this.fail("Estas tropas não podem se mover.");
          if (to.terrain || (to.card && from.terrain))
            this.fail("Nenhuma tropa pode se mover para um pântano.");
          this.relocateTroops(from, to);
          break;
        }
        case "endTurn":
          this.endTurn(user);
          break;
        case "mulligan":
          this.mulligan(user);
          break;
        case "sacrifice":
          this.sacrifice(user, cmd.slotId, cmd.source);
          break;
        case "preparationBonus":
          this.preparationBonus(user, cmd.accept);
          this.tryStartBattle();
          break;
        case "surrender":
          this.finish(this.opponent(user).id, "Desistência.");
          break;
      }
      if (
        this.state.phase === "PREPARATION" &&
        ["play", "move", "ability"].includes(cmd.type)
      )
        this.player(user).preparation.started = true;
      this.resolve();
      this.notifyContinuousPassives(previous);
      if (
        (previous.phase === "PREPARATION" || previous.turn <= 2) &&
        ["play", "ability", "move"].includes(cmd.type)
      ) {
        const after = new Map(
          this.state.slots
            .flatMap(slotCards)
            .concat(
              this.state.players.flatMap((p) => [
                ...p.hand,
                ...p.deck,
                ...p.graveyard,
                ...p.banished,
                ...p.forgotten,
              ]),
            )
            .filter((c): c is Instance => c !== null)
            .map((c) => [c.id, c]),
        );
        const abilitySlot =
          cmd.type === "ability"
            ? previous.slots.find((s) => s.id === cmd.slotId)
            : undefined;
        const payingCard =
          cmd.type === "ability"
            ? cmd.source === "rider"
              ? abilitySlot?.rider
              : cmd.source === "structure"
                ? abilitySlot?.structure
                : abilitySlot?.card
            : undefined;
        const lifeCost =
          cmd.type === "ability"
            ? (payingCard?.habilidadesAtivas.find((h) => h.id === cmd.abilityId)
                ?.custoVida ?? 0)
            : 0;
        if (
          previous.slots
            .flatMap(slotCards)
            .some(
              (c) =>
                c &&
                (after.get(c.id)?.hpAtual ?? 0) <
                  c.hpAtual - (c.id === payingCard?.id ? lifeCost : 0),
            )
        )
          this.fail("Nenhuma ação pode causar dano durante a preparação.");
      }
      if (cmd.type !== "chooseCoin") this.player(user).inactivityStreak = 0;
      if (!["endTurn", "surrender", "chooseCoin"].includes(cmd.type))
        this.player(user).turnActions++;
      this.state.version++;
      this.processed.set(key, this.state.version);
      if (this.processed.size > 1000)
        this.processed.delete(this.processed.keys().next().value!);
      return { duplicate: false, version: this.state.version };
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }
  snapshot(user: string) {
    this.player(user);
    return this.snapshotFor(user);
  }
  spectatorSnapshot() {
    return this.snapshotFor();
  }
  private snapshotFor(user?: string) {
    return structuredClone({
      id: this.id,
      openingBlocked: this.openingBlocked(),
      damageOpeningBlocked:
        this.state.phase === "PREPARATION" || this.state.turn <= 2,
      equipmentFreeTargets: user
        ? this.state.slots
            .filter(
              (s) =>
                !this.equipmentPlacementError(user, s) &&
                this.equipmentGrant(user, s),
            )
            .map((s) => s.id)
        : [],
      equipmentTargets: user
        ? this.state.slots
            .filter((s) => !this.equipmentPlacementError(user, s))
            .map((s) => s.id)
        : [],
      events: this.state.events ?? [],
      reactions: reactionDescriptions,
      ongoingSpells: this.state.ongoingSpells,
      fieldEffects: this.state.fieldEffects,
      pendingImpact: this.state.pendingImpact?.request,
      pendingHandChoice: this.state.pendingHandChoice,
      pendingRevive:
        !this.state.pendingSpell &&
        !this.state.pendingAttack &&
        !this.state.pendingImpact &&
        !this.state.pendingHandChoice
          ? this.state.pendingRevives?.[0]
          : undefined,
      reviveDestinations: this.state.pendingRevives?.length
        ? reviveDestinations(
            this.state.slots,
            this.state.pendingRevives[0].ownerId,
          ).map((s) => s.id)
        : [],
      pendingSpell: this.state.pendingSpell,
      pendingAttack: this.state.pendingAttack,
      canRespond:
        !!user &&
        !!this.state.pendingSpell &&
        this.state.pendingSpell.casterId !== user &&
        this.canRespondWithWater(user),
      responseCards:
        user &&
        this.state.pendingSpell &&
        this.state.pendingSpell.casterId !== user
          ? this.player(user)
              .hand.filter((c) =>
                this.waterReactionAllowed(this.player(user), c),
              )
              .map((c) => c.id)
          : [],
      version: this.state.version,
      turn: this.state.turn,
      round: this.state.round,
      phase: this.state.phase,
      coinToss: this.state.coinToss,
      current: this.state.current,
      status: this.state.status,
      winner: this.state.winner,
      reason: this.state.reason,
      slots: this.state.slots.map((slot) => ({
        ...slot,
        structure: slot.structure
          ? {
              ...this.fieldView(slot.structure),
              manaRecovery: this.manaRecovery(slot.structure),
              manaAttachments: this.manaAttachments(slot.structure),
              bonusAtaquePassivo:
                fieldAttackBonus(slot.structure) +
                slot.structure.statuses
                  .filter(
                    (s) => s.nome === "BonusAtaque" && s.turnosRestantes > 0,
                  )
                  .reduce((n, s) => n + (s.valor ?? 0), 0),
            }
          : null,
        rider: slot.rider
          ? {
              ...this.fieldView(slot.rider),
              manaRecovery: this.manaRecovery(slot.rider),
              manaAttachments: this.manaAttachments(slot.rider),
              limiteAtaques: basicAttackLimit(slot.rider, this.state.slots),
              bonusAtaquePassivo:
                adjacentAttackBonus(slot.rider, this.state.slots) +
                fieldAttackBonus(slot.rider) +
                slot.rider.statuses
                  .filter(
                    (s) => s.nome === "BonusAtaque" && s.turnosRestantes > 0,
                  )
                  .reduce((n, s) => n + (s.valor ?? 0), 0),
            }
          : null,
        card:
          slot.card?.concealedTrap && slot.ownerId !== user
            ? hiddenFieldCard(
                slot,
                this.player(slot.ownerId).deckAppearance.verso,
              )
            : slot.card
              ? {
                  ...this.fieldView(slot.card),
                  manaRecovery: this.manaRecovery(slot.card),
                  manaAttachments: this.manaAttachments(slot.card),
                  limiteAtaques: basicAttackLimit(slot.card, this.state.slots),
                  bonusAtaquePassivo:
                    adjacentAttackBonus(slot.card, this.state.slots) +
                    fieldAttackBonus(slot.card) +
                    slot.card.statuses
                      .filter(
                        (s) =>
                          s.nome === "BonusAtaque" && s.turnosRestantes > 0,
                      )
                      .reduce((sum, s) => sum + (s.valor ?? 0), 0),
                }
              : null,
        ...(slot.ownerId === user
          ? {
              attackTargets: {
                card: this.attackTargets(user, slot, slot.card),
                structure: this.attackTargets(user, slot, slot.structure),
                rider: this.attackTargets(user, slot, slot.rider ?? null),
              },
              abilityBlockReasons: {
                structure: this.abilityAttackBlockReasons(
                  user,
                  slot,
                  slot.structure,
                ),
                card: this.abilityAttackBlockReasons(user, slot, slot.card),
                rider: this.abilityAttackBlockReasons(user, slot, slot.rider),
              },
              attackBlockReasons: {
                card: this.attackBlockReasons(user, slot.card),
                structure: this.attackBlockReasons(user, slot.structure),
                rider: this.attackBlockReasons(user, slot.rider ?? null),
              },
              mountTargets:
                !slot.rider &&
                slot.card?.tipo === "Tropa" &&
                !this.mountActionError(user, slot, slot.card)
                  ? this.state.slots
                      .filter(
                        (s) =>
                          s !== slot &&
                          s.kind === "Tropa" &&
                          !s.terrain &&
                          !(slot.structure && s.structure) &&
                          canMount(s.card, slot.card!, !!s.rider),
                      )
                      .map((s) => s.id)
                  : [],
              canDismount:
                !!slot.rider &&
                !this.mountActionError(user, slot, slot.rider) &&
                !!this.dismountDestination(slot),
            }
          : {}),
      })),
      log: this.state.log,
      players: this.state.players.map((p) => ({
        id: p.id,
        nome: p.nome,
        deckAppearance: p.deckAppearance,
        mana: p.mana,
        mage: p.mage,
        counters: p.counters,
        preparation: p.preparation,
        combatStarted: p.combatStarted,
        inactivityStreak: p.inactivityStreak,
        deckCount: p.deck.length,
        handCount: p.hand.length,
        graveyard: p.graveyard,
        banished: p.banished,
        forgotten: p.forgotten,
        ...(user &&
        p.id !== user &&
        (this.player(user).revealHandUntilTurn !== undefined
          ? this.state.turn < this.player(user).revealHandUntilTurn!
          : this.player(user).revealHandRound === this.state.round)
          ? { revealedHand: p.hand.map((c) => modifiedSpell(c, p.mage)) }
          : {}),
        ...(p.id === user
          ? {
              hand: p.hand.map((c) => {
                const effective = modifiedSpell(c, p.mage);
                const reason = this.spellBlockReason(effective, p.id);
                return {
                  ...effective,
                  custoManaBase: c.custoMana,
                  ...(c.tipo === "Armamento" &&
                  this.state.slots.some(
                    (s) =>
                      !this.equipmentPlacementError(p.id, s) &&
                      this.equipmentGrant(p.id, s),
                  )
                    ? { custoMana: 0, equipamentoGratuito: true }
                    : {}),
                  canDiscard: this.canDiscard(c),
                  alvo: this.spellTarget(effective, p.id),
                  spellBlockedReason: reason,
                  handBlockedReason: this.openingCardBlockReason(c),
                  ...(c.alvoAutomatico && !reason
                    ? { automaticTargetId: this.spellSelection(c, p.id, [])[0] }
                    : {}),
                };
              }),
              deck: [...p.deck].sort((a, b) => a.nome.localeCompare(b.nome)),
            }
          : {}),
      })),
    });
  }
  private notifyContinuousPassives(previous: State) {
    for (const slot of this.state.slots) {
      for (const source of [slot.card, slot.rider, slot.structure].filter(
        (c): c is Instance => !!c,
      )) {
        const before = previous.slots
          .flatMap(slotCards)
          .find((c) => c.id === source.id);
        for (const rule of source.habilidadesPassivas.map(normalizePassive)) {
          if (
            rule.gatilho !== "continuous" ||
            !continuousPassiveActive(source, rule, this.state.slots)
          )
            continue;
          if (!before || !continuousPassiveActive(before, rule, previous.slots))
            this.event("passive", source, describePassiveActions(rule.efeitos));
        }
      }
    }
  }
}
