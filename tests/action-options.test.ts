import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { modifiedSpell } from "../src/game/spell-modifiers";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { chooseAction } from "../src/game/action-options";
import { cleanCard } from "../src/services/catalog";
const catalog = raw.map((c) => cardSchema.parse(c));
function card(id: string, ownerId = "p1", extra: Partial<Card> = {}): Instance {
  const c = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id),
    ...extra,
  });
  return {
    ...structuredClone(c),
    id: randomUUID(),
    ownerId,
    hpAtual: c.hp ?? 0,
    statuses: [],
    attacked: false,
    usedAbility: false,
  };
}
function make(turn = 3) {
  const cartas = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: { nome: "Teste", mago: "108", cartas },
    })),
    catalog,
    () => 0.8,
  );
  Object.assign(g.state, { phase: "BATTLE", current: "p1", turn, round: 3 });
  for (const p of g.state.players) {
    p.mana = 20;
    p.hand = [];
    p.mage.habilidadesPassivas = [];
    p.mage.elemento = "Neutro";
    p.mage.fraqueza = [];
    p.mage.resistencia = [];
    p.mage.limites[0].feiticosUsados = 20;
  }
  slot(g, "p2:front:2").card = card("023", "p2", {
    hp: 40,
    elemento: "Neutro",
    fraqueza: [],
    resistencia: [],
    habilidadesPassivas: [],
  });
  return g;
}
const slot = (g: Game, id: string) => g.state.slots.find((s) => s.id === id)!;
const act = (g: Game, data: object, user = g.state.current) =>
  g.execute(user, {
    ...data,
    actionId: randomUUID(),
    version: g.state.version,
  });
const end = (g: Game) => act(g, { type: "endTurn" });
function cast(
  g: Game,
  id: string,
  targets: string[] = [],
  extra: Partial<Card> = {},
  owner = g.state.current,
) {
  const c = card(id, owner, extra);
  g.player(owner).hand.push(c);
  act(g, { type: "play", cardId: c.id, targets }, owner);
  return c;
}

const options = [
  {
    id: "gain",
    nome: "Receber mana",
    alvo: "Global",
    efeitos: [{ id: "mana", valor: 2 }],
  },
  {
    id: "recycle",
    nome: "Reciclar armamentos",
    alvo: "Cemiterio",
    maxAlvos: 2,
    efeitos: [{ id: "shuffleGraveyard", valor: 2, tiposCarta: ["Armamento"] }],
  },
];
function modal() {
  return card("051", "p1", {
    custoMana: 5,
    alvo: "Global",
    efeitos: [],
    opcoes: options as Card["opcoes"],
  });
}
test("opções declarativas mantêm a identidade, validam modo e sobrevivem ao Mongo", () => {
  const c = modal();
  assert.deepEqual(playableErrors(c), []);
  const {
    id,
    ownerId,
    hpAtual,
    statuses,
    attacked,
    usedAbility,
    ...definition
  } = c;
  const doc = new CardModel(definition);
  assert.equal(doc.validateSync(), undefined);
  const restored = cardSchema.parse(cleanCard(doc.toObject()));
  assert.deepEqual(restored.opcoes, c.opcoes);
  assert.throws(() => chooseAction(c), /Escolha/);
  assert.throws(() => chooseAction(c, "ausente"), /Escolha/);
  const action = chooseAction(c, "recycle");
  assert.equal(action.id, c.id);
  assert.equal(action.nome, c.nome);
  assert.equal(action.alvo, "Cemiterio");
  assert.equal(action.maxAlvos, 2);
  assert.equal(action.opcoes, undefined);
  assert.equal(c.opcoes?.length, 2);
  assert.throws(() => chooseAction(card("039"), "gain"), /não aceita/);
});
test("feitiço com opções executa só a escolha e rejeita pedidos inválidos sem gastar recursos", () => {
  const g = make();
  const c = modal();
  g.player("p1").hand = [c];
  for (const extra of [
    {},
    { mode: "ausente" },
    { mode: "gain", targets: ["inexistente"] },
  ]) {
    const before = JSON.stringify(g.exportState());
    assert.throws(() => act(g, { type: "play", cardId: c.id, ...extra }));
    assert.equal(JSON.stringify(g.exportState()), before);
  }
  act(g, { type: "play", cardId: c.id, mode: "gain" });
  assert.equal(g.player("p1").mana, 17);
  assert.equal(g.player("p1").graveyard[0].id, c.id);
  assert.equal(g.player("p1").counters.spells, 1);
});
test("reciclagem genérica exige o tipo correto e permite escolher uma ou duas cartas", () => {
  let g = make();
  const c = modal();
  const weapon = card("047");
  const troop = card("023");
  g.player("p1").hand = [c];
  g.player("p1").graveyard = [weapon, troop];
  const before = JSON.stringify(g.exportState());
  assert.throws(
    () =>
      act(g, {
        type: "play",
        cardId: c.id,
        mode: "recycle",
        targets: [troop.id],
      }),
    /tipo permitido/,
  );
  assert.equal(JSON.stringify(g.exportState()), before);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  act(g, { type: "play", cardId: c.id, mode: "recycle", targets: [weapon.id] });
  assert(g.player("p1").deck.some((x) => x.id === weapon.id));
  assert(!g.player("p1").graveyard.some((x) => x.id === weapon.id));
  assert(g.player("p1").graveyard.some((x) => x.id === troop.id));
});
test("Amplificar modifica efeitos de cada opção sem mudar quantidades de seleção", () => {
  const g = make();
  g.player("p1").mage.statuses.push({
    nome: "Amplificar",
    turnosRestantes: 2,
    spellBoost: { elementos: ["Neutro"], bonus: 1, descontoMana: 2 },
  });
  const c = { ...modal(), elemento: "Neutro" as const };
  const effective = modifiedSpell(c, g.player("p1").mage);
  assert.equal(effective.custoMana, 3);
  assert.equal(chooseAction(effective, "gain").efeitos[0].valor, 3);
  const recycle = chooseAction(effective, "recycle");
  assert.equal(recycle.maxAlvos, 2);
  assert.equal(recycle.efeitos[0].valor, 2);
  assert.equal(c.opcoes![0].efeitos[0].valor, 2);
});
test("os mesmos efeitos com escolha funcionam em habilidades de cartas em campo", () => {
  const g = make();
  const troop = card("023", "p1", {
    habilidadesAtivas: [
      {
        id: "opcional",
        nome: "Escolher",
        custoMana: 1,
        opcoes: options as Card["opcoes"],
      },
    ],
  });
  slot(g, "p1:front:0").card = troop;
  assert.deepEqual(playableErrors(troop), []);
  g.player("p1").mana = 10;
  act(g, {
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "opcional",
    mode: "gain",
  });
  assert.equal(g.player("p1").mana, 11);
  assert.equal(slot(g, "p1:front:0").card!.usedAbility, true);
});

test("interface resolve a opção antes de oferecer alvos e filtra armamentos no cemitério", async () => {
  const modulePath = "../public/JS/battle-targets.js";
  const { actionTarget, hasAutomaticTarget, zoneCardAllowed } = await import(
    modulePath
  );
  const c = modal();
  const selection = {
    type: "play",
    card: c,
    mode: undefined as string | undefined,
  };
  assert.equal(hasAutomaticTarget(c), false);
  assert.equal(actionTarget(selection).alvo, undefined);
  selection.mode = "recycle";
  const recycle = actionTarget(selection);
  assert.equal(recycle.alvo, "Cemiterio");
  assert.equal(recycle.id, c.id);
  assert.equal(recycle.maxAlvos, 2);
  assert.equal(zoneCardAllowed(recycle, { tipo: "Armamento" }), true);
  assert.equal(zoneCardAllowed(recycle, { tipo: "Tropa" }), false);
  selection.mode = "gain";
  assert.equal(hasAutomaticTarget(actionTarget(selection)), true);
});
