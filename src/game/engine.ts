import { playableErrors } from "./capabilities";
import type { Instance, Slot, Player, State, DeckDefinition } from "./state";
import { adjacentAttackBonus, restrictedBasicAttack } from "./passives";
import { randomUUID } from "node:crypto";
import { Card, Effect, TipoAlvoFeitico } from "../types/card";
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
  private processed = new Map<string, number>();
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
      for (const card of [slot.card, slot.structure])
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
      this.state.slots
        .flatMap((s) => [s.card, s.structure])
        .find((c) => c?.id === id) ?? null
    );
  }
  private targetSlot(id: string) {
    return this.state.slots.find(
      (s) => s.id === id || s.card?.id === id || s.structure?.id === id,
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
    this.state.log = this.state.log.slice(-30);
  }
  private spend(player: Player, cost: number) {
    if (player.mana < cost) this.fail("Mana insuficiente.");
    player.mana -= cost;
  }
  private finish(winner: string | null, reason: string) {
    if (this.state.status === "FINISHED") return;
    this.state.status = "FINISHED";
    delete this.state.pendingSpell;
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
    player.mana = Math.min(
      20,
      player.mana +
        (player.mage.recuperacaoMana ?? 0) +
        this.state.slots
          .filter((s) => s.ownerId === player.id)
          .flatMap((s) => [s.card, s.structure])
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
  ) {
    const slot = this.targetSlot(id);
    if (!slot) this.fail("Alvo não encontrado.");
    // A estrutura absorve o golpe inteiro, inclusive o excedente.
    // Sem tropa vinculada, ela não protege o mago.
    const bypassFrozen =
      !!attacker &&
      id === slot.id &&
      slot.card?.tipo === "Tropa" &&
      hasStatus(slot.card.statuses, ["Congelado"]);
    const protectedByStructure =
      slot.structure &&
      slot.card?.tipo === "Tropa" &&
      id !== slot.structure.id &&
      !bypassFrozen &&
      !hasStatus(slot.structure!.statuses, ["Abalo"]) &&
      !piercing;
    const target =
      id === slot.structure?.id
        ? slot.structure
        : protectedByStructure
          ? slot.structure!
          : bypassFrozen
            ? this.player(slot.ownerId).mage
            : (slot.card ?? this.player(slot.ownerId).mage);
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
      return;
    }
    if (element && target.fraqueza.includes(element)) remaining *= 2;
    if (
      element &&
      target.resistencia.includes(element) &&
      !this.has(target, "Vapor")
    )
      remaining = Math.floor(remaining / 2);
    if (this.has(target, "armaduraPoderosa"))
      remaining = Math.max(0, remaining - 2);
    const shield = target.statuses.find(
      (s) => s.nome === "Escudo" && (s.valor ?? 0) > 0,
    );
    if (shield) {
      const absorbed = Math.min(remaining, shield.valor!);
      shield.valor! -= absorbed;
      remaining -= absorbed;
    }
    const excess =
      ((attacker && this.has(attacker, "Sobrepujar")) ||
        this.has(target, "Explosão")) &&
      target.tipo === "Tropa"
        ? Math.max(0, remaining - target.hpAtual)
        : 0;
    target.hpAtual -= remaining;
    if (remaining)
      this.trigger("onDamageTaken", {
        cardId: target.id,
        ownerId: target.ownerId,
      });
    if (excess) this.player(target.ownerId).mage.hpAtual -= excess;
  }
  private heal(card: Instance, value: number) {
    if (card.hp === undefined)
      this.fail("Este alvo não possui vida para curar.");
    const slot = this.state.slots.find((s) => s.card?.id === card.id);
    const bonus = slot
      ? this.weapons(slot).reduce((n, w) => n + (w.bonusHp ?? 0), 0)
      : 0;
    card.hpAtual = Math.max(
      card.hpAtual,
      Math.min((card.hp ?? 0) + bonus, card.hpAtual + value),
    );
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
  }
  private event(kind: string, card: Instance) {
    this.state.eventSequence = (this.state.eventSequence ?? 0) + 1;
    (this.state.events ??= []).push({
      sequence: this.state.eventSequence,
      kind,
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
          this.event("death", slot.structure);
          player.graveyard.push(slot.structure);
          slot.structure = null;
          changed = true;
        }
        if (slot.card?.tipo === "Tropa" && slot.card.hpAtual <= 0) {
          const dead = slot.card;
          this.event("death", dead);
          slot.card = null;
          player.graveyard.push(dead);
          changed = true;
          for (const weapon of this.weapons(slot)) {
            if (this.has(weapon, "Herança")) continue;
            const weaponSlot = this.targetSlot(weapon.id)!;
            player.graveyard.push(weapon);
            weaponSlot.card = null;
          }
          this.trigger("onDeath", {
            ownerId: player.id,
            cardId: dead.id,
            element: dead.elemento,
          });
          this.log(`${dead.nome} foi para o cemitério.`);
        }
      }
    }
    if (guard >= 100) this.fail("Ciclo de efeitos excedeu o limite.");
    const dead = this.state.players.filter((p) => p.mage.hpAtual <= 0);
    if (dead.length)
      this.finish(
        dead.length === 2 ? null : this.opponent(dead[0].id).id,
        dead.length === 2
          ? "Empate: os dois magos foram derrotados."
          : "Mago derrotado.",
      );
  }
  private trigger(
    trigger: string,
    context: {
      ownerId: string;
      cardId?: string;
      element?: string;
      status?: string;
      attackerId?: string;
    },
  ) {
    // Snapshot: alterações de zonas durante um gatilho não mudam os participantes desse evento.
    const listeners = this.state.slots.flatMap((s) =>
      [s.card, s.structure].filter((c): c is Instance => c !== null),
    );
    for (const card of listeners)
      for (const passive of card.habilidadesPassivas.filter(
        (h) => h.gatilho === trigger,
      )) {
        const owner = this.player(card.ownerId),
          value = passive.valor ?? 1;
        if (trigger === "onAttacked") {
          if (card.id !== context.cardId || !context.attackerId) continue;
        }
        if (trigger === "onStatusApplied") {
          if (
            context.ownerId === owner.id ||
            context.status !== passive.condicao
          )
            continue;
        } else if (owner.id !== context.ownerId) continue;
        if (trigger === "onDeath" && context.cardId === card.id) continue;
        if (
          passive.condicao === "aliadoMorreTerra" &&
          context.element !== "Terra"
        )
          continue;
        if (passive.condicao === "aliadoMorreAr" && context.element !== "Ar")
          continue;
        if (
          trigger === "onSpellCast" &&
          passive.condicao &&
          passive.condicao !== context.element
        )
          continue;
        switch (passive.efeito) {
          case "aplicarStatusAtacante":
            if (context.attackerId && this.findCard(context.attackerId))
              this.effects(
                owner.id,
                [
                  {
                    id: "status",
                    status: passive.status!,
                    duracao: passive.duracao!,
                  },
                ],
                [context.attackerId],
              );
            break;
          case "acumularDanoFogo":
            if (context.element === "Fogo") {
              card.fireSpellsCast = (card.fireSpellsCast ?? 0) + 1;
              card.fireDamageBonus = Math.floor(card.fireSpellsCast / 2);
            }
            break;
          case "curarMagoAgua":
            if (context.element === "Agua")
              owner.mage.hpAtual = Math.min(
                (owner.mage.hp ?? 20) + 6,
                owner.mage.hpAtual + 3,
              );
            break;
          case "ganharVida":
            card.hp = (card.hp ?? 0) + value;
            card.hpAtual += value;
            break;
          case "curarMago":
            this.heal(owner.mage, value);
            break;
          case "recuperarMana":
            owner.mana = Math.min(20, owner.mana + value);
            break;
          case "comprarCarta":
            this.draw(owner, value);
            break;
          case "manaCampoVazio":
            if (!this.front(owner.id).some((s) => s.card))
              owner.mana = Math.min(20, owner.mana + (passive.valor ?? 5));
            break;
          case "comprarCartaCemiterio": {
            const card = owner.graveyard.pop();
            if (card) {
              this.resetCard(card);
              owner.hand.push(card);
            }
            break;
          }
          case "ganharVidaEManaSacrificio":
            owner.mana = Math.min(20, owner.mana + 2);
            this.heal(owner.mage, 2);
            break;
          case "causarDanoExtra":
            if (context.cardId && this.findCard(context.cardId))
              this.damage(context.cardId, passive.valor ?? 4);
            break;
        }
      }
  }
  private validateTargets(
    owner: string,
    type: TipoAlvoFeitico | undefined,
    ids: string[],
    max = 1,
  ): string[] {
    if (!type) this.fail("Tipo de alvo não definido.");
    if (new Set(ids).size !== ids.length || ids.length > max)
      this.fail("Alvos repetidos ou acima do limite.");
    const me = this.player(owner),
      enemy = this.opponent(owner);
    if (
      type === "Global" ||
      type === "TodosInimigos" ||
      type === "TodasTropasInimigas"
    ) {
      if (ids.length) this.fail("Esta ação não aceita seleção de alvos.");
      if (type === "TodasTropasInimigas")
        return this.state.slots
          .filter((s) => s.ownerId === enemy.id && s.card?.tipo === "Tropa")
          .map((s) => s.id);
      return type === "TodosInimigos"
        ? this.state.slots
            .filter(
              (s) =>
                s.ownerId === enemy.id &&
                (s.card?.tipo === "Tropa" || s.kind === "Mago"),
            )
            .map((s) => s.id)
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
      const card = id === slot.structure?.id ? slot.structure : slot.card;
      if (type === "UnicoAliado" && slot.ownerId !== owner)
        this.fail("Selecione um aliado.");
      if (
        (type === "UnicoInimigo" || type === "MultiplosInimigos") &&
        slot.ownerId === owner
      )
        this.fail("Selecione um inimigo.");
      if (type === "Estrutura" && !slot.structure)
        this.fail("Selecione uma estrutura.");
      if (slot.ownerId !== owner && card && this.has(card, "Esconder"))
        this.fail("Esta carta está escondida.");
    }
    return type === "Estrutura"
      ? ids.map((id) => this.targetSlot(id)!.structure!.id)
      : ids;
  }
  private effects(
    ownerId: string,
    effects: Effect[],
    ids: string[],
    element?: Card["elemento"],
  ) {
    const player = this.player(ownerId);
    for (const effect of effects) {
      switch (effect.id) {
        case "damage":
          for (const id of ids)
            this.damage(
              id,
              effect.valor!,
              undefined,
              false,
              effect.elemento ?? element,
            );
          break;
        case "heal":
          for (const id of ids) {
            const card = this.findCard(id) ?? this.targetSlot(id)?.card;
            if (!card) this.fail("Não é possível curar este alvo.");
            this.heal(card, effect.valor!);
          }
          break;
        case "status":
          for (const id of ids) {
            const card = this.findCard(id) ?? this.targetSlot(id)?.card;
            if (!card) this.fail("Status exige uma carta.");
            applyStatus(
              card.statuses,
              effect.status!,
              effect.duracao!,
              effect.status === "Escudo" ? (effect.valor ?? 3) : effect.valor,
              this.state.turn,
            );
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
      else {
        if (card.tipo === "Armamento")
          for (const beneficiary of this.weaponBeneficiaries(slot))
            if (beneficiary.card) beneficiary.card.hpAtual -= card.bonusHp ?? 0;
        if (card.tipo === "Tropa")
          for (const weapon of this.weapons(slot)) {
            if (this.has(weapon, "Herança")) continue;
            this.player(card.ownerId).graveyard.push(weapon);
            this.targetSlot(weapon.id)!.card = null;
          }
        slot.card = null;
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
          : (slot.structure ?? slot.card);
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
            this.damage(adjacent.card.id, 2, undefined, true);
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
          applyStatus(card.statuses, "Envenenado", 3);
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
      const ids = this.validateTargets(
        user,
        this.spellTarget(card, user),
        cmd.targets,
        card.maxAlvos,
      );
      this.spend(player, card.custoMana);
      const bonus =
        card.elemento === "Fogo" ? (player.mage.fireDamageBonus ?? 0) : 0;
      player.hand.splice(index, 1);
      player.graveyard.push(card);
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
          const target = id === s?.structure?.id ? s.structure : s?.card;
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
        slot.card
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
          if (beneficiary.card) beneficiary.card.hpAtual += card.bonusHp ?? 0;
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
        this.damage(id, 6, undefined, false, "Fogo");
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
      .map((s) => s.id);
  }
  private earthGolem(user: string) {
    return this.state.slots.some(
      (s) =>
        s.ownerId === user &&
        s.card?.tipo === "Tropa" &&
        (s.card.numeroCatalogo === "025" ||
          (s.card.elemento === "Terra" &&
            /golem/i.test(
              s.card.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
            ))),
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
        this.damage(target, damage, undefined, false, element);
    };
    const ongoing = (
      kind: "tornado" | "arrowRain" | "sandstorm",
      damage: number,
    ) => {
      this.state.ongoingSpells ??= [];
      this.state.ongoingSpells.push({
        id: card.id,
        ownerId: user,
        kind,
        rounds: 2,
        damage,
        element: card.elemento,
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
          target = id === s?.structure?.id ? s.structure : s?.card;
        if (target) {
          applyStatus(target.statuses, name, duration, value, this.state.turn);
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
        const troop = slot.card;
        if (troop) {
          slot.card = null;
          this.resetCard(troop);
          enemy.hand.push(troop);
        }
        ongoing("tornado", 3);
        break;
      }
      case "arrowRain":
        if (this.state.ongoingSpells?.some((s) => s.kind === "arrowRain"))
          this.fail("Já existe Chuva de Flechas em campo.");
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
            this.damage(id, 3 + bonus, undefined, false, card.elemento);
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
    for (const spell of this.state.ongoingSpells ?? []) {
      if (this.state.status !== "ACTIVE") break;
      const targets =
        spell.kind === "tornado"
          ? [this.opponent(spell.ownerId).mage.id]
          : this.enemyTargets(spell.ownerId, true);
      if (spell.element) this.react(spell.ownerId, targets, spell.element);
      for (const id of targets)
        this.damage(id, spell.damage, undefined, false, spell.element);
      spell.rounds--;
      this.log(
        `${spell.kind === "tornado" ? "Furacão" : spell.kind === "arrowRain" ? "Chuva de Flechas" : "Furacão de Areia"} causou dano no fim da rodada.`,
      );
      this.resolve();
    }
    this.state.ongoingSpells = this.state.ongoingSpells?.filter(
      (s) => s.rounds > 0,
    );
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
    if (target.card && restrictedBasicAttack(target.card, card))
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
  private attack(user: string, cmd: Extract<Command, { type: "attack" }>) {
    if (this.openingBlocked())
      this.fail(
        "Ataques bloqueados na preparação e no primeiro turno de cada jogador.",
      );
    const p = this.player(user),
      slot = this.ownSlot(cmd.slotId, user),
      card = cmd.source === "structure" ? slot.structure : slot.card;
    const sourceError = this.attackSourceError(user, slot, card);
    if (sourceError) this.fail(sourceError);
    if (!card) this.fail("Carta ausente.");
    const enemy = this.opponent(user),
      target = this.state.slots.find(
        (s) => s.id === cmd.targetId && s.ownerId === enemy.id,
      );
    if (!target) this.fail("Selecione um slot inimigo.");
    const targetError = this.attackTargetError(slot, card, target);
    if (targetError) this.fail(targetError);
    this.event("attack", card);
    card.attacked = true;
    p.combatStarted = true;
    if (card.tipo !== "Mago") p.counters.attacks++;
    card.palavrasChave = card.palavrasChave.filter((k) => k !== "Esconder");
    card.statuses = card.statuses.filter((s) => s.nome !== "Esconder");
    if (this.has(card, "Cegueira") || this.has(card, "Cego")) {
      if (this.rng() < 0.5) {
        if (target.card)
          this.trigger("onAttacked", {
            ownerId: target.card.ownerId,
            cardId: target.card.id,
            attackerId: card.id,
          });
        this.log(`${card.nome} errou por cegueira.`);
        return;
      }
    }
    const attackedCard = target.card;
    this.damage(
      target.id,
      (card.ataque ?? 0) +
        adjacentAttackBonus(card, this.state.slots) +
        (card.tipo === "Estrutura"
          ? 0
          : this.weapons(slot).reduce(
              (sum, c) => sum + (c.bonusAtaque ?? 0),
              0,
            )),
      card,
    );
    if (attackedCard)
      this.trigger("onAttacked", {
        ownerId: attackedCard.ownerId,
        cardId: attackedCard.id,
        attackerId: card.id,
      });
    this.trigger("onAttack", { ownerId: user, cardId: card.id });
    this.log(`${card.nome} atacou a coluna ${target.column + 1}.`);
  }
  private ability(user: string, cmd: Extract<Command, { type: "ability" }>) {
    const p = this.player(user),
      slot = this.ownSlot(cmd.slotId, user),
      card = cmd.source === "structure" ? slot.structure : slot.card;
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
      const targets = this.validateTargets(user, ability.alvo, cmd.targets);
      this.spend(p, ability.custoMana);
      this.effects(user, ability.efeitos, targets, card.elemento);
    } else {
      switch (ability.id) {
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
          if (cmd.mode === "cura") this.heal(target, 3);
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
          this.damage(this.opponent(user).mage.id, 2);
          break;
        case "ordemDaEspada":
          this.spend(p, ability.custoMana);
          for (const s of this.state.slots.filter(
            (s) =>
              s.ownerId === this.opponent(user).id && s.card?.tipo === "Tropa",
          ))
            this.damage(s.id, 3);
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
    this.log(`${card.nome} usou ${ability.nome}.`);
  }
  private beginTurn() {
    const p = this.player(this.state.current);
    p.combatStarted = false;
    p.turnActions = 0;
    p.counters = { summons: 0, attacks: 0, spells: 0, unique: 0 };
    for (const c of this.state.slots
      .filter((s) => s.ownerId === p.id)
      .flatMap((s) => [s.card, s.structure]))
      if (c) {
        c.attacked = false;
        c.usedAbility = false;
        c.moved = false;
      }
    this.recoverMana(p);
    this.trigger("onTurnStart", { ownerId: p.id });
    if (this.state.status === "ACTIVE") this.draw(p, 1);
  }
  private sacrifice(user: string, slotId: string) {
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
    if (slot.card?.tipo !== "Tropa")
      this.fail("Escolha uma tropa sua para sacrificar.");
    const dead = slot.card;
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
      .flatMap((s) => [s.card, s.structure])
      .filter((c): c is Instance => c !== null)) {
      if (roundEnded) card.hpAtual -= tickRound(card.statuses);
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
      this.state.pendingSpell &&
      !["respondSpell", "surrender"].includes(cmd.type)
    )
      this.fail("Aguarde a resposta ao feitiço.");
    if (
      !["surrender", "respondSpell"].includes(cmd.type) &&
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
          const fromBonus = this.weapons(from).reduce(
              (n, w) => n + (w.bonusHp ?? 0),
              0,
            ),
            toBonus = this.weapons(to).reduce(
              (n, w) => n + (w.bonusHp ?? 0),
              0,
            );
          if (from.card) from.card.hpAtual += toBonus - fromBonus;
          if (to.card) to.card.hpAtual += fromBonus - toBonus;
          [from.card, to.card] = [to.card, from.card];
          [from.structure, to.structure] = [to.structure, from.structure];
          if (to.card) to.card.moved = true;
          break;
        }
        case "endTurn":
          this.endTurn(user);
          break;
        case "mulligan":
          this.mulligan(user);
          break;
        case "sacrifice":
          this.sacrifice(user, cmd.slotId);
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
      if (
        (previous.phase === "PREPARATION" || previous.turn <= 2) &&
        ["play", "ability", "move"].includes(cmd.type)
      ) {
        const after = new Map(
          this.state.slots
            .flatMap((s) => [s.card, s.structure])
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
            .flatMap((s) => [s.card, s.structure])
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
        card: slot.card
          ? {
              ...slot.card,
              bonusAtaquePassivo: adjacentAttackBonus(
                slot.card,
                this.state.slots,
              ),
            }
          : null,
        ...(slot.ownerId === user
          ? {
              attackTargets: {
                card: this.attackTargets(user, slot, slot.card),
                structure: this.attackTargets(user, slot, slot.structure),
              },
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
              hand: p.hand.map((c) => ({
                ...c,
                alvo: this.spellTarget(c, p.id),
              })),
              deck: [...p.deck].sort((a, b) => a.nome.localeCompare(b.nome)),
            }
          : {}),
      })),
    });
  }
}
