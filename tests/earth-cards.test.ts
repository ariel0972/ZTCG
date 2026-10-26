import { earthCardPatch } from "../scripts/update-earth-cards";
import { completeCoin } from "./support/coin";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import { slotCards, type Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { cleanCard } from "../src/services/catalog";
const catalog = raw.map((c) => cardSchema.parse(c));
function act(g: Game, user: string, cmd: object) {
  return g.execute(user, {
    ...cmd,
    actionId: randomUUID(),
    version: g.state.version,
  });
}
function make() {
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
    () => 0.2,
  );
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
  completeCoin(g);
  g.state.turn = 3;
  g.state.current = "p1";
  for (const p of g.state.players) {
    p.mana = 20;
    p.mage.habilidadesPassivas = [];
    p.mage.limites[0].tropaAtacam = 20;
  }
  return g;
}
function instance(
  ref: string,
  owner = "p1",
  extra: Partial<Card> = {},
): Instance {
  const c = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === ref),
    ...extra,
  });
  return {
    ...c,
    id: randomUUID(),
    ownerId: owner,
    hpAtual: c.hp ?? 0,
    statuses: [],
    attacked: false,
    usedAbility: false,
  };
}
function put(
  g: Game,
  ref: string,
  column: number,
  owner = "p1",
  extra: Partial<Card> = {},
) {
  const s = g.state.slots.find(
    (s) => s.ownerId === owner && s.kind === "Tropa" && s.column === column,
  )!;
  s.card = instance(ref, owner, extra);
  return s.card.id;
}
function get(g: Game, id: string) {
  return g.state.slots.flatMap(slotCards).find((c) => c.id === id)!;
}
function ability(g: Game, id: string, name: string, targets: string[] = []) {
  const slot = g.state.slots.find((s) =>
    slotCards(s).some((c) => c.id === id),
  )!;
  return act(g, get(g, id).ownerId, {
    type: "ability",
    slotId: slot.id,
    source: slot.rider?.id === id ? "rider" : "card",
    abilityId: name,
    targets,
  });
}

function spell(g: Game, ref: string, targets: string[] = []) {
  const p = g.state.players[0];
  p.mana = 20;
  p.counters.spells = 0;
  p.counters.unique = 0;
  const card = instance(ref);
  p.hand.push(card);
  return act(g, "p1", { type: "play", cardId: card.id, targets });
}
function earthMage(g: Game) {
  const p = g.state.players[0],
    c = instance("018");
  p.mage = c;
  g.state.slots.find((s) => s.ownerId === "p1" && s.kind === "Mago")!.card = c;
  return c;
}
function noElements(g: Game, id: string) {
  const c = get(g, id);
  c.fraqueza = [];
  c.resistencia = [];
  return c;
}
function turn(g: Game) {
  act(g, g.state.current, { type: "endTurn" });
}

test("cartas de Terra e invocação publicadas persistem e usam efeitos genéricos", () => {
  for (const id of ["018", "033", "055", "042", "056", "071", "093"]) {
    const card = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(card.publicado, true);
    assert.deepEqual(playableErrors(card), []);
    const doc = new CardModel(card);
    assert.equal(doc.validateSync(), undefined);
    assert.deepEqual(cleanCard(doc.toObject() as any), card);
  }
});
test("Mago de Terra acumula até cinco, mantém entre ciclos e Água remove antes do dano", () => {
  const g = make(),
    m = earthMage(g);
  const target = put(g, "023", 0, "p2", {
    hp: 100,
    resistencia: [],
    fraqueza: [],
  });
  const deck = g.state.players[1].deck.length;
  for (let i = 0; i < 7; i++) spell(g, "033");
  assert.equal(get(g, m.id).statuses.find((s) => s.permanente)?.valor, 5);
  turn(g);
  turn(g);
  assert.equal(get(g, m.id).statuses.find((s) => s.permanente)?.valor, 5);
  const water = instance("001", "p2", {
    elemento: "Agua",
    alvo: "UnicoInimigo",
    tiposAlvo: ["Mago"],
    efeitos: [{ id: "damage", valor: 6 }],
  });
  g.state.players[1].hand.push(water);
  g.state.players[1].mana = 20;
  g.state.current = "p2";
  const hp = get(g, m.id).hpAtual;
  act(g, "p2", { type: "play", cardId: water.id, targets: [m.id] });
  assert.equal(get(g, m.id).hpAtual, hp - 3);
  assert.equal(
    get(g, m.id).statuses.some((s) => s.permanente),
    false,
  );
  assert.ok(get(g, target).hpAtual > 0);
  assert.ok(deck > 0);
});
test("Erosão provocada substitui descarte por dois ciclos e Lama dá bônus apenas naquele turno", () => {
  const g = make(),
    m = earthMage(g),
    target = put(g, "023", 0, "p2", {
      hp: 100,
      elemento: "Ar",
      resistencia: [],
      fraqueza: [],
    });
  const enemy = g.state.players[1],
    before = enemy.deck.length;
  const field = instance("001", "p1", {
    elemento: "Terra",
    alvo: "CampoInimigo",
    efeitos: [{ id: "field", elemento: "Terra" }],
  });
  g.state.players[0].hand.push(field);
  const slot = g.state.slots.find((s) => s.card?.id === target)!;
  act(g, "p1", { type: "play", cardId: field.id, targets: [slot.id] });
  assert.equal(enemy.deck.length, before);
  assert.equal(
    get(g, target).statuses.find((s) => s.nome === "Erosão")?.turnosRestantes,
    2,
  );
  const hp = get(g, target).hpAtual;
  turn(g);
  assert.equal(get(g, target).hpAtual, hp);
  turn(g);
  assert.equal(get(g, target).hpAtual, hp - 1);
  turn(g);
  turn(g);
  assert.equal(get(g, target).hpAtual, hp - 2);
  g.state.slots.find((s) => s.id === slot.id)!.appliedElement = "Agua";
  get(g, target).appliedElement = "Agua";
  g.state.current = "p1";
  g.state.players[0].mana = 20;
  g.state.players[0].hand.push({ ...field, id: randomUUID() });
  const c = g.state.players[0].hand.at(-1)!;
  act(g, "p1", { type: "play", cardId: c.id, targets: [slot.id] });
  assert.equal(
    get(g, m.id).statuses.find((s) => s.nome === "BonusAtaque")?.valor,
    2,
  );
  assert.equal(
    get(g, m.id).statuses.find((s) => s.nome === "Bônus de dano de feitiço")
      ?.valor,
    2,
  );
  turn(g);
  assert.ok(
    !get(g, m.id).statuses.some(
      (s) => s.nome === "BonusAtaque" && s.turnosRestantes > 0,
    ),
  );
});
test("Bola de Demolição filtra Água/Ar, preserva absorção e aplica condições de dois ciclos", () => {
  const g = make();
  earthMage(g);
  const water = put(g, "023", 0, "p2", {
      hp: 30,
      elemento: "Agua",
      fraqueza: [],
      resistencia: [],
    }),
    air = put(g, "023", 1, "p2", {
      hp: 30,
      elemento: "Ar",
      fraqueza: [],
      resistencia: [],
    }),
    normal = put(g, "023", 2, "p2", {
      hp: 30,
      elemento: "Neutro",
      fraqueza: [],
      resistencia: [],
    });
  const slot = g.state.slots.find((s) => s.card?.id === water)!;
  slot.structure = instance("056", "p2");
  spell(g, "033");
  assert.equal(get(g, water).hpAtual, 30);
  assert.equal(
    g.state.slots.find((s) => s.id === slot.id)!.structure!.hpAtual,
    10,
  );
  assert.equal(get(g, air).hpAtual, 27);
  assert.equal(get(g, normal).hpAtual, 24);
  assert.equal(
    get(g, water).statuses.find((s) => s.nome === "Envenenado")
      ?.turnosRestantes,
    2,
  );
  assert.ok(get(g, water).statuses.some((s) => s.nome === "Atordoado"));
  turn(g);
  assert.equal(get(g, water).hpAtual, 30);
  turn(g);
  assert.equal(get(g, water).hpAtual, 29);
  turn(g);
  turn(g);
  assert.equal(get(g, water).hpAtual, 28);
});
test("Terremoto atinge os dois lados e cobra uma vez o dano de estrutura, sem atingir magos", () => {
  const g = make();
  earthMage(g);
  const earth = put(g, "023", 0, "p1", {
      hp: 30,
      elemento: "Terra",
      fraqueza: [],
      resistencia: [],
    }),
    water = put(g, "023", 0, "p2", {
      hp: 30,
      elemento: "Agua",
      fraqueza: [],
      resistencia: [],
    }),
    other = put(g, "023", 1, "p2", {
      hp: 30,
      elemento: "Neutro",
      fraqueza: [],
      resistencia: [],
    });
  const slot = g.state.slots.find((s) => s.card?.id === other)!;
  slot.structure = instance("056", "p2");
  const magehp = g.state.players.map((p) => p.mage.hpAtual);
  spell(g, "055");
  assert.equal(get(g, earth).hpAtual, 28);
  assert.equal(get(g, water).hpAtual, 30);
  assert.equal(get(g, other).hpAtual, 28);
  assert.equal(
    g.state.slots.find((s) => s.id === slot.id)!.structure!.hpAtual,
    6,
  );
  assert.equal(
    g.state.slots
      .find((s) => s.id === slot.id)!
      .structure!.statuses.find((s) => s.nome === "Abalo")?.turnosRestantes,
    2,
  );
  assert.equal(
    get(g, earth).statuses.some((s) => s.nome === "Atordoado"),
    false,
  );
  assert.equal(
    get(g, water).statuses.find((s) => s.nome === "Atordoado")?.turnosRestantes,
    2,
  );
  assert.deepEqual(
    g.state.players.map((p) => p.mage.hpAtual),
    magehp,
  );
});
test("Torre bloqueia condições, permite exceções e bloqueia ataque por um ciclo quando quebrada", () => {
  const g = make(),
    target = put(g, "023", 0, "p2", {
      hp: 30,
      elemento: "Neutro",
      fraqueza: [],
      resistencia: [],
    }),
    slot = g.state.slots.find((s) => s.card?.id === target)!;
  slot.structure = instance("056", "p2");
  const cast = (effects: any[]) => {
    const c = instance("001", "p1", {
      elemento: "Neutro",
      alvo: "UnicoInimigo",
      efeitos: effects,
    });
    g.state.players[0].hand.push(c);
    g.state.players[0].mana = 20;
    g.state.players[0].counters.spells = 0;
    act(g, "p1", { type: "play", cardId: c.id, targets: [target] });
  };
  cast([
    { id: "status", status: "Cego", duracao: 2 },
    { id: "status", status: "Atordoado", duracao: 1 },
  ]);
  assert.equal(
    get(g, target).statuses.some((s) => s.nome === "Cego"),
    false,
  );
  assert.ok(get(g, target).statuses.some((s) => s.nome === "Atordoado"));
  cast([{ id: "damage", valor: 11 }]);
  assert.equal(g.state.slots.find((s) => s.id === slot.id)!.structure, null);
  assert.equal(get(g, target).hpAtual, 30);
  assert.equal(
    get(g, target).statuses.find((s) => s.nome === "SemAtaque")
      ?.turnosRestantes,
    1,
  );
  turn(g);
  assert.ok(get(g, target).statuses.some((s) => s.nome === "SemAtaque"));
  turn(g);
  assert.ok(
    !get(g, target).statuses.some(
      (s) => s.nome === "SemAtaque" && s.turnosRestantes > 0,
    ),
  );
});
test("Toupeira esconde depois do dano e Escavação respeita estrutura e a coluna frontal", () => {
  const g = make(),
    mole = put(g, "042", 0),
    enemy = put(g, "023", 2, "p2", {
      hp: 30,
      ataque: 2,
      elemento: "Neutro",
      fraqueza: [],
      resistencia: [],
    });
  const from = g.state.slots.find((s) => s.card?.id === enemy)!,
    to = g.state.slots.find((s) => s.card?.id === mole)!;
  g.state.current = "p2";
  act(g, "p2", { type: "attack", slotId: from.id, targetId: to.id });
  assert.equal(get(g, mole).hpAtual, 7);
  assert.ok(get(g, mole).statuses.some((s) => s.nome === "Esconder"));
  g.state.current = "p1";
  g.state.slots.find((s) => s.id === from.id)!.structure = instance(
    "056",
    "p2",
  );
  ability(g, mole, "escavacao");
  assert.equal(
    get(g, enemy).statuses.some((s) => s.nome === "Incapacitado"),
    false,
  );
  get(g, mole).usedAbility = false;
  get(g, mole).abilityRounds = {};
  g.state.slots.find((s) => s.id === from.id)!.structure = null;
  ability(g, mole, "escavacao");
  assert.equal(
    get(g, enemy).statuses.find((s) => s.nome === "Incapacitado")
      ?.turnosRestantes,
    1,
  );
});
test("Gerar Torre escolhe do baralho ou cemitério, sem mobilização nem custo da estrutura", () => {
  for (const zone of ["deck", "graveyard"] as const) {
    const g = make(),
      m = earthMage(g),
      ally = put(g, "023", 0),
      tower = instance("056");
    g.state.players[0][zone].push(tower);
    const slot = g.state.slots.find((s) => s.card?.id === ally)!;
    ability(g, m.id, "gerarTorre", [tower.id]);
    assert.equal(g.state.players[0].mana, 15);
    assert.equal(g.state.pendingRevives?.[0].deployment?.destino, "Estrutura");
    act(g, "p1", {
      type: "chooseRevive",
      cardId: tower.id,
      destinationId: slot.id,
    });
    assert.equal(
      g.state.slots.find((s) => s.id === slot.id)!.structure?.id,
      tower.id,
    );
    assert.equal(g.state.players[0].counters.summons, 0);
    assert.equal(
      g.state.players[0][zone].some((c) => c.id === tower.id),
      false,
    );
  }
});
test("Chamar Tropa escolhe tropas não invocação, posiciona gratuitamente e manda excedente à mão", () => {
  const g = make(),
    p = g.state.players[0];
  put(g, "023", 0);
  put(g, "023", 1);
  const a = instance("020"),
    b = instance("021");
  p.deck.push(a, b);
  spell(g, "093", [a.id, b.id]);
  assert.equal(
    g.state.players[0].hand.some((c) => c.id === b.id),
    true,
  );
  assert.equal(p.counters.summons, 0);
  const slot = g.state.slots.find(
    (s) => s.ownerId === "p1" && s.kind === "Tropa" && !s.card,
  )!;
  act(g, "p1", { type: "chooseRevive", cardId: a.id, destinationId: slot.id });
  assert.equal(g.state.slots.find((s) => s.id === slot.id)!.card?.id, a.id);
  assert.equal(g.state.players[0].mana, 13);
  assert.equal(p.counters.summons, 0);
  const invalid = instance("025");
  g.state.players[0].deck.push(invalid);
  assert.throws(() => spell(g, "093", [invalid.id]), /cartas válidas/);
});
test("Círculo dispensa mana e materiais, preserva limite e é consumido também por ressurreição", () => {
  const g = make(),
    sid = "p1:front:0";
  spell(g, "071", [sid]);
  assert.ok(g.state.slots.find((s) => s.id === sid)!.summonCircle);
  assert.equal(
    g.state.players[0].graveyard.some((c) => c.numeroCatalogo === "071"),
    false,
  );
  const normal = instance("020");
  g.state.players[0].hand.push(normal);
  assert.throws(
    () => act(g, "p1", { type: "play", cardId: normal.id, slotId: sid }),
    /apenas tropas de Invocação/,
  );
  const summon = instance("025");
  g.state.players[0].hand.push(summon);
  g.state.players[0].mana = 0;
  act(g, "p1", { type: "play", cardId: summon.id, slotId: sid });
  assert.equal(g.state.slots.find((s) => s.id === sid)!.card?.id, summon.id);
  assert.equal(g.state.players[0].mana, 4);
  assert.equal(g.state.players[0].counters.summons, 1);
  assert.equal(
    g.state.slots.find((s) => s.id === sid)!.summonCircle,
    undefined,
  );
  assert.ok(
    g.state.players[0].graveyard.some((c) => c.numeroCatalogo === "071"),
  );
  const g2 = make();
  spell(g2, "071", [sid]);
  const dead = instance("020");
  g2.state.players[0].graveyard.push(dead);
  const c = instance("080");
  g2.state.players[0].hand.push(c);
  g2.state.players[0].mana = 10;
  act(g2, "p1", {
    type: "play",
    cardId: c.id,
    targets: [dead.id],
    destinationId: sid,
  });
  assert.equal(g2.state.slots.find((s) => s.id === sid)!.card?.id, dead.id);
  assert.equal(
    g2.state.slots.find((s) => s.id === sid)!.summonCircle,
    undefined,
  );
  assert.equal(g2.state.players[0].mana, 9);
});

test("migração preserva arte personalizada, compara só regras escolhidas e é idempotente", () => {
  for (const id of ["018", "033", "055", "042", "056", "071", "093"]) {
    const card = catalog.find((c) => c.numeroCatalogo === id)!;
    const current = {
      ...structuredClone(card),
      imgURL: "/avatars/custom.webp",
      versao: 91,
      custoMana: 99,
    };
    const plan = earthCardPatch(current);
    assert.equal((plan.patch as any).imgURL, undefined);
    assert.equal(plan.version, 91);
    const after: any = { ...current, ...plan.patch };
    for (const key of Object.keys(plan.unset)) delete after[key];
    const repeated = earthCardPatch(after);
    assert.deepEqual(repeated.patch, {});
    assert.deepEqual(repeated.unset, {});
    assert.equal(after.imgURL, current.imgURL);
  }
});
test("Erosão recebida pelo Mago de Terra mantém o descarte normal", () => {
  const g = make(),
    m = earthMage(g);
  g.state.current = "p2";
  const card = instance("001", "p2", {
    elemento: "Ar",
    alvo: "UnicoInimigo",
    efeitos: [{ id: "status", status: "Cego", duracao: 1 }],
  });
  g.state.players[1].hand.push(card);
  const before = g.state.players[0].deck.length;
  act(g, "p2", { type: "play", cardId: card.id, targets: [m.id] });
  assert.equal(g.state.players[0].deck.length, before - 2);
  assert.equal(
    get(g, m.id).statuses.some((s) => s.danoPeriodico),
    false,
  );
});
test("Chamar Tropa posiciona as duas escolhas e Círculo mantém o limite normal", () => {
  const g = make(),
    a = instance("020"),
    b = instance("021");
  g.state.players[0].deck.push(a, b);
  spell(g, "093", [a.id, b.id]);
  act(g, "p1", {
    type: "chooseRevive",
    cardId: a.id,
    destinationId: "p1:front:0",
  });
  assert.equal(g.state.pendingRevives?.length, 1);
  act(g, "p1", {
    type: "chooseRevive",
    cardId: b.id,
    destinationId: "p1:front:1",
  });
  assert.equal(g.state.pendingRevives?.length, 0);
  assert.equal(g.state.players[0].counters.summons, 0);
  spell(g, "071", ["p1:front:2"]);
  const c = instance("025");
  g.state.players[0].hand.push(c);
  g.state.players[0].counters.summons =
    g.state.players[0].mage.limites[0].tropasMobilizadas;
  assert.throws(
    () => act(g, "p1", { type: "play", cardId: c.id, slotId: "p1:front:2" }),
    /Limite de mobilização/,
  );
  assert.ok(g.state.slots.find((s) => s.id === "p1:front:2")!.summonCircle);
});
test("Torre protege também de condições dos feitiços especiais antigos", () => {
  const g = make(),
    id = put(g, "020", 0, "p2", { elemento: "Neutro" });
  g.state.slots.find((s) => s.card?.id === id)!.structure = instance(
    "056",
    "p2",
  );
  spell(g, "008");
  assert.equal(
    get(g, id).statuses.some((s) => ["Cego", "Queimado"].includes(s.nome)),
    false,
  );
});
