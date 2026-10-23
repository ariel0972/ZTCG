import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  planResultRecalculation,
  recalculationSummary,
} from "../scripts/lib/recalculate-results-plan";
import { experienceHistory } from "../src/services/experience";
import { fakeDatabase } from "./support/database";
import { recalculateAllResults } from "../scripts/recalculate-results";
import { withResultControl } from "../src/services/result-control";
const a = "1".repeat(24),
  b = "2".repeat(24);
const row = (n: number, reason = "Desistência.", turns = 10, winner = b) => ({
  matchId: "m" + n,
  players: [
    { userId: a, deckId: "4".repeat(24) },
    { userId: b, deckId: "5".repeat(24) },
  ],
  winner,
  reason,
  turns,
  finishedAt: new Date(n * 1000),
});
test("migração infere desistente, conta desistências curtas, aplica quarta aos dois e é idempotente", () => {
  const rows = [row(0, "Desistência.", 1), row(1), row(2), row(3)];
  const original = JSON.stringify(rows),
    plan = planResultRecalculation([...rows].reverse());
  assert.equal(plan.updates.length, 4);
  assert.equal(plan.matches[0].surrenderedBy, a);
  assert.equal(plan.matches[0].surrenderStreak, 1);
  assert.equal(plan.matches[0].awardXp, false);
  assert.equal(plan.matches[3].surrenderStreak, 4);
  assert.equal(plan.matches[3].ranked, false);
  for (const id of [a, b]) {
    const stats = experienceHistory(id, plan.matches).stats;
    assert.equal(stats.partidas, 3);
    assert.equal(stats.partidasClassificadas, 2);
    assert.equal(stats.xp, 108);
  }
  assert.equal(JSON.stringify(rows), original);
  assert.equal(planResultRecalculation(plan.matches).updates.length, 0);
  const summary = recalculationSummary(rows, plan.matches, [a, b]);
  assert.equal(summary.shortSurrenders, 1);
  assert.equal(summary.excessiveSurrenders, 1);
  assert.equal(summary.changedAccounts, 2);
});
test("migração preserva exclusões e resultados, reinicia sequência ao vencer por desistência e amplia duração", () => {
  const deleted = { ...row(0), deletedAt: new Date(0) };
  const rows = [
    deleted,
    row(1),
    row(2),
    row(3),
    row(4, "Desistência.", 10, a),
    row(5),
    row(6, "Mago derrotado.", 20, a),
  ];
  const plan = planResultRecalculation(rows);
  assert.deepEqual(plan.matches[0], deleted);
  assert(!plan.updates.some((u) => u.matchId === deleted.matchId));
  assert.equal(plan.matches[5].surrenderStreak, 1);
  assert.equal(
    experienceHistory(a, plan.matches).awards.get("m6")?.xpGanho,
    88,
  );
  for (let i = 1; i < rows.length; i++) {
    assert.equal(plan.matches[i].winner, rows[i].winner);
    assert.equal(plan.matches[i].turns, rows[i].turns);
  }
});
test("migração rejeita desistência sem vencedor/turnos e identidade ambígua antes de produzir alterações", () => {
  for (const value of [
    { ...row(0), winner: null },
    { ...row(0), winner: "f".repeat(24) },
    { ...row(0), turns: undefined },
    { ...row(0), players: [{ userId: a }] },
  ])
    assert.throws(() => planResultRecalculation([value]));
  assert.throws(() => planResultRecalculation([row(0), row(0)]));
});
test("recálculo real do serviço cria backup antes, atualiza ambos e mantém cartas e moderação", async () => {
  const db = await fakeDatabase();
  let backup: string | undefined;
  const logger = mock.method(console, "log", (...items: unknown[]) => {
    const value = JSON.parse(String(items[0]));
    if (value.backup) backup = value.backup;
  });
  try {
    db.matches.push(
      row(0, "Desistência.", 1),
      row(1, "Mago derrotado.", 20, a),
    );
    db.users[0].moderation = { banned: true, reason: "preservar" };
    db.users[0].sessionVersion = 5;
    const beforeCards = JSON.stringify(db.cards);
    const preview = await recalculateAllResults(false);
    assert.equal(preview.shortSurrenders, 1);
    assert(!db.matches[0].rulesVersion);
    assert.equal(backup, undefined);
    await recalculateAllResults(true);
    assert(backup);
    const saved = JSON.parse(await fs.readFile(backup, "utf8"));
    assert.equal(saved.matches[0].rulesVersion, undefined);
    assert.equal(db.matches[0].historyVisible, false);
    assert.equal(db.matches[1].rulesVersion, 2);
    assert.equal(db.users[0].ranking.stats.xp, 88);
    assert.equal(db.users[1].ranking.stats.xp, 70);
    assert.equal(db.decks[0].ranking.partidas, 1);
    assert.equal(db.decks[1].ranking.partidas, 1);
    assert.equal(db.users[0].moderation.banned, true);
    assert.equal(db.users[0].sessionVersion, 5);
    assert.equal(JSON.stringify(db.cards), beforeCards);
    assert.equal(db.adminAudits[0].status, "complete");
  } finally {
    logger.mock.restore();
    db.restore();
    if (backup) await fs.unlink(backup);
  }
});
test("checkpoint renova a trava e recusa continuar se outra operação tomou a lease", async () => {
  const db = await fakeDatabase();
  let now = 100000;
  const clock = mock.method(Date, "now", () => now);
  try {
    await withResultControl(async (checkpoint) => {
      const initial = +db.adminControls[0].until;
      now += 31000;
      await checkpoint();
      assert.equal(+db.adminControls[0].until, initial + 31000);
      db.adminControls[0].token = "other";
      now += 31000;
      await assert.rejects(checkpoint, (e: any) => e.code === "ADMIN_BUSY");
    });
    assert.equal(db.adminControls[0].token, "other");
  } finally {
    clock.mock.restore();
    db.restore();
  }
});
