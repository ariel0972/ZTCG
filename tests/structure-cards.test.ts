import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import type { Instance } from "../src/game/state";
import { Game } from "../src/game/engine";
import { currentBasicAttack } from "../src/game/passives";
import { playableErrors } from "../src/game/capabilities";
import { structuresPatch } from "../scripts/update-structure-cards";
import CardModel from "../src/db/models/Card";
const catalog = raw.map((c) => cardSchema.parse(c));
function setup(mage = "016", roll = 0.4) {
  const refs = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    [
      { id: "p", nome: "P", deck: { nome: "P", mago: mage, cartas: refs } },
      { id: "q", nome: "Q", deck: { nome: "Q", mago: "016", cartas: refs } },
    ],
    catalog,
    () => roll,
  );
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.current = "p";
  for (const p of g.state.players) {
    p.hand = [];
    p.mana = 20;
    p.preparation.ready = true;
  }
  const card = (
    ref: string,
    owner = "p",
    over: Partial<Instance> = {},
  ): Instance => {
    const c = catalog.find((c) => c.numeroCatalogo === ref)!;
    return {
      ...structuredClone(c),
      id: randomUUID(),
      ownerId: owner,
      hpAtual: c.hp ?? 0,
      attacked: false,
      usedAbility: false,
      statuses: [],
      ...over,
    };
  };
  const slot = (owner: string, column: number) =>
    g.state.slots.find((s) => s.id === owner + ":front:" + column)!;
  const place = (
    ref: string,
    owner = "p",
    column = 0,
    over: Partial<Instance> = {},
  ) => {
    const c = card(ref, owner, over);
    slot(owner, column).card = c;
    return c;
  };
  const run = (cmd: Record<string, unknown>, owner = g.state.current) =>
    g.execute(owner, {
      ...cmd,
      version: g.state.version,
      actionId: randomUUID(),
    });
  const play = (ref: string, extra: Record<string, unknown> = {}) => {
    const c = card(ref, g.state.current);
    g.player(g.state.current).hand.push(c);
    run({ type: "play", cardId: c.id, ...extra });
    return c;
  };
  const attack = (owner = "p", column = 0, target = "q:front:2") =>
    run(
      { type: "attack", slotId: owner + ":front:" + column, targetId: target },
      owner,
    );
  const pass = () => run({ type: "endTurn" });
  const live = (c: Instance) =>
    g.state.slots
      .flatMap((s) => [s.card, s.rider, s.structure])
      .find((x) => x?.id === c.id)!;
  return { g, card, slot, place, run, play, attack, pass, live };
}

const shot = (
  b: ReturnType<typeof setup>,
  targetId = "q:front:2",
  extra: Record<string, unknown> = {},
) =>
  b.run({
    type: "attack",
    slotId: "p:front:0",
    source: "structure",
    targetId,
    ...extra,
  });
const build = (
  b: ReturnType<typeof setup>,
  ref: string,
  owner = "p",
  column = 0,
) => {
  const c = b.card(ref, owner);
  b.slot(owner, column).structure = c;
  return c;
};
test("as quatro estruturas são publicadas, configuráveis e preservadas pelo banco e migração", async () => {
  for (const id of ["058", "059", "091", "109"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), []);
    const doc = new CardModel(c);
    await doc.validate();
    const { _id, __v, ...obj } = doc.toObject() as any;
    assert.deepEqual(cardSchema.parse(obj), c);
    const patch = structuresPatch({
      ...c,
      publicado: false,
      hp: 1,
      ataque: 2,
      estrutura: undefined,
      imgURL: "/avatars/preserved.webp",
    });
    assert.equal(patch.patch.publicado, true);
    assert.equal(patch.patch.imgURL, undefined);
  }
});
test("disparo e ataque normal dividem o contador da tropa de dois ataques", () => {
  for (const firstNormal of [true, false]) {
    const b = setup();
    b.place("022");
    build(b, "058");
    b.place("020", "q", 0, {
      hp: 20,
      hpAtual: 20,
      resistencia: [],
      fraqueza: [],
    });
    b.place("020", "q", 2, {
      hp: 20,
      hpAtual: 20,
      resistencia: [],
      fraqueza: [],
    });
    if (firstNormal) b.attack();
    else shot(b, "q:front:0");
    assert.equal(b.slot("p", 0).card!.attacksMade, 1);
    assert.equal(b.slot("p", 0).card!.attacked, false);
    assert.equal(b.g.player("p").counters.attacks, 1);
    if (firstNormal) shot(b, "q:front:0");
    else b.attack();
    assert.equal(b.slot("p", 0).card!.attacked, true);
    assert.equal(b.g.player("p").counters.attacks, 2);
    assert.throws(() => b.attack());
  }
});
test("tropa de um ataque não recebe ataque extra da estrutura e tiro não recebe arma", () => {
  const b = setup();
  b.place("020");
  build(b, "091");
  b.g.state.slots.find((s) => s.id === "p:arm:front-left")!.card = b.card(
    "037",
    "p",
    { bonusAtaque: 20 },
  );
  const hp = b.g.player("q").mage.hpAtual;
  shot(b, "q:mage");
  assert.equal(b.g.player("q").mage.hpAtual, hp - 4);
  assert.equal(b.slot("p", 0).card!.attacked, true);
  assert.throws(() => b.attack());
  assert.throws(() => shot(b, "q:mage"));
});
test("somente ocupante usa estrutura e gasta seu próprio ataque, preservando montaria", () => {
  const b = setup();
  b.place("074");
  b.slot("p", 0).rider = b.card("022");
  build(b, "091");
  shot(b, "q:mage");
  assert.equal(b.slot("p", 0).rider!.attacksMade, 1);
  assert.equal(b.slot("p", 0).card!.attacked, false);
  assert.equal(b.slot("p", 0).card!.attacksMade ?? 0, 0);
  const c = setup();
  c.place("074");
  c.slot("p", 0).rider = c.card("020", "p", { attacked: true, attacksMade: 1 });
  build(c, "091");
  assert.throws(() => shot(c, "q:mage"));
  assert.equal(c.slot("p", 0).card!.attacked, false);
});
test("Torreta alcança qualquer tropa mas não o mago; Canhão é frontal", () => {
  const b = setup();
  b.place("020");
  build(b, "058");
  const far = b.place("020", "q", 0, {
    hp: 20,
    hpAtual: 20,
    resistencia: [],
    fraqueza: [],
  });
  shot(b, "q:front:0");
  assert.equal(b.live(far).hpAtual, 17);
  const c = setup();
  c.place("020");
  build(c, "058");
  assert.throws(() => shot(c, "q:mage"));
  const d = setup();
  d.place("020");
  build(d, "091");
  d.place("020", "q", 0);
  assert.throws(() => shot(d, "q:front:0"));
  assert.throws(() => shot(d, "q:mage"));
  assert.throws(() => shot(d, "q:front:2"));
});
test("recarga impede o disparo na rodada seguinte, mas não o ataque da tropa", () => {
  const b = setup();
  b.g.state.round = 3;
  b.place("020");
  build(b, "091");
  shot(b, "q:mage");
  b.pass();
  b.pass();
  assert.equal(b.g.state.round, 4);
  assert.throws(() => shot(b, "q:mage"));
  assert.ok(
    b.g.snapshot("p").slots.find((s) => s.id === "p:front:0")!.attackTargets!
      .card.length > 0,
  );
  b.pass();
  b.pass();
  assert.equal(b.g.state.round, 5);
  shot(b, "q:mage");
});
test("estado do ocupante bloqueia disparo, Cego pode errar e consome o ataque", () => {
  for (const nome of ["Congelado", "Atordoado", "Incapacitado"]) {
    const b = setup();
    b.place("020", "p", 0, { statuses: [{ nome, turnosRestantes: 2 }] });
    build(b, "091");
    assert.throws(() => shot(b, "q:mage"));
  }
  const b = setup();
  b.place("020", "p", 0, { statuses: [{ nome: "Cego", turnosRestantes: 2 }] });
  build(b, "091");
  const hp = b.g.player("q").mage.hpAtual;
  shot(b, "q:mage");
  assert.equal(b.g.player("q").mage.hpAtual, hp);
  assert.equal(b.slot("p", 0).card!.attacked, true);
  assert.ok(b.g.state.events?.some((e) => e.kind === "miss"));
});
test("ataque básico escolhe tropa ou estrutura ofensiva; Torre continua absorvendo", () => {
  for (const targetSource of ["card", "structure"]) {
    const b = setup();
    b.place("020", "p", 0, { ataque: 3 });
    const target = b.place("020", "q", 2, {
      hp: 20,
      hpAtual: 20,
      resistencia: [],
      fraqueza: [],
    });
    build(b, "091", "q", 2);
    b.run({
      type: "attack",
      slotId: "p:front:0",
      targetId: "q:front:2",
      targetSource,
    });
    assert.equal(b.live(target).hpAtual, targetSource === "card" ? 17 : 20);
    assert.equal(
      b.slot("q", 2).structure!.hpAtual,
      targetSource === "structure" ? 6 : 9,
    );
  }
  const b = setup();
  b.place("020");
  const target = b.place("020", "q", 2);
  build(b, "056", "q", 2);
  b.attack();
  assert.equal(b.live(target).hpAtual, target.hp);
  assert.ok(b.slot("q", 2).structure!.hpAtual < 10);
});
test("tropa intercepta ataques básicos dirigidos ao Canhão Instável; feitiço atinge o canhão", () => {
  const b = setup();
  b.place("020", "p", 0, { ataque: 3 });
  const target = b.place("020", "q", 2, {
    hp: 20,
    hpAtual: 20,
    resistencia: [],
    fraqueza: [],
  });
  build(b, "109", "q", 2);
  b.run({
    type: "attack",
    slotId: "p:front:0",
    targetId: "q:front:2",
    targetSource: "structure",
  });
  assert.equal(b.live(target).hpAtual, 17);
  assert.equal(b.slot("q", 2).structure!.hpAtual, 8);
  b.play("002", { targets: [b.slot("q", 2).structure!.id] });
  assert.equal(b.slot("q", 2).structure!.hpAtual, 4);
});
test("Muro bloqueia ataque, converte Terra em vida e é destruído por Água e Ar", () => {
  for (const element of ["Agua", "Ar"]) {
    const b = setup();
    b.place("020", "p", 0, { elemento: "Terra", ataque: 5 });
    const target = b.place("020", "q", 2);
    build(b, "059", "q", 2);
    b.attack();
    assert.equal(b.slot("q", 2).structure!.hpAtual, 9);
    assert.equal(b.slot("q", 2).structure!.hp, 9);
    assert.equal(b.live(target).hpAtual, target.hp);
    const spell = b.card("002", "p", {
      elemento: element as Instance["elemento"],
      efeitos: [{ id: "damage", valor: 1 }],
    });
    b.g.player("p").hand.push(spell);
    b.run({
      type: "play",
      cardId: spell.id,
      targets: [b.slot("q", 2).structure!.id],
    });
    assert.equal(b.slot("q", 2).structure, null);
    assert.equal(b.live(target).hpAtual, target.hp);
  }
  const b = setup();
  b.place("020");
  build(b, "059");
  assert.throws(() => b.attack());
  assert.throws(() => shot(b, "q:mage"));
});
test("carga exige ao menos 2, acumula entre turnos e é gasta inteira no disparo", () => {
  const b = setup("016", 0.2);
  b.place("020");
  build(b, "109");
  assert.throws(() =>
    b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 1 }),
  );
  b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 3 });
  assert.equal(b.g.player("p").mana, 17);
  assert.equal(b.slot("p", 0).structure!.storedMana, 3);
  assert.throws(() =>
    b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 2 }),
  );
  b.pass();
  b.pass();
  b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 3 });
  assert.equal(b.slot("p", 0).structure!.storedMana, 6);
  const target = b.place("020", "q", 2, {
    hp: 20,
    hpAtual: 20,
    resistencia: [],
    fraqueza: ["Fogo"],
  });
  shot(b);
  assert.equal(b.live(target).hpAtual, 14);
  assert.equal(b.slot("p", 0).structure!.storedMana, 0);
});
test("disparo sorteia exatamente os seis elementos e soma 1 por 2 mana", () => {
  for (const [i, element] of [
    "Neutro",
    "Fogo",
    "Agua",
    "Terra",
    "Ar",
    "Zarcos",
  ].entries()) {
    const b = setup("016", (i + 0.01) / 6);
    b.place("020");
    build(b, "109");
    b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 2 });
    const target = b.place("020", "q", 2, {
      hp: 20,
      hpAtual: 20,
      resistencia: [],
      fraqueza: [],
    });
    shot(b);
    assert.equal(b.live(target).hpAtual, 19);
    assert.ok(
      b.g.state.events?.some(
        (e) => e.kind === "damage" && e.damage?.element === element,
      ),
    );
  }
});
test("explosão usa dano antes de resistência e mata canhão, montaria e ocupante", () => {
  const b = setup("016", 0.01);
  b.place("074");
  b.slot("p", 0).rider = b.card("023");
  build(b, "109");
  b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 20 });
  const target = b.place("020", "q", 2, {
    hp: 30,
    hpAtual: 30,
    resistencia: ["Neutro"],
    fraqueza: [],
  });
  shot(b);
  assert.equal(b.live(target).hpAtual, 25);
  assert.equal(b.slot("p", 0).structure, null);
  assert.equal(b.slot("p", 0).card, null);
  assert.equal(b.slot("p", 0).rider, null);
});
test("explosão acontece mesmo ao errar ou ao Golém desviar do tiro", () => {
  for (const dodge of [false, true]) {
    const b = setup("016", 0.1);
    b.place("020", "p", 0, {
      statuses: dodge ? [] : [{ nome: "Cego", turnosRestantes: 2 }],
    });
    build(b, "109");
    b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 20 });
    const target = b.place(dodge ? "026" : "020", "q", 2, {
      hp: 30,
      hpAtual: 30,
      resistencia: [],
      fraqueza: [],
    });
    shot(b);
    if (dodge) {
      assert.equal(b.g.state.pendingImpact?.request.cardId, target.id);
      b.run(
        {
          type: "respondDodge",
          dodge: true,
          choiceKey: b.g.state.pendingImpact!.request.key,
        },
        "q",
      );
    }
    assert.equal(b.live(target).hpAtual, 30);
    assert.equal(b.slot("p", 0).structure, null);
    assert.equal(b.slot("p", 0).card, null);
  }
});

test("carga é idempotente e tiro/explosão sobrevivem à resposta persistida", () => {
  const b = setup();
  b.place("020");
  build(b, "109");
  const actionId = randomUUID(),
    version = b.g.state.version;
  const cmd = {
    type: "chargeStructure",
    slotId: "p:front:0",
    mana: 20,
    actionId,
    version,
  };
  b.g.execute("p", cmd);
  assert.equal(b.g.execute("p", cmd).duplicate, true);
  assert.equal(b.g.player("p").mana, 0);
  assert.equal(b.slot("p", 0).structure!.storedMana, 20);
  b.g.player("q").mage.habilidadesPassivas = [
    {
      gatilho: "onTargeted",
      escopo: "proprio",
      efeitos: [{ id: "reflectAttack" }],
    },
  ];
  shot(b, "q:mage");
  assert.ok(b.g.state.pendingAttack);
  const restored = Game.restore(b.g.exportState(), () => 0.4);
  restored.execute("q", {
    type: "respondAttack",
    reflect: true,
    version: restored.state.version,
    actionId: randomUUID(),
  });
  assert.equal(restored.state.pendingAttack, undefined);
  assert.equal(
    restored.state.slots.find((s) => s.id === "p:front:0")!.structure,
    null,
  );
  assert.equal(
    restored.state.slots.find((s) => s.id === "p:front:0")!.card,
    null,
  );
  assert.equal(restored.player("q").mage.hpAtual, 20);
});
test("carga e recarga são perdidas ao sair do campo", () => {
  const b = setup();
  const troop = b.place("020");
  build(b, "109");
  b.run({ type: "chargeStructure", slotId: "p:front:0", mana: 2 });
  shot(b, "q:mage");
  b.pass();
  b.play("004", { targets: [troop.id] });
  const returned = b.g
    .player("p")
    .hand.find((c) => c.numeroCatalogo === "109")!;
  assert.equal(returned.storedMana, undefined);
  assert.equal(returned.structureAttackRound, undefined);
  assert.equal(returned.structureChargeTurn, undefined);
});
