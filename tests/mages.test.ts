import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import { deckInput } from "../src/domain/deck";
import { deckDTO } from "../src/services/decks";
import { JSDOM } from "jsdom";
const catalog = raw.map((c) => cardSchema.parse(c));
function make(mage = "016") {
  const cartas = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo) as string[])
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: {
        nome: "Maré",
        mago: id === "p1" ? mage : "108",
        cartas,
        icone: "/assets/icons/agua.svg",
        verso: "water",
      },
    })),
    catalog,
    () => 0.2,
  );
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
  turn(g, "p1");
  return g;
}
function act(g: Game, user: string, data: Record<string, unknown>) {
  return g.execute(user, {
    actionId: randomUUID(),
    version: g.state.version,
    ...data,
  });
}
function turn(g: Game, id: string) {
  while (g.state.current !== id || g.state.turn === 1)
    act(g, g.state.current, { type: "endTurn" });
}
function instance(
  id: string,
  ownerId: string,
  overrides: Partial<Card> = {},
): Instance {
  const card = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id),
    ...overrides,
  });
  return {
    ...card,
    id: randomUUID(),
    ownerId,
    hpAtual: card.hp ?? 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
}
function cast(
  g: Game,
  id: string,
  targets: string[] = [],
  overrides: Partial<Card> = {},
) {
  const c = instance(id, "p1", overrides);
  g.player("p1").hand.push(c);
  act(g, "p1", { type: "play", cardId: c.id, targets });
}
test("magos publicados têm limites da arte; aparência do deck chega aos dois jogadores e valida referências", () => {
  for (const id of ["016", "017"])
    assert.deepEqual(
      playableErrors(catalog.find((c) => c.numeroCatalogo === id)!),
      [],
    );
  const g = make();
  for (const user of ["p1", "p2"])
    assert.deepEqual(g.snapshot(user).players[0].deckAppearance, {
      nome: "Maré",
      icone: "/assets/icons/agua.svg",
      verso: "water",
    });
  assert.equal(g.player("p1").mage.limites[0].tropasMobilizadas, 2);
  assert.equal(make("017").player("p1").mage.limites[0].tropaAtacam, 1);
  assert.equal(
    deckInput.parse({
      nome: "Teste",
      mago: null,
      cartas: [],
      icone: "/assets/icons/feitiço.svg",
      verso: "fire",
    }).verso,
    "fire",
  );
  assert.throws(() =>
    deckInput.parse({
      nome: "Teste",
      mago: null,
      cartas: [],
      verso: "../invalid",
    }),
  );
  assert.equal(
    deckDTO({ _id: "old", nome: "Antigo", cartas: [], mago: null }).verso,
    "common",
  );
});
test("Mago de Fogo mantém bônus a cada dois feitiços; Bola de Fogo atinge tropas laterais sem atingir o mago", () => {
  const g = make();
  g.state.slots.find((s) => s.id === "p2:front:0")!.card = instance(
    "021",
    "p2",
    { hp: 60 },
  );
  g.state.slots.find((s) => s.id === "p2:arm:front-right")!.card = instance(
    "021",
    "p2",
    { hp: 60 },
  );
  g.player("p1").mana = 20;
  for (let n = 0; n < 3; n++) cast(g, "001");
  assert.equal(g.player("p1").mage.fireDamageBonus, 1);
  assert.equal(
    g.state.slots.find((s) => s.id === "p2:front:0")!.card!.hpAtual,
    50,
  );
  assert.equal(
    g.state.slots.find((s) => s.id === "p2:arm:front-right")!.card!.hpAtual,
    50,
  );
  assert.equal(g.player("p2").mage.hpAtual, 20);
  act(g, "p1", { type: "endTurn" });
  turn(g, "p1");
  g.player("p1").mana = 20;
  cast(g, "001");
  cast(g, "001");
  assert.equal(
    g.state.slots.find((s) => s.id === "p2:front:0")!.card!.hpAtual,
    41,
  );
  assert.equal(g.player("p1").mage.fireDamageBonus, 2);
  const before = g.player("p1").mage.fireSpellsCast;
  cast(g, "002", [g.player("p2").mage.id]);
  assert.equal(g.player("p1").mage.fireSpellsCast, before);
});
test("Recuperar Energia exige um feitiço próprio e usa a habilidade sem conjurá-lo", () => {
  const g = make(),
    troop = instance("021", "p1"),
    spell = instance("002", "p1");
  g.player("p1").hand.push(troop, spell);
  g.player("p1").mana = 18;
  const cmd = {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "recuperarEnergia",
  };
  assert.throws(() => act(g, "p1", { ...cmd, targets: [troop.id] }), /feitiço/);
  act(g, "p1", { ...cmd, targets: [spell.id] });
  assert.equal(g.player("p1").mana, 20);
  assert.equal(g.player("p1").mage.usedAbility, true);
  assert.ok(g.player("p1").graveyard.some((c) => c.id === spell.id));
  assert.equal(g.player("p1").mage.fireSpellsCast, undefined);
  assert.equal(g.player("p1").counters.spells, 0);
  assert.throws(
    () => act(g, "p1", { ...cmd, targets: [spell.id] }),
    /utilizada/,
  );
});
test("Mago de Água cura por feitiço até 26; Proteção escolhe cura ou escudo por duas rodadas", () => {
  const g = make("017");
  g.player("p1").mana = 20;
  g.player("p1").mage.hpAtual = 19;
  for (const hp of [22, 25, 26]) {
    cast(g, "002", [g.player("p2").mage.id]);
    assert.equal(g.player("p1").mage.hpAtual, hp);
  }
  const ally = instance("021", "p1");
  ally.hpAtual = 5;
  g.state.slots.find((s) => s.id === "p1:front:0")!.card = ally;
  act(g, "p1", {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "protecaoAquatica",
    targets: [ally.id],
    mode: "escudo",
  });
  assert.equal(
    g.state.slots
      .find((s) => s.id === "p1:front:0")!
      .card!.statuses.find((s) => s.nome === "Escudo")!.turnosRestantes,
    2,
  );
  act(g, "p1", { type: "endTurn" });
  turn(g, "p1");
  act(g, "p1", {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "protecaoAquatica",
    targets: [ally.id],
    mode: "cura",
  });
  assert.equal(
    g.state.slots.find((s) => s.id === "p1:front:0")!.card!.hpAtual,
    8,
  );
  assert.equal(g.player("p1").mage.hpAtual, 26);
});
test("reação consome o elemento recebido no campo e na carta; sem reação ele permanece", () => {
  const g = make();
  g.player("p1").mana = 20;
  const target = g.state.slots.find((s) => s.id === "p2:front:0")!;
  const apply = (elemento: Card["elemento"]) =>
    cast(g, "002", [target.id], {
      elemento,
      custoMana: 0,
      alvo: "CampoInimigo",
      efeitos: [{ id: "field" }],
    });
  apply("Ar");
  assert.equal(
    g.state.slots.find((s) => s.id === target.id)!.appliedElement,
    "Ar",
  );
  apply("Agua");
  assert.equal(
    g.state.slots.find((s) => s.id === target.id)!.appliedElement,
    undefined,
  );
  apply("Fogo");
  assert.equal(
    g.state.slots.find((s) => s.id === target.id)!.appliedElement,
    "Fogo",
  );
  act(g, "p1", { type: "endTurn" });
  turn(g, "p1");
  g.state.slots.find((s) => s.id === target.id)!.card = instance("021", "p2", {
    hp: 30,
  });
  apply("Agua");
  assert.equal(
    g.state.slots.find((s) => s.id === target.id)!.card!.appliedElement,
    undefined,
  );
  assert.match(g.state.log.join("\n"), /Vapor/);
});
test("personalização altera só o baralho escolhido e mantém as cartas", async () => {
  const dom = new JSDOM('<div id="picker"></div>');
  const modulePath = "../public/JS/deck-appearance.js";
  const { renderDeckAppearance } = await import(modulePath);
  const deck = {
    nome: "Meu deck",
    cartas: ["021"],
    verso: "common",
    icone: "/assets/icons/neutro.svg",
  };
  const picker = dom.window.document.querySelector("#picker")!;
  let count = 0;
  const render = () =>
    renderDeckAppearance(picker, deck, () => {
      count++;
      render();
    });
  render();
  (
    picker.querySelector(
      '[aria-label="Verso do baralho: Fogo"]',
    ) as HTMLButtonElement
  ).click();
  (
    picker.querySelector(
      '[aria-label="Ícone do baralho: Água"]',
    ) as HTMLButtonElement
  ).click();
  assert.equal(deck.verso, "fire");
  assert.equal(deck.icone, "/assets/icons/agua.svg");
  assert.deepEqual(deck.cartas, ["021"]);
  assert.equal(count, 2);
  dom.window.close();
});
