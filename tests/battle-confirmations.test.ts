import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("confirmação considera apenas ataques legais próprios, inclusive ataques restantes", async () => {
  const path = "../public/JS/battle-confirmations.js";
  const { availableAttackCount } = await import(path);
  const state: any = {
    id: "game",
    turn: 3,
    version: 1,
    phase: "BATTLE",
    status: "ACTIVE",
    current: "me",
    slots: [
      {
        ownerId: "me",
        attackTargets: { card: ["enemy:0"], rider: [], structure: ["enemy:1"] },
      },
      { ownerId: "enemy", attackTargets: { card: ["me:0"] } },
    ],
  };
  assert.equal(availableAttackCount(state, "me"), 2);
  state.slots[0].attackTargets.card = [];
  assert.equal(availableAttackCount(state, "me"), 1);
  for (const change of [
    { phase: "PREPARATION" },
    { phase: "COIN_TOSS" },
    { current: "enemy" },
    { status: "FINISHED" },
    { paused: true },
    { pendingImpact: {} },
    { pendingSpell: {} },
  ])
    assert.equal(availableAttackCount({ ...state, ...change }, "me"), 0);
  state.slots[0].attackTargets.structure = [];
  assert.equal(availableAttackCount(state, "me"), 0);
});
test("clicar fora cancela também ações preparadas; alvos, menu e diálogos mantêm a seleção", async () => {
  const dom = new JSDOM(
    '<main><div id="outside"></div><div id="card-menu"><button id="action"></button></div><div class="board-slot" id="target"></div><div class="battle-hand-card" id="hand"></div><dialog><button id="zone-choice"></button></dialog></main>',
  );
  try {
    const path = "../public/JS/battle-confirmations.js";
    const { dismissCardMenu } = await import(path);
    const doc = dom.window.document;
    for (const type of ["hand", "field", "play", "ability", "attack", "move"])
      assert.equal(
        dismissCardMenu(doc.getElementById("outside"), { type }),
        true,
      );
    for (const id of ["target", "hand", "action", "zone-choice"])
      assert.equal(
        dismissCardMenu(doc.getElementById(id), { type: "play" }),
        false,
      );
    assert.equal(dismissCardMenu(doc.getElementById("outside"), null), false);
  } finally {
    dom.window.close();
  }
});
test("confirmar envia uma única decisão; cancelar e atualizar estado não passam o turno", async () => {
  const dom = new JSDOM("<body></body>"),
    previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const path = "../public/JS/battle-confirmations.js";
    const { createEndTurnConfirmation } = await import(path);
    const decisions: string[] = [];
    const ui = createEndTurnConfirmation({
      onConfirm: (key: string) => decisions.push(key),
    });
    const dialog: any = dom.window.document.querySelector("dialog");
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
      dialog.dispatchEvent(new dom.window.Event("close"));
    };
    const state = {
      id: "game",
      turn: 3,
      version: 1,
      phase: "BATTLE",
      status: "ACTIVE",
    };
    ui.ask(state, 1);
    assert.equal(dialog.open, true);
    assert.match(dialog.textContent, /Uma carta/);
    (dialog.querySelector("button.quiet") as HTMLButtonElement).click();
    assert.deepEqual(decisions, []);
    ui.ask(state, 2);
    ui.update({ ...state, version: 2 });
    assert.equal(dialog.open, false);
    assert.deepEqual(decisions, []);
    ui.ask(state, 1);
    ui.update({ ...state, paused: true });
    assert.equal(dialog.open, false);
    ui.ask(state, 2);
    (dialog.querySelector("button.primary") as HTMLButtonElement).click();
    assert.equal(dialog.open, false);
    assert.equal(decisions.length, 1);
    assert.equal(ui.matches(state, decisions[0]), true);
    assert.equal(ui.matches({ ...state, turn: 4 }, decisions[0]), false);
  } finally {
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
