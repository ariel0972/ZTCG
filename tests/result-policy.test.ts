import test from "node:test";
import assert from "node:assert/strict";
import {
  durationMultiplier,
  resultEligibility,
  isSurrender,
} from "../src/services/result-policy";
import { experienceHistory } from "../src/services/experience";
test("duração usa limites sem sobreposição e multiplica a sequência apenas em partidas novas", () => {
  for (const [turns, value] of [
    [0, 1],
    [4, 1],
    [5, 1.3],
    [9, 1.3],
    [10, 1.8],
    [19, 1.8],
    [20, 2.2],
    [29, 2.2],
    [30, 1.7],
    [100, 1.7],
  ])
    assert.equal(durationMultiplier(turns), value);
  const matches = [0, 1].map((i) => ({
    matchId: "m" + i,
    winner: "me",
    reason: "Mago derrotado.",
    turns: 20,
    finishedAt: new Date(i),
    rulesVersion: 2,
  }));
  const result = experienceHistory("me", matches);
  assert.equal(result.awards.get("m0")?.xpGanho, 88);
  assert.equal(result.awards.get("m1")?.xpGanho, 97); // 40 × 1.1 × 2.2, rounded once
  assert.equal(result.awards.get("m1")?.multiplicadorXp, 2.42);
  assert.equal(
    experienceHistory(
      "me",
      matches.map(({ rulesVersion, ...m }) => m),
    ).stats.xp,
    84,
  );
});
test("desistência curta prevalece sobre a quarta, desconexão não é desistência manual", () => {
  assert.equal(isSurrender("Desistência."), true);
  assert.equal(isSurrender("Abandono após desconexão."), false);
  assert.deepEqual(
    resultEligibility({
      rulesVersion: 2,
      reason: "Desistência.",
      turns: 5,
      surrenderStreak: 4,
    }),
    { historyVisible: false, ranked: false, countGame: false, awardXp: false },
  );
  assert.deepEqual(
    resultEligibility({
      rulesVersion: 2,
      reason: "Desistência.",
      turns: 6,
      surrenderStreak: 4,
    }),
    { historyVisible: false, ranked: false, countGame: true, awardXp: true },
  );
  assert.equal(
    resultEligibility({
      rulesVersion: 2,
      reason: "Desistência.",
      turns: 6,
      surrenderStreak: 3,
    }).ranked,
    true,
  );
  assert.equal(
    resultEligibility({ reason: "Desistência.", turns: 1 }).awardXp,
    true,
  );
});
test("quarta desistência preserva XP e partidas, excluída não altera sequência ou XP", () => {
  const matches = Array.from({ length: 4 }, (_, i) => ({
    matchId: "s" + i,
    winner: "other",
    reason: "Desistência.",
    turns: 10,
    rulesVersion: 2,
    surrenderStreak: i + 1,
    surrenderedBy: "me",
    finishedAt: new Date(i),
  }));
  for (const id of ["me", "other"]) {
    const { stats, awards } = experienceHistory(id, matches);
    assert.equal(stats.partidas, 4);
    assert.equal(stats.partidasClassificadas, 3);
    assert.equal(stats.historicoCount, 3);
    assert.equal(stats.xp, 144);
    assert.equal(awards.get("s3")?.contaResultado, false);
    assert.equal(stats.sequenciaDesistencias, id === "me" ? 4 : 0);
  }
  const deleted = { ...matches[0], deletedAt: new Date() };
  assert.equal(experienceHistory("me", [deleted]).stats.xp, 0);
  const short = { ...matches[0], turns: 5 };
  assert.equal(experienceHistory("me", [short]).stats.partidas, 0);
  assert.equal(experienceHistory("me", [short]).stats.sequenciaDesistencias, 1);
  const reset = {
    ...matches[0],
    matchId: "reset",
    finishedAt: new Date(5),
    winner: "me",
    surrenderedBy: "other",
  };
  assert.equal(
    experienceHistory("me", [...matches, reset]).stats.sequenciaDesistencias,
    0,
  );
});
