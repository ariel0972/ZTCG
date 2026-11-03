import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import type { Instance } from "../src/game/state";
import { Game } from "../src/game/engine";
import { currentBasicAttack } from "../src/game/passives";
import { playableErrors } from "../src/game/capabilities";
import { rogueWindPatch } from "../scripts/update-rogue-wind-cards";
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
  return { g, card, slot, place, run, play, attack, pass };
}

test("quatro cartas são executáveis e preservadas pelo schema do banco", async () => {
  for (const id of ["088", "097", "043", "042"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), [], id);
    const doc = new CardModel(c);
    await doc.validate();
    const { _id, __v, ...obj } = doc.toObject() as any;
    assert.deepEqual(cardSchema.parse(obj), c);
  }
});
test("Ladino usa Furto rápido para roubar o topo sem escolher carta", () => {
  const b = setup();
  b.place("088");
  const first = b.card("023", "q"),
    top = b.card("027", "q");
  b.g.player("q").deck = [first, top];
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "furtoRapido",
    targets: [],
  });
  assert.equal(b.g.player("p").mana, 16);
  assert.equal(b.g.player("p").hand[0].id, top.id);
  assert.equal(b.g.player("p").hand[0].ownerId, "p");
  assert.deepEqual(
    b.g.player("q").deck.map((c) => c.id),
    [first.id],
  );
});
test("Destravar recupera só o feitiço escolhido do cemitério aliado e mantém custo 4", () => {
  const b = setup();
  b.place("088");
  const spell = b.card("097"),
    other = b.card("001"),
    troop = b.card("023"),
    enemy = b.card("097", "q");
  b.g.player("p").graveyard = [spell, other, troop];
  b.g.player("q").graveyard = [enemy];
  for (const id of [troop.id, enemy.id]) {
    const before = JSON.stringify(b.g.exportState());
    assert.throws(() =>
      b.run({
        type: "ability",
        slotId: "p:front:0",
        abilityId: "destravar",
        targets: [id],
      }),
    );
    assert.equal(JSON.stringify(b.g.exportState()), before);
  }
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "destravar",
    targets: [spell.id],
  });
  assert.equal(b.g.player("p").mana, 16);
  assert.deepEqual(
    b.g.player("p").hand.map((c) => c.id),
    [spell.id],
  );
  assert.deepEqual(
    b.g.player("p").graveyard.map((c) => c.id),
    [other.id, troop.id],
  );
});
test("Ladino compra do próprio deck ao matar tropa, mas não ao destruir estrutura", () => {
  for (const structure of [false, true]) {
    const b = setup();
    b.place("088");
    b.place("020", "q", 2, {
      hp: 20,
      hpAtual: structure ? 20 : 1,
      resistencia: [],
      fraqueza: [],
    });
    if (structure)
      b.slot("q", 2).structure = b.card("056", "q", { hpAtual: 1 });
    const reward = b.card("027");
    b.g.player("p").deck = [reward];
    b.attack();
    assert.equal(
      b.g.player("p").hand.some((c) => c.id === reward.id),
      !structure,
    );
  }
});
test("Furtar mostra dado e rouba 3 no par ou 1 no ímpar, sem seleção e sem fadiga adversária", () => {
  for (const [roll, count] of [
    [0.5, 3],
    [0.4, 1],
  ]) {
    const b = setup("016", roll);
    const refs = [
      b.card("020", "q"),
      b.card("021", "q"),
      b.card("022", "q"),
      b.card("023", "q"),
    ];
    b.g.player("q").deck = refs;
    b.play("097");
    assert.equal(b.g.player("p").hand.length, count);
    assert.equal(b.g.player("q").deck.length, 4 - count);
    assert.equal(b.g.player("p").mana, 16);
    assert.ok(
      b.g.state.events?.some((e) =>
        e.message?.includes("dado de 6 lados caiu"),
      ),
    );
    assert.equal(b.g.player("q").mage.hpAtual, 20);
  }
});
test("roubo múltiplo pega cartas originais antes de cada Rato substituir por maldições", () => {
  const b = setup("016", 0.5);
  b.place("027");
  b.place("027", "p", 1);
  const original = [b.card("020", "q"), b.card("021", "q"), b.card("022", "q")];
  b.g.player("q").deck = [...original];
  b.play("097");
  assert.deepEqual(
    new Set(b.g.player("p").hand.map((c) => c.id)),
    new Set(original.map((c) => c.id)),
  );
  assert.equal(b.g.player("q").deck.filter((c) => c.onDrawEffects).length, 6);
});
test("Bater das Asas causa 2 em tropa fora da coluna, estrutura absorve e mago é inválido", () => {
  for (const structure of [false, true]) {
    const b = setup();
    b.place("043");
    const target = b.place("020", "q", 1, {
      hp: 40,
      hpAtual: 40,
      resistencia: [],
      fraqueza: [],
    });
    if (structure) b.slot("q", 1).structure = b.card("056", "q");
    assert.throws(() =>
      b.run({
        type: "ability",
        slotId: "p:front:0",
        abilityId: "baterDasAsas",
        targets: [b.g.player("q").mage.id],
      }),
    );
    b.run({
      type: "ability",
      slotId: "p:front:0",
      abilityId: "baterDasAsas",
      targets: [target.id],
    });
    assert.equal(b.g.player("p").mana, 17);
    assert.equal(b.slot("q", 1).card!.hpAtual, structure ? 40 : 38);
    if (structure) assert.equal(b.slot("q", 1).structure!.hpAtual, 8);
  }
});
test("Lufada devolve só montaria ou ocupante frontal e armamento acompanha apenas quem usava", () => {
  for (const chooseRider of [false, true]) {
    const b = setup();
    b.place("043");
    const mount = b.place("074", "q", 2);
    const rider = b.card("023", "q");
    b.slot("q", 2).rider = rider;
    const weapon = b.card("047", "q");
    b.g.state.slots.find((s) => s.id === "q:arm:front-right")!.card = weapon;
    rider.hpAtual += 5;
    const target = chooseRider ? rider : mount,
      stay = chooseRider ? mount : rider;
    b.run({
      type: "ability",
      slotId: "p:front:0",
      abilityId: "lufada",
      targets: [target.id],
    });
    assert.equal(b.slot("q", 2).card!.id, stay.id);
    assert.equal(b.slot("q", 2).rider, null);
    assert.ok(b.g.player("q").hand.some((c) => c.id === target.id));
    assert.equal(
      b.g.player("q").hand.some((c) => c.id === weapon.id),
      chooseRider,
    );
    assert.equal(b.g.player("p").mana, 15);
  }
});
test("Lufada só atinge a coluna frontal e causa 3 na estrutura mesmo se ela quebrar", () => {
  for (const hp of [10, 2]) {
    const b = setup();
    b.place("043");
    const wrong = b.place("020", "q", 1),
      target = b.place("020", "q", 2, { hpAtual: 20 });
    b.slot("q", 2).structure = b.card("056", "q", {
      hpAtual: hp,
      statuses: [{ nome: "Abalo", turnosRestantes: 2 }],
    });
    assert.throws(() =>
      b.run({
        type: "ability",
        slotId: "p:front:0",
        abilityId: "lufada",
        targets: [wrong.id],
      }),
    );
    b.run({
      type: "ability",
      slotId: "p:front:0",
      abilityId: "lufada",
      targets: [target.id],
    });
    assert.equal(b.slot("q", 2).card!.id, target.id);
    assert.equal(b.slot("q", 2).card!.hpAtual, 20);
    assert.equal(b.g.player("q").hand.length, 0);
    assert.equal(b.slot("q", 2).structure?.hpAtual ?? 0, Math.max(0, hp - 3));
  }
});
test("Cuspe de Lama aplica no campo à frente por dois ciclos completos mesmo com estrutura", () => {
  const b = setup();
  b.place("042");
  b.place("020", "q", 2);
  b.slot("q", 2).structure = b.card("056", "q");
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "cuspeDeLama",
    targets: [],
  });
  assert.equal(b.g.player("p").mana, 15);
  assert.equal(b.slot("q", 2).terrain!.rodadasRestantes, 2);
  assert.equal(b.slot("q", 2).structure!.hpAtual, 10);
  b.pass();
  assert.equal(b.slot("q", 2).terrain!.rodadasRestantes, 2);
  assert.throws(() =>
    b.run({ type: "move", slotId: "q:front:2", destinationId: "q:front:1" }),
  );
  b.pass();
  assert.equal(b.slot("q", 2).terrain!.rodadasRestantes, 1);
  b.pass();
  assert.equal(b.slot("q", 2).terrain!.rodadasRestantes, 1);
  b.pass();
  assert.equal(b.slot("q", 2).terrain, undefined);
});
test("Congelado e Atordoado suspendem eventos e habilidades da arma, mantendo contínuas, mana e bônus impressos", () => {
  for (const name of ["Congelado", "Atordoado"]) {
    const b = setup();
    b.place("023", "p", 0, {
      habilidadesPassivas: [
        {
          gatilho: "onSpellCast",
          escopo: "aliado",
          efeitos: [{ id: "draw", jogador: "aliado", valor: 1 }],
        },
        {
          gatilho: "continuous",
          escopo: "proprio",
          efeitos: [{ id: "attackBonus", valor: 2 }],
        },
      ],
    });
    b.play("047", { slotId: "p:arm:front-left" });
    b.slot("p", 0).card!.statuses = [{ nome: name, turnosRestantes: 2 }];
    const weapon = b.g.state.slots.find(
      (s) => s.id === "p:arm:front-left",
    )!.card!;
    const enemy = b.place("020", "q", 2);
    assert.throws(() =>
      b.run({
        type: "ability",
        slotId: "p:arm:front-left",
        abilityId: "congelarTropa",
        targets: [enemy.id],
      }),
    );
    assert.match(
      b.g.snapshot("p").slots.find((s) => s.id === "p:arm:front-left")!
        .abilityBlockReasons!.card.congelarTropa,
      /bloquead/,
    );
    assert.equal(currentBasicAttack(b.slot("p", 0).card!, b.g.state.slots), 8);
    assert.equal(
      b.g.snapshot("p").slots.find((s) => s.id === "p:front:0")!.card!
        .manaRecovery,
      2,
    );
    const reward = b.card("027");
    b.g.player("p").deck = [reward];
    const cast = () => {
      const spell = b.card("066", "p", {
        alvo: "Global",
        custoMana: 0,
        efeitos: [{ id: "mana", valor: 1 }],
      });
      b.g.player("p").hand.push(spell);
      b.run({ type: "play", cardId: spell.id, targets: [] });
    };
    cast();
    assert.equal(b.g.player("p").hand.length, 0);
    b.slot("p", 0).card!.statuses = [];
    cast();
    assert.ok(b.g.player("p").hand.some((c) => c.id === reward.id));
  }
});
test("Golém congelado ou atordoado não abre reação de desvio", () => {
  for (const name of ["Congelado", "Atordoado"]) {
    const b = setup();
    b.place("026", "q", 2, { statuses: [{ nome: name, turnosRestantes: 2 }] });
    b.play("001");
    assert.equal(b.g.state.pendingImpact, undefined);
    assert.ok(b.slot("q", 2).card!.hpAtual < 15);
  }
});
test("migração das quatro cartas preserva artes e versão e é idempotente", () => {
  for (const id of ["088", "097", "043", "042"]) {
    const before = {
        ...catalog.find((c) => c.numeroCatalogo === id)!,
        custoMana: 99,
        imgURL: "/avatars/custom.webp",
        versao: 19,
      },
      p = rogueWindPatch(before),
      after = { ...before, ...p.patch };
    for (const k of Object.keys(p.unset)) delete (after as any)[k];
    assert.equal(after.imgURL, before.imgURL);
    assert.equal(after.versao, 19);
    assert.deepEqual(rogueWindPatch(after).patch, {});
    assert.deepEqual(rogueWindPatch(after).unset, {});
  }
});

test("interface filtra coluna frontal, ocupante montado e feitiço do cemitério", async () => {
  const path = "../public/JS/battle-targets.js",
    { spellSlotTarget, zoneCardAllowed } = await import(path);
  const ability = catalog
    .find((c) => c.numeroCatalogo === "043")!
    .habilidadesAtivas.find((h) => h.id === "lufada")!;
  const action = { ...ability, sourceColumn: 0 };
  const base = {
    ownerId: "q",
    kind: "Tropa",
    column: 2,
    card: { id: "mount", tipo: "Tropa", hp: 10 },
  };
  assert.equal(spellSlotTarget(action, base, "p"), true);
  assert.equal(
    spellSlotTarget(
      action,
      { ...base, card: { id: "rider", tipo: "Tropa", hp: 11 } },
      "p",
    ),
    true,
  );
  assert.equal(spellSlotTarget(action, { ...base, column: 0 }, "p"), false);
  assert.equal(spellSlotTarget(action, { ...base, ownerId: "p" }, "p"), false);
  const recover = catalog
    .find((c) => c.numeroCatalogo === "088")!
    .habilidadesAtivas.find((h) => h.id === "destravar")!;
  assert.equal(zoneCardAllowed(recover, { tipo: "Feitico" }), true);
  assert.equal(zoneCardAllowed(recover, { tipo: "Tropa" }), false);
});

test("arma vinculada também suspende passiva de evento enquanto o receptor está congelado", () => {
  const b = setup();
  b.place("023");
  b.play("047", { slotId: "p:arm:front-left" });
  const arm = b.g.state.slots.find((s) => s.id === "p:arm:front-left")!.card!;
  arm.habilidadesPassivas.push({
    gatilho: "onSpellCast",
    escopo: "aliado",
    efeitos: [{ id: "mana", jogador: "aliado", valor: 2 }],
  });
  b.slot("p", 0).card!.statuses = [{ nome: "Congelado", turnosRestantes: 2 }];
  b.g.player("p").mana = 5;
  const cast = () => {
    const c = b.card("066", "p", {
      custoMana: 0,
      alvo: "Global",
      efeitos: [{ id: "mana", valor: 1 }],
    });
    b.g.player("p").hand.push(c);
    b.run({ type: "play", cardId: c.id, targets: [] });
  };
  cast();
  assert.equal(b.g.player("p").mana, 6);
  b.slot("p", 0).card!.statuses = [];
  cast();
  assert.equal(b.g.player("p").mana, 9);
});
test("recuperação e dado funcionam em cartas com outro nome e número", () => {
  const b = setup("016", 0.5);
  const source = b.place("088", "p", 0, {
    numeroCatalogo: "999",
    nome: "Pesquisador",
    subtipo: "Monstro",
  });
  const spell = b.card("097");
  b.g.player("p").graveyard = [spell];
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "destravar",
    targets: [spell.id],
  });
  assert.equal(b.g.player("p").hand[0].id, spell.id);
  const other = setup("016", 0.5);
  const generic = other.card("097", "p", {
    numeroCatalogo: "998",
    nome: "Dado de cura",
    alvo: "UnicoAliado",
    efeitos: [
      { id: "heal", valor: 1, dado: { lados: 6, bonusPar: 2, bonusImpar: 0 } },
    ],
  });
  other.g.player("p").mage.hpAtual = 10;
  other.g.player("p").hand = [generic];
  other.run({
    type: "play",
    cardId: generic.id,
    targets: [other.g.player("p").mage.id],
  });
  assert.equal(other.g.player("p").mage.hpAtual, 13);
});

test("passiva já enfileirada não ativa se sua fonte for congelada antes de executar", () => {
  const b = setup();
  b.place("023", "p", 0, {
    habilidadesPassivas: [
      {
        gatilho: "onSpellCast",
        escopo: "aliado",
        efeitos: [
          { id: "status", alvo: "magoAliado", status: "Congelado", duracao: 2 },
        ],
      },
    ],
  });
  b.g.player("p").mage.habilidadesPassivas = [
    {
      gatilho: "onSpellCast",
      escopo: "aliado",
      efeitos: [{ id: "draw", jogador: "aliado", valor: 1 }],
    },
  ];
  const source = b.g.state.slots.find((s) => s.id === "p:front:0")!,
    mage = b.g.state.slots.find((s) => s.kind === "Mago" && s.ownerId === "p")!;
  b.g.state.slots = [
    source,
    mage,
    ...b.g.state.slots.filter((s) => s !== source && s !== mage),
  ];
  const spell = b.card("066", "p", {
    custoMana: 0,
    alvo: "Global",
    efeitos: [{ id: "mana", valor: 1 }],
  });
  b.g.player("p").hand = [spell];
  b.run({ type: "play", cardId: spell.id, targets: [] });
  assert.ok(b.g.player("p").mage.statuses.some((s) => s.nome === "Congelado"));
  assert.equal(b.g.player("p").hand.length, 0);
});
