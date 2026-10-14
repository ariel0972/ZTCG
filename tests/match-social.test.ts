import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { JSDOM } from "jsdom";
import { fakeDatabase } from "./support/database";
import { MemoryDurableStore } from "./support/durable-store";
import { DurableGame } from "../src/game/durable";
import { Game } from "../src/game/engine";
import { MatchSocial, CHAT_TTL, VIEWER_TTL } from "../src/game/social";
import { createApp } from "../src/application";

const p1 = "1".repeat(24),
  p2 = "2".repeat(24),
  p3 = "3".repeat(24);
async function fixture() {
  const db = await fakeDatabase(),
    store = new MemoryDurableStore();
  let now = Date.now();
  const game = new DurableGame(
    store,
    () => now,
    async () =>
      ({
        deck: { nome: "Teste", mago: "108", cartas: db.decks[0].cartas },
        catalog: db.catalog,
      }) as any,
    async () => {},
  );
  await game.join(p1, "Duelista 1", "deck", randomUUID());
  await game.join(p2, "Duelista 2", "deck", randomUUID());
  const id = (await game.state(p1)).match!.id,
    social = new MatchSocial(game, undefined, () => now);
  const friend = (player = p1, status = "accepted") => {
    db.friendships.push({
      key: [player, p3].sort().join(":"),
      members: [player, p3],
      requestedBy: player,
      status,
    });
  };
  return {
    db,
    store,
    game,
    id,
    social,
    friend,
    advance: (n: number) => {
      now += n;
    },
    now: () => now,
  };
}
test("espectador: amizade de qualquer jogador, revogação imediata nas rotas e dados privados ausentes", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.social.authorize(f.id, p3), { status: 403 });
    f.friend(p2, "pending");
    await assert.rejects(f.social.authorize(f.id, p3), { status: 403 });
    f.db.friendships[0].status = "accepted";
    assert.equal((await f.social.authorize(f.id, p3)).id, f.id);
    const room = f.store.rooms.get(f.id)!;
    const game = Game.restore(room.game);
    game.player(p1).revealHandRound = game.state.round;
    game.state.pendingImpact = {
      base: structuredClone(game.state),
      operation: { user: p1, command: {} },
      decisions: {},
      randoms: [],
      request: {
        key: randomUUID(),
        ownerId: p1,
        cardId: game.player(p1).mage.id,
        source: "attack",
      },
    };
    room.game = game.exportState();
    const beforePresence = await f.store.presence([p1, p2, p3]),
      before = JSON.stringify(room);
    const snapshot = (await f.game.spectatorState(f.id)).match;
    for (const player of snapshot.players) {
      assert.equal("hand" in player, false);
      assert.equal("deck" in player, false);
      assert.equal("revealedHand" in player, false);
      assert.equal(player.handCount, 5);
    }
    for (const slot of snapshot.slots) {
      for (const key of [
        "attackTargets",
        "mountTargets",
        "abilityBlockReasons",
        "canDismount",
      ])
        assert.equal(key in slot, false);
    }
    assert.equal(snapshot.canRespond, false);
    assert.equal("base" in snapshot.pendingImpact!, false);
    assert.equal(JSON.stringify(room), before);
    assert.deepEqual(await f.store.presence([p1, p2, p3]), beforePresence);
    f.db.friendships.length = 0;
    await assert.rejects(f.social.authorize(f.id, p3), { status: 403 });
    await assert.rejects(
      f.game.command(f.id, p3, {
        type: "endTurn",
        commandId: randomUUID(),
        expectedVersion: 0,
      }),
      { status: 403 },
    );
  } finally {
    f.db.restore();
  }
});
test("chat separado: texto e emojis, idempotência, limite por conta e expiração sem depender do ciclo TTL", async () => {
  const f = await fixture();
  try {
    f.friend();
    const before = JSON.stringify(f.store.rooms.get(f.id)),
      messageId = randomUUID();
    const message = await f.social.send(
      f.id,
      p3,
      "Duelista 3",
      messageId,
      " Olá 👋🔥 <img src=x onerror=alert(1)> ",
    );
    assert.equal(message.role, "spectator");
    assert.equal(message.text.startsWith("Olá 👋🔥"), true);
    const retry = await f.social.send(
      f.id,
      p3,
      "Duelista 3",
      messageId,
      message.text,
    );
    assert.equal(retry.id, messageId);
    assert.equal((await f.social.snapshot(f.id)).messages.length, 1);
    await assert.rejects(
      f.social.send(f.id, p3, "Duelista 3", randomUUID(), "Outro"),
      { status: 429 },
    );
    await assert.rejects(
      f.social.send(f.id, p1, "Um", randomUUID(), "x".repeat(301)),
      { status: 422 },
    );
    await assert.rejects(
      f.social.send(f.id, p1, "Um", randomUUID(), "\u0000  "),
      { status: 422 },
    );
    f.advance(1501);
    const player = await f.social.send(
      f.id,
      p1,
      "Um",
      randomUUID(),
      "Boa partida 🎉",
    );
    assert.equal(player.role, "player");
    assert.equal(JSON.stringify(f.store.rooms.get(f.id)), before);
    f.advance(CHAT_TTL - 1501);
    assert.deepEqual(
      (await f.social.snapshot(f.id)).messages.map((m) => m.id),
      [player.id],
    );
    f.advance(1501);
    assert.equal((await f.social.snapshot(f.id)).messages.length, 0);
  } finally {
    f.db.restore();
  }
});
test("chat carrega somente as 50 mensagens recentes, em ordem", async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 55; n++) {
      await f.social.send(f.id, p1, "Um", randomUUID(), String(n));
      f.advance(1501);
    }
    const messages = (await f.social.snapshot(f.id)).messages;
    assert.equal(messages.length, 50);
    assert.equal(messages[0].text, "5");
    assert.equal(messages[49].text, "54");
  } finally {
    f.db.restore();
  }
});
test("espectadores: duas abas contam uma pessoa, saída independente, expiração e nenhuma presença de combate", async () => {
  const f = await fixture();
  try {
    f.friend();
    const a = randomUUID(),
      b = randomUUID(),
      before = JSON.stringify(f.store.rooms.get(f.id));
    await f.social.watch(f.id, p3, "Terceiro", a);
    await f.social.watch(f.id, p3, "Terceiro", b);
    assert.equal((await f.social.snapshot(f.id)).viewers.length, 1);
    assert.equal((await f.store.presence([p3]))[p3], undefined);
    await f.social.watch(f.id, p1, "Jogador", randomUUID());
    assert.equal((await f.social.snapshot(f.id)).viewers.length, 1);
    await f.social.store.leave(f.id, p3, a);
    assert.equal((await f.social.snapshot(f.id)).viewers.length, 1);
    f.advance(VIEWER_TTL + 1);
    assert.equal((await f.social.snapshot(f.id)).viewers.length, 0);
    assert.equal(JSON.stringify(f.store.rooms.get(f.id)), before);
  } finally {
    f.db.restore();
  }
});
test("amigos: atividade online, offline e jogando, apenas amizades aceitas", async () => {
  const f = await fixture();
  try {
    f.friend();
    f.friend(p2, "pending");
    let friends = await f.social.activities(p3);
    assert.equal(friends.length, 1);
    assert.equal(friends[0].activity, "playing");
    assert.equal(friends[0].matchId, f.id);
    f.store.rooms.get(f.id)!.game.state.status = "FINISHED";
    f.advance(100000);
    assert.equal((await f.social.activities(p3))[0].activity, "offline");
    await f.social.store.touch(p1, f.now());
    assert.equal((await f.social.activities(p3))[0].activity, "online");
    f.advance(90001);
    assert.equal((await f.social.activities(p3))[0].activity, "offline");
  } finally {
    f.db.restore();
  }
});
test("HTTP: chat autenticado, campo público sem mãos, SSE público e acesso removido", async () => {
  const f = await fixture();
  process.env.SECRET = "social-tests-012345678901234567890123456789";
  const server = createServer(
    createApp([], async () => mongoose, f.game, f.social),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (path: string, user = p3, body?: object) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${jwt.sign({ id: user }, process.env.SECRET!)}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await call(`/rooms/${f.id}/state`)).status, 403);
    f.friend(p2);
    const view = (await (await call(`/rooms/${f.id}/state`)).json()) as any;
    assert.equal(
      view.match.players.every(
        (p: any) => !p.hand && !p.deck && !p.revealedHand,
      ),
      true,
    );
    const sent = await call(`/rooms/${f.id}/chat`, p3, {
      id: randomUUID(),
      text: "Olá 🔥",
    });
    assert.equal(sent.status, 200);
    assert.equal(((await sent.json()) as any).message.nome, "Duelista 3");
    assert.equal(
      (
        await call(`/rooms/${f.id}/chat`, p3, {
          id: randomUUID(),
          text: "Não",
          nome: "Falso",
        })
      ).status,
      422,
    );
    const stream = await call(`/rooms/${f.id}/stream`),
      reader = stream.body!.getReader();
    const packet = new TextDecoder().decode((await reader.read()).value);
    assert.equal(
      stream.headers.get("content-type")?.includes("text/event-stream"),
      true,
    );
    assert.equal(packet.includes('"hand":'), false);
    assert.equal(packet.includes('"deck":'), false);
    await reader.cancel();
    f.db.friendships.length = 0;
    assert.equal(
      (
        await call(`/rooms/${f.id}/chat`, p3, {
          id: randomUUID(),
          text: "Bloqueado",
        })
      ).status,
      403,
    );
    assert.equal((await call(`/rooms/${f.id}/state`)).status, 403);
    assert.equal((await call(`/rooms/${f.id}/social`)).status, 403);
    assert.equal(
      (await call(`/rooms/${f.id}/watch`, p3, { session: randomUUID() }))
        .status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.db.restore();
  }
});
test("DOM: chat recolhível, emojis e HTML como texto, contador e envios sem duplicação", async () => {
  const modulePath = "../public/JS/match-chat.js",
    { createMatchChat } = await import(modulePath);
  const dom = new JSDOM('<body><section id="chat"></section></body>', {
    url: "https://example.test",
  });
  const host = dom.window.document.getElementById("chat")!,
    sent: any[] = [],
    matchId = randomUUID();
  let confirmations = 0;
  const chat = createMatchChat({
    host,
    user: { id: p1 },
    feedback: {
      unlock() {},
      play() {
        confirmations++;
      },
      close() {},
    },
    request: async (path: string, opts: any) => {
      const body = JSON.parse(opts.body);
      sent.push({ path, body });
      return {
        message: {
          ...body,
          matchId,
          userId: p1,
          nome: "Um",
          role: "player",
          createdAt: Date.now(),
          expiresAt: Date.now() + CHAT_TTL,
        },
      };
    },
  });
  try {
    chat.setMatch(matchId);
    chat.update({
      matchId,
      messages: [
        {
          id: randomUUID(),
          text: '<img src=x onerror="alert(1)"> 👋',
          nome: "Outro",
          userId: p2,
          role: "spectator",
          createdAt: Date.now(),
          expiresAt: Date.now() + CHAT_TTL,
        },
      ],
      viewers: [{ nome: "Amigo", userId: p3 }],
      serverNow: Date.now(),
    });
    assert.equal(host.querySelector("details")!.open, false);
    assert.equal(host.querySelector("img"), null);
    assert.equal(confirmations, 0);
    assert.match(host.textContent!, /<img src=x/);
    assert.match(
      host.querySelector(".match-watchers")!.textContent!,
      /1 pessoa/,
    );
    const emoji = host.querySelector(
      '[aria-label="Adicionar emoji"]',
    ) as HTMLButtonElement;
    const menu = host.querySelector(".match-emoji-menu") as HTMLElement;
    assert.equal(menu.parentElement, host.querySelector("form"));
    emoji.click();
    assert.equal(menu.hidden, false);
    assert.equal(emoji.getAttribute("aria-expanded"), "true");
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
    );
    assert.equal(menu.hidden, true);
    assert.equal(emoji.getAttribute("aria-expanded"), "false");
    const input = host.querySelector("input")!;
    input.value = "Boa partida 🎉";
    host
      .querySelector("form")!
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].path, `/rooms/${matchId}/chat`);
    assert.equal(input.value, "");
    assert.equal(confirmations, 1);
    assert.match(host.textContent!, /Mensagem enviada/);
    assert.equal(host.querySelectorAll(".message-arriving").length, 1);
    (
      host.querySelector(
        '[aria-label="Silenciar som do chat"]',
      ) as HTMLButtonElement
    ).click();
    input.value = "Sem som";
    host
      .querySelector("form")!
      .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(confirmations, 1);
    chat.update({
      matchId: randomUUID(),
      messages: [],
      viewers: [],
      serverNow: Date.now(),
    });
    assert.match(host.textContent!, /Boa partida 🎉/);
  } finally {
    chat.close();
    dom.window.close();
  }
});

test("SSE do jogo continua atualizando enquanto o armazenamento do chat está lento", async () => {
  const f = await fixture();
  process.env.SECRET = "slow-chat-tests-012345678901234567890123456789";
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => {
      started = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const snapshot = f.social.snapshot.bind(f.social);
  f.social.snapshot = async (id) => {
    started();
    await gate;
    return snapshot(id);
  };
  const server = createServer(
    createApp([], async () => mongoose, f.game, f.social),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as any).port}/game/stream`,
      {
        headers: {
          Authorization: `Bearer ${jwt.sign({ id: p1 }, process.env.SECRET!)}`,
        },
      },
    );
    const reader = response.body!.getReader();
    await reader.read();
    await Promise.race([
      entered,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Chat não iniciou")), 4000);
      }),
    ]);
    clearTimeout(timeout);
    const room = (await f.store.room(f.id))!;
    room.game.state.version++;
    await f.store.saveRoom(room.revision, room);
    const next = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Chat bloqueou a partida")),
          4000,
        );
      }),
    ]);
    clearTimeout(timeout);
    assert.equal(
      new TextDecoder()
        .decode(next.value)
        .includes(`"version":${room.game.state.version}`),
      true,
    );
    await reader.cancel();
  } finally {
    clearTimeout(timeout);
    release();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.db.restore();
  }
});

test("transporte de espectador usa somente rotas públicas, entrega deltas sociais e recusa comandos", async () => {
  const modulePath = "../public/JS/game-transport.js",
    { gameTransport } = await import(modulePath);
  const id = randomUUID(),
    paths: string[] = [],
    packets: any[] = [],
    notices: any[] = [];
  const transport = gameTransport({
    readOnly: true,
    statePath: `/rooms/${id}/state`,
    streamPath: `/rooms/${id}/stream`,
    getToken: () => "fixture",
    request: async () => {
      throw Error("Comando privado não permitido");
    },
    fetchStream: async (path: string) => {
      paths.push(path);
      return new Response(
        new ReadableStream({
          start(controller) {
            const frames = [
              { match: { id, version: 1, revision: 1, status: "ACTIVE" } },
              { social: { matchId: id, messages: [], viewers: [] } },
              {
                social: {
                  matchId: id,
                  messages: [{ text: "Olá" }],
                  viewers: [],
                },
              },
            ];
            controller.enqueue(
              new TextEncoder().encode(
                frames
                  .map((data) => `data: ${JSON.stringify(data)}\n\n`)
                  .join(""),
              ),
            );
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  transport.on("match:state", (data: any) => packets.push(data));
  transport.on("match:social", (data: any) => notices.push(data));
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(paths, [`/rooms/${id}/stream`]);
    assert.equal(packets.length, 1);
    assert.equal(notices.length, 2);
    let result: any;
    transport.emit("match:command", {}, (_: any, reply: any) => {
      result = reply;
    });
    assert.equal(result.success, false);
  } finally {
    transport.close();
  }
});
