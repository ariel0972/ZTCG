import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { fakeDatabase } from "./support/database";
import { moderateMember } from "../src/services/admin-moderation";
import {
  previewHistoryDeletion,
  applyHistoryDeletion,
  recoverHistoryDeletions,
} from "../src/services/admin-history";
import {
  reconcileResultPolicies,
  recordMatchResult,
} from "../src/services/result-settlement";
import { profileStats } from "../src/services/profiles";
import { accountRestriction } from "../src/services/account-access";
import { createApp } from "../src/application";
import User from "../src/db/models/user";
const p = "1".repeat(24),
  q = "2".repeat(24),
  admin = "3".repeat(24);
const body = (action: string, expectedVersion = 0, other = {}) => ({
  actionId: randomUUID(),
  expectedVersion,
  action,
  ...other,
});
const rejects = (fn: () => Promise<unknown>, status: number) =>
  assert.rejects(fn, (e: any) => e.status === status);
test("moderação exige admin, impede automoderação, valida prazos, revoga sessões e é idempotente", async () => {
  const db = await fakeDatabase();
  process.env.SECRET = "test-admin-workflow-01234567890123456789";
  try {
    await rejects(() => moderateMember(p, q, body("ban")), 403);
    await rejects(() => moderateMember(admin, admin, body("ban")), 409);
    await assert.rejects(() =>
      moderateMember(admin, p, body("suspend", 0, { hours: 3 })),
    );
    const action = body("suspend", 0, { hours: 12, reason: "teste" });
    const start = Date.now(),
      r = await moderateMember(admin, p, action, start);
    assert.equal(r.user.managementVersion, 1);
    assert.equal(db.users[0].sessionVersion, 1);
    assert.equal(
      +new Date(db.users[0].moderation.suspendedUntil),
      start + 12 * 3600000,
    );
    assert.equal(
      accountRestriction(db.users[0], start)?.code,
      "ACCOUNT_SUSPENDED",
    );
    assert.equal(accountRestriction(db.users[0], start + 12 * 3600000), null);
    assert.equal(
      (await moderateMember(admin, p, action, start + 1000)).duplicate,
      true,
    );
    assert.equal(db.users[0].managementVersion, 1);
    await rejects(() => moderateMember(admin, p, body("ban")), 409);
    await moderateMember(admin, p, body("unsuspend", 1));
    await moderateMember(admin, p, body("ban", 2));
    assert.equal(accountRestriction(db.users[0])?.code, "ACCOUNT_BANNED");
    await moderateMember(admin, p, body("unban", 3));
    assert.equal(accountRestriction(db.users[0]), null);
    await moderateMember(admin, p, body("promote", 4));
    assert.equal(db.users[0].admin, true);
    await moderateMember(p, admin, body("demote"));
    assert.equal(db.users[2].admin, false);
    await rejects(() => moderateMember(p, p, body("demote", 5)), 409);
    assert.equal(db.adminAudits.length, 6);
  } finally {
    db.restore();
  }
});
function row(i: number, loser = p, turns = 10) {
  const other = loser === p ? q : p;
  return {
    matchId: "result-" + i,
    players: [
      { userId: p, nome: "Um", deckId: "4".repeat(24) },
      { userId: q, nome: "Dois", deckId: "5".repeat(24) },
    ],
    winner: other,
    reason: "Desistência.",
    turns,
    rulesVersion: 2,
    surrenderedBy: loser,
    finishedAt: new Date(2026, 9, 23, 0, i),
  };
}
test("liquidação aplica quarta desistência aos dois; exclusão reclassifica seguintes e refaz rankings dos dois", async () => {
  const db = await fakeDatabase();
  process.env.SECRET = "test-admin-workflow-01234567890123456789";
  try {
    db.matches.push(...Array.from({ length: 4 }, (_, i) => row(i)));
    await reconcileResultPolicies([p, q]);
    assert.equal(db.matches[3].ranked, false);
    const before = await profileStats(q);
    assert.equal(before.vitorias, 3);
    assert.equal(before.partidas, 4);
    const preview = await previewHistoryDeletion(admin, p, {
      all: false,
      matchIds: ["result-0"],
    });
    assert.equal(preview.count, 1);
    assert.equal(preview.players.length, 2);
    await rejects(
      () => applyHistoryDeletion(p, p, { token: preview.token }),
      403,
    );
    const result = await applyHistoryDeletion(admin, p, {
      token: preview.token,
    });
    assert.equal(result.count, 1);
    assert("affectedPlayers" in result);
    assert.equal(result.affectedPlayers, 2);
    assert(db.matches[0].deletedAt);
    assert.equal(db.matches[3].surrenderStreak, 3);
    assert.equal(db.matches[3].ranked, true);
    assert.equal((await profileStats(p)).derrotas, 3);
    assert.equal((await profileStats(q)).vitorias, 3);
    assert.equal((await profileStats(q)).xp, 108);
    assert.equal(db.users[0].ranking.partidas, 3);
    assert.equal(db.users[1].ranking.partidas, 3);
    assert.equal(db.decks[0].ranking.partidas, 3);
    assert.equal(db.decks[1].ranking.partidas, 3);
    assert.equal(
      (await applyHistoryDeletion(admin, p, { token: preview.token }))
        .duplicate,
      true,
    );
    const all = await previewHistoryDeletion(admin, p, {
      all: true,
      matchIds: [],
    });
    await applyHistoryDeletion(admin, p, { token: all.token });
    for (const id of [p, q]) assert.equal((await profileStats(id)).xp, 0);
    assert.equal(db.users[0].ranking.vitorias, 0);
    assert.equal(db.decks[1].ranking.partidas, 0);
  } finally {
    db.restore();
  }
});
test("prévia rejeita IDs alheios, alterações após prévia e token adulterado", async () => {
  const db = await fakeDatabase();
  process.env.SECRET = "test-admin-workflow-01234567890123456789";
  try {
    db.matches.push(row(0));
    await rejects(
      () =>
        previewHistoryDeletion(admin, p, { all: false, matchIds: ["missing"] }),
      409,
    );
    const preview = await previewHistoryDeletion(admin, p, {
      all: true,
      matchIds: [],
    });
    db.matches.push(row(1));
    await rejects(
      () => applyHistoryDeletion(admin, p, { token: preview.token }),
      409,
    );
    await rejects(
      () => applyHistoryDeletion(admin, p, { token: "invalid" }),
      422,
    );
    assert(!db.matches.some((m) => m.deletedAt));
  } finally {
    db.restore();
  }
});
test("exclusão interrompida retoma recálculo e gravação repetida não ressuscita batalha", async () => {
  const db = await fakeDatabase();
  process.env.SECRET = "test-admin-workflow-01234567890123456789";
  try {
    db.matches.push(row(0));
    const preview = await previewHistoryDeletion(admin, p, {
      all: true,
      matchIds: [],
    });
    const patch = mock.method(User, "updateOne", () => {
      throw new Error("temporary");
    });
    await assert.rejects(
      () => applyHistoryDeletion(admin, p, { token: preview.token }),
      /temporary/,
    );
    patch.mock.restore();
    assert(db.matches[0].deletedAt);
    assert.equal(db.adminAudits[0].status, "pending");
    await recoverHistoryDeletions();
    assert.equal(db.adminAudits[0].status, "complete");
    const room: any = {
      id: "result-0",
      resultRulesVersion: 2,
      finishedAt: Date.now(),
      entries: [
        { id: p, nome: "Um", deckId: "4".repeat(24) },
        { id: q, nome: "Dois", deckId: "5".repeat(24) },
      ],
      game: { state: { reason: "Desistência.", winner: q, turn: 10 } },
    };
    await recordMatchResult(room);
    assert.equal(db.matches.length, 1);
    assert(db.matches[0].deletedAt);
    assert.equal((await profileStats(p)).partidas, 0);
  } finally {
    db.restore();
  }
});
test("gravação distingue salas antigas e novas, conta sequência curta e redefine ao ganhar sem desistir", async () => {
  const db = await fakeDatabase();
  try {
    const room = (i: number, version?: number, loser = p, turns = 10): any => ({
      id: "new-" + i,
      resultRulesVersion: version,
      finishedAt: i * 1000,
      entries: [
        { id: p, nome: "Um" },
        { id: q, nome: "Dois" },
      ],
      game: {
        state: {
          reason: "Desistência.",
          winner: loser === p ? q : p,
          turn: turns,
        },
      },
    });
    await recordMatchResult(room(0, undefined, p, 1));
    assert.equal(db.matches[0].rulesVersion, undefined);
    for (let i = 1; i <= 4; i++)
      await recordMatchResult(room(i, 2, p, i === 1 ? 5 : 10));
    assert.equal(db.matches[1].awardXp, false);
    assert.equal(db.matches[4].ranked, false);
    assert.equal((await profileStats(p)).partidas, 4);
    await recordMatchResult(room(5, 2, q));
    await recordMatchResult(room(6, 2, p));
    assert.equal(db.matches[6].surrenderStreak, 1);
    assert.equal(db.matches[6].ranked, true);
  } finally {
    db.restore();
  }
});
test("conta banida ou suspensa não entra, não renova e não usa sessão anterior; suspensão expirada permite login", async () => {
  process.env.SECRET = "test-admin-workflow-01234567890123456789";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const post = async (path: string, data: any, headers = {}) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
    return {
      status: r.status,
      data: (await r.json()) as any,
      cookie: r.headers.get("set-cookie"),
    };
  };
  try {
    const login = await post("/auth/logar", {
      email: "p1@test.local",
      senha: "teste-ztcg-123",
    });
    assert.equal(login.status, 200);
    await moderateMember(admin, p, body("ban"));
    const old = await fetch(base + "/auth/me", {
      headers: { Authorization: "Bearer " + login.data.token },
    });
    assert.equal(old.status, 401);
    assert.equal(
      (
        await post("/auth/logar", {
          email: "p1@test.local",
          senha: "teste-ztcg-123",
        })
      ).status,
      403,
    );
    const refresh = jwt.sign(
      { id: p, sv: 1, purpose: "refresh" },
      process.env.SECRET!,
    );
    assert.equal(
      (await post("/auth/refresh", {}, { Cookie: "ztcg_refresh=" + refresh }))
        .status,
      403,
    );
    await moderateMember(admin, p, body("unban", 1));
    await moderateMember(
      admin,
      p,
      body("suspend", 2, { hours: 2 }),
      Date.now() - 3 * 3600000,
    );
    assert.equal(
      (
        await post("/auth/logar", {
          email: "p1@test.local",
          senha: "teste-ztcg-123",
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});

test("rotas administrativas recusam membro e exclusão remove os dois históricos públicos", async () => {
  process.env.SECRET = "test-admin-workflow-01234567890123456789";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const call = async (path: string, id = admin, data?: unknown) => {
    const r = await fetch(base + path, {
      method: data ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + jwt.sign({ id }, process.env.SECRET!),
        "Content-Type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: r.status, data: (await r.json()) as any };
  };
  try {
    db.matches.push(
      ...Array.from({ length: 4 }, (_, i) => row(i)),
      row(5, p, 3),
    );
    await reconcileResultPolicies([p, q]);
    for (const id of [p, q]) {
      const profile = await call("/profiles/" + id, id);
      assert.equal(profile.status, 200);
      assert.equal(profile.data.matches.length, 3);
      assert.equal(profile.data.stats.partidas, 4);
      assert.equal(profile.data.stats.partidasSemClassificacao, 1);
    }
    const denied = await call("/admin/users/" + p + "/history-preview", p, {
      all: true,
      matchIds: [],
    });
    assert.equal(denied.status, 401);
    const preview = await call(
      "/admin/users/" + p + "/history-preview",
      admin,
      { all: false, matchIds: ["result-0"] },
    );
    assert.equal(preview.status, 200);
    const removed = await call("/admin/users/" + p + "/history-delete", admin, {
      token: preview.data.token,
    });
    assert.equal(removed.status, 200);
    for (const id of [p, q]) {
      const profile = await call("/profiles/" + id, id);
      assert.equal(profile.data.matches.length, 3); // previously fourth surrender becomes ranked
      assert(!profile.data.matches.some((m: any) => m.matchId === "result-0"));
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
