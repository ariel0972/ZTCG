import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { fakeDatabase } from "./support/database";
import { createApp } from "../src/application";
import Tutorial from "../src/db/models/tutorial";
import {
  tutorialState,
  tutorialAction,
  restartTutorial,
} from "../src/services/tutorial";
import { nextTutorialAction } from "./support/tutorial";
import { profileStats } from "../src/services/profiles";

test("progresso pertence à conta, retoma em outra sessão, CAS e replay são idempotentes; treino não dá XP", async () => {
  const db = await fakeDatabase(),
    uid = "1".repeat(24),
    other = "2".repeat(24);
  delete db.users[0].tutorialCompletedAt;
  try {
    const initial = await tutorialState(uid);
    assert.equal(initial.required, true);
    assert.equal(initial.step, 0);
    const input = { type: "continue", version: 0, actionId: randomUUID() };
    const one = await tutorialAction(uid, input);
    assert.equal(one.step, 1);
    assert.equal((await tutorialAction(uid, input)).step, 1);
    assert.equal((await tutorialState(uid)).step, 1);
    assert.equal((await tutorialState(other)).step, 0);
    await assert.rejects(
      () =>
        tutorialAction(uid, {
          type: "continue",
          version: 0,
          actionId: randomUUID(),
        }),
      (e: any) => e.code === "STALE_TUTORIAL",
    );
    let row: any = await Tutorial.findById(uid).lean();
    while (!row.completedAt) {
      await tutorialAction(uid, nextTutorialAction(row));
      row = await Tutorial.findById(uid).lean();
    }
    assert.ok(db.users[0].tutorialCompletedAt);
    assert.equal((await tutorialState(uid)).required, false);
    assert.equal((await profileStats(uid)).xp, 0);
    assert.equal(db.matches.length, 0);
    assert.equal(row.game, null);
    const reset = await restartTutorial(uid, row.version, randomUUID());
    assert.equal(reset.step, 0);
    assert.equal(reset.required, false);
  } finally {
    db.restore();
  }
});
test("cadastro abre sessão para o tutorial; login só exige uma vez; pular libera PvP e IA sem dar XP", async () => {
  process.env.SECRET = "tutorial-http-test-012345678901234567890";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  delete db.users[0].tutorialCompletedAt;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const token = jwt.sign({ id: "1".repeat(24) }, process.env.SECRET!);
  const call = async (path: string, body?: object, auth = token) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: "Bearer " + auth } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: (await r.json()) as any };
  };
  try {
    assert.equal((await call("/tutorial/state", undefined, "")).status, 401);
    const registered = await call(
      "/auth/registrar",
      {
        nome: "Novo Aprendiz",
        email: "newtutorial@test.local",
        senha: "senha-123456",
        confirmPassword: "senha-123456",
      },
      "",
    );
    assert.equal(registered.status, 201);
    assert.ok(registered.data.token);
    assert.equal(registered.data.user.tutorialRequired, true);
    const login = await call(
      "/auth/logar",
      { email: "p1@test.local", senha: "teste-ztcg-123" },
      "",
    );
    assert.equal(login.data.user.tutorialRequired, true);
    for (const event of ["queue:join", "ai:start"]) {
      const response = await call("/game/event", {
        event,
        requestId: randomUUID(),
        data: { deckId: "4".repeat(24) },
      });
      assert.equal(response.status, 403);
      assert.equal(response.data.code, "TUTORIAL_REQUIRED");
    }
    const state = await call("/tutorial/state");
    const skip = await call("/tutorial/action", {
      type: "skip",
      version: state.data.version,
      actionId: randomUUID(),
    });
    assert.equal(skip.data.required, false);
    assert.equal(skip.data.skipped, true);
    assert.equal((await call("/auth/me")).data.user.tutorialRequired, false);
    assert.equal(
      (
        await call(
          "/auth/logar",
          { email: "p1@test.local", senha: "teste-ztcg-123" },
          "",
        )
      ).data.user.tutorialRequired,
      false,
    );
    assert.equal(db.matches.length, 0);
    const tamper = await call("/tutorial/action", {
      type: "skip",
      version: 0,
      actionId: randomUUID(),
      userId: "2".repeat(24),
    });
    assert.equal(tamper.status, 422);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
