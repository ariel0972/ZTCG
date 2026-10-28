import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createTutorial,
  advanceTutorial,
  tutorialExpected,
  tutorialLessons,
  tutorialView,
  type TutorialProgress,
} from "../src/game/tutorial";
import { Game } from "../src/game/engine";
import { nextTutorialAction } from "./support/tutorial";

test("tutorial completo usa motor real, qualquer coluna, ambas as faces e dois encerramentos por efeito", () => {
  for (const face of ["heads", "tails"] as const)
    for (const column of [0, 1, 2]) {
      let p = createTutorial("1".repeat(24), "Aprendiz");
      let checked = false;
      while (!p.completedAt) {
        const id = tutorialLessons[p.step].id;
        p = advanceTutorial(p, nextTutorialAction(p, face, column));
        if (id === "preparation")
          assert.equal(Game.restore(p.game!).player(p._id).mana, 5);
        if (id === "coin") {
          const g = Game.restore(p.game!);
          assert.equal(g.state.coinToss?.result, face);
          assert.equal(g.state.coinToss?.winnerId, p._id);
        }
        if (id === "spell") {
          const g = Game.restore(p.game!),
            target = g.state.slots.find(
              (s) => s.ownerId !== p._id && s.card?.tipo === "Tropa",
            )!.card!;
          assert.equal(target.hpAtual, 1);
          assert.equal(
            target.statuses.find((s) => s.nome === "Sangrando")
              ?.turnosRestantes,
            3,
          );
        }
        if (id === "effectFirstHalf") {
          const g = Game.restore(p.game!),
            target = g.state.slots.find(
              (s) => s.ownerId !== p._id && s.card?.tipo === "Tropa",
            )!.card!;
          assert.equal(target.hpAtual, 1);
          assert.equal(
            target.statuses.find((s) => s.nome === "Sangrando")
              ?.turnosRestantes,
            3,
          );
          checked = true;
        }
        if (id === "effectSecondHalf") {
          const g = Game.restore(p.game!);
          assert.equal(
            g.state.slots.some(
              (s) => s.ownerId !== p._id && s.card?.tipo === "Tropa",
            ),
            false,
          );
          assert.ok(
            g.state.players
              .find((pl) => pl.id !== p._id)!
              .graveyard.some((c) => c.numeroCatalogo === "020"),
          );
        }
      }
      assert.equal(checked, true);
      assert.equal(p.game, null);
      assert.equal(p.step, tutorialLessons.length - 1);
      assert.equal(tutorialView(p).completed, true);
    }
});
test("pular é permitido desde o início, encerra onboarding sem fingir vitória, e ações fora da etapa não avançam", () => {
  const p = createTutorial("1".repeat(24), "Aprendiz"),
    before = JSON.stringify(p);
  assert.throws(
    () =>
      advanceTutorial(p, {
        type: "attack",
        version: 0,
        actionId: randomUUID(),
      }),
    /ação destacada/,
  );
  assert.equal(JSON.stringify(p), before);
  const skipped = advanceTutorial(p, {
    type: "skip",
    version: 0,
    actionId: randomUUID(),
  });
  assert.ok(skipped.skippedAt);
  assert.equal(skipped.game, null);
  assert.equal(tutorialView(skipped).skipped, true);
  assert.match(tutorialView(skipped).lesson.body, /pulou/);
});
