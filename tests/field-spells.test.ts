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
import { cleanCard } from "../src/services/catalog";
import { fieldSpellPatch } from "../scripts/update-field-spells";
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

test("definições novas e variantes sobrevivem ao esquema Mongo e à limpeza", () => {
  for (const id of ["004", "035", "136"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.deepEqual(playableErrors(c), []);
    const doc = new CardModel(c);
    assert.equal(doc.validateSync(), undefined);
    assert.deepEqual(cleanCard(doc.toObject()), c);
  }
});
test("Furacão devolve o grupo inteiro e os vínculos sem destruir nem ferir o mago", () => {
  const g = make(),
    s = slot(g, "p2:front:2"),
    mount = s.card!;
  mount.palavrasChave = ["Montaria"];
  s.rider = card("023", "p2");
  s.structure = card("023", "p2", { tipo: "Estrutura", hp: 10, ataque: 1 });
  const w = card("047", "p2");
  slot(g, "p2:arm:front-right").card = w;
  const ids = [mount, s.rider, s.structure, w].map((c) => c.id);
  mount.statuses = [{ nome: "Cego", turnosRestantes: 2 }];
  cast(g, "004", [mount.id]);
  assert.equal(slot(g, s.id).card, null);
  assert.equal(slot(g, s.id).rider, null);
  assert.equal(slot(g, s.id).structure, null);
  assert.equal(slot(g, "p2:arm:front-right").card, null);
  assert.ok(
    ids.every((id) =>
      g.player("p2").hand.some((c) => c.id === id && !c.statuses.length),
    ),
  );
  assert.equal(g.player("p2").mage.hpAtual, 18);
  assert.equal(g.state.ongoingSpells?.length ?? 0, 0);
  assert.equal(g.player("p1").mana, 14);
});
test("Furacão: Fogo recebe 2 e estrutura absorve; Terra fica por dois ciclos sem devolução", () => {
  for (const structure of [false, true]) {
    const g = make(),
      s = slot(g, "p2:front:2");
    s.card!.elemento = "Fogo";
    if (structure)
      s.structure = card("023", "p2", {
        tipo: "Estrutura",
        hp: 10,
        ataque: 1,
        fraqueza: [],
        resistencia: [],
      });
    cast(g, "004", [s.card!.id]);
    assert.equal(slot(g, s.id).card!.hpAtual, structure ? 40 : 38);
    if (structure) assert.equal(slot(g, s.id).structure!.hpAtual, 8);
  }
  const g = make(4),
    s = slot(g, "p2:front:2");
  s.card!.elemento = "Terra";
  s.structure = card("023", "p2", { tipo: "Estrutura", hp: 10, ataque: 1 });
  cast(g, "004", [s.card!.id]);
  assert.equal(slot(g, s.id).card!.hpAtual, 40);
  const duration = () =>
    slot(g, s.id).card!.statuses.find((s) => s.nome === "Atordoado")
      ?.turnosRestantes ?? 0;
  assert.equal(duration(), 2);
  end(g);
  assert.equal(duration(), 2);
  end(g);
  assert.equal(duration(), 1);
  end(g);
  assert.equal(duration(), 1);
  end(g);
  assert.equal(duration(), 0);
});
test("Furacão não aceita mago e não ativa a combinação antiga com Bola de Fogo", () => {
  const g = make();
  const source = card("004");
  g.player("p1").hand.push(source);
  const before = JSON.stringify(g.exportState());
  assert.throws(
    () =>
      act(g, {
        type: "play",
        cardId: source.id,
        targets: [g.player("p2").mage.id],
      }),
    /Tipo de alvo/,
  );
  assert.equal(JSON.stringify(g.exportState()), before);
  const target = slot(g, "p2:front:2").card!;
  cast(g, "001");
  const hp = g.player("p2").mage.hpAtual;
  act(g, { type: "play", cardId: source.id, targets: [target.id] });
  assert.equal(g.player("p2").mage.hpAtual, hp);
});
test("Tornado sem Ar custa 6 e atinge apenas tropas e mago inimigos imediatamente", () => {
  const g = make(),
    own = card("023", "p1", { hp: 40 });
  slot(g, "p1:front:0").card = own;
  cast(g, "035");
  assert.equal(own.hpAtual, 40);
  assert.equal(g.player("p1").mage.hpAtual, 18);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 34);
  assert.equal(g.player("p2").mage.hpAtual, 12);
  assert.equal(g.player("p1").mana, 14);
  assert.equal(g.state.ongoingSpells?.length ?? 0, 0);
});
test("Ar de qualquer lado muda custo e efeito do Tornado; condição fica fixada ao lançar", () => {
  for (const side of ["p1", "p2"]) {
    let g = make(4);
    const air = card("023", side, {
      elemento: "Ar",
      hp: 40,
      fraqueza: [],
      resistencia: [],
      habilidadesPassivas: [],
    });
    slot(g, side + ":front:0").card = air;
    const source = card("035");
    g.player("p1").hand = [source];
    assert.equal(
      g.snapshot("p1").players.find((p) => p.id === "p1")!.hand![0].custoMana,
      8,
    );
    act(g, { type: "play", cardId: source.id });
    assert.equal(g.player("p1").mana, 12);
    assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40);
    assert.equal(g.player("p2").mage.hpAtual, 18);
    slot(g, side + ":front:0").card = null;
    g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
    end(g);
    assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40);
    end(g);
    assert.equal(slot(g, "p2:front:2").card!.hpAtual, 34);
    assert.equal(g.state.ongoingSpells![0].rounds, 1);
    end(g);
    end(g);
    assert.equal(slot(g, "p2:front:2").card!.hpAtual, 28);
    assert.equal(g.state.ongoingSpells?.length, 0);
  }
});
test("Tornado periódico ignora resistência mas mantém fraqueza, escudo e estrutura", () => {
  const g = make();
  slot(g, "p1:front:0").card = card("023", "p1", { elemento: "Ar", hp: 40 });
  const s = slot(g, "p2:front:2");
  s.card!.resistencia = ["Fogo"];
  s.structure = card("023", "p2", {
    tipo: "Estrutura",
    hp: 40,
    ataque: 1,
    resistencia: ["Fogo"],
    fraqueza: ["Fogo"],
  });
  s.structure.statuses = [{ nome: "Escudo", valor: 2, turnosRestantes: 5 }];
  cast(g, "035");
  end(g);
  end(g);
  assert.equal(slot(g, s.id).structure!.hpAtual, 30);
  assert.equal(slot(g, s.id).card!.hpAtual, 40);
  slot(g, s.id).structure = null;
  end(g);
  end(g);
  assert.equal(slot(g, s.id).card!.hpAtual, 34);
});
test("Tornado com Ar exige 8 de mana e a falha é atômica", () => {
  const g = make();
  slot(g, "p1:front:0").card = card("023", "p1", { elemento: "Ar" });
  const c = card("035");
  g.player("p1").hand = [c];
  g.player("p1").mana = 7;
  const before = JSON.stringify(g.exportState());
  assert.throws(() => act(g, { type: "play", cardId: c.id }), /Mana/);
  assert.equal(JSON.stringify(g.exportState()), before);
});
test("Campo beneficia ambos, desconta todas as cartas de Fogo e renova sem acumular", () => {
  const g = make();
  cast(g, "136");
  assert.equal(g.player("p1").mana, 13);
  for (const p of g.state.players)
    for (const tipo of [
      "Feitico",
      "Tropa",
      "Estrutura",
      "Armamento",
    ] as const) {
      const c = card("035", p.id, {
        tipo,
        elemento: "Fogo",
        custoMana: 1,
        hp: 40,
        ataque: 1,
        manaGerada: 1,
        direcaoAtaque: "Frente",
        bonusHp: 1,
        bonusAtaque: 1,
      });
      assert.equal(modifiedSpell(c, p.mage, g.state).custoMana, 0);
    }
  assert.equal(
    modifiedSpell(card("035"), g.player("p1").mage, g.state).custoMana,
    4,
  );
  end(g);
  assert.equal(g.state.ruleFields![0].rounds, 2);
  g.player("p2").mana = 20;
  cast(g, "136", [], {}, "p2");
  assert.equal(g.player("p2").mana, 15);
  assert.equal(g.state.ruleFields!.length, 1);
  assert.equal(g.state.ruleFields![0].ownerId, "p2");
  end(g);
  assert.equal(g.state.ruleFields![0].rounds, 2);
  end(g);
  assert.equal(g.state.ruleFields![0].rounds, 1);
  end(g);
  end(g);
  assert.equal(g.state.ruleFields!.length, 0);
  assert.equal(
    modifiedSpell(card("035"), g.player("p1").mage, g.state).custoMana,
    6,
  );
});
test("Campo normaliza Água, sem ignorar escudos nem estruturas", () => {
  const g = make();
  cast(g, "136");
  const s = slot(g, "p2:front:2");
  s.structure = card("023", "p2", {
    tipo: "Estrutura",
    hp: 30,
    ataque: 1,
    fraqueza: ["Agua"],
    resistencia: [],
  });
  s.structure.statuses = [{ nome: "Escudo", valor: 1, turnosRestantes: 3 }];
  cast(g, "002", [s.card!.id]);
  assert.equal(slot(g, s.id).structure!.hpAtual, 27);
  assert.equal(slot(g, s.id).card!.hpAtual, 40);
  slot(g, s.id).structure = null;
  slot(g, s.id).card!.resistencia = ["Agua"];
  cast(g, "002", [s.card!.id]);
  assert.equal(slot(g, s.id).card!.hpAtual, 36);
});
test("Campo anula Ar contra tropas/magos, incluindo área; compra de cartas continua", () => {
  const g = make();
  cast(g, "136");
  const hp = slot(g, "p2:front:2").card!.hpAtual;
  cast(g, "004", [slot(g, "p2:front:2").card!.id]);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, hp);
  assert.equal(g.player("p1").mana, 7);
  assert.equal(g.player("p1").counters.spells, 2);
  cast(g, "009");
  assert.equal(g.state.ongoingSpells?.length ?? 0, 0);
  assert.equal(slot(g, "p2:front:2").card!.statuses.length, 0);
  const before = g.player("p1").deck.length;
  cast(g, "004", [], {
    custoMana: 0,
    alvo: "Global",
    tiposAlvo: undefined,
    efeitos: [{ id: "draw", valor: 1 }],
  });
  assert.equal(g.player("p1").deck.length, before - 1);
});
test("Campo pode ser material e sua remoção encerra imediatamente as regras", () => {
  const g = make();
  const field = cast(g, "136");
  const c = card("023", "p1", {
    elemento: "Neutro",
    custoMana: 0,
    custoEntrada: {
      quantidade: 1,
      tiposCarta: ["Feitico"],
      origens: ["campo"],
    },
  });
  g.player("p1").hand.push(c);
  act(g, {
    type: "play",
    cardId: c.id,
    slotId: "p1:front:1",
    materiais: [field.id],
  });
  assert.equal(g.state.ruleFields?.length, 0);
  assert.equal(
    g.player("p1").graveyard.filter((c) => c.id === field.id).length,
    1,
  );
});

test("migração preserva arte e atributos administrativos e é idempotente", () => {
  for (const id of ["004", "035"]) {
    const original = {
      ...structuredClone(catalog.find((c) => c.numeroCatalogo === id)!),
      imgURL: "/arte-custom.png",
      resistencia: ["Agua"],
      versao: 44,
    } as any;
    original.custoMana = 10;
    original.efeitos = [{ id: "damage", valor: 1 }];
    original.varianteCampo = undefined;
    const plan = fieldSpellPatch(original);
    const result = { ...original, ...plan.patch };
    for (const key of Object.keys(plan.unset)) delete result[key];
    assert.equal(result.imgURL, original.imgURL);
    assert.deepEqual(result.resistencia, original.resistencia);
    assert.equal(result.versao, 44);
    assert.equal(result.custoMana, 6);
    assert.deepEqual(fieldSpellPatch(result).patch, {});
    assert.deepEqual(fieldSpellPatch(result).unset, {});
  }
  assert.throws(() =>
    fieldSpellPatch({
      ...catalog.find((c) => c.numeroCatalogo === "136"),
      nome: "Outra carta",
    }),
  );
});
test("efeitos podem ser reutilizados em habilidade de outra carta, sem ID especial", () => {
  const g = make();
  const own = card("023", "p1", {
    habilidadesAtivas: [
      {
        id: "retornar",
        nome: "Retornar",
        custoMana: 0,
        alvo: "TodasTropasInimigas",
        efeitos: [{ id: "returnToHand", devolverVinculos: true }],
      },
    ],
  });
  slot(g, "p1:front:0").card = own;
  slot(g, "p2:front:2").rider = card("023", "p2");
  const group = [
    slot(g, "p2:front:2").card!.id,
    slot(g, "p2:front:2").rider!.id,
  ];
  act(g, {
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "retornar",
    targets: [],
  });
  assert.ok(group.every((id) => g.player("p2").hand.some((c) => c.id === id)));
  assert.equal(slot(g, "p2:front:2").card, null);
});
