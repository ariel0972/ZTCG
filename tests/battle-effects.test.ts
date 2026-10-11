import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";

const catalog = raw.map((c) => cardSchema.parse(c));
function fixture() {
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: {
        nome: "Teste",
        mago: "108",
        cartas: catalog
          .filter((c) => c.publicado && c.tipo === "Tropa")
          .flatMap((c) => Array(3).fill(c.numeroCatalogo))
          .slice(0, 40),
      },
    })),
    catalog,
    () => 0.2,
  );
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  const slot = g.state.slots.find(
    (s) => s.ownerId === "p2" && s.kind === "Tropa" && s.column === 1,
  )!;
  const card: Instance = {
    ...structuredClone(catalog.find((c) => c.numeroCatalogo === "021")!),
    id: randomUUID(),
    ownerId: "p2",
    hpAtual: 30,
    hp: 30,
    statuses: [],
    attacked: false,
    usedAbility: false,
  };
  card.resistencia = [];
  card.fraqueza = [];
  slot.card = card;
  return { g, slot, card };
}
test("as oito reações emitem localização pública persistida, inclusive Lama em slot vazio", () => {
  const pairs = [
    ["Terra", "Fogo", "Lava"],
    ["Agua", "Fogo", "Vapor"],
    ["Terra", "Agua", "Lama"],
    ["Terra", "Ar", "Erosão"],
    ["Ar", "Fogo", "Explosão"],
    ["Ar", "Agua", "Congelar"],
    ["Zarcos", "Zarcos", "Zarconizado"],
    ["Lama", "Agua", "Florescer"],
  ];
  for (const [existing, incoming, name] of pairs) {
    const { g, slot, card } = fixture();
    if (existing === "Lama")
      slot.terrain = { nome: "Lama", rodadasRestantes: 2 };
    else card.elemento = existing as Instance["elemento"];
    if (name === "Lama") {
      slot.card = null;
      slot.appliedElement = "Terra";
    }
    (g as any).react("p1", [slot.card?.id ?? slot.id], incoming);
    const event = g.state.events!.find((e) => e.kind === "elementalReaction")!;
    assert.equal(event.reaction, name);
    assert.equal(event.slotId, slot.id);
    assert.match(event.message!, new RegExp(name));
    const saved = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
    assert.deepEqual(saved.snapshot("p1").events, g.snapshot("p2").events);
  }
});
test("Neutro e combinações sem reação não anunciam ativação", () => {
  const { g, card } = fixture();
  card.elemento = "Fogo";
  (g as any).react("p1", [card.id], "Neutro");
  (g as any).react("p1", [card.id], "Fogo");
  assert.equal(
    g.state.events?.filter((e) => e.kind === "elementalReaction").length ?? 0,
    0,
  );
});
test("dano registra modificadores efetivos, valor após escudos e o alvo que absorveu o golpe", () => {
  const { g, slot, card } = fixture();
  card.fraqueza = ["Fogo"];
  card.statuses = [{ nome: "Escudo", turnosRestantes: 2, valor: 3 }];
  (g as any).damage(card.id, 4, undefined, false, "Fogo");
  let event = g.state.events!.at(-1)!;
  assert.deepEqual(event.damage, {
    amount: 5,
    element: "Fogo",
    modifiers: ["weakness"],
  });
  assert.equal(card.hpAtual, 25);
  const structure: Instance = {
    ...structuredClone(card),
    id: randomUUID(),
    tipo: "Estrutura" as const,
    statuses: [],
    resistencia: ["Fogo" as const],
    fraqueza: [],
  };
  slot.structure = structure;
  (g as any).damage(card.id, 4, undefined, false, "Fogo");
  event = g.state.events!.at(-1)!;
  assert.equal(event.card.id, structure.id);
  assert.equal(event.slotId, slot.id);
  assert.deepEqual(event.damage, {
    amount: 2,
    element: "Fogo",
    modifiers: ["resistance"],
  });
  structure.statuses = [{ nome: "Vapor", turnosRestantes: 1 }];
  (g as any).damage(card.id, 4, undefined, false, "Fogo");
  assert.deepEqual(g.state.events!.at(-1)!.damage, {
    amount: 4,
    element: "Fogo",
    modifiers: [],
  });
  structure.statuses = [
    { nome: "EscudoProtecao", turnosRestantes: 1, valor: 1 },
  ];
  (g as any).damage(card.id, 4, undefined, false, "Fogo");
  assert.deepEqual(g.state.events!.at(-1)!.damage, { amount: 0 });
});
test("dano periódico e excedente no mago não inventam modificador elemental", () => {
  const { g, card } = fixture();
  card.fraqueza = ["Fogo"];
  card.statuses = [{ nome: "Explosão", turnosRestantes: 1 }];
  card.hpAtual = 2;
  (g as any).damage(card.id, 4, undefined, false, "Fogo");
  const mage = g.state.events!.at(-1)!;
  assert.equal(mage.card.id, g.player("p2").mage.id);
  assert.deepEqual(mage.damage, { amount: 6 });
  (g as any).reportDamage(card, 2, "Queimado", 5);
  assert.deepEqual(g.state.events!.at(-1)!.damage, { amount: 2 });
});

function browserFixture() {
  const dom = new JSDOM(
    '<body><div data-slot-id="s"><div data-live-card-id="c"></div></div></body>',
    { pretendToBeVisual: true },
  );
  for (const el of dom.window.document.querySelectorAll(
    "[data-slot-id],[data-live-card-id]",
  ))
    el.getBoundingClientRect = () => ({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 200,
      bottom: 250,
      width: 100,
      height: 150,
      toJSON() {},
    });
  return dom;
}
test("animações cobrem reações, sobrevivem à morte do alvo e respeitam movimento reduzido", async () => {
  const path = "../public/JS/battle-effects.js";
  const { createBattleEffects } = await import(path);
  const dom = browserFixture(),
    doc = dom.window.document;
  let animated = 0;
  (doc.querySelector("[data-live-card-id]")! as any).animate = () => {
    animated++;
    return { cancel() {}, finished: Promise.resolve() };
  };
  const view = createBattleEffects(doc.body);
  const event = {
    kind: "damage",
    card: { id: "c" },
    slotId: "s",
    damage: { amount: 5, element: "Fogo", modifiers: ["weakness"] },
  };
  try {
    for (const reaction of [
      "Lava",
      "Vapor",
      "Lama",
      "Erosão",
      "Explosão",
      "Congelar",
      "Zarconizado",
      "Florescer",
    ])
      view.show({
        kind: "elementalReaction",
        reaction,
        card: { id: "c" },
        slotId: "s",
      });
    assert.equal(doc.querySelectorAll('[data-kind="reaction"]').length, 8);
    view.show(event);
    assert.match(
      doc.querySelector(".battle-effect--weakness")!.textContent!,
      /Fraqueza · −5/,
    );
    assert.equal(animated, 1);
    const face = doc.querySelector("[data-live-card-id]")!;
    const previousRect = face.getBoundingClientRect();
    face.getBoundingClientRect = () => ({
      ...previousRect,
      left: 150,
      right: 250,
    });
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(
      (doc.querySelector(".battle-effect--weakness") as HTMLElement).style.left,
      "138px",
    );
    (dom.window as any).matchMedia = () => ({ matches: true });
    view.show({ ...event, damage: { amount: 1, modifiers: ["resistance"] } });
    const still = doc.querySelector(".battle-effect--resistance")!;
    assert.ok(still.classList.contains("battle-effect--still"));
    assert.equal(still.querySelectorAll(".battle-effect__particle").length, 0);
    assert.equal(animated, 1);
    doc.querySelector("[data-live-card-id]")!.remove();
    view.show(event);
    assert.equal(doc.querySelectorAll(".battle-effect--weakness").length, 2);
    for (let i = 0; i < 20; i++) view.show(event);
    assert.equal(doc.querySelectorAll(".battle-effect").length, 12);
    view.reset();
    assert.equal(doc.querySelectorAll(".battle-effect").length, 0);
  } finally {
    view.close();
    dom.window.close();
  }
});
test("snapshots repetidos não reproduzem efeitos; cada golpe recebe feedback mesmo com cinco avisos", async () => {
  const path = "../public/JS/battle-events.js";
  const { createBattleEvents } = await import(path);
  const dom = browserFixture(),
    old = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  const view = createBattleEvents(dom.window.document.body);
  const events = Array.from({ length: 8 }, (_, i) => ({
    sequence: i + 1,
    kind: "damage",
    card: { id: "c", nome: "Carta", imgURL: "" },
    damage: { amount: i + 1, modifiers: [] },
  }));
  try {
    view.update({ id: "a", events: [] });
    view.update({ id: "a", events });
    view.update({ id: "a", events });
    assert.equal(
      dom.window.document.querySelectorAll(".battle-effect").length,
      8,
    );
    assert.equal(
      dom.window.document.querySelectorAll(".battle-event").length,
      5,
    );
    view.update({ id: "b", events });
    assert.equal(
      dom.window.document.querySelectorAll(".battle-effect").length,
      0,
    );
    view.update({ id: "b", events });
    assert.equal(
      dom.window.document.querySelectorAll(".battle-effect").length,
      0,
    );
  } finally {
    view.close();
    if (old) Object.defineProperty(globalThis, "document", old);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});
