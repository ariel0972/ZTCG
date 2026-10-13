import test from "node:test";
import assert from "node:assert/strict";
import {
  experienceHistory,
  experienceProgress,
  levelThreshold,
  levelTitle,
} from "../src/services/experience";

test("limiares acumulados e títulos preservam todas as faixas", () => {
  const thresholds = [0, 100, 240, 560, 980, 1600, 2420, 3440];
  thresholds.forEach((xp, i) => {
    assert.equal(levelThreshold(i + 1), xp);
    assert.equal(experienceProgress(xp).nivel, i + 1);
    assert.equal(experienceProgress(xp).progresso, 0);
    if (xp) assert.equal(experienceProgress(xp - 1).nivel, i);
  });
  for (const [levels, title] of [
    [[1], "Noviço em Mana"],
    [[2, 3], "Aprendiz de thumos"],
    [[4, 6], "Thumo praticante"],
    [[7, 10], "Tumociente"],
    [[11, 15], "Thumista Avançado"],
    [[16, 20], "Alto Mago"],
    [[21, 25], "Mago Experiente"],
    [[26, 30], "Dominante da Mana"],
    [[31, 50], "Alto Sacerdote Thumista"],
  ] as const)
    for (const level of levels) assert.equal(levelTitle(level), title);
  assert.equal(experienceProgress(82100).nivel, 31);
  assert.equal(experienceProgress(-10).xp, 0);
});

function history(results: string[], reasons: Record<number, string> = {}) {
  return results.map((winner, i) => ({
    matchId: `match-${i}`,
    winner: winner || null,
    reason: reasons[i] || "Mago derrotado.",
    finishedAt: new Date(2026, 9, 1, 0, i),
  }));
}

test("sequências aumentam até ×1,5, arredondam cada prêmio e reiniciam ao trocar o resultado", () => {
  const matches = history([
    "me",
    "me",
    "me",
    "me",
    "me",
    "me",
    "me",
    "other",
    "other",
    "other",
    "other",
  ]);
  const { stats, awards } = experienceHistory("me", matches.slice().reverse());
  assert.deepEqual(
    [...awards.values()].map((a) => a.xpGanho),
    [40, 44, 48, 52, 56, 60, 60, 32, 35, 38, 42],
  );
  assert.equal(stats.xp, 507);
  assert.equal(stats.maiorSequenciaVitorias, 7);
  assert.equal(stats.sequenciaVitorias, 0);
  assert.equal(stats.sequenciaDerrotas, 4);
  assert.equal(stats.multiplicadorProximaDerrota, 1.4);
  assert.equal(stats.multiplicadorProximaVitoria, 1);
  assert.deepEqual(
    experienceHistory("me", matches),
    experienceHistory("me", matches),
  );
  const losses = experienceHistory("me", history(Array(7).fill("other")));
  assert.deepEqual(
    [...losses.awards.values()].map((a) => a.xpGanho),
    [32, 35, 38, 42, 45, 48, 48],
  );
});

test("empate e todos os encerramentos especiais zeram ambas as sequências", () => {
  const reasons = [
    "Desistência.",
    "Abandono após desconexão.",
    "Derrota por três turnos consecutivos de inatividade.",
    "Empate: ambos desconectados além do prazo de reconexão.",
  ];
  for (const reason of reasons) {
    const matches = history(
      ["me", "me", reason.startsWith("Empate") ? "" : "me", "me", "other"],
      { 2: reason },
    );
    for (const id of ["me", "other"]) {
      const result = experienceHistory(id, matches);
      assert.equal(result.awards.get("match-2")?.xpGanho, 20);
      assert.equal(result.awards.get("match-2")?.multiplicadorXp, 1);
      assert.equal(
        result.awards.get("match-3")?.xpGanho,
        id === "me" ? 40 : 32,
      );
      assert.equal(
        result.awards.get("match-4")?.xpGanho,
        id === "me" ? 32 : 40,
      );
      assert.equal(
        experienceHistory(id, matches.slice(0, 3)).stats.sequenciaVitorias,
        0,
      );
      assert.equal(
        experienceHistory(id, matches.slice(0, 3)).stats.sequenciaDerrotas,
        0,
      );
    }
  }
  const draw = experienceHistory("me", history(["me", "me", "", "me"]));
  assert.equal(draw.awards.get("match-2")?.xpGanho, 30);
  assert.equal(draw.awards.get("match-3")?.xpGanho, 40);
  assert.equal(draw.stats.sequenciaVitorias, 1);
});

test("datas iguais usam desempate estável e histórico vazio começa no nível 1", () => {
  const matches = history(["me", "other", "me"]).map((m) => ({
    ...m,
    finishedAt: new Date(0),
  }));
  assert.deepEqual(
    experienceHistory("me", matches.reverse()),
    experienceHistory("me", [...matches].reverse()),
  );
  const empty = experienceHistory("me", []);
  assert.equal(empty.stats.xp, 0);
  assert.equal(empty.stats.nivel, 1);
  assert.equal(empty.stats.titulo, "Noviço em Mana");
  assert.equal(empty.stats.xpParaProximoNivel, 100);
});
