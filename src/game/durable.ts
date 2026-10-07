import { createHash, randomUUID } from "node:crypto";
import { Game } from "./engine";
import {
  DurableRoom,
  DurableStore,
  Lobby,
  MongoGameStore,
  Waiting,
} from "./store";
import { ownedDeck } from "../services/decks";
import Match from "../db/models/match";
import { AppError } from "../lib/errors";
import { log } from "../lib/observability";
export const TURN_MS = 120_000,
  LEASE_MS = 15_000,
  RECONNECT_MS = 90_000;
type Loader = typeof ownedDeck;
export class DurableGame {
  constructor(
    readonly store: DurableStore = new MongoGameStore(),
    private now = Date.now,
    private load: Loader = ownedDeck,
    private record = async (room: DurableRoom) => {
      await Match.updateOne(
        { matchId: room.id },
        {
          $setOnInsert: {
            matchId: room.id,
            players: room.entries.map((e) => ({
              userId: e.id,
              nome: e.nome,
              deckId: e.deckId,
            })),
            winner: room.game.state.winner,
            reason: room.game.state.reason,
            turns: room.game.state.turn,
            finishedAt: new Date(room.finishedAt!),
          },
        },
        { upsert: true, writeConcern: { w: "majority", wtimeout: 5000 } },
      );
    },
  ) {}
  private async retry<T>(operation: () => Promise<T | undefined>): Promise<T> {
    for (let n = 0; n < 20; n++) {
      const result = await operation();
      if (result !== undefined) return result;
      await new Promise((r) =>
        setTimeout(r, Math.min(5 * n, 50) + Math.random() * 15),
      );
    }
    throw new AppError(409, "Partida ocupada. Tente novamente.", "STORE_BUSY");
  }
  private prune(lobby: Lobby) {
    const now = this.now();
    lobby.waiting = lobby.waiting.filter((e) => now - e.joinedAt < 300_000);
    for (const [key, value] of Object.entries(lobby.receipts))
      if (now - value.at > 300_000) delete lobby.receipts[key];
    if (Object.keys(lobby.receipts).length > 1000) {
      const keys = Object.keys(lobby.receipts);
      for (const key of keys.slice(0, keys.length - 1000))
        delete lobby.receipts[key];
    }
  }
  async cancel(user: string, requestId: string) {
    return this.retry(async () => {
      const { revision, data } = await this.store.lobby();
      const key = user + ":" + requestId;
      if (data.receipts[key]) return data.receipts[key].result;
      this.prune(data);
      data.waiting = data.waiting.filter((e) => e.id !== user);
      data.generations[user] = (data.generations[user] ?? 0) + 1;
      const result = { queued: false };
      data.receipts[key] = { at: this.now(), result };
      return (await this.store.saveLobby(revision, data)) ? result : undefined;
    });
  }
  async join(user: string, nome: string, deckId: string, requestId: string) {
    const initial = await this.store.lobby(),
      generation = initial.data.generations[user] ?? 0;
    const { deck, catalog } = await this.load(deckId, user, true);
    const hash = createHash("sha256")
      .update(
        JSON.stringify(
          [...catalog].sort((a, b) =>
            a.numeroCatalogo.localeCompare(b.numeroCatalogo),
          ),
        ),
      )
      .digest("hex");
    const ids = new Set([deck.mago, ...deck.cartas]);
    const entry: Waiting = {
      id: user,
      nome,
      deckId,
      deck,
      catalog: catalog.filter((c) => ids.has(c.numeroCatalogo)),
      catalogHash: hash,
      joinedAt: this.now(),
    };
    await this.store.touch(user, this.now());
    return this.retry(async () => {
      const { revision, data } = await this.store.lobby(),
        key = user + ":" + requestId;
      if (data.receipts[key]) return data.receipts[key].result;
      if ((data.generations[user] ?? 0) !== generation)
        throw new AppError(409, "Busca cancelada.", "QUEUE_CANCELED");
      const active = data.active[user]
        ? await this.store.room(data.active[user])
        : null;
      if (active?.game.state.status === "ACTIVE")
        return { queued: false, active: true };
      this.prune(data);
      data.waiting = data.waiting.filter((e) => e.catalogHash === hash);
      if (data.waiting.some((e) => e.id === user)) return { queued: true };
      if (data.waiting.length >= 50)
        throw new AppError(503, "Fila cheia. Aguarde.", "QUEUE_CAPACITY");
      const opponent = data.waiting.shift();
      let room: DurableRoom | undefined;
      if (opponent) {
        room = this.makeRoom([opponent, entry]);
        // First store the room; only the winning lobby CAS authorizes its use.
        await this.store.insertRoom(room);
        data.active[user] = room.id;
        data.active[opponent.id] = room.id;
      } else data.waiting.push(entry);
      const result = { queued: !room };
      data.receipts[key] = { at: this.now(), result };
      if (Buffer.byteLength(JSON.stringify(data)) > 8_000_000)
        throw new AppError(503, "Fila cheia. Aguarde.", "QUEUE_CAPACITY");
      if (!(await this.store.saveLobby(revision, data))) return undefined;
      log(room ? "match_created" : "queue_joined", { matchId: room?.id });
      return result;
    });
  }
  private makeRoom(entries: Waiting[]): DurableRoom {
    // Presence grace belongs to this match, including rematches after a long wait.
    entries = entries.map((entry) => ({ ...entry, joinedAt: this.now() }));
    const catalog = [
      ...new Map(
        entries.flatMap((e) => e.catalog).map((c) => [c.numeroCatalogo, c]),
      ).values(),
    ];
    const game = new Game(randomUUID(), entries as [Waiting, Waiting], catalog);
    return {
      id: game.id,
      revision: 0,
      game: game.exportState(),
      entries,
      deadline: this.now() + TURN_MS,
      lastAdvancedAt: this.now(),
      resultSaved: false,
      rematchVotes: [],
      rematchClosed: false,
    };
  }
  async startPrivate(
    invitationId: string,
    players: { id: string; nome: string; deckId: string }[],
  ) {
    if (players.length !== 2 || players[0].id === players[1].id)
      throw new AppError(422, "Escolha dois jogadores diferentes.");
    const entries = await Promise.all(
      players.map(async (p) => {
        const { deck, catalog } = await this.load(p.deckId, p.id, true);
        const catalogHash = createHash("sha256")
          .update(
            JSON.stringify(
              [...catalog].sort((a, b) =>
                a.numeroCatalogo.localeCompare(b.numeroCatalogo),
              ),
            ),
          )
          .digest("hex");
        const ids = new Set([deck.mago, ...deck.cartas]);
        return {
          ...p,
          deck,
          catalog: catalog.filter((c) => ids.has(c.numeroCatalogo)),
          catalogHash,
          joinedAt: this.now(),
        } as Waiting;
      }),
    );
    if (entries[0].catalogHash !== entries[1].catalogHash)
      throw new AppError(409, "Catálogo mudou. Tente novamente.");
    return this.retry(async () => {
      const { revision, data } = await this.store.lobby(),
        key = "invite:" + invitationId;
      if (data.receipts[key]) return data.receipts[key].result;
      for (const p of players) {
        const room = data.active[p.id]
          ? await this.store.room(data.active[p.id])
          : null;
        if (room?.invitationId === invitationId) return { matchId: room.id };
        if (
          room?.game.state.status === "ACTIVE" ||
          data.waiting.some((e) => e.id === p.id)
        )
          throw new AppError(409, "Um jogador já está em uma partida ou fila.");
      }
      const room = this.makeRoom(entries);
      room.invitationId = invitationId;
      await this.store.insertRoom(room);
      for (const p of players) {
        data.active[p.id] = room.id;
        data.generations[p.id] = (data.generations[p.id] ?? 0) + 1;
      }
      const result = { matchId: room.id };
      data.receipts[key] = { at: this.now(), result };
      return (await this.store.saveLobby(revision, data)) ? result : undefined;
    });
  }
  private async authorized(id: string, user?: string, claims?: Lobby) {
    const room = await this.store.room(id);
    if (!room) throw new AppError(404, "Partida não encontrada.");
    if (user && !room.entries.some((e) => e.id === user))
      throw new AppError(403, "Acesso negado.");
    const data = claims ?? (await this.store.lobby()).data;
    if (
      room.game.state.status === "ACTIVE" &&
      !room.entries.every((e) => data.active[e.id] === id)
    )
      throw new AppError(409, "Partida não confirmada.", "UNCLAIMED_ROOM");
    return room;
  }
  private async advance(room: DurableRoom, recovery = false) {
    const now = this.now(),
      game = Game.restore(room.game);
    if (game.state.status !== "ACTIVE") return game;
    // A long platform outage grants reconnection time instead of deciding a loss.
    if (
      recovery &&
      room.recoveryUntil === undefined &&
      now - room.lastAdvancedAt > 600_000
    ) {
      room.deadline += now - room.lastAdvancedAt;
      if (room.responseDeadline !== undefined)
        room.responseDeadline += now - room.lastAdvancedAt;
      room.recoveryUntil = now + RECONNECT_MS;
    }
    const seen = await this.store.presence(room.entries.map((e) => e.id));
    const absent = room.entries.filter(
      (e) => now - Math.max(seen[e.id] ?? 0, e.joinedAt) > LEASE_MS,
    );
    const expired = absent.filter(
      (e) =>
        now - Math.max(seen[e.id] ?? 0, e.joinedAt) >= LEASE_MS + RECONNECT_MS,
    );
    if (absent.length === 2) {
      room.pausedAt ??= Math.min(
        ...room.entries.map(
          (e) => Math.max(seen[e.id] ?? 0, e.joinedAt) + LEASE_MS,
        ),
      );
      if (expired.length === 2 && now >= (room.recoveryUntil ?? 0))
        game.drawByDisconnection();
    } else {
      if (room.pausedAt !== undefined) {
        room.deadline += Math.max(0, now - room.pausedAt);
        if (room.responseDeadline !== undefined)
          room.responseDeadline += Math.max(0, now - room.pausedAt);
        delete room.pausedAt;
      }
      if (expired.length && now >= (room.recoveryUntil ?? 0))
        game.abandon(expired[0].id, "Abandono após desconexão.");
      if (game.state.pendingSpell && now >= (room.responseDeadline ?? now)) {
        game.resolvePendingSpell();
        room.deadline =
          (room.responseDeadline ?? now) + (room.remainingTurnMs ?? TURN_MS);
        delete room.responseDeadline;
        delete room.remainingTurnMs;
      }
      for (
        let n = 0;
        game.state.status === "ACTIVE" &&
        !game.state.pendingSpell &&
        now >= room.deadline &&
        n < 10;
        n++
      ) {
        game.timeout();
        room.deadline += TURN_MS;
      }
    }
    room.lastAdvancedAt = now;
    return game;
  }
  private finalize(room: DurableRoom, game: Game) {
    room.game = game.exportState();
    if (game.state.status === "FINISHED") room.finishedAt ??= this.now();
  }
  async command(id: string, user: string, command: unknown) {
    const started = performance.now();
    const timing = { readMs: 0, applyMs: 0, writeMs: 0, attempts: 0 };
    const result = await this.retry(async () => {
      timing.attempts++;
      let stage = performance.now();
      const room = await this.authorized(id, user),
        game = await this.advance(room, true);
      timing.readMs += performance.now() - stage;
      stage = performance.now();
      const turn = game.state.turn,
        phase = game.state.phase,
        responding = !!game.state.pendingSpell;
      let response: unknown, error: unknown;
      try {
        response = game.execute(user, command);
      } catch (e) {
        error = e;
      }
      if (game.state.turn !== turn || game.state.phase !== phase)
        room.deadline = this.now() + TURN_MS;
      if (!responding && game.state.pendingSpell) {
        room.remainingTurnMs = Math.max(0, room.deadline - this.now());
        room.responseDeadline = this.now() + 20000;
      } else if (responding && !game.state.pendingSpell) {
        room.deadline = this.now() + (room.remainingTurnMs ?? TURN_MS);
        delete room.responseDeadline;
        delete room.remainingTurnMs;
      }
      this.finalize(room, game);
      timing.applyMs += performance.now() - stage;
      stage = performance.now();
      const saved = await this.store.saveRoom(room.revision, room);
      timing.writeMs += performance.now() - stage;
      if (!saved) return undefined;
      room.revision++;
      if (error) throw error;
      return { room, response };
    });
    await this.project(result.room);
    log("game_command", {
      matchId: id,
      durationMs: Math.round(performance.now() - started),
      ...Object.fromEntries(
        Object.entries(timing).map(([key, value]) => [key, Math.round(value)]),
      ),
    });
    return {
      ...(result.response as object),
      state: {
        success: true,
        queued: false,
        serverNow: this.now(),
        match: this.view(result.room, user),
      },
    };
  }
  private view(room: DurableRoom, user: string) {
    return {
      ...Game.restore(room.game).snapshot(user),
      revision: room.revision,
      deadline: room.deadline,
      responseDeadline: room.responseDeadline,
      reconnectMs: RECONNECT_MS,
      paused: room.pausedAt !== undefined,
      serverNow: this.now(),
    };
  }
  async state(user: string, heartbeat = true) {
    // Resolve expiration using previous heartbeats, then acknowledge this client's return.
    const { data } = await this.store.lobby(),
      id = data.active[user];
    let room: DurableRoom | null = null;
    if (id)
      room = await this.retry(async () => {
        const current = await this.authorized(id, user, data);
        if (current.game.state.status === "FINISHED") return current;
        const before = JSON.stringify([
            current.game.state.version,
            current.deadline,
            current.responseDeadline,
            current.pausedAt,
            current.recoveryUntil,
          ]),
          checkpoint = this.now() - current.lastAdvancedAt >= 10000;
        const game = await this.advance(current, heartbeat);
        this.finalize(current, game);
        const after = JSON.stringify([
          current.game.state.version,
          current.deadline,
          current.responseDeadline,
          current.pausedAt,
          current.recoveryUntil,
        ]);
        if (before === after && !checkpoint) return current;
        if (!(await this.store.saveRoom(current.revision, current)))
          return undefined;
        current.revision++;
        return current;
      });
    if (heartbeat) await this.store.touch(user, this.now());
    if (room) {
      await this.project(room);
    }
    return {
      success: true,
      queued: data.waiting.some(
        (e) => e.id === user && this.now() - e.joinedAt < 300_000,
      ),
      serverNow: this.now(),
      match:
        room &&
        !(
          room.game.state.status === "FINISHED" &&
          room.seenResultBy?.includes(user)
        )
          ? this.view(room, user)
          : null,
      rematch:
        room &&
        room.game.state.status === "FINISHED" &&
        (room.rematchVotes.length > 0 || room.rematchClosed)
          ? {
              matchId: room.id,
              requestedBy: room.rematchVotes[room.rematchVotes.length - 1],
              canceled: room.rematchClosed,
            }
          : null,
    };
  }
  async acknowledgeResult(id: string, user: string) {
    await this.retry(async () => {
      const room = await this.authorized(id, user);
      if (room.game.state.status !== "FINISHED")
        throw new AppError(409, "A partida ainda está em andamento.");
      room.seenResultBy ??= [];
      if (room.seenResultBy.includes(user)) return true;
      room.seenResultBy.push(user);
      return (await this.store.saveRoom(room.revision, room))
        ? true
        : undefined;
    });
    return {};
  }
  async project(room: DurableRoom) {
    if (room.game.state.status !== "FINISHED" || room.resultSaved) return;
    try {
      await this.record(room);
      await this.retry(async () => {
        const current = await this.store.room(room.id);
        if (!current || current.resultSaved) return true;
        current.resultSaved = true;
        return (await this.store.saveRoom(current.revision, current))
          ? true
          : undefined;
      });
      log("result_persisted", { matchId: room.id });
    } catch {
      log("result_pending", { matchId: room.id }, "error");
    }
  }
  async rematch(id: string, user: string, refuse = false) {
    const old = await this.retry(async () => {
      const room = await this.authorized(id, user);
      if (room.game.state.status !== "FINISHED")
        throw new AppError(409, "Partida ainda em andamento.");
      if (room.rematchId) return room;
      if (room.rematchClosed && !refuse)
        throw new AppError(409, "Revanche indisponível.");
      if (refuse) {
        room.rematchClosed = true;
        room.rematchVotes = [];
      } else if (!room.rematchVotes.includes(user))
        room.rematchVotes.push(user);
      return (await this.store.saveRoom(room.revision, room))
        ? room
        : undefined;
    });
    if (refuse || old.rematchVotes.length < 2) return { waiting: !refuse };
    await this.retry(async () => {
      const { revision, data } = await this.store.lobby();
      const latest = await this.store.room(id);
      if (!latest || latest.rematchClosed || latest.rematchVotes.length < 2)
        throw new AppError(409, "Revanche cancelada.");
      const claims = old.entries.map((e) => data.active[e.id]);
      if (claims.every((c) => c !== id) && claims[0] === claims[1]) return true;
      if (
        claims.some((c) => c !== id) ||
        old.entries.some((e) => data.waiting.some((w) => w.id === e.id))
      )
        throw new AppError(
          409,
          "Um jogador já entrou em outra fila ou partida.",
        );
      const room = this.makeRoom(old.entries);
      await this.store.insertRoom(room);
      for (const e of old.entries) data.active[e.id] = room.id;
      return (await this.store.saveLobby(revision, data)) ? true : undefined;
    });
    return { waiting: false };
  }
  async maintain() {
    let examined = 0;
    for (const room of await this.store.pending(100)) {
      try {
        if (room.game.state.status === "ACTIVE")
          await this.retry(async () => {
            const current = await this.authorized(room.id),
              game = await this.advance(current);
            this.finalize(current, game);
            if (!(await this.store.saveRoom(current.revision, current)))
              return undefined;
            await this.project(current);
            return true;
          });
        else await this.project(room);
        examined++;
      } catch {
        log("maintenance_failed", { matchId: room.id }, "error");
      }
    }
    return { examined };
  }
}
