import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { Game } from "../src/game/engine";
import {
  aiEntry,
  chooseAiCommand,
  aiNeedsAction,
  AI_DELAY_MS,
} from "../src/game/ai";
import { DurableGame } from "../src/game/durable";
import { MemoryDurableStore } from "./support/durable-store";
import { fakeDatabase } from "./support/database";
import { profileExperience } from "../src/services/profiles";
import { resultEligibility } from "../src/services/result-policy";
const catalog = raw.map((c) => cardSchema.parse(c));

test("IA mobiliza pelas regras reais, não se passa por conta e persiste entre coordenadores", async () => {
  let now = 1000000;
  const store = new MemoryDurableStore(),
    entry = aiEntry(catalog, now);
  const load = async () => ({ deck: entry.deck, catalog }) as any;
  const service = () =>
    new DurableGame(
      store,
      () => now,
      load,
      async () => {},
    );
  const uid = "1".repeat(24),
    request = randomUUID();
  const first = await service().startAi(uid, "Aprendiz", "deck", request);
  assert.equal(
    (await service().startAi(uid, "Aprendiz", "deck", request)).matchId,
    first.matchId,
  );
  const room = store.rooms.get(first.matchId as string)!;
  assert.equal(room.mode, "ai");
  const bot = room.entries.find((e) => e.bot)!;
  assert.equal((await store.lobby()).data.active[bot.id], undefined);
  // Give the bot a known ordinary troop to make preparation deterministic.
  const g = Game.restore(room.game),
    normal = g
      .player(bot.id)
      .deck.find(
        (c) =>
          c.tipo === "Tropa" && !c.custoEntrada && c.subtipo !== "Invocação",
      )!;
  g.player(bot.id).hand = [normal];
  g.player(bot.id).deck = g
    .player(bot.id)
    .deck.filter((c) => c.id !== normal.id);
  room.game = g.exportState();
  now += AI_DELAY_MS - 1;
  await store.touch(uid, now);
  assert.equal((await service().state(uid)).match?.version, g.state.version);
  now += 1;
  const state = await service().state(uid);
  assert.equal(state.match?.mode, "ai");
  assert.ok(
    state.match?.slots.some(
      (s) => s.ownerId === bot.id && s.card?.id === normal.id,
    ),
  );
  assert.equal(
    store.rooms.get(room.id)!.game.state.players.find((p) => p.id === bot.id)!
      .mana,
    5,
  );
  const recovered = await service().state(uid);
  assert.equal(recovered.match?.id, room.id);
  assert.ok(recovered.match?.slots.some((s) => s.card?.id === normal.id));
  const version = recovered.match!.version;
  now += AI_DELAY_MS - 1;
  assert.equal((await service().state(uid)).match?.version, version);
  now += 1;
  assert.equal((await service().state(uid)).match?.version, version + 1);
});
test("IA respeita dono da reação e só escolhe comandos válidos sem alterar a simulação original", () => {
  const bot = aiEntry(catalog, 0),
    human = { ...bot, id: "1".repeat(24), nome: "Aprendiz", bot: false };
  const g = new Game(randomUUID(), [human, bot], catalog, () => 0.2);
  const original = JSON.stringify(g.exportState());
  const cmd = chooseAiCommand(g, bot.id)!;
  assert.equal(JSON.stringify(g.exportState()), original);
  g.execute(bot.id, {
    ...cmd,
    actionId: randomUUID(),
    version: g.state.version,
  });
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.current = human.id;
  assert.equal(aiNeedsAction(g, bot.id), false);
});
test("vitória contra IA grava uma vez, paga XP normal e fica fora de todos os resultados ranqueados", async () => {
  const db = await fakeDatabase();
  let now = 1000000;
  const store = new MemoryDurableStore(),
    service = () => new DurableGame(store, () => now);
  const uid = "1".repeat(24);
  try {
    const created = await service().startAi(
        uid,
        "Aprendiz",
        "4".repeat(24),
        randomUUID(),
      ),
      room = store.rooms.get(created.matchId as string)!;
    const g = Game.restore(room.game),
      bot = room.entries.find((e) => e.bot)!;
    g.state.phase = "BATTLE";
    g.state.turn = 6;
    g.state.current = uid;
    g.player(bot.id).mage.hpAtual = 1;
    g.player(uid).preparation.ready = true;
    for (const slot of g.state.slots)
      if (slot.kind !== "Mago") {
        slot.card = null;
        slot.rider = null;
        slot.structure = null;
      }
    room.game = g.exportState();
    room.deadline = now + 120000;
    room.aiNextAt = now + 10000;
    const source = g.state.slots.find(
        (s) => s.ownerId === uid && s.kind === "Mago",
      )!,
      target = g.state.slots.find(
        (s) => s.ownerId === bot.id && s.kind === "Mago",
      )!;
    await service().command(room.id, uid, {
      type: "attack",
      slotId: source.id,
      targetId: target.id,
      version: g.state.version,
      actionId: randomUUID(),
    });
    await service().state(uid);
    await service().project(store.rooms.get(room.id)!);
    assert.equal(db.matches.length, 1);
    assert.equal(db.matches[0].mode, "ai");
    assert.equal(db.matches[0].ranked, false);
    assert.equal(db.matches[0].historyVisible, true);
    assert.equal(db.matches[0].awardXp, true);
    assert.equal(db.matches[0].players.find((p: any) => p.isAI).nome, bot.nome);
    const xp = await profileExperience(uid);
    assert.equal(xp.stats.vitorias, 0);
    assert.equal(xp.stats.partidasClassificadas, 0);
    assert.equal(xp.stats.partidas, 1);
    assert.equal(xp.awards.get(room.id)?.xpGanho, 52);
    assert.equal(
      db.users.find((u) => u._id === bot.id),
      undefined,
    );
    assert.equal(db.users[0].ranking.partidas, 0);
    assert.equal(db.decks[0].ranking.partidas, 0);
    const rematch = await service().rematch(room.id, uid);
    assert.equal(rematch.waiting, false);
    const next = await service().state(uid);
    assert.notEqual(next.match?.id, room.id);
    assert.equal(next.match?.mode, "ai");
    assert.equal((await service().rematch(room.id, uid)).waiting, false);
    assert.equal((await service().state(uid)).match?.id, next.match?.id);
  } finally {
    db.restore();
  }
});
test("IA mantém restrições normais de desistência sem entrar no ranking", () => {
  assert.deepEqual(
    resultEligibility({
      mode: "ai",
      rulesVersion: 2,
      turns: 3,
      reason: "Desistência.",
    }),
    { historyVisible: false, ranked: false, countGame: false, awardXp: false },
  );
  assert.deepEqual(
    resultEligibility({
      mode: "ai",
      rulesVersion: 2,
      turns: 8,
      reason: "Mago derrotado.",
    }),
    { historyVisible: true, ranked: false, countGame: true, awardXp: true },
  );
});

test("IA joga um combate inteiro com tropas, feitiços e ataques sem laço ou ação ilegal", () => {
  const one = aiEntry(catalog, 0),
    two = aiEntry(catalog, 0),
    g = new Game(randomUUID(), [one, two], catalog, () => 0.6);
  const actions = new Set<string>();
  let n = 0;
  while (g.state.status === "ACTIVE" && n++ < 500) {
    if (g.state.phase === "COIN_TOSS" && g.state.coinToss?.result) {
      g.timeout();
      continue;
    }
    const actor = g.state.players.find((p) => aiNeedsAction(g, p.id));
    assert.ok(actor, "No active actor");
    const command = chooseAiCommand(g, actor.id)!;
    assert.ok(command);
    actions.add(String(command.type));
    g.execute(actor.id, {
      ...command,
      actionId: randomUUID(),
      version: g.state.version,
    });
  }
  assert.equal(g.state.status, "FINISHED");
  assert.ok(actions.has("attack"));
  assert.ok(actions.has("play"));

  assert.ok(g.state.turn >= 3);
});

test("IA usa habilidade quando útil e anuncia feitiço sem conhecer reação oculta do humano", () => {
  const bot = aiEntry(catalog, 0),
    human = { ...bot, id: "1".repeat(24), nome: "Aprendiz", bot: false };
  const g = new Game(randomUUID(), [human, bot], catalog, () => 0.2);
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.current = bot.id;
  g.player(bot.id).mana = 20;
  g.player(bot.id).hand = [];
  const card = (ref: string, owner: string) => {
    const c = catalog.find((c) => c.numeroCatalogo === ref)!;
    return {
      ...structuredClone(c),
      id: randomUUID(),
      ownerId: owner,
      hpAtual: c.hp ?? 0,
      attacked: false,
      usedAbility: false,
      statuses: [],
    };
  };
  const source = g.state.slots.find(
      (s) => s.ownerId === bot.id && s.kind === "Tropa" && s.column === 1,
    )!,
    target = g.state.slots.find(
      (s) => s.ownerId === human.id && s.kind === "Tropa" && s.column === 1,
    )!;
  source.card = card("023", bot.id);
  target.card = card("020", human.id);
  target.card.statuses = [{ nome: "Esconder", turnosRestantes: 2 }];
  const ability = chooseAiCommand(g, bot.id)!;
  assert.equal(ability.type, "ability");
  g.execute(bot.id, {
    ...ability,
    actionId: randomUUID(),
    version: g.state.version,
  });
  g.state.slots.find((s) => s.id === source.id)!.card!.attacked = true;
  g.player(bot.id).combatStarted = true;
  const fire = card("001", bot.id);
  g.player(bot.id).hand = [fire];
  g.state.slots.find((s) => s.id === target.id)!.card!.statuses = [];
  g.state.slots.find((s) => s.id === target.id)!.card!.hpAtual = 3;
  const before = chooseAiCommand(g, bot.id);
  g.player(human.id).hand = [card("002", human.id)];
  g.player(human.id).mana = 20;
  const after = chooseAiCommand(g, bot.id);
  assert.deepEqual(after, before);
  assert.equal(after!.type, "play");
  assert.equal(after!.cardId, fire.id);
  g.execute(bot.id, {
    ...after,
    actionId: randomUUID(),
    version: g.state.version,
  });
  assert.ok(g.state.pendingSpell);
  assert.equal(aiNeedsAction(g, bot.id), false);
});

test("IA aguarda uma pausa inteira depois de passar o turno ou expirar o relógio humano", async () => {
  let now = 1000000;
  const store = new MemoryDurableStore(),
    entry = aiEntry(catalog, now),
    service = () =>
      new DurableGame(
        store,
        () => now,
        async () => ({ deck: entry.deck, catalog }) as any,
        async () => {},
      ),
    uid = "1".repeat(24);
  const created = await service().startAi(
    uid,
    "Aprendiz",
    "deck",
    randomUUID(),
  );
  const room = store.rooms.get(created.matchId as string)!,
    bot = room.entries.find((e) => e.bot)!;
  const g = Game.restore(room.game);
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.current = uid;
  for (const p of g.state.players) {
    p.mana = 20;
    p.preparation.ready = true;
  }
  room.game = g.exportState();
  room.aiNextAt = now - 100000;
  room.deadline = now + 120000;
  const passed = await service().command(room.id, uid, {
    type: "endTurn",
    version: g.state.version,
    actionId: randomUUID(),
  });
  const version = passed.state.match.version;
  assert.equal(passed.state.match.current, bot.id);
  assert.equal(passed.state.match.aiNextAt, now + AI_DELAY_MS);
  assert.equal((await service().state(uid)).match?.version, version);
  now += AI_DELAY_MS - 1;
  assert.equal((await service().state(uid)).match?.version, version);
  now += 1;
  assert.equal((await service().state(uid)).match?.version, version + 1);
  const current = store.rooms.get(room.id)!,
    expiring = Game.restore(current.game);
  expiring.state.current = uid;
  current.game = expiring.exportState();
  current.deadline = now - 1;
  current.aiNextAt = now - 100000;
  const timed = await service().state(uid);
  assert.equal(timed.match?.version, expiring.state.version + 1);
  assert.equal(timed.match?.current, bot.id);
  assert.equal(timed.match?.aiNextAt, now + AI_DELAY_MS);
});
