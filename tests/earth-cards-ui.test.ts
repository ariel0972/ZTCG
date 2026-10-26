import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import raw from "../src/data/catalog.json";

test("busca permite Torre na reserva, exclui Invocações e painel posiciona a carta escolhida", async () => {
  const path = "../public/JS/battle-targets.js";
  const { zoneCardAllowed, spellSlotTarget } = await import(path);
  const mage = raw.find((c) => c.numeroCatalogo === "018")!,
    call = raw.find((c) => c.numeroCatalogo === "093")!,
    circle = raw.find((c) => c.numeroCatalogo === "071")!;
  assert.equal(
    zoneCardAllowed(
      mage.habilidadesAtivas![0],
      raw.find((c) => c.numeroCatalogo === "056"),
    ),
    true,
  );
  assert.equal(
    zoneCardAllowed(
      mage.habilidadesAtivas![0],
      raw.find((c) => c.numeroCatalogo === "058"),
    ),
    false,
  );
  assert.equal(
    zoneCardAllowed(
      call,
      raw.find((c) => c.numeroCatalogo === "025"),
    ),
    false,
  );
  assert.equal(
    zoneCardAllowed(
      call,
      raw.find((c) => c.numeroCatalogo === "042"),
    ),
    true,
  );
  const slot = { id: "x", ownerId: "p1", kind: "Tropa", column: 0, card: null };
  assert.equal(spellSlotTarget(circle, slot, "p1"), true);
  assert.equal(
    spellSlotTarget(circle, { ...slot, summonCircle: {} }, "p1"),
    false,
  );
  const dom = new JSDOM("<main></main>");
  try {
    const module = "../public/JS/revive-choice.js";
    const { renderReviveChoice } = await import(module);
    let command: any;
    const state = {
      players: [
        { id: "p1", deck: [{ id: "tower", nome: "Torre" }], graveyard: [] },
      ],
      slots: [slot],
      reviveDestinations: ["x"],
      pendingRevive: {
        id: "choice",
        ownerId: "p1",
        cards: ["tower"],
        source: "Gerar Torre",
        deployment: { destino: "Estrutura" },
      },
    };
    const host = dom.window.document.querySelector("main")!;
    renderReviveChoice(host, state, "p1", {
      onChoose: (c: any) => (command = c),
    });
    const selects = host.querySelectorAll("select");
    assert.equal(selects[0].value, "tower");
    selects[1].value = "x";
    selects[1].dispatchEvent(new dom.window.Event("change"));
    (host.querySelector("button") as HTMLButtonElement).click();
    assert.deepEqual(command, {
      type: "chooseRevive",
      cardId: "tower",
      destinationId: "x",
    });
    assert.match(host.textContent!, /Colocar em campo/);
  } finally {
    dom.window.close();
  }
});
