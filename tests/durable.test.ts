import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import {
  DurableGame,
  LEASE_MS,
  RECONNECT_MS,
  TURN_MS,
} from "../src/game/durable";
import { MemoryDurableStore } from "./support/durable-store";
import { Game } from "../src/game/engine";
const catalog = initial.map((c) => cardSchema.parse(c));
const cartas = catalog
  .filter((c) => c.publicado && c.tipo === "Tropa")
  .flatMap((c) => Array(3).fill(c.numeroCatalogo))
  .slice(0, 40);
const deck = { nome: "Teste", mago: "108", cartas };
function fixture() {
  let now = 1000000;
  const store = new MemoryDurableStore(),
    results = new Map<string, unknown>();
  let failure = false;
  const load = async () => ({ deck, catalog }) as any;
  const record = async (room: any) => {
    if (failure) throw new Error("history down");
    results.set(room.id, room.game.state);
  };
  const service = () => new DurableGame(store, () => now, load, record);
  return {
    store,
    results,
    service,
    advance: (ms: number) => {
      now += ms;
    },
    fail: (value: boolean) => {
      failure = value;
    },
  };
}
async function pair(f: ReturnType<typeof fixture>, a = "p1", b = "p2") {
  const game = f.service();
  await game.join(a, a, "deck", randomUUID());
  await game.join(b, b, "deck", randomUUID());
  return (await game.state(a)).match!;
}

test("convite privado concorrente é idempotente e concede presença inicial após conexão antiga", async () => {
  const f = fixture();
  await f.store.touch("p1", 1);
  await f.store.touch("p2", 1);
  const invitationId = randomUUID(),
    players = ["p1", "p2"].map((id) => ({ id, nome: id, deckId: "deck" }));
  const replies = await Promise.all([
    f.service().startPrivate(invitationId, players),
    f.service().startPrivate(invitationId, players),
  ]);
  assert.equal(replies[0].matchId, replies[1].matchId);
  assert.equal((await f.service().state("p1")).match!.status, "ACTIVE");
  await assert.rejects(
    f.service().startPrivate(randomUUID(), players),
    /partida|fila/,
  );
});
test("janela de Jato dura 20 segundos, persiste após reinício e preserva tempo do turno", async () => {
  const f = fixture(),
    m = await pair(f),
    room = f.store.rooms.get(m.id)!;
  let g = Game.restore(room.game);
  for (const id of ["p1", "p2"])
    g.execute(id, {
      type: "endTurn",
      actionId: randomUUID(),
      version: g.state.version,
    });
  g.state.current = "p1";
  g.state.turn = 3;
  const instantiate = (id: string, ownerId: string) => ({
    ...catalog.find((c) => c.numeroCatalogo === id)!,
    id: randomUUID(),
    ownerId,
    hpAtual: 0,
    statuses: [],
    attacked: false,
    usedAbility: false,
  });
  const spell = instantiate("001", "p1");
  g.player("p1").hand = [spell];
  g.player("p2").hand = [instantiate("002", "p2")];
  g.player("p1").mana = 20;
  g.player("p2").mana = 20;
  const troop = instantiate("020", "p2");
  troop.hpAtual = 20;
  g.state.slots.find((s) => s.id === "p2:front:0")!.card = troop;
  room.game = g.exportState();
  room.deadline = 1000000 + 80000;
  f.store.rooms.set(m.id, room);
  await f.service().command(m.id, "p1", {
    type: "play",
    cardId: spell.id,
    actionId: randomUUID(),
    version: g.state.version,
  });
  const pending = (await f.service().state("p2")).match!;
  assert.ok(pending.pendingSpell);
  assert.equal(pending.responseDeadline, 1020000);
  f.advance(19000);
  await f.store.touch("p1", 1019000);
  await f.store.touch("p2", 1019000);
  assert.ok((await f.service().state("p2")).match!.pendingSpell);
  f.advance(1000);
  await f.store.touch("p1", 1020000);
  await f.store.touch("p2", 1020000);
  const resolved = (await f.service().state("p1")).match!;
  assert.equal(resolved.pendingSpell, undefined);
  assert.equal(resolved.deadline, 1100000);
  assert.equal(resolved.current, "p1");
});
test("resultado reconhecido não reabre após reinício, sem ocultar o resultado do oponente ou impedir revanche", async () => {
  const f = fixture(),
    match = await pair(f);
  await assert.rejects(f.service().acknowledgeResult(match.id, "p1"));
  await f.service().command(match.id, "p1", {
    type: "surrender",
    version: 0,
    actionId: randomUUID(),
  });
  await assert.rejects(f.service().acknowledgeResult(match.id, "intruso"));
  assert.equal((await f.service().state("p1")).match!.status, "FINISHED");
  await f.service().acknowledgeResult(match.id, "p1");
  await f.service().acknowledgeResult(match.id, "p1");
  assert.equal((await f.service().state("p1")).match, null);
  assert.equal((await f.service().state("p2")).match!.status, "FINISHED");
  assert.equal(f.results.size, 1);
  await f.service().rematch(match.id, "p1", false);
  await f.service().rematch(match.id, "p2", false);
  const next = (await f.service().state("p1")).match!;
  assert.notEqual(next.id, match.id);
  assert.equal(next.status, "ACTIVE");
});
test("restauração após BSON/JSON religa o mago à sua carta no campo", async () => {
  const f = fixture(),
    match = await pair(f),
    room = (await f.store.room(match.id))!;
  const game = Game.restore(JSON.parse(JSON.stringify(room.game)));
  const player = game.state.players[0],
    mageSlot = game.state.slots.find(
      (s) => s.ownerId === player.id && s.kind === "Mago",
    )!;
  assert.equal(player.mage, mageSlot.card);
  mageSlot.card!.hpAtual -= 3;
  assert.equal(player.mage.hpAtual, mageSlot.card!.hpAtual);
});
test("fila e partida sobrevivem à substituição do coordenador; mãos permanecem privadas", async () => {
  const f = fixture();
  await f.service().join("p1", "Um", "deck", randomUUID());
  assert.equal((await f.service().state("p1")).queued, true);
  await f.service().join("p2", "Dois", "deck", randomUUID());
  const one = (await f.service().state("p1")).match!,
    two = (await f.service().state("p2")).match!;
  assert.equal(one.id, two.id);
  assert.equal((await f.service().state("p1")).rematch, null);
  assert.equal(one.players.find((p) => p.id === "p2")!.hand, undefined);
});
test("falha antes da gravação não publica uma jogada; resposta perdida não duplica após reinício", async () => {
  const f = fixture(),
    match = await pair(f),
    command = {
      actionId: randomUUID(),
      version: match.version,
      type: "endTurn",
    };
  f.store.failRoomWrite = true;
  await assert.rejects(f.service().command(match.id, "p1", command));
  f.store.failRoomWrite = false;
  assert.equal((await f.store.room(match.id))!.game.state.version, 0);
  f.store.loseResponse = true;
  await assert.rejects(f.service().command(match.id, "p1", command));
  const result = (await f.service().command(match.id, "p1", command)) as any;
  assert.equal(result.duplicate, true);
  assert.equal((await f.store.room(match.id))!.game.state.version, 1);
});
test("resultado pendente persiste e é reprocessado por outro processo sem duplicar", async () => {
  const f = fixture(),
    match = await pair(f);
  f.fail(true);
  await f.service().command(match.id, "p1", {
    type: "surrender",
    version: 0,
    actionId: randomUUID(),
  });
  assert.equal((await f.store.room(match.id))!.resultSaved, false);
  assert.equal(f.results.size, 0);
  f.fail(false);
  await f.service().maintain();
  await f.service().maintain();
  assert.equal(f.results.size, 1);
  assert.equal((await f.store.room(match.id))!.resultSaved, true);
});
test("desconexão simultânea pausa e termina em empate; manutenção não cria presença fictícia", async () => {
  const f = fixture(),
    match = await pair(f);
  f.advance(LEASE_MS + 1);
  await f.service().maintain();
  assert.ok((await f.store.room(match.id))!.pausedAt);
  f.advance(RECONNECT_MS);
  await f.service().maintain();
  const end = (await f.store.room(match.id))!.game.state;
  assert.equal(end.status, "FINISHED");
  assert.equal(end.winner, null);
});
test("manutenção tardia resolve abandono; recuperação longa concede uma única tolerância", async () => {
  const f = fixture(),
    match = await pair(f);
  f.advance(86400000);
  await f.service().maintain();
  assert.equal((await f.store.room(match.id))!.game.state.status, "FINISHED");
  const second = fixture(),
    other = await pair(second);
  second.advance(700000);
  assert.equal((await second.service().state("p1")).match!.status, "ACTIVE");
  second.advance(RECONNECT_MS + LEASE_MS + 1);
  await second.service().maintain();
  assert.equal(
    (await second.store.room(other.id))!.game.state.status,
    "FINISHED",
  );
});
test("uma aba ainda ativa mantém a conta conectada; ausência unilateral dá abandono", async () => {
  const f = fixture(),
    match = await pair(f);
  for (let i = 0; i < 11; i++) {
    f.advance(10000);
    await f.service().state("p1");
  }
  const end = (await f.store.room(match.id))!.game.state;
  assert.equal(end.winner, "p1");
  assert.match(end.reason!, /desconexão/);
});
test("prazos são avançados antes de aceitar uma ação atrasada; três turnos ociosos consecutivos", async () => {
  const f = fixture(),
    match = await pair(f),
    room = (await f.store.room(match.id))!;
  room.game.state.phase = "BATTLE";
  room.game.state.current = "p1";
  room.game.state.turn = 3;
  room.game.state.round = 3;
  await f.store.saveRoom(room.revision, room);
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 12; j++) {
      f.advance(10000);
      await f.store.touch("p1", 1000000 + (i * 12 + j + 1) * 10000);
      await f.store.touch("p2", 1000000 + (i * 12 + j + 1) * 10000);
    }
    await f.service().maintain();
  }
  const end = (await f.store.room(match.id))!.game.state;
  assert.equal(end.status, "FINISHED");
  assert.match(end.reason!, /inatividade/i);
});
test("mudança de catálogo não mistura revisões; cancelamento vence carregamento pendente", async () => {
  const f = fixture();
  await f.service().join("p1", "Um", "deck", randomUUID());
  const changed = structuredClone(catalog);
  changed[0].descricao += " nova";
  const second = new DurableGame(
    f.store,
    () => 1000000,
    async () => ({ deck, catalog: changed }) as any,
    async () => {},
  );
  await second.join("p2", "Dois", "deck", randomUUID());
  assert.equal((await f.store.lobby()).data.waiting.length, 1);
  assert.equal((await f.service().state("p1")).match, null);
  let resolve!: () => void;
  const delay = new Promise<void>((r) => {
    resolve = r;
  });
  const waiting = new DurableGame(
    f.store,
    () => 1000000,
    async () => {
      await delay;
      return { deck, catalog } as any;
    },
    async () => {},
  );
  const joining = waiting.join("p3", "Tres", "deck", randomUUID());
  await new Promise((r) => setTimeout(r, 0));
  await f.service().cancel("p3", randomUUID());
  resolve();
  await assert.rejects(joining, /cancelada/);
});
test("carga: 100 jogadores em 4 coordenadores e 30 cópias simultâneas da mesma ação", async () => {
  const f = fixture(),
    workers = Array.from({ length: 4 }, () => f.service()),
    start = performance.now();
  // Waves avoid unbounded pressure on the shared queue CAS; match commands shard by room.
  for (let offset = 0; offset < 100; offset += 10)
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const id = "load-" + (offset + i);
        return workers[i % 4].join(id, id, "deck", randomUUID());
      }),
    );
  const lobby = (await f.store.lobby()).data;
  assert.equal(lobby.waiting.length, 0);
  assert.equal(new Set(Object.values(lobby.active)).size, 50);
  const room = (await f.store.room(lobby.active["load-0"]))!,
    id = room.entries[0].id;
  const command = { type: "endTurn", version: 0, actionId: randomUUID() };
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      workers[i % 4].command(room.id, id, command),
    ),
  );
  assert.equal(results.filter((r: any) => !r.duplicate).length, 1);
  assert.equal((await f.store.room(room.id))!.game.state.version, 1);
  console.log(
    JSON.stringify({
      event: "load_test",
      players: 100,
      matches: 50,
      duplicateRequests: 30,
      durationMs: Math.round(performance.now() - start),
    }),
  );
});

test("leituras sem mudanças não regravam sala; comando retorna snapshot privado confirmado", async () => {
  const f = fixture(),
    m = await pair(f),
    game = f.service();
  const original = f.store.saveRoom.bind(f.store);
  let writes = 0;
  f.store.saveRoom = async (...args) => {
    writes++;
    return original(...args);
  };
  for (let n = 0; n < 10; n++) await game.state("p1");
  assert.equal(writes, 0);
  const response = await game.command(m.id, "p1", {
    type: "endTurn",
    actionId: randomUUID(),
    version: m.version,
  });
  assert.equal(response.state.match.version, m.version + 1);
  assert.equal(writes, 1);
  assert.equal(
    response.state.match.players.find((p) => p.id === "p2")!.hand,
    undefined,
  );
  assert.equal(
    response.state.match.revision,
    (await f.store.room(m.id))!.revision,
  );
  f.advance(10001);
  await game.state("p1");
  assert.equal(writes, 2);
});

test("revanche após espera longa recebe nova tolerância de presença e mantém os decks", async () => {
  const f = fixture(),
    match = await pair(f);
  await f.service().command(match.id, "p1", {
    type: "surrender",
    version: 0,
    actionId: randomUUID(),
  });
  const before = (await f.store.room(match.id))!;
  f.advance(5 * 60000);
  await f.service().rematch(match.id, "p1");
  await f.service().rematch(match.id, "p2");
  const next = (await f.service().state("p1")).match!;
  assert.notEqual(next.id, match.id);
  assert.equal(next.status, "ACTIVE");
  assert.equal(next.paused, false);
  const after = (await f.store.room(next.id))!;
  assert.deepEqual(
    after.entries.map((e) => e.deck),
    before.entries.map((e) => e.deck),
  );
  assert.ok(
    after.entries.every((e) => e.joinedAt > before.entries[0].joinedAt),
  );
  f.advance(LEASE_MS + RECONNECT_MS + 1);
  await f.service().maintain();
  assert.equal((await f.store.room(next.id))!.game.state.status, "FINISHED");
});

test("fila repetida é idempotente, intruso é bloqueado e recusa encerra revanche", async () => {
  const f = fixture(),
    service = f.service(),
    requestId = randomUUID();
  await service.join("p1", "Um", "deck", requestId);
  await service.join("p1", "Um", "deck", requestId);
  await service.join("p1", "Um", "deck", randomUUID());
  assert.equal((await f.store.lobby()).data.waiting.length, 1);
  await service.join("p2", "Dois", "deck", randomUUID());
  const match = (await service.state("p1")).match!;
  assert.equal(
    (await service.join("p1", "Um", "deck", randomUUID())).active,
    true,
  );
  await assert.rejects(
    service.command(match.id, "intruso", {
      type: "surrender",
      version: 0,
      actionId: randomUUID(),
    }),
    /Acesso negado/,
  );
  await service.command(match.id, "p1", {
    type: "surrender",
    version: 0,
    actionId: randomUUID(),
  });
  await service.rematch(match.id, "p1");
  await service.rematch(match.id, "p2", true);
  await assert.rejects(service.rematch(match.id, "p1"), /indisponível/);
});
