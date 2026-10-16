import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("menus ficam no campo, preservam botões e só reabrem quando uma nova decisão é necessária", async () => {
  const modulePath = "../public/JS/field-overlays.js",
    { createFieldMenu } = await import(modulePath);
  const dom = new JSDOM(
    '<body><div id="field"><button id="card">Tropa</button></div><section id="response"><button id="accept">Aceitar</button></section></body>',
  );
  const doc = dom.window.document,
    field = doc.getElementById("field")!,
    response = doc.getElementById("response")!,
    button = doc.getElementById("accept")!;
  let decisions = 0;
  button.onclick = () => {
    decisions++;
  };
  const view = createFieldMenu(field, {
    label: "Turno pausado",
    content: response,
    revealOnOpen: true,
  });
  try {
    const menu = field.querySelector("details")!;
    let revealed = 0;
    menu.scrollIntoView = () => {
      revealed++;
    };
    assert.equal(menu.hidden, true);
    view.update({ visible: true, key: "window-1" });
    assert.equal(menu.open, true);
    assert.equal(menu.contains(button), true);
    button.click();
    assert.equal(decisions, 1);
    menu.open = false;
    view.update({ visible: true, key: "window-1" });
    assert.equal(menu.open, false);
    assert.equal(revealed, 1);
    view.update({ visible: true, key: "window-2" });
    assert.equal(menu.open, true);
    assert.equal(revealed, 2);
    view.update({ visible: false, key: "window-2" });
    assert.equal(menu.hidden, true);
    assert.equal(doc.querySelector("dialog[open]"), null);
    assert.equal(field.querySelector("#card")!.textContent, "Tropa");
  } finally {
    view.close();
    dom.window.close();
  }
});

test("aviso para espectador só informa a preparação ou a pausa, sem cartas privadas ou ações", async () => {
  const modulePath = "../public/JS/field-overlays.js",
    { publicFieldNotice } = await import(modulePath);
  const state: any = {
    id: "room",
    status: "ACTIVE",
    phase: "BATTLE",
    players: [{ id: "p1", nome: "Um", hand: [{ nome: "Segredo" }] }],
  };
  assert.equal(publicFieldNotice(state), null);
  assert.match(
    publicFieldNotice({ ...state, phase: "PREPARATION" }).message,
    /preparando/,
  );
  assert.match(
    publicFieldNotice({ ...state, paused: true }).message,
    /reconexão/,
  );
  const choice = publicFieldNotice({
    ...state,
    responseDeadline: 100,
    pendingHandChoice: { ownerId: "p1" },
  });
  assert.match(choice.message, /Um está escolhendo uma carta/);
  assert.equal(JSON.stringify(choice).includes("Segredo"), false);
  assert.match(
    publicFieldNotice({ ...state, pendingRevive: { ownerId: "p1" } }).message,
    /Um está escolhendo uma tropa e um espaço/,
  );
  assert.equal(
    publicFieldNotice({ ...state, status: "FINISHED", paused: true }),
    null,
  );
});
