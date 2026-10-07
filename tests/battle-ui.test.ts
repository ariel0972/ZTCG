import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("cartas dinâmicas mostram vida atual, bônus de armamento e status com duração", async () => {
  const dom = new JSDOM("<body></body>");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const modulePath = "../public/JS/battle-ui.js";
    const { cardFace } = await import(modulePath);
    const card = {
      nome: "Guerreiro",
      tipo: "Tropa",
      custoMana: 3,
      hp: 10,
      hpAtual: 6,
      ataque: 2,
      statuses: [{ nome: "Envenenado", turnosRestantes: 3 }],
      attacked: true,
    };
    const slot = { id: "p1:front:0", ownerId: "p1", kind: "Tropa", column: 0 };
    const face = cardFace(card, {
      slot,
      slots: [
        { id: "p1:arm:front-left", ownerId: "p1", card: { bonusAtaque: 4 } },
      ],
    });
    const updated = cardFace(card, {
      slot,
      slots: [],
      previous: { attack: "2", health: "10" },
    });
    assert.ok(updated.querySelector(".health").classList.contains("changed"));
    assert.ok(!updated.querySelector(".attack").classList.contains("changed"));
    assert.equal(face.querySelector(".attack").textContent, "6");
    assert.equal(face.querySelector(".health").textContent, "6");
    assert.ok(face.querySelector(".health").classList.contains("damaged"));
    assert.match(
      face.querySelector(".effect-token").getAttribute("aria-label"),
      /Envenenado.*3 rodada/,
    );
    assert.match(face.textContent, /Ataque usado/);
    const structure = cardFace(
      { ...card, tipo: "Estrutura" },
      {
        slot,
        slots: [
          { id: "p1:arm:front-left", ownerId: "p1", card: { bonusAtaque: 4 } },
        ],
      },
    );
    assert.equal(structure.querySelector(".attack").textContent, "2");
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("arraste distingue clique, cancela sem jogar e executa só uma soltura em destino válido", async () => {
  const dom = new JSDOM(
    '<button id="card">Carta</button><button data-slot-id="slot">Destino</button>',
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const modulePath = "../public/JS/battle-ui.js";
    const { bindCardDrag } = await import(modulePath);
    const card = dom.window.document.getElementById("card")!;
    const target = dom.window.document.querySelector("[data-slot-id]")!;
    (dom.window.document as any).elementFromPoint = () => target;
    let drops = 0,
      clicks = 0;
    bindCardDrag(card, {
      source: { type: "play" },
      canStart: () => true,
      actionFor: () => "play",
      onDrop: () => drops++,
    });
    card.addEventListener("click", () => clicks++);
    const pointer = (type: string, x: number) => {
      const event = new dom.window.MouseEvent(type, {
        clientX: x,
        clientY: 20,
        button: 0,
        cancelable: true,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      card.dispatchEvent(event);
    };
    pointer("pointerdown", 10);
    pointer("pointerup", 10);
    (card as any).click();
    assert.equal(clicks, 1);
    assert.equal(drops, 0);
    pointer("pointerdown", 10);
    pointer("pointermove", 40);
    pointer("pointercancel", 40);
    assert.equal(drops, 0);
    assert.equal(dom.window.document.querySelector(".drag-ghost"), null);
    pointer("pointerdown", 10);
    pointer("pointermove", 40);
    assert.ok(target.classList.contains("drop-ready"));
    pointer("pointerup", 40);
    (card as any).click();
    assert.equal(drops, 1);
    assert.equal(clicks, 1);
    assert.equal(dom.window.document.querySelector(".drag-ghost"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("destinos de arraste respeitam preparação, lados, pântano e bloqueio após atacar", async () => {
  const modulePath = "../public/JS/battle-ui.js";
  const { dropAction } = await import(modulePath);
  const state = {
    status: "ACTIVE",
    phase: "PREPARATION",
    players: [{ id: "p1", combatStarted: false }],
    slots: [],
  };
  const source = { type: "play", card: { tipo: "Tropa", palavrasChave: [] } };
  const own = {
    id: "p1:front:0",
    ownerId: "p1",
    kind: "Tropa",
    column: 0,
    card: null,
  };
  assert.equal(dropAction(source, own, state, "p1"), "play");
  assert.equal(
    dropAction(source, { ...own, ownerId: "p2" }, state, "p1"),
    null,
  );
  assert.equal(
    dropAction(source, { ...own, terrain: { nome: "Lama" } }, state, "p1"),
    null,
  );
  state.players[0].combatStarted = true;
  assert.equal(dropAction(source, own, state, "p1"), null);
  const attack = {
    type: "field",
    card: { tipo: "Tropa", direcaoAtaque: "Frente", palavrasChave: [] },
    slot: own,
  };
  assert.equal(
    dropAction(attack, { ...own, ownerId: "p2", column: 2 }, state, "p1"),
    null,
  );
  state.phase = "BATTLE";
  assert.equal(
    dropAction(attack, { ...own, ownerId: "p2", column: 2 }, state, "p1"),
    "attack",
  );
});

test("arraste usa os alvos calculados pelo servidor, inclusive mago e Guardar", async () => {
  const modulePath = "../public/JS/battle-ui.js";
  const { dropAction } = await import(modulePath);
  const mage = { id: "p2:mage", ownerId: "p2", kind: "Mago", column: 1 };
  const state = { status: "ACTIVE", phase: "BATTLE", players: [], slots: [] };
  const source = {
    type: "field",
    card: { tipo: "Tropa" },
    slot: { ownerId: "p1", attackTargets: { card: [mage.id], structure: [] } },
  };
  assert.equal(dropAction(source, mage, state, "p1"), "attack");
  assert.equal(
    dropAction(
      source,
      { ...mage, id: "p2:front:1", kind: "Tropa" },
      state,
      "p1",
    ),
    null,
  );
  source.card.tipo = "Estrutura";
  assert.equal(
    dropAction(source, mage, state, "p1"),
    null,
    "Estrutura possui seu próprio conjunto de alvos.",
  );
});
