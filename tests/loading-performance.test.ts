import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { JSDOM } from "jsdom";
import mongoose from "mongoose";
import { ReadCache } from "../src/lib/read-cache";
import { getCatalog, invalidateCatalog } from "../src/services/catalog";
import CardModel from "../src/db/models/Card";
import User from "../src/db/models/user";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test("cache: compartilha concorrência, expira, limita entradas e não guarda falhas nem ressuscita invalidações", async () => {
  let now = 0,
    reads = 0;
  const cache = new ReadCache<number>(100, 2, () => now);
  const load = async () => ++reads;
  assert.deepEqual(
    await Promise.all(Array.from({ length: 20 }, () => cache.get("a", load))),
    Array(20).fill(1),
  );
  now = 99;
  assert.equal(await cache.get("a", load), 1);
  now = 100;
  assert.equal(await cache.get("a", load), 2);
  await cache.get("b", load);
  await cache.get("c", load);
  assert.equal(await cache.get("a", load), 5);
  await assert.rejects(
    cache.get("error", async () => {
      throw Error("offline");
    }),
  );
  assert.equal(await cache.get("error", load), 6);
  let resolve!: (value: number) => void;
  const old = cache.get(
    "race",
    () =>
      new Promise<number>((r) => {
        resolve = r;
      }),
  );
  await tick();
  cache.clear("race");
  assert.equal(await cache.get("race", load), 7);
  resolve(999);
  assert.equal(await old, 999);
  assert.equal(await cache.get("race", load), 7);
});

test("catálogo: 20 pedidos fazem uma leitura, cópias isoladas e edição invalida imediatamente", async () => {
  const original = CardModel.find;
  let reads = 0;
  (CardModel as any).find = () => ({
    lean: async () => {
      reads++;
      return [];
    },
  });
  invalidateCatalog();
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => getCatalog()),
    );
    assert.equal(reads, 1);
    const name = results[1][0].nome;
    results[0][0].nome = "mutated";
    assert.equal((await getCatalog())[0].nome, name);
    invalidateCatalog();
    await getCatalog();
    assert.equal(reads, 2);
  } finally {
    CardModel.find = original;
    invalidateCatalog();
  }
});

test("HTTP: ranking reutiliza consultas e assets versionados/ETag não acessam o banco", async () => {
  const db = await fakeDatabase();
  let connections = 0,
    reads = 0;
  const original = User.find;
  (User as any).find = (...args: any[]) => {
    reads++;
    return (original as any)(...args);
  };
  const server = createServer(
    createApp([], async () => {
      connections++;
      return mongoose;
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const source = await readFile("public/JS/image-sources.js", "utf8");
    const url = source.match(/\/assets\/optimized\/[^"\s]+\.webp/)![0];
    const asset = await fetch(base + url);
    await asset.arrayBuffer();
    assert.equal(asset.status, 200);
    assert.equal(
      asset.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    const revalidated = await fetch(base + url, {
      cache: "no-cache",
      headers: { "If-None-Match": asset.headers.get("etag")! },
    });
    assert.equal(revalidated.status, 304);
    assert.equal(connections, 0);
    const script = await fetch(base + "/JS/auth.js");
    assert.equal(
      script.headers.get("cache-control"),
      "public, max-age=0, must-revalidate",
    );
    await script.text();
    for (let i = 0; i < 5; i++) {
      const response = await fetch(base + "/rankings");
      assert.equal(response.status, 200);
      await response.json();
    }
    assert.equal(reads, 2);
    const invalid = await fetch(base + "/rankings?mode=invalid");
    assert.equal(invalid.status, 422);
    await invalid.text();
    assert.equal(reads, 2);
    const cards = await fetch(base + "/cards");
    assert.match(cards.headers.get("cache-control")!, /public, max-age=60/);
    await cards.text();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});

test("artes: variantes locais menores, miniaturas e recuperação de imagem externa sem srcset antigo", async () => {
  const modulePath = "../public/JS/image-sources.js";
  const { setImageSource, optimizedImageUrl } = await import(modulePath);
  const dom = new JSDOM("");
  const img = dom.window.document.createElement("img");
  try {
    const original = "/assets/Cards/Arqueiro.png";
    setImageSource(img, original, true);
    assert.match(img.srcset, /320w/);
    assert.match(img.srcset, /750w/);
    assert.equal(img.getAttribute("src"), original);
    const full = optimizedImageUrl(original);
    assert.ok(
      (await stat("public" + full)).size <
        (await stat("public" + original)).size,
    );
    setImageSource(img, "https://example.test/custom.png");
    assert.equal(img.srcset, "");
    assert.equal(img.sizes, "");
    assert.equal(
      optimizedImageUrl("https://example.test/custom.png"),
      "https://example.test/custom.png",
    );
  } finally {
    dom.window.close();
  }
});

test("API pública não envia token e respostas privadas continuam autenticadas", async () => {
  const dom = new JSDOM("", { url: "https://example.test" });
  dom.window.sessionStorage.setItem("token", "private-account");
  const requests: any[] = [];
  const source = (await readFile("public/JS/auth.js", "utf8"))
    .replace(/^import.*;\s*/gm, "")
    .replace(/^export /gm, "");
  const api = new Function(
    "sessionStorage",
    "localStorage",
    "fetch",
    `${source}\nreturn api;`,
  )(
    dom.window.sessionStorage,
    dom.window.localStorage,
    async (path: string, options: any) => {
      requests.push({ path, ...options });
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    },
  );
  try {
    for (const path of [
      "/cards",
      "/cards/schema",
      "/rules-data",
      "/rankings?mode=wins",
      "/decks",
      "/cards/validate",
    ])
      await api(path);
    for (const request of requests.slice(0, 4))
      assert.equal(request.headers.Authorization, undefined);
    for (const request of requests.slice(4))
      assert.equal(request.headers.Authorization, "Bearer private-account");
  } finally {
    dom.window.close();
  }
});

test("Mongo: leituras leves do lobby e revisões concorrentes compartilhadas, invalidadas ao salvar", async () => {
  const { MongoGameStore } = await import("../src/game/store");
  const lobby = mongoose.model("GameLobby"),
    rooms = mongoose.model("GameRoom");
  const originalLobby = lobby.findById,
    originalRoom = rooms.findById,
    originalWrite = rooms.updateOne;
  let projection: any,
    reads = 0,
    revision = 1;
  (lobby as any).findById = () => ({
    select: (fields: any) => {
      projection = fields;
      return {
        lean: async () => ({
          data: {
            active: { a: "match" },
            waiting: [{ id: "b", joinedAt: 10 }],
          },
        }),
      };
    },
  });
  (rooms as any).findById = () => ({
    select: () => ({
      lean: async () => {
        reads++;
        return { revision };
      },
    }),
  });
  (rooms as any).updateOne = async () => {
    revision++;
    return { modifiedCount: 1 };
  };
  try {
    const store = new MongoGameStore();
    assert.equal((await store.lobbyState()).waiting[0].id, "b");
    assert.deepEqual(Object.keys(projection).sort(), [
      "data.active",
      "data.waiting.id",
      "data.waiting.joinedAt",
    ]);
    assert.deepEqual(
      await Promise.all(
        Array.from({ length: 20 }, () => store.roomRevision("match")),
      ),
      Array(20).fill(1),
    );
    assert.equal(reads, 1);
    await store.saveRoom(1, { id: "match", revision: 1 } as any);
    assert.equal(await store.roomRevision("match"), 2);
    assert.equal(
      reads,
      1,
      "a revisão confirmada é reutilizada sem consulta adicional",
    );
    (rooms as any).updateOne = async () => ({ modifiedCount: 0 });
    assert.equal(
      await store.saveRoom(0, { id: "match", revision: 0 } as any),
      false,
    );
    assert.equal(await store.roomRevision("match"), 2);
    assert.equal(reads, 2, "CAS recusado exige nova leitura da revisão");
  } finally {
    lobby.findById = originalLobby;
    rooms.findById = originalRoom;
    rooms.updateOne = originalWrite;
  }
});
