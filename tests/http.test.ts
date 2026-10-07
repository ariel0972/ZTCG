import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import initial from "../src/data/catalog.json";
import { DurableGame } from "../src/game/durable";
import { MemoryDurableStore } from "./support/durable-store";
test("API: cadastro, login, CRUD, revisões, privacidade e catálogo", async () => {
  process.env.SECRET = "secret-only-for-tests-01234567890123456789";
  const db = await fakeDatabase(),
    store = new MemoryDurableStore(),
    server = createServer(
      createApp([], async () => mongoose, new DurableGame(store)),
    );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const tokens = [1, 2, 3].map((i) =>
    jwt.sign({ id: String(i).repeat(24) }, process.env.SECRET!, {
      expiresIn: "1h",
    }),
  );
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    token = tokens[0],
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as any };
  }
  try {
    assert.equal((await request("/health")).status, 200);
    const catalog = await request("/cards");
    assert.equal(catalog.data.cards.length, 130);
    const schema = await request("/cards/schema");
    assert.ok(schema.data.efeitos.includes("heal"));
    const registration = await request("/auth/registrar", "POST", {
      nome: "Teste novo",
      email: "novo@test.local",
      senha: "segredo-123",
      confirmPassword: "segredo-123",
    });
    assert.equal(registration.status, 201);
    assert.equal(
      (
        await request("/auth/registrar", "POST", {
          nome: "Teste novo",
          email: "novo@test.local",
          senha: "segredo-123",
          confirmPassword: "segredo-123",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/auth/logar", "POST", {
          email: "novo@test.local",
          senha: "incorreta",
        })
      ).status,
      401,
    );
    const login = await request("/auth/logar", "POST", {
      email: "novo@test.local",
      senha: "segredo-123",
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.senha, undefined);
    const decoded = jwt.decode(login.data.token);
    assert.ok(decoded && typeof decoded !== "string" && decoded.exp);
    const mine = await request("/auth/me");
    assert.equal(mine.data.user.senha, undefined);
    assert.equal((await request(`/user/${"2".repeat(24)}`)).status, 403);
    assert.equal((await request(`/decks/user/${"2".repeat(24)}`)).status, 403);
    assert.equal((await request("/decks", "GET", undefined, "")).status, 401);
    const created = await request("/decks/user", "POST", {
      nome: "Rascunho",
      icone: "/assets/icons/feitiço.svg",
      verso: "fire",
      cartas: [{ id: 21, ataque: 999 }],
      mago: null,
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.deck.icone, "/assets/icons/feitiço.svg");
    assert.equal(created.data.deck.verso, "fire");
    const savedAppearance = await request("/decks");
    assert.equal(
      savedAppearance.data.decks.find(
        (d: any) => d._id === created.data.deck._id,
      ).verso,
      "fire",
    );
    assert.deepEqual(created.data.deck.cartas, ["021"]);
    const id = created.data.deck._id;
    assert.equal((await request(`/decks/${id}/play`)).status, 422);
    assert.equal(
      (
        await request(`/decks/${id}`, "PUT", {
          nome: "Atualizado",
          cartas: ["021"],
          mago: "108",
          revisao: 0,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/decks/${id}`, "PUT", {
          nome: "Aba antiga",
          cartas: [],
          mago: null,
          revisao: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (await request(`/decks/${id}`, "DELETE", undefined, tokens[1])).status,
      404,
    );
    assert.equal((await request(`/decks/${id}`, "DELETE")).status, 200);
    assert.equal((await request("/decks/invalid/play")).status, 422);
    assert.equal((await request("/admin/cards")).status, 401);
    const unsupported = {
      numeroCatalogo: "999",
      nome: "Futuro",
      tipo: "Feitico",
      custoMana: 1,
      alvo: "Global",
      efeitos: [{ id: "unknown" }],
      publicado: true,
    };
    assert.equal(
      (
        await request(
          "/admin/cards/999",
          "PUT",
          { card: unsupported, expectedVersion: 1 },
          tokens[2],
        )
      ).status,
      422,
    );
    const definition = { ...unsupported, publicado: false };
    assert.equal(
      (
        await request(
          "/admin/cards/999",
          "PUT",
          { card: definition, expectedVersion: 1 },
          tokens[2],
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/admin/cards/999",
          "PUT",
          { card: definition, expectedVersion: 1 },
          tokens[2],
        )
      ).status,
      409,
    );
    // Uma carta antiga sem versao pode ser revisada explicitamente no editor.
    const legacy = { ...definition, numeroCatalogo: "998" };
    db.cards.push(legacy);
    assert.equal(
      (
        await request(
          "/admin/cards/998",
          "PUT",
          { card: legacy, expectedVersion: 1 },
          tokens[2],
        )
      ).status,
      200,
    );
    assert.equal(db.cards.find((c) => c.numeroCatalogo === "998").versao, 2);
    assert.equal((await request("/matches")).status, 200);
    // A record written outside the admin API must still be checked before queueing.
    const cardId = db.decks[0].cartas[0];
    const local = initial.find((card) => card.numeroCatalogo === cardId)!;
    db.cards.push({
      ...local,
      publicado: true,
      habilidadesAtivas: [
        {
          id: "broken",
          nome: "Quebrada",
          custoMana: 1,
          alvo: "UnicoInimigo",
          efeitos: [{ id: "tornado", valor: 1 }],
        },
      ],
    });
    const invalidDeck = await request(`/decks/${db.decks[0]._id}/play`);
    assert.equal(invalidDeck.status, 422);
    assert.equal(invalidDeck.data.code, "INVALID_DECK");
    const queue = await request("/game/event", "POST", {
      event: "queue:join",
      data: { deckId: String(db.decks[0]._id) },
      requestId: randomUUID(),
    });
    assert.equal(queue.status, 422);
    assert.equal((await store.lobby()).data.waiting.length, 0);
    assert.equal(
      (
        await request("/auth/logar", "POST", {
          email: { $ne: null },
          senha: "x",
        })
      ).status,
      422,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.restore();
  }
});
test("páginas e healthcheck continuam disponíveis sem banco", async () => {
  const server = createServer(
    createApp([], async () => {
      throw new Error("offline");
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(base + "/")).status, 200);
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await fetch(base + "/cards")).status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
