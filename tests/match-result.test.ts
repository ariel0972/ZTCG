import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("resultado: vitória, derrota, empate e fechamento sem reabrir a cada snapshot", async () => {
  const dom = new JSDOM(
    '<dialog><h2 id="result-title"></h2><div id="result-symbol"></div><p id="result-reason"></p></dialog>',
  );
  const dialog = dom.window.document.querySelector("dialog")!;
  let openings = 0,
    cleared = 0;
  dialog.showModal = () => {
    openings++;
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
  };
  const modulePath = "../public/JS/match-result.js";
  const { createMatchResult } = await import(modulePath);
  const result = createMatchResult(dialog);
  const state = {
    id: "a",
    status: "FINISHED",
    winner: "me",
    reason: "Mago derrotado",
  };
  result.update(state, "me", () => cleared++);
  assert.equal(dialog.open, true);
  assert.equal(dialog.dataset.outcome, "win");
  assert.equal(dialog.querySelector("h2")!.textContent, "Vitória!");
  assert.equal(dialog.querySelector("p")!.textContent, state.reason);
  result.close();
  result.update(state, "me", () => cleared++);
  assert.equal(dialog.open, false);
  assert.equal(openings, 1);
  assert.equal(cleared, 1);
  result.update({ ...state, id: "b", winner: "enemy" }, "me", () => cleared++);
  assert.equal(dialog.dataset.outcome, "loss");
  result.update({ ...state, id: "c", winner: null }, "me", () => cleared++);
  assert.equal(dialog.dataset.outcome, "draw");
  result.update({ ...state, status: "ACTIVE" }, "me", () => cleared++);
  assert.equal(dialog.open, false, "Uma revanche fecha o resultado anterior.");
  dom.window.close();
});
