import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import initial from "../src/data/catalog.json";
import { Card, cardSchema } from "../src/types/card";
import { Game } from "../src/game/engine";
import { playableErrors } from "../src/game/capabilities";
import { cardReference, deckInput, validateDeck } from "../src/domain/deck";
const catalog = (initial as unknown[]).map((c) => cardSchema.parse(c));
function deck() {
  const cards: string[] = [];
  for (const c of catalog.filter((c) => c.publicado && c.tipo === "Tropa"))
    for (let i = 0; i < 3 && cards.length < 40; i++)
      cards.push(c.numeroCatalogo);
  return { nome: "Teste", mago: "108", cartas: cards };
}
function game(custom = catalog) {
  return new Game(
    randomUUID(),
    [
      { id: "p1", nome: "Um", deck: deck() },
      { id: "p2", nome: "Dois", deck: deck() },
    ],
    custom,
    () => 0.2,
  );
}
function command(g: Game, user: string, data: Record<string, unknown>) {
  return g.execute(user, {
    actionId: randomUUID(),
    version: g.state.version,
    ...data,
  });
}
function battle(g: Game) {
  g.state.phase = "BATTLE";
  g.state.round = 3;
  g.state.turn = 3;
  g.state.current = "p1";
  for (const slot of g.state.slots.filter((s) => s.kind === "Tropa"))
    slot.card = inst(g, "021", slot.ownerId);
  return g;
}
function inst(g: Game, id: string, owner = "p1") {
  const c = catalog.find((c) => c.numeroCatalogo === id)!;
  return {
    ...structuredClone(c),
    id: randomUUID(),
    ownerId: owner,
    hpAtual: c.hp ?? 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
}

test("catálogo legado convertido, completo e publicação executável", () => {
  assert.equal(catalog.length, 130);
  assert.equal(new Set(catalog.map((c) => c.numeroCatalogo)).size, 130);
  for (const c of catalog.filter((c) => c.publicado))
    assert.deepEqual(playableErrors(c), [], c.nome);
  assert.deepEqual(validateDeck(deck(), catalog, true), []);
});
test("normalização não confia nos atributos do cliente", () => {
  assert.equal(cardReference({ id: 21, ataque: 9999 }), "021");
  const parsed = deckInput.parse({
    nome: "Teste",
    mago: { id: 108 },
    cartas: [{ id: 21, cost: -1 }],
  });
  assert.deepEqual(parsed.cartas, ["021"]);
  assert.throws(() => cardReference({ id: "$ne" }));
});
test("rascunho é salvável, mas não jogável; limites de cópias são uniformes", () => {
  assert.deepEqual(validateDeck({ cartas: [], mago: null }, catalog), []);
  assert.ok(validateDeck({ cartas: [], mago: null }, catalog, true).length);
  assert.ok(
    validateDeck({ cartas: ["021", "021", "021", "021"], mago: "108" }, catalog)
      .length,
  );
  assert.ok(validateDeck({ cartas: ["108"], mago: "021" }, catalog).length);
});
test("cartas inválidas e efeitos não implementados não são publicáveis", () => {
  assert.throws(() =>
    cardSchema.parse({
      numeroCatalogo: "999",
      nome: "Ruim",
      tipo: "Tropa",
      custoMana: -1,
    }),
  );
  const c = cardSchema.parse({
    numeroCatalogo: "999",
    nome: "Futuro",
    tipo: "Feitico",
    custoMana: 2,
    alvo: "Global",
    efeitos: [{ id: "unknown" }],
  });
  assert.ok(playableErrors(c).length);
});

test("efeitos especiais de feitiços não podem ser publicados como habilidades genéricas", () => {
  const troop = catalog.find((c) => c.tipo === "Tropa" && c.publicado)!;
  for (const id of [
    "stoneVolley",
    "tornado",
    "arrowRain",
    "protectionShield",
    "tremor",
    "lightOrb",
    "sandstorm",
    "meteors",
    "zarcosTear",
    "strongFlow",
  ]) {
    const card = cardSchema.parse({
      ...troop,
      habilidadesAtivas: [
        {
          id: "teste",
          nome: "Teste",
          custoMana: 1,
          alvo: "UnicoInimigo",
          efeitos: [{ id, valor: 1 }],
        },
      ],
    });
    assert.ok(
      playableErrors(card).some((error) =>
        /não são executáveis em habilidades/.test(error),
      ),
      id,
    );
  }
  const heal = cardSchema.parse({
    ...troop,
    habilidadesAtivas: [
      {
        id: "cura",
        nome: "Curar",
        custoMana: 1,
        alvo: "UnicoAliado",
        efeitos: [{ id: "heal", valor: 3 }],
      },
    ],
  });
  assert.deepEqual(playableErrors(heal), []);
});
test("estado público não expõe mão nem baralho adversário", () => {
  const g = game(),
    snapshot = g.snapshot("p1"),
    enemy = snapshot.players.find((p) => p.id === "p2")!;
  assert.equal("hand" in enemy, false);
  assert.equal("deck" in enemy, false);
  assert.equal(snapshot.players[0].deckCount, 35);
  assert.throws(() => g.snapshot("intruso"));
});
test("intruso não troca cartas nem envia comandos", () => {
  const g = game(),
    before = JSON.stringify(g.state);
  assert.throws(() =>
    command(g, "intruso", {
      type: "move",
      slotId: "p2:front:0",
      destinationId: "p2:front:1",
    }),
  );
  assert.equal(JSON.stringify(g.state), before);
});
test("preparação não permite ataques ou feitiços", () => {
  const g = game();
  assert.throws(() =>
    command(g, "p1", {
      type: "attack",
      slotId: "p1:front:0",
      targetId: "p2:front:2",
    }),
  );
  g.player("p1").hand.push(inst(g, "001"));
  assert.throws(() =>
    command(g, "p1", {
      type: "play",
      cardId: g.player("p1").hand.at(-1)!.id,
      targets: [],
    }),
  );
});
test("ataque rejeita alvo aliado, ausente e fora de alcance sem consumir ação", () => {
  const g = battle(game()),
    slot = g.state.slots.find((s) => s.id === "p1:front:0")!;
  slot.card = inst(g, "021");
  const before = JSON.stringify(g.state);
  for (const targetId of ["p1:mage", "inexistente", "p2:front:0"])
    assert.throws(() =>
      command(g, "p1", { type: "attack", slotId: slot.id, targetId }),
    );
  assert.equal(JSON.stringify(g.state), before);
});
test("feitiço inválido devolve todos os recursos e não descarta carta", () => {
  const g = battle(game()),
    c = inst(g, "002");
  g.player("p1").hand.push(c);
  const before = JSON.stringify(g.state);
  assert.throws(() =>
    command(g, "p1", { type: "play", cardId: c.id, targets: ["inexistente"] }),
  );
  assert.equal(JSON.stringify(g.state), before);
});
test("ressurreição inválida não cobra mana; tropas retornam restauradas", () => {
  const g = battle(game());
  g.player("p1").mana = 10;
  const before = JSON.stringify(g.state);
  assert.throws(() =>
    command(g, "p1", {
      type: "ability",
      slotId: "p1:mage",
      abilityId: "ressurreicaoSombria",
      targets: [],
    }),
  );
  assert.equal(JSON.stringify(g.state), before);
  const dead = inst(g, "021");
  dead.hpAtual = 0;
  g.player("p1").graveyard.push(dead);
  command(g, "p1", {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "enganarAMorte",
    targets: [],
  });
  assert.equal(
    g.player("p1").deck.find((c) => c.id === dead.id)!.hpAtual,
    dead.hp,
  );
});
test("Canivetes rejeita alvos duplicados e aliados", () => {
  const g = battle(game()),
    c = inst(g, "064"),
    target = g.state.slots.find((s) => s.id === "p2:front:0")!.card!;
  g.player("p1").hand.push(c);
  assert.throws(() =>
    command(g, "p1", {
      type: "play",
      cardId: c.id,
      targets: [target.id, target.id],
    }),
  );
  assert.throws(() =>
    command(g, "p1", {
      type: "play",
      cardId: c.id,
      targets: [g.player("p1").mage.id],
    }),
  );
});
test("Busca Elemental não permite tropa no deck", () => {
  const g = battle(game()),
    c = inst(g, "112");
  g.player("p1").hand.push(c);
  const before = JSON.stringify(g.state);
  assert.throws(() =>
    command(g, "p1", {
      type: "play",
      cardId: c.id,
      targets: [g.player("p1").deck[0].id],
    }),
  );
  assert.equal(JSON.stringify(g.state), before);
});
test("efeitos genéricos aceitam cura e status com schema validado", () => {
  const extra = cardSchema.parse({
    numeroCatalogo: "999",
    nome: "Cura",
    tipo: "Feitico",
    custoMana: 2,
    alvo: "UnicoAliado",
    efeitos: [{ id: "heal", valor: 3 }],
    publicado: true,
  });
  const g = battle(game([...catalog, extra])),
    mage = g.player("p1").mage;
  mage.hpAtual = 10;
  const card = {
    ...extra,
    id: randomUUID(),
    ownerId: "p1",
    hpAtual: 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
  g.player("p1").hand.push(card);
  command(g, "p1", { type: "play", cardId: card.id, targets: [mage.id] });
  assert.equal(g.player("p1").mage.hpAtual, 13);
});

test("alvo Estrutura aplica status na estrutura e não abre Jato para feitiço dirigido só a ela", () => {
  const spell = cardSchema.parse({
    numeroCatalogo: "999",
    nome: "Alvo estrutural",
    tipo: "Feitico",
    custoMana: 1,
    elemento: "Fogo",
    alvo: "Estrutura",
    publicado: true,
    efeitos: [{ id: "status", status: "Cego", duracao: 2 }],
  });
  for (const direct of [false, true]) {
    const g = battle(game([...catalog, spell]));
    const target = g.state.slots.find((s) => s.id === "p2:front:0")!;
    const structure = { ...inst(g, "021", "p2"), tipo: "Estrutura" as const };
    target.structure = structure;
    const cast = { ...inst(g, "001"), ...spell, id: randomUUID() };
    g.player("p1").hand.push(cast);
    g.player("p2").hand = [inst(g, "002", "p2")];
    g.player("p2").mana = 20;
    command(g, "p1", {
      type: "play",
      cardId: cast.id,
      targets: [direct ? structure.id : target.id],
    });
    const after = g.state.slots.find((s) => s.id === target.id)!;
    assert.equal(g.state.pendingSpell, undefined);
    assert.ok(after.structure!.statuses.some((s) => s.nome === "Cego"));
    assert.ok(!after.card!.statuses.some((s) => s.nome === "Cego"));
  }
});
test("dano por habilidade e status encerra partida; ações posteriores são bloqueadas", () => {
  const g = battle(game()),
    assassin = inst(g, "020");
  g.state.slots.find((s) => s.id === "p1:front:0")!.card = assassin;
  g.player("p1").mana = 10;
  g.player("p2").mage.hpAtual = 2;
  command(g, "p1", {
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "ataqueFurtivo",
    targets: [],
  });
  assert.equal(g.state.winner, "p1");
  assert.throws(() => command(g, "p1", { type: "endTurn" }));
  const h = battle(game());
  h.player("p2").mage.hpAtual = 1;
  h.player("p2").mage.statuses.push({
    nome: "Sangramento",
    turnosRestantes: 2,
  });
  command(h, "p1", { type: "endTurn" });
  assert.equal(h.state.status, "ACTIVE");
  command(h, "p2", { type: "endTurn" });
  assert.equal(h.state.winner, "p1");
});
test("fadiga termina o jogo, sem prender a fase de início", () => {
  const g = battle(game());
  g.state.turn = 2;
  g.state.current = "p1";
  g.player("p2").deck = [];
  command(g, "p1", { type: "endTurn" });
  assert.equal(g.state.status, "FINISHED");
  assert.equal(g.state.winner, "p1");
});
test("duplicata de comando é idempotente; revisão antiga é rejeitada", () => {
  const g = game(),
    c = { actionId: randomUUID(), version: 0, type: "endTurn" };
  g.execute("p1", c);
  assert.equal(g.execute("p1", c).duplicate, true);
  assert.equal(g.state.turn, 1);
  assert.equal(g.player("p1").preparation.ready, true);
  assert.throws(() => g.execute("p2", { ...c, actionId: randomUUID() }));
});
