import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import initial from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import CardModel from "../src/db/models/Card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { entryCost, materialOptions } from "../src/game/entry-cost";
import { invocationCostPatch } from "../scripts/update-invocation-costs";
const catalog = initial.map((c) => cardSchema.parse(c));
function instance(
  id: string,
  ownerId = "p1",
  extra: Partial<Card> = {},
): Instance {
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
function make(necro = false) {
  const cartas = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: { nome: "Teste", mago: necro ? "108" : "019", cartas },
    })),
    catalog,
    () => 0.8,
  );
  Object.assign(g.state, { phase: "BATTLE", turn: 3, round: 2, current: "p1" });
  for (const p of g.state.players) {
    p.hand = [];
    p.mana = 20;
    p.mage.limites[0].feiticosUsados = 20;
    p.mage.limites[0].tropasMobilizadas = 5;
  }
  return g;
}
const slot = (g: Game, id = "p1:front:0") =>
  g.state.slots.find((s) => s.id === id)!;
const act = (g: Game, command: object, user = "p1") =>
  g.execute(user, {
    ...command,
    version: g.state.version,
    actionId: randomUUID(),
  });
function play(
  g: Game,
  c: Instance,
  materials?: string[],
  position = "p1:front:0",
) {
  if (!g.player(c.ownerId).hand.some((x) => x.id === c.id))
    g.player(c.ownerId).hand.push(c);
  return act(
    g,
    {
      type: "play",
      cardId: c.id,
      slotId: c.tipo === "Feitico" ? undefined : position,
      materiais: materials,
      targets: [],
    },
    c.ownerId,
  );
}
function unchanged(g: Game, fn: () => unknown) {
  const before = JSON.stringify(g.exportState());
  assert.throws(fn);
  assert.equal(JSON.stringify(g.exportState()), before);
}

test("Goléns pagam tropa do mesmo elemento da mão e mana sem descartar a carta errada", () => {
  for (const id of ["025", "026"]) {
    const g = make(),
      golem = instance(id),
      material = instance("023", "p1", { elemento: golem.elemento });
    const spare = instance("057");
    g.player("p1").hand = [material, golem, spare];
    play(g, golem, [material.id]);
    assert.equal(slot(g).card!.id, golem.id);
    assert.equal(g.player("p1").mana, 20 - golem.custoMana);
    assert.deepEqual(
      g.player("p1").hand.map((c) => c.id),
      [spare.id],
    );
    assert.equal(
      g.player("p1").graveyard.filter((c) => c.id === material.id).length,
      1,
    );
  }
});
test("custo rejeita ausentes, duplicados, tipo/elemento errado, adversário, cemitério e mana insuficiente atomicamente", () => {
  for (const mode of [
    "missing",
    "duplicate",
    "type",
    "element",
    "applied",
    "enemy",
    "grave",
    "mana",
    "invalid-slot",
  ]) {
    const g = make(),
      c = instance("026"),
      m = instance("023", "p1", { elemento: "Agua" });
    if (mode === "type") Object.assign(m, { tipo: "Feitico" });
    if (["element", "applied"].includes(mode)) m.elemento = "Neutro";
    if (mode === "applied") m.appliedElement = "Agua";
    if (mode === "enemy") m.ownerId = "p2";
    if (mode === "grave") g.player("p1").graveyard.push(m);
    else g.player("p1").hand.push(m);
    g.player("p1").hand.push(c);
    if (mode === "mana") g.player("p1").mana = 0;
    unchanged(g, () =>
      play(
        g,
        c,
        mode === "missing"
          ? undefined
          : mode === "duplicate"
            ? [m.id, m.id]
            : [m.id],
        mode === "invalid-slot" ? "p2:front:0" : "p1:front:0",
      ),
    );
  }
});
test("sacrifício substitui a tropa no mesmo espaço, ignora estrutura e status e ativa passivas uma vez", () => {
  const g = make(true),
    c = instance("025"),
    m = instance("023");
  m.statuses = [{ nome: "Congelado", turnosRestantes: 2 }];
  slot(g).card = m;
  const structure = instance("056");
  slot(g).structure = structure;
  g.player("p1").mage.hpAtual = 10;
  play(g, c, [m.id]);
  assert.equal(slot(g).card!.id, c.id);
  assert.equal(slot(g).structure!.id, structure.id);
  assert.equal(structure.hpAtual, structure.hp);
  assert.equal(g.player("p1").mage.hpAtual, 12);
  assert.equal(g.player("p1").mana, 15);
  assert.equal(g.player("p1").mage.usedAbility, false);
  assert.equal(g.player("p1").graveyard.filter((c) => c.id === m.id).length, 1);
  assert.equal(g.player("p1").counters.summons, 1);
});
test("quantidade, origens, tipos e elementos são reutilizados em feitiço sem depender do nome da invocação", () => {
  const g = make();
  const c = instance("057", "p1", {
    nome: "Outra carta",
    elemento: "Neutro",
    custoMana: 3,
    alvo: "Global",
    tiposAlvo: undefined,
    efeitos: [{ id: "mana", valor: 1 }],
    custoEntrada: {
      quantidade: 2,
      tiposCarta: ["Tropa", "Feitico"],
      origens: ["mao", "campo"],
      elementos: ["Fogo"],
    },
  });
  const hand = instance("057", "p1", { elemento: "Fogo" }),
    field = instance("023", "p1", { elemento: "Fogo" });
  g.player("p1").hand = [c, hand];
  slot(g).card = field;
  unchanged(g, () => play(g, c, [hand.id]));
  play(g, c, [hand.id, field.id]);
  assert.equal(g.player("p1").mana, 18);
  assert.equal(slot(g).card, null);
  assert.ok(g.player("p1").graveyard.some((c) => c.id === hand.id));
});
test("materiais de feitiço em campo removem Amplificar, dano contínuo e vínculo de mana", () => {
  for (const id of ["127", "120", "079"]) {
    const g = make(),
      field = instance("023");
    slot(g).card = field;
    const spell = instance(id);
    g.player("p1").hand.push(spell);
    act(g, {
      type: "play",
      cardId: spell.id,
      targets: id === "079" ? [field.id] : [],
    });
    g.player("p1").mana = 20;
    const c = instance("025", "p1", {
      custoEntrada: {
        quantidade: 1,
        tiposCarta: ["Feitico"],
        origens: ["campo"],
      },
    });
    g.player("p1").hand.push(c);
    assert.ok(
      materialOptions(g.state, "p1", c).some((o) => o.card.id === spell.id),
    );
    play(g, c, [spell.id], "p1:front:1");
    assert.equal((g.state.ongoingSpells ?? []).length, 0);
    assert.equal((g.state.attachments ?? []).length, 0);
    assert.equal(
      g.player("p1").mage.statuses.filter((s) => s.spellBoost).length,
      0,
    );
    assert.equal(
      g.player("p1").graveyard.filter((c) => c.id === spell.id).length,
      1,
    );
  }
});
test("armamentos e estruturas configurados como material saem do campo e removem seus bônus", () => {
  const g = make(),
    troop = instance("023");
  slot(g).card = troop;
  const weapon = instance("047");
  slot(g, "p1:arm:front-left").card = weapon;
  troop.hpAtual += weapon.bonusHp!;
  const tower = instance("056");
  slot(g).structure = tower;
  const c = instance("025", "p1", {
    custoEntrada: {
      quantidade: 2,
      tiposCarta: ["Armamento", "Estrutura"],
      origens: ["campo"],
    },
  });
  play(g, c, [weapon.id, tower.id], "p1:front:1");
  assert.equal(slot(g).structure, null);
  assert.equal(slot(g, "p1:arm:front-left").card, null);
  assert.equal(slot(g).card!.hpAtual, troop.hp);
  assert.ok(g.player("p1").graveyard.some((c) => c.id === tower.id));
});
test("preparação bloqueia invocações e permite reembaralhar mão só de invocações", () => {
  const g = make();
  g.state.phase = "PREPARATION";
  g.player("p1").hand = [instance("025"), instance("026")];
  const c = g.player("p1").hand[0];
  unchanged(g, () => play(g, c, []));
  assert.match(
    g.snapshot("p1").players.find((p) => p.id === "p1")!.hand![0]
      .handBlockedReason!,
    /preparação/,
  );
  act(g, { type: "mulligan" });
  assert.equal(g.player("p1").preparation.redraws, 1);
});
test("reviver Invocação não cobra materiais nem mana de entrada", () => {
  const g = make(true),
    c = instance("026");
  c.hpAtual = 0;
  g.player("p1").graveyard.push(c);
  g.player("p1").mana = 0;
  act(g, {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "enganarAMorte",
    targets: [c.id],
    destinationId: "p1:front:0",
  });
  assert.equal(slot(g).card!.id, c.id);
  assert.equal(g.player("p1").mana, 0);
  assert.equal(g.player("p1").counters.summons, 0);
});
test("nova Invocação usa regra global e opções privadas só aparecem para o dono", () => {
  const g = make(),
    c = instance("023", "p1", {
      numeroCatalogo: "999",
      subtipo: "Invocação",
      custoEntrada: undefined,
    }),
    m = instance("023");
  g.player("p1").hand = [c, m];
  assert.equal(entryCost(c)!.quantidade, 1);
  assert.deepEqual(entryCost(c)!.tiposCarta, ["Tropa", "Feitico"]);
  const own = g.snapshot("p1").players.find((p) => p.id === "p1")!
    .hand![0] as any;
  assert.deepEqual(
    own.materiaisEntrada.map((c: any) => c.id),
    [m.id],
  );
  assert.equal(
    g.snapshot("p2").players.find((p) => p.id === "p1")!.hand,
    undefined,
  );
  assert.equal(
    g.spectatorSnapshot().players.find((p) => p.id === "p1")!.hand,
    undefined,
  );
  play(g, c, [m.id]);
});
test("custo persiste em Mongo/Zod e migração preserva atributos administrativos", async () => {
  const c = catalog.find((c) => c.numeroCatalogo === "025")!;
  const model = new CardModel(c);
  await model.validate();
  const { _id, __v, ...raw } = model.toObject();
  assert.deepEqual(cardSchema.parse(raw), c);
  const custom = {
    ...structuredClone(c),
    custoMana: 9,
    hp: 38,
    imgURL: "/custom.png",
    versao: 12,
    custoEntrada: undefined,
  };
  const patch = invocationCostPatch(custom).patch;
  assert.deepEqual(Object.keys(patch), ["custoEntrada"]);
  const next = { ...custom, ...patch };
  assert.equal(next.custoMana, 9);
  assert.equal(next.hp, 38);
  assert.equal(next.versao, 12);
  assert.deepEqual(invocationCostPatch(next).patch, {});
});

test("Reação com custo configurado também exige materiais e não os gasta duas vezes", () => {
  const g = make(),
    target = instance("023", "p2");
  slot(g, "p2:front:0").card = target;
  const reaction = instance("002", "p2", {
      custoEntrada: {
        quantidade: 1,
        tiposCarta: ["Tropa"],
        origens: ["mao"],
        mesmoElemento: true,
      },
    }),
    material = instance("023", "p2", { elemento: "Agua" });
  g.player("p2").hand = [reaction, material];
  const fire = instance("035");
  play(g, fire);
  assert.ok(g.state.pendingSpell);
  unchanged(g, () =>
    act(g, { type: "respondSpell", cardId: reaction.id }, "p2"),
  );
  const command = {
    type: "respondSpell",
    cardId: reaction.id,
    materiais: [material.id],
    actionId: randomUUID(),
    version: g.state.version,
  };
  g.execute("p2", command);
  const after = JSON.stringify(g.exportState());
  g.execute("p2", command);
  assert.equal(JSON.stringify(g.exportState()), after);
  assert.equal(g.player("p2").mana, 20 - reaction.custoMana);
  assert.equal(g.state.pendingSpell, undefined);
});
