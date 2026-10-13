import { playableErrors } from "./capabilities";
import type { Instance, Slot, Player, State, DeckDefinition } from "./state";
import type { BattleEvent, BattleDamage } from "./state";
import { slotCards } from "./state";
import {
  adjacentAttackBonus,
  targetAttackBonus,
  blockedOwnAttack,
  canMount,
  attackInterceptor,
  restrictedBasicAttack,
  passiveMatches,
  matchesPassiveFilter,
  spellDamageBonus,
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
export class Game {
  public state: State;
  private deferMageDefeat = false;
  private processed = new Map<string, number>();
  private passiveDepth = 0;
  private passiveSteps = 0;
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
        counters: { summons: 0, attacks: 0, spells: 0, unique: 0 },
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
      current: players[this.rng() < 0.5 ? 0 : 1].id,
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
      const j = Math.floor(this.rng() * (i + 1));
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
  private has(card: Instance, word: string) {
    return (
      card.palavrasChave.includes(word) ||
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
    if (this.state.phase === "PREPARATION") {
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
    return this.state.phase === "PREPARATION" || this.state.turn <= 2;
  }
  private recoverMana(player: Player) {
    const mage = player.mage;
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
    player.mana = Math.min(
      20,
      player.mana +
        recovery +
        this.state.slots
          .filter((s) => s.ownerId === player.id)
          .flatMap(slotCards)
          .reduce(
            (sum, c) =>
              sum + (c && c.tipo !== "Mago" ? (c.manaGerada ?? 0) : 0),
            0,
          ),
    );
  }
  private causesDamage(effects: Effect[] = [], abilityId?: string) {
    return (
      ["ataqueFurtivo", "ordemDaEspada"].includes(abilityId ?? "") ||
      effects.some(
        (e) =>
          [
            "damage",
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
  private weapons(slot: Slot) {
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
  ): void {
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
    if (target.hpAtual <= 0) return;
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
      ? this.weapons(slot).reduce((n, w) => n + (w.bonusHp ?? 0), 0)
      : 0;
    const previous = card.hpAtual;
    card.hpAtual = Math.max(
      card.hpAtual,
      Math.min((card.hp ?? 0) + (excess ?? bonus), card.hpAtual + value),
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
  private weaponBeneficiaries(weaponSlot: Slot) {
    if (weaponSlot.id.includes(":arm:back-"))
      return this.state.slots.filter(
        (s) => s.ownerId === weaponSlot.ownerId && s.kind === "Mago",
      );
    return this.front(weaponSlot.ownerId).filter(
      (s) => s.column === weaponSlot.column,
    );
  }
  private resetCard(card: Instance) {
    card.hpAtual = card.hp ?? 0;
    card.statuses = [];
    card.attacked = false;
    card.usedAbility = false;
    card.moved = false;
    delete card.appliedElement;
    delete card.revivedFromGraveyard;
    delete card.killedBy;
  }
  private event(
    kind: string,
    card: Pick<Instance, "id" | "nome" | "imgURL" | "ownerId">,
    message?: string,
    details?: Pick<
      BattleEvent,
      "slotId" | "reaction" | "damage" | "originOwnerId" | "summary"
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
          const killedBy = dead.killedBy;
          this.event("death", dead);
          if (slot.rider?.id === dead.id) slot.rider = null;
          else {
            slot.card = slot.rider ?? null;
            slot.rider = null;
          }
          player.graveyard.push(dead);
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
    if (guard >= 100) this.fail("Ciclo de efeitos excedeu o limite.");
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
      if (hasStatus(source.statuses, ["Cego"]) && this.rng() < 0.5) {
        this.log(`${source.nome} errou a retaliação por cegueira.`);
        return true;
      }
      this.completeAttack(
        source,
        target,
        this.basicAttackDamage(source, defender),
        source.elemento,
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
        player.mana = Math.min(20, player.mana + action.valor);
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
  private relocateTroops(from: Slot, to: Slot) {
    const before = this.weapons(from).reduce((n, w) => n + (w.bonusHp ?? 0), 0);
    const after = this.weapons(to).reduce((n, w) => n + (w.bonusHp ?? 0), 0);
    if (from.card) from.card.hpAtual += after - before;
    if (from.rider) from.rider.hpAtual += after - before;
    if (to.card) to.card.hpAtual += before - after;
    if (to.rider) to.rider.hpAtual += before - after;
    [from.card, to.card] = [to.card, from.card];
    [from.structure, to.structure] = [to.structure, from.structure];
    [from.rider, to.rider] = [to.rider, from.rider];
    if (to.card) to.card.moved = true;
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
    this.player(user).counters.attacks++;
    this.player(user).combatStarted = true;
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
    ids: string[],
    element?: Card["elemento"],
    source?: Instance,
    cause?: string,
  ) {
    const player = this.player(ownerId);
    for (const effect of effects) {
      switch (effect.id) {
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
          for (const id of ids)
            this.damage(
              id,
              effect.valor!,
              undefined,
              false,
              effect.elemento ?? element,
              source,
              cause,
            );
          break;
        case "heal":
          for (const id of ids) {
            const card = this.findCard(id) ?? this.targetSlot(id)?.card;
            if (!card) this.fail("Não é possível curar este alvo.");
            this.heal(card, effect.valor!, undefined, source ?? player.mage);
          }
          break;
        case "status":
          for (const id of ids) {
            const card = this.findCard(id) ?? this.targetSlot(id)?.card;
            if (!card) this.fail("Status exige uma carta.");
            const applied = applyStatus(
              card.statuses,
              effect.status!,
              effect.duracao!,
              effect.status === "Escudo" ? (effect.valor ?? 3) : effect.valor,
              this.state.turn,
              effect.unidade,
            );
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
          player.mana = Math.min(20, player.mana + effect.valor!);
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
      if (card.tipo === "Mago")
        this.fail("Remoção definitiva não pode remover o mago.");
      if (slot.structure?.id === card.id) slot.structure = null;
      else if (slot.rider?.id === card.id) slot.rider = null;
      else {
        if (card.tipo === "Armamento")
          for (const beneficiary of this.weaponBeneficiaries(slot))
            for (const troop of [beneficiary.card, beneficiary.rider])
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
          slot.terrain = { nome: "Lama", rodadasRestantes: 2 };
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
        this.player(ownerId).mana = Math.min(20, this.player(ownerId).mana + 2);
        break;
      case "Florescer":
        if (!card) break;
        if (card.subtipo === "Planta") {
          card.hp = (card.hp ?? 0) + 1;
          card.hpAtual++;
        } else {
          applyStatus(card.statuses, "Envenenado", 3).originOwnerId = ownerId;
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
      card = player.hand[index];
    if (!card) this.fail("Carta não está na sua mão.");
    const limits = player.mage.limites[0];
    if (card.tipo === "Feitico") {
      if (hasStatus(player.mage.statuses, ["Cego"]))
        this.fail("Um mago Cego não pode conjurar feitiços.");
      if (
        this.openingBlocked() &&
        this.causesDamage(card.efeitos) &&
        !(
          card.efeitos.every((e) => e.id === "lightOrb") &&
          player.mage.elemento !== "Fogo"
        )
      )
        this.fail(
          "Feitiços que causam dano são bloqueados na preparação e no primeiro turno de cada jogador.",
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
      player.hand.splice(index, 1);
      player.graveyard.push(card);
      (player.castCards ??= []).push(card.numeroCatalogo);
      player.castCards = [...new Set(player.castCards)];
      this.event("spell", card);
      if (card.assinatura) player.counters.unique++;
      else player.counters.spells++;
      this.trigger("onSpellCast", {
        ownerId: user,
        element: card.elemento,
        cardId: card.id,
      });
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
        this.state.pendingSpell = { casterId: user, card, targets: ids, bonus };
        this.log(
          `${player.nome} conjurou ${card.nome}. Aguardando resposta com Jato d'água.`,
        );
        return;
      }
      this.resolveSpell(user, card, ids, bonus);
    } else {
      if (!cmd.slotId) this.fail("Selecione um slot.");
      const slot = this.ownSlot(cmd.slotId, user);
      if (card.tipo === "Mago") this.fail("O mago já está em campo.");
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
          : card.custoMana,
      );
      player.hand.splice(index, 1);
      this.event("summon", card);
      if (card.tipo === "Estrutura") slot.structure = card;
      else if (card.tipo === "Tropa" && slot.card) slot.rider = card;
      else slot.card = card;
      if (card.tipo === "Tropa") {
        card.hpAtual += this.weapons(slot).reduce(
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
        for (const beneficiary of this.weaponBeneficiaries(slot))
          for (const troop of [beneficiary.card, beneficiary.rider])
            if (troop) troop.hpAtual += card.bonusHp ?? 0;
        this.trigger("onEquip", { ownerId: user, cardId: card.id });
      }
    }
    if (card.tipo !== "Feitico") this.zarcosPlayed(user, card);
    this.log(`${player.nome} jogou ${card.nome}.`);
  }
  canRespondWithWater(user: string) {
    const p = this.player(user);
    return (
      !hasStatus(p.mage.statuses, ["Cego"]) &&
      p.counters.spells < p.mage.limites[0].feiticosUsados &&
      p.hand.some(
        (c) =>
          c.numeroCatalogo === "002" && !c.assinatura && p.mana >= c.custoMana,
      )
    );
  }
  private resolveSpell(
    user: string,
    card: Instance,
    ids: string[],
    bonus: number,
  ) {
    if (!this.specialSpell(user, card, ids, bonus)) {
      if (card.elemento) this.react(user, ids, card.elemento);
      this.effects(
        user,
        card.efeitos.map((e) =>
          e.id === "damage" ? { ...e, valor: (e.valor ?? 0) + bonus } : e,
        ),
        ids,
        card.elemento,
        card,
        `${card.nome} (${this.player(user).nome})`,
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
  private spellBlockReason(card: Instance, user: string) {
    if (
      card.efeitos?.some((e) =>
        this.state.ongoingSpells?.some(
          (s) => s.ownerId === user && s.kind === e.id && s.rounds > 0,
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
    if (card.elemento !== "Zarcos") return;
    const player = this.player(user),
      watchers = player.zarcosWatchers ?? [];
    player.zarcosWatchers = watchers.filter((w) => w.cardId === card.id);
    for (const watcher of watchers.filter((w) => w.cardId !== card.id)) {
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
          damage,
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
        rounds: 2,
        damage,
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
    ) => {
      for (const id of targets) {
        const s = this.targetSlot(id),
          target = this.findCard(id) ?? s?.card;
        if (target) {
          applyStatus(
            target.statuses,
            name,
            duration,
            value,
            this.state.turn,
          ).originOwnerId = user;
          this.trigger("onStatusApplied", {
            ownerId: target.ownerId,
            cardId: target.id,
            status: canonicalStatus(name),
          });
        }
      }
    };
    switch (effect.id) {
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
          hit([target ?? enemy.mage.id], 1);
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
        if (slot.structure) {
          slot.structure.hpAtual = 0;
          this.resolve();
        }
        const troop = this.findCard(ids[0]) ?? slot.card;
        if (troop) {
          if (slot.rider?.id === troop.id) slot.rider = null;
          else {
            slot.card = slot.rider ?? null;
            slot.rider = null;
          }
          this.resetCard(troop);
          enemy.hand.push(troop);
        }
        ongoing("tornado", 3);
        break;
      }
      case "arrowRain":
        ongoing("arrowRain", mageElement === "Fogo" ? 5 : 3);
        if (mageElement === "Agua")
          status(this.enemyTargets(user), "Congelado", 2);
        if (mageElement === "Ar")
          status(this.enemyTargets(user, true), "Sangrando", 3);
        if (mageElement === "Terra")
          status(this.enemyTargets(user, true), "Cego", 2);
        break;
      case "protectionShield":
        status(ids, "EscudoProtecao", 2, 3);
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
        hit(targets, mageElement === "Terra" ? 6 : 4);
        status(
          this.enemyTargets(user),
          mageElement === "Terra" ? "Atordoado" : "Incapacitado",
          2,
        );
        break;
      }
      case "lightOrb":
        if (card.elemento) this.react(user, ids, card.elemento);
        if (mageElement === "Fogo")
          for (const id of ids)
            this.damage(
              id,
              3 + bonus,
              undefined,
              false,
              card.elemento,
              undefined,
              card.nome,
            );
        status(ids, "Cego", 2);
        break;
      case "sandstorm":
        if (card.elemento) this.react(user, ids, card.elemento);
        status(ids, "Cego", 2);
        ongoing("sandstorm", 2);
        if (mageElement === "Ar") {
          const stolen = enemy.deck.pop();
          if (stolen) {
            stolen.ownerId = user;
            player.hand.push(stolen);
          }
        }
        break;
      case "meteors":
        if (ids.some((id) => this.targetSlot(id)?.card?.tipo !== "Tropa"))
          this.fail("Chuva de Meteoros atinge somente tropas.");
        hit(ids, 2);
        break;
      case "zarcosTear":
        player.mana = Math.min(20, player.mana + 3);
        if (!player.zarcosTriggered?.includes(card.id))
          (player.zarcosWatchers ??= []).push({
            cardId: card.id,
            kind: "tear",
          });
        break;
      case "strongFlow":
        this.draw(player, 3);
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
        const targets =
          spell.kind === "tornado"
            ? [this.opponent(spell.ownerId).mage.id]
            : this.enemyTargets(spell.ownerId, true);
        if (spell.element) this.react(spell.ownerId, targets, spell.element);
        const name =
          spell.card?.nome ??
          (spell.kind === "tornado"
            ? "Furacão"
            : spell.kind === "arrowRain"
              ? "Chuva de Flechas"
              : "Furacão de Areia");
        for (const id of targets)
          this.damage(
            id,
            spell.damage,
            undefined,
            false,
            spell.element,
            undefined,
            `${name} (${this.player(spell.ownerId).nome}, fim da rodada)`,
            spell.ownerId,
          );
        spell.rounds--;
        this.log(`${name} causou dano no fim da rodada.`);
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
    const pending = this.state.pendingSpell;
    if (!pending || this.state.status !== "ACTIVE") return;
    delete this.state.pendingSpell;
    this.resolveSpell(
      pending.casterId,
      pending.card,
      pending.targets,
      pending.bonus,
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
    if (
      !card ||
      card.numeroCatalogo !== "002" ||
      card.assinatura ||
      !this.canRespondWithWater(user)
    )
      this.fail("Jato d'água não está disponível para responder.");
    this.spend(player, card.custoMana);
    player.hand.splice(player.hand.indexOf(card), 1);
    player.graveyard.push(card);
    player.counters.spells++;
    player.castCards = [
      ...new Set([...(player.castCards ?? []), card.numeroCatalogo]),
    ];
    delete this.state.pendingSpell;
    this.trigger("onSpellCast", {
      ownerId: user,
      element: card.elemento,
      cardId: card.id,
    });
    this.log(`${player.nome} cancelou ${pending.card.nome} com Jato d'água.`);
  }
  private attackSourceError(user: string, slot: Slot, card: Instance | null) {
    const p = this.player(user);
    if (!card || !["Tropa", "Mago", "Estrutura"].includes(card.tipo))
      return "Selecione uma tropa, mago ou estrutura.";
    if (blockedOwnAttack(card, this.state.slots))
      return "A passiva desta carta exige uma carta aliada em campo para atacar.";
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
          "Cego",
          "Congelado",
        ]))
    )
      return "A tropa protegida não pode atacar com a estrutura neste estado.";
    if (
      card.attacked ||
      (card.tipo !== "Mago" &&
        p.counters.attacks >= p.mage.limites[0].tropaAtacam)
    )
      return "Limite de ataque atingido.";
    if (
      card.statuses.some((s) =>
        [
          "Incapacitado",
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
          (!exposed || guarded || target.kind === "Mago") &&
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
        "Ataques bloqueados na preparação e no primeiro turno de cada jogador.",
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
    const announcedDefender = this.basicAttackDefender(target);
    this.event(
      "attack",
      card,
      `Ataque: ${card.nome} (${p.nome}) atacou ${announcedDefender.nome} (${this.player(announcedDefender.ownerId).nome}).${interception}`,
    );
    card.attacked = true;
    p.combatStarted = true;
    if (card.tipo !== "Mago") p.counters.attacks++;
    card.palavrasChave = card.palavrasChave.filter((k) => k !== "Esconder");
    card.statuses = card.statuses.filter((s) => s.nome !== "Esconder");
    card.statuses = card.statuses.filter(
      (s) => !s.requerStatus || this.has(card, s.requerStatus),
    );
    if (this.has(card, "Cegueira") || this.has(card, "Cego")) {
      if (this.rng() < 0.5) {
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
        return;
      }
    }
    const defender = this.basicAttackDefender(target);
    const bonusOnTarget = targetAttackBonus(card, defender, this.state.slots);
    if (bonusOnTarget)
      this.log(
        `${card.nome} ganhou +${bonusOnTarget} neste ataque contra ${defender.nome} pela vida do alvo.`,
      );
    const damage = this.basicAttackDamage(card, defender);
    if (this.canReflectAttack(defender, card)) {
      this.state.pendingAttack = {
        attackerOwnerId: user,
        attackerId: card.id,
        targetSlotId: target.id,
        defenderId: defender.id,
        damage,
        element: card.elemento,
        interception: interceptionProtection,
      };
      this.log(`${defender.nome} pode devolver o ataque de ${card.nome}.`);
      return;
    }
    this.completeAttack(
      card,
      target,
      damage,
      card.elemento,
      false,
      undefined,
      interceptionProtection,
    );
  }
  private basicAttackDamage(card: Instance, defender: Instance) {
    const slot = this.targetSlot(card.id)!;
    return (
      (card.ataque ?? 0) +
      card.statuses
        .filter((s) => s.nome === "BonusAtaque" && s.turnosRestantes > 0)
        .reduce((sum, s) => sum + (s.valor ?? 0), 0) +
      adjacentAttackBonus(card, this.state.slots) +
      targetAttackBonus(card, defender, this.state.slots) +
      (card.tipo === "Estrutura"
        ? 0
        : this.weapons(slot).reduce((sum, c) => sum + (c.bonusAtaque ?? 0), 0))
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
  }
  resolvePendingAttack(reflect = false) {
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
    const ability = card.habilidadesAtivas.find((h) => h.id === cmd.abilityId);
    if (!ability) this.fail("Esta carta não possui a habilidade.");
    if (this.openingBlocked())
      this.fail(
        "Habilidades bloqueadas na preparação e no primeiro turno de cada jogador.",
      );
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
      if (ability.filtroAlvo) {
        const matches = (id: string) =>
          matchesPassiveFilter(this.findCard(id)!, ability.filtroAlvo);
        if (
          ["TodosAliados", "TodasTropasInimigas"].includes(ability.alvo ?? "")
        )
          targets = targets.filter(matches);
        else if (targets.some((id) => !matches(id)))
          this.fail("O alvo não corresponde ao filtro desta habilidade.");
      }
      this.spend(p, ability.custoMana);
      this.effects(
        user,
        ability.efeitos,
        targets,
        card.elemento,
        card,
        `${ability.nome} de ${card.nome}`,
      );
    } else {
      switch (ability.id) {
        case "refazerCaminhos": {
          this.validateTargets(user, "Cemiterio", cmd.targets);
          const index = p.graveyard.findIndex(
            (c) => c.id === cmd.targets[0] && c.tipo === "Feitico",
          );
          if (index < 0) this.fail("Escolha um feitiço do seu cemitério.");
          this.spend(p, ability.custoMana);
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
          this.spend(p, ability.custoMana);
          this.damage(
            target.id,
            3,
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
          this.spend(p, ability.custoMana);
          const discarded = p.hand.splice(i, 1)[0];
          p.graveyard.push(discarded);
          p.mana = Math.min(20, p.mana + 3);
          this.log(
            `${card.nome} sacrificou ${discarded.nome} da mão e recuperou 3 mana.`,
          );
          break;
        }
        case "protecaoAquatica": {
          const ids = this.validateTargets(user, "UnicoAliado", cmd.targets);
          const target = this.findCard(ids[0]) ?? this.targetSlot(ids[0])?.card;
          if (!target || !cmd.mode) this.fail("Escolha alvo aliado e modo.");
          this.spend(p, ability.custoMana);
          if (cmd.mode === "cura") this.heal(target, 3, undefined, card);
          else
            target.statuses.push({
              nome: "Escudo",
              valor: 3,
              turnosRestantes: 2,
            });
          break;
        }
        case "enganarAMorte": {
          const cards = p.graveyard.filter((c) => c.tipo === "Tropa").slice(-3);
          if (!cards.length) this.fail("Não há tropas no cemitério.");
          this.spend(p, ability.custoMana);
          for (const c of cards) this.resetCard(c);
          p.graveyard = p.graveyard.filter((c) => !cards.includes(c));
          p.deck.push(...cards);
          this.shuffle(p.deck);
          break;
        }
        case "ressurreicaoSombria": {
          this.validateTargets(user, "Cemiterio", cmd.targets);
          const i = p.graveyard.findIndex(
            (c) => c.id === cmd.targets[0] && c.tipo === "Tropa",
          );
          if (i < 0) this.fail("Escolha uma tropa do cemitério.");
          this.spend(p, ability.custoMana);
          const c = p.graveyard.splice(i, 1)[0];
          this.resetCard(c);
          c.custoMana = 0;
          c.revivedFromGraveyard = true;
          p.hand.push(c);
          break;
        }
        case "ataqueFurtivo":
          this.spend(p, ability.custoMana);
          this.damage(
            this.opponent(user).mage.id,
            2,
            undefined,
            false,
            undefined,
            undefined,
            `${ability.nome} de ${card.nome}`,
            user,
          );
          break;
        case "ordemDaEspada":
          this.spend(p, ability.custoMana);
          for (const s of this.state.slots.filter(
            (s) =>
              s.ownerId === this.opponent(user).id && s.card?.tipo === "Tropa",
          ))
            this.damage(
              s.id,
              3,
              undefined,
              false,
              undefined,
              card,
              `${ability.nome} de ${card.nome}`,
            );
          break;
        case "armaduraPoderosa":
          this.spend(p, ability.custoMana);
          card.attacked = true;
          card.statuses.push(
            { nome: "Guardar", turnosRestantes: 2 },
            { nome: "armaduraPoderosa", turnosRestantes: 2 },
          );
          break;
        default:
          this.fail("Habilidade ainda não implementada.");
      }
    }
    card.usedAbility = true;
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
        .filter((h) => h.efeitos?.some((e) => e.id === "spendAttack"))
        .map((h) => [
          h.id,
          this.attackSourceError(user, slot, card ?? null) ?? "",
        ]),
    );
  }
  private beginTurn() {
    const p = this.player(this.state.current);
    p.combatStarted = false;
    p.turnActions = 0;
    p.counters = { summons: 0, attacks: 0, spells: 0, unique: 0 };
    for (const c of this.state.slots
      .filter((s) => s.ownerId === p.id)
      .flatMap(slotCards))
      if (c) {
        c.attacked = false;
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
    if (this.openingBlocked())
      this.fail(
        "Sacrifício bloqueado na preparação e no primeiro turno de combate.",
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
    if (roundEnded) {
      this.tickOngoingSpells();
      for (const player of this.state.players) {
        player.roundSpells = [];
        player.comboTriggered = false;
        player.zarcosWatchers = [];
        player.zarcosTriggered = [];
      }
    }
    if (roundEnded)
      for (const slot of this.state.slots)
        if (slot.terrain && --slot.terrain.rodadasRestantes <= 0)
          delete slot.terrain;
    for (const card of this.state.slots
      .flatMap(slotCards)
      .filter((c): c is Instance => c !== null)) {
      if (roundEnded) {
        tickRound(card.statuses, (status, value) => {
          if (card.hpAtual <= 0) return;
          const before = card.hpAtual;
          card.hpAtual -= value;
          this.reportDamage(
            card,
            value,
            `${status.nome} (fim da rodada)`,
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
        });
      }
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
    this.beginTurn();
  }
  execute(user: string, raw: unknown) {
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
      !["surrender", "respondSpell", "respondAttack"].includes(cmd.type) &&
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
    const previous = this.state;
    this.state = structuredClone(previous);
    try {
      switch (cmd.type) {
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
        if (
          previous.slots
            .flatMap(slotCards)
            .some((c) => c && (after.get(c.id)?.hpAtual ?? 0) < c.hpAtual)
        )
          this.fail("Nenhuma ação pode causar dano durante a preparação.");
      }
      this.player(user).inactivityStreak = 0;
      if (!["endTurn", "surrender"].includes(cmd.type))
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
    return structuredClone({
      id: this.id,
      openingBlocked: this.openingBlocked(),
      events: this.state.events ?? [],
      reactions: reactionDescriptions,
      ongoingSpells: this.state.ongoingSpells,
      pendingSpell: this.state.pendingSpell,
      pendingAttack: this.state.pendingAttack,
      canRespond:
        !!this.state.pendingSpell &&
        this.state.pendingSpell.casterId !== user &&
        this.canRespondWithWater(user),
      version: this.state.version,
      turn: this.state.turn,
      round: this.state.round,
      phase: this.state.phase,
      current: this.state.current,
      status: this.state.status,
      winner: this.state.winner,
      reason: this.state.reason,
      slots: this.state.slots.map((slot) => ({
        ...slot,
        rider: slot.rider
          ? {
              ...slot.rider,
              bonusAtaquePassivo:
                adjacentAttackBonus(slot.rider, this.state.slots) +
                slot.rider.statuses
                  .filter(
                    (s) => s.nome === "BonusAtaque" && s.turnosRestantes > 0,
                  )
                  .reduce((n, s) => n + (s.valor ?? 0), 0),
            }
          : null,
        card: slot.card
          ? {
              ...slot.card,
              bonusAtaquePassivo:
                adjacentAttackBonus(slot.card, this.state.slots) +
                slot.card.statuses
                  .filter(
                    (s) => s.nome === "BonusAtaque" && s.turnosRestantes > 0,
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
        ...(p.id === user
          ? {
              hand: p.hand.map((c) => {
                const reason = this.spellBlockReason(c, p.id);
                return {
                  ...c,
                  alvo: this.spellTarget(c, p.id),
                  spellBlockedReason: reason,
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
      for (const source of [slot.card, slot.rider].filter(
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
