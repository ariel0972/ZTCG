import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { Game } from "../src/game/engine";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { DurableGame } from "../src/game/durable";
import { MongoGameStore } from "../src/game/store";
import { createApp } from "../src/application";
import User from "../src/db/models/user";

// Synthetic rooms only. Never use the application database or real accounts.
async function main() {
  assert.ok(process.env.MONGO_TEST_URL, "Set MONGO_TEST_URL explicitly");
  const database = `ztcg_test_benchmark_${randomUUID().replace(/-/g, "")}`;
  const label = process.argv[2] || "sample";
  assert.match(label, /^[a-z0-9-]+$/);
  process.env.SECRET = "synthetic-performance-fixture-only-0123456789";
  await mongoose.connect(process.env.MONGO_TEST_URL!, {
    dbName: database,
    autoCreate: false,
    autoIndex: false,
    monitorCommands: true,
  });
  let safeToDrop = false;
  const catalog = initial.map((c) => cardSchema.parse(c));
  const deck = {
    nome: "Benchmark",
    mago: "108",
    cartas: catalog
      .filter((c) => c.publicado && c.tipo === "Tropa")
      .flatMap((c) => Array(3).fill(c.numeroCatalogo))
      .slice(0, 40),
  };
  const stores = [new MongoGameStore(), new MongoGameStore()];
  const games = stores.map(
    (store) =>
      new DurableGame(
        store,
        Date.now,
        async () => ({ deck, catalog }) as any,
        async () => {},
      ),
  );
  const servers = games.map((game) =>
    createServer(createApp([], async () => mongoose, game)),
  );
  const aborts: AbortController[] = [];
  type Counts = {
    operations: Record<string, number>;
    requestBytes: number;
    responseBytes: number;
  };
  const counts = (): Counts => ({
    operations: {},
    requestBytes: 0,
    responseBytes: 0,
  });
  let active: Counts | undefined;
  const requests = new Map<number, Counts>();
  mongoose.connection.getClient().on("commandStarted", (event: any) => {
    if (
      !active ||
      !["find", "update", "aggregate", "delete", "insert"].includes(
        event.commandName,
      )
    )
      return;
    const key = `${event.commandName}:${event.command[event.commandName]}`;
    active.operations[key] = (active.operations[key] || 0) + 1;
    active.requestBytes += mongoose.mongo.BSON.calculateObjectSize(
      event.command,
    );
    requests.set(event.requestId, active);
  });
  mongoose.connection.getClient().on("commandSucceeded", (event: any) => {
    const bucket = requests.get(event.requestId);
    if (bucket)
      bucket.responseBytes += mongoose.mongo.BSON.calculateObjectSize(
        event.reply,
      );
    requests.delete(event.requestId);
  });
  const ids = ["1".repeat(24), "2".repeat(24)];
  const headers = (user: number) => ({
    Authorization: `Bearer ${jwt.sign({ id: ids[user] }, process.env.SECRET!)}`,
    "Content-Type": "application/json",
  });
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  try {
    assert.equal(
      (await mongoose.connection.db!.listCollections().toArray()).length,
      0,
    );
    safeToDrop = true;
    for (const [index, id] of ids.entries())
      await User.create({
        _id: id,
        nome: `Test ${index}`,
        email: `test${index}@test.local`,
        senha: "fixture",
      });
    for (const server of servers)
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
    const bases = servers.map(
      (server) => `http://127.0.0.1:${(server.address() as any).port}`,
    );
    await games[0].join(ids[0], "One", "deck", randomUUID());
    await games[0].join(ids[1], "Two", "deck", randomUUID());
    const room = (await games[0].state(ids[0])).match!;
    const template = (await stores[0].room(room.id))!;
    // Identical shuffle and card definitions on both revisions of the server.
    template.game = new Game(
      room.id,
      template.entries,
      catalog,
      () => 0.37,
    ).exportState();
    const fixtureHash = createHash("sha256")
      .update(
        JSON.stringify({
          deck,
          catalog,
          hands: template.game.state.players.map((player) =>
            player.hand.map((card) => card.numeroCatalogo),
          ),
        }),
      )
      .digest("hex");
    async function stream(instance: number, user: number) {
      const abort = new AbortController();
      aborts.push(abort);
      const response = await fetch(bases[instance] + "/game/stream", {
        headers: headers(user),
        signal: abort.signal,
      });
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      let buffer = "";
      async function next(version?: number): Promise<any> {
        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (!frame.startsWith("data: ")) continue;
            const data = JSON.parse(frame.slice(6));
            if (
              data.match &&
              (version === undefined || data.match.version >= version)
            )
              return data;
          } else {
            const chunk = await reader.read();
            assert.ok(!chunk.done);
            buffer += new TextDecoder().decode(chunk.value);
          }
        }
      }
      const initialState = await next();
      for (const player of initialState.match.players)
        if (player.id !== ids[user]) assert.equal("hand" in player, false);
      return { next, close: () => abort.abort() };
    }
    const results: Record<string, unknown> = {};
    for (const instance of [0, 1]) {
      const metrics = counts(),
        acknowledgments: number[] = [],
        propagation: number[] = [];
      for (let i = 0; i < 16; i++) {
        const current = (await stores[0].room(room.id))!;
        const reset = structuredClone(template);
        reset.revision = current.revision;
        reset.lastAdvancedAt = Date.now();
        reset.deadline = Date.now() + 120000;
        await stores[0].saveRoom(current.revision, reset);
        const peer = await stream(instance, 1);
        await sleep((i * 97) % 700);
        active = metrics;
        const started = performance.now();
        const arrived = peer.next(1).then(() => performance.now() - started);
        const response = await fetch(bases[0] + "/game/event", {
          method: "POST",
          headers: headers(0),
          body: JSON.stringify({
            event: "match:command",
            requestId: randomUUID(),
            data: {
              matchId: room.id,
              command: { type: "endTurn", version: 0, actionId: randomUUID() },
            },
          }),
        });
        const data = (await response.json()) as any;
        assert.equal(response.status, 200, JSON.stringify(data));
        assert.equal(data.state.match.version, 1);
        acknowledgments.push(performance.now() - started);
        propagation.push(await arrived);
        active = undefined;
        peer.close();
      }
      const percentiles = (samples: number[]) => {
        samples.sort((a, b) => a - b);
        return {
          p50: +samples[Math.ceil(samples.length * 0.5) - 1].toFixed(1),
          p95: +samples[Math.ceil(samples.length * 0.95) - 1].toFixed(1),
        };
      };
      results[instance ? "otherWorker" : "sameWorker"] = {
        samples: 16,
        acknowledgmentMs: percentiles(acknowledgments),
        opponentMs: percentiles(propagation),
        ...metrics,
      };
    }
    const peers = await Promise.all([stream(0, 0), stream(0, 1)]);
    const idle = counts();
    active = idle;
    await sleep(12000);
    active = undefined;
    peers.forEach((peer) => peer.close());
    const output = {
      label,
      fixtureHash,
      environment:
        "loopback HTTP, MongoDB real, synthetic 40-card decks; no CDN or WAN",
      idle: { seconds: 12, players: 2, ...idle },
      ...results,
    };
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/game-performance-${label}.json`,
      JSON.stringify(output, null, 2),
    );
    console.log(JSON.stringify(output));
  } finally {
    active = undefined;
    aborts.forEach((abort) => abort.abort());
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (safeToDrop) await mongoose.connection.db!.dropDatabase();
    await mongoose.disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
