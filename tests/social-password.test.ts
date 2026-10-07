import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { fakeDatabase } from "./support/database";
import { MemoryDurableStore } from "./support/durable-store";
import { DurableGame } from "../src/game/durable";
import { createApp } from "../src/application";
import { passwordRoutes } from "../src/routes/passwordRoutes";
test("recuperação: resposta genérica, hash, expiração, uso único e revogação de sessão", async () => {
  const db = await fakeDatabase();
  let now = Date.now(),
    sent: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(
    passwordRoutes(
      async (_email, token) => {
        sent.push(token);
      },
      () => ({}) as any,
      () => now,
    ),
  );
  app.use((e: any, _req: any, res: any, _next: any) =>
    res.status(e.status ?? 422).json({ success: false }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  async function post(path: string, body: object) {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  try {
    const known = await post("/forgot-password", { email: "p1@test.local" }),
      unknown = await post("/forgot-password", { email: "unknown@test.local" });
    assert.deepEqual(known, unknown);
    assert.equal(sent.length, 1);
    assert.notEqual(db.users[0].resetTokenHash, sent[0]);
    const data = {
      token: sent[0],
      senha: "nova-senha-123",
      confirmPassword: "nova-senha-123",
    };
    now += 1800001;
    assert.equal((await post("/reset-password", data)).status, 422);
    await post("/forgot-password", { email: "p1@test.local" });
    data.token = sent[1];
    const results = await Promise.all([
      post("/reset-password", data),
      post("/reset-password", data),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
    assert.equal(db.users[0].sessionVersion, 1);
    assert.equal(db.users[0].resetTokenHash, undefined);
    assert.ok(await bcrypt.compare(data.senha, db.users[0].senha));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
test("amigos: consentimento, privacidade, convites por dono, validade e partida privada idempotente", async () => {
  process.env.SECRET = "secret-only-for-tests-01234567890123456789";
  const db = await fakeDatabase(),
    store = new MemoryDurableStore();
  const load = async (deckId: string, user: string) => {
    const deck = db.decks.find((d) => d._id === deckId && d.userId === user);
    if (!deck) throw new Error("wrong owner");
    return { deck, catalog: db.catalog };
  };
  const game = new DurableGame(store, Date.now, load as any, async () => {}),
    server = createServer(createApp([], async () => mongoose, game));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const ids = [1, 2, 3].map((i) => String(i).repeat(24)),
    tokens = ids.map((id) => jwt.sign({ id }, process.env.SECRET!));
  async function req(path: string, method = "GET", body?: object, who = 0) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens[who]}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: (await r.json()) as any };
  }
  try {
    assert.equal(
      (await req("/friends/requests", "POST", { userId: ids[0] })).status,
      422,
    );
    const search = await req("/friends/search?q=Duelista");
    assert.equal(search.data.users.length, 2);
    assert.equal(search.data.users[0].email, undefined);
    const invite = { userId: ids[1], deckId: "4".repeat(24) };
    assert.equal((await req("/friends/invites", "POST", invite)).status, 403);
    await req("/friends/requests", "POST", { userId: ids[1] });
    assert.equal(
      (await req(`/friends/requests/${ids[1]}/accept`, "POST", {})).status,
      404,
    );
    assert.equal(
      (await req(`/friends/requests/${ids[0]}/accept`, "POST", {}, 1)).status,
      200,
    );
    const created = await req("/friends/invites", "POST", invite);
    assert.equal(created.status, 200);
    const path = `/friends/invites/${created.data.id}/accept`;
    assert.equal(
      (await req(path, "POST", { deckId: "6".repeat(24) }, 2)).status,
      404,
    );
    const accepted = await req(path, "POST", { deckId: "5".repeat(24) }, 1);
    assert.equal(accepted.status, 200);
    const repeat = await req(path, "POST", { deckId: "5".repeat(24) }, 1);
    assert.equal(repeat.data.matchId, accepted.data.matchId);
    assert.equal((await game.state(ids[0])).match!.id, accepted.data.matchId);
    assert.equal((await game.state(ids[1])).match!.id, accepted.data.matchId);
    assert.equal(
      (await req("/friends/invites", "GET", undefined, 2)).data.invites.length,
      0,
    );
    const expired = await req("/friends/invites", "POST", invite);
    db.invitations.find((i) => i.invitationId === expired.data.id).expires =
      new Date(0);
    assert.equal(
      (
        await req(
          `/friends/invites/${expired.data.id}/accept`,
          "POST",
          { deckId: "5".repeat(24) },
          1,
        )
      ).status,
      409,
    );
    db.users[0].sessionVersion = 1;
    assert.equal((await req("/auth/me")).status, 401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
