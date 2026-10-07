import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { applyStatus, tickRound } from "../src/game/status";
import { elementalReaction } from "../src/game/reactions";

const catalog = raw.map((c) => cardSchema.parse(c));
function make() {
  const cartas = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo) as string[])
    .slice(0, 40);
  return new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: { nome: "Teste", mago: "108", cartas },
    })),
    catalog,
    () => 0.2,
  );
}
function instance(
  id: string,
  ownerId = "p1",
  overrides: Partial<Card> = {},
): Instance {
  const card = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id)!,
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
function command(g: Game, user: string, data: Record<string, unknown>) {
  return g.execute(user, {
    actionId: randomUUID(),
    version: g.state.version,
    ...data,
  });
}
function slot(g: Game, id: string) {
  return g.state.slots.find((s) => s.id === id)!;
}
function battle(g = make()) {
  command(g, "p2", { type: "endTurn" });
  command(g, "p1", { type: "endTurn" });
  return g;
}
function later(g = battle()) {
  command(g, "p1", { type: "endTurn" });
  command(g, "p2", { type: "endTurn" });
  return g;
}
function cast(g: Game, c: Instance, targets: string[]) {
  g.player(c.ownerId).mana = 20;
  g.player(c.ownerId).hand.push(c);
  command(g, c.ownerId, { type: "play", cardId: c.id, targets });
}
test("Neutro não deixa token nem consome elemento anterior; recuperação limpa tokens Neutro antigos", () => {
  const g = later(),
    target = g.state.slots.find(
      (s) => s.ownerId === "p2" && s.kind === "Tropa" && s.column === 0,
    )!;
  target.card = instance("021", "p2", { elemento: "Neutro" });
  (g as any).react("p1", [target.card.id], "Neutro");
  assert.equal(target.appliedElement, undefined);
  assert.equal(target.card.appliedElement, undefined);
  (g as any).react("p1", [target.card.id], "Fogo");
  (g as any).react("p1", [target.card.id], "Neutro");
  assert.equal(target.appliedElement, "Fogo");
  assert.equal(target.card.appliedElement, "Fogo");
  target.appliedElement = "Neutro";
  target.card.appliedElement = "Neutro";
  const restored = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  assert.equal(slot(restored, target.id).appliedElement, undefined);
  assert.equal(slot(restored, target.id).card!.appliedElement, undefined);
  assert.equal(Object.keys(restored.snapshot("p1").reactions).length, 8);
});

test("preparação simultânea mantém cinco cartas privadas e mobilização manual gratuita com limite", () => {
  const g = make();
  for (const id of ["p1", "p2"]) {
    assert.equal(g.player(id).hand.length, 5);
    assert.equal(g.player(id).mana, 5);
    assert.ok(
      g.state.slots
        .filter((s) => s.ownerId === id && s.kind === "Tropa")
        .every((s) => !s.card),
    );
    const mana = g.player(id).mana;
    for (let col = 0; col < 3; col++)
      command(g, id, {
        type: "play",
        cardId: g.player(id).hand[0].id,
        slotId: `${id}:front:${col}`,
      });
    assert.equal(g.player(id).mana, mana);
    slot(g, `${id}:front:0`).card = null;
    const before = JSON.stringify(g.state);
    assert.throws(
      () =>
        command(g, id, {
          type: "play",
          cardId: g.player(id).hand[0].id,
          slotId: `${id}:front:0`,
        }),
      /mobilização/,
    );
    assert.equal(JSON.stringify(g.state), before);
    const enemy = g.snapshot(id).players.find((p) => p.id !== id)!;
    assert.equal("hand" in enemy, false);
    assert.equal("deck" in enemy, false);
  }
  command(g, "p2", { type: "endTurn" });
  assert.equal(g.state.phase, "PREPARATION");
  command(g, "p1", { type: "endTurn" });
  assert.equal(g.state.phase, "BATTLE");
  assert.equal(g.state.round, 2);
  assert.equal(g.state.turn, 1);
  assert.equal(g.player("p1").hand.length, 3);
});

test("preparação permite cura, cobra armamentos e rejeita habilidades e feitiços de dano sem consumir recursos", () => {
  const g = make();
  const healer = instance("002", "p2", {
    efeitos: [{ id: "heal", valor: 3 }],
    alvo: "UnicoAliado",
  });
  g.player("p2").mage.hpAtual = 10;
  cast(g, healer, [g.player("p2").mage.id]);
  assert.equal(g.player("p2").mage.hpAtual, 13);
  const weapon = instance("021", "p1", {
    tipo: "Armamento",
    bonusAtaque: 1,
    bonusHp: 0,
    custoMana: 2,
  });
  g.player("p1").hand.push(weapon);
  command(g, "p1", {
    type: "play",
    cardId: weapon.id,
    slotId: "p1:arm:back-left",
  });
  assert.equal(g.player("p1").mana, 3);
  slot(g, "p1:front:0").card = instance("020");
  const before = JSON.stringify(g.state);
  assert.throws(
    () =>
      command(g, "p1", {
        type: "ability",
        slotId: "p1:front:0",
        abilityId: "ataqueFurtivo",
      }),
    /preparação/,
  );
  assert.equal(JSON.stringify(g.state), before);
});

test("reembaralhamento limitado a três, compensação opcional individual e confirmação não encerra antes das decisões", () => {
  const g = make();
  for (let i = 0; i < 3; i++) {
    g.player("p1").hand = Array.from({ length: 5 }, () => instance("001"));
    command(g, "p1", { type: "mulligan" });
  }
  assert.equal(g.player("p1").preparation.redraws, 3);
  g.player("p1").hand = Array.from({ length: 5 }, () => instance("001"));
  assert.throws(() => command(g, "p1", { type: "mulligan" }));
  assert.throws(() => command(g, "p2", { type: "endTurn" }), /extra/);
  const count = g.player("p2").hand.length;
  command(g, "p2", { type: "preparationBonus", accept: false });
  command(g, "p2", { type: "preparationBonus", accept: true });
  command(g, "p2", { type: "preparationBonus", accept: false });
  assert.equal(g.player("p2").hand.length, count + 1);
  command(g, "p2", { type: "endTurn" });
  command(g, "p1", { type: "endTurn" });
  assert.equal(g.state.phase, "BATTLE");
});

test("confirmação antecipada permite resolver compensação nova e o timeout penaliza só quem não ficou pronto", () => {
  const g = make();
  command(g, "p2", { type: "endTurn" });
  g.player("p1").hand = Array.from({ length: 5 }, () => instance("001"));
  command(g, "p1", { type: "mulligan" });
  command(g, "p1", { type: "endTurn" });
  assert.equal(g.state.phase, "PREPARATION");
  command(g, "p2", { type: "preparationBonus", accept: true });
  assert.equal(g.state.phase, "BATTLE");
  const h = make();
  command(h, "p2", { type: "endTurn" });
  h.timeout();
  assert.equal(h.state.status, "ACTIVE");
  assert.equal(h.state.phase, "BATTLE");
  assert.equal(h.player("p1").inactivityStreak, 1);
  assert.equal(h.player("p2").inactivityStreak, 0);
});

test("habilidades bloqueadas no primeiro turno de cada jogador; uma por carta por rodada e status impeditivos", () => {
  const g = battle();
  for (const id of ["p1", "p2"]) {
    slot(g, `${id}:front:0`).card = instance("020", id);
    g.player(id).mana = 20;
  }
  assert.throws(
    () =>
      command(g, "p1", {
        type: "ability",
        slotId: "p1:front:0",
        abilityId: "ataqueFurtivo",
      }),
    /primeiro turno/,
  );
  command(g, "p1", { type: "endTurn" });
  assert.throws(
    () =>
      command(g, "p2", {
        type: "ability",
        slotId: "p2:front:0",
        abilityId: "ataqueFurtivo",
      }),
    /primeiro turno/,
  );
  command(g, "p2", { type: "endTurn" });
  command(g, "p1", { type: "endTurn" });
  command(g, "p2", {
    type: "ability",
    slotId: "p2:front:0",
    abilityId: "ataqueFurtivo",
  });
  assert.throws(() =>
    command(g, "p2", {
      type: "ability",
      slotId: "p2:front:0",
      abilityId: "ataqueFurtivo",
    }),
  );
  command(g, "p2", { type: "endTurn" });
  for (const name of ["Atordoado", "Congelado", "Cego"]) {
    slot(g, "p1:front:0").card!.statuses = [{ nome: name, turnosRestantes: 2 }];
    assert.throws(() =>
      command(g, "p1", {
        type: "ability",
        slotId: "p1:front:0",
        abilityId: "ataqueFurtivo",
      }),
    );
  }
});

test("primeiro ataque bloqueia mobilização, mas preserva feitiços e habilidades nos turnos seguintes", () => {
  const g = later();
  slot(g, "p1:front:0").card = instance("020");
  command(g, "p1", {
    type: "attack",
    slotId: "p1:front:0",
    targetId: "p2:front:2",
  });
  assert.throws(
    () =>
      command(g, "p1", {
        type: "play",
        cardId: g.player("p1").hand[0].id,
        slotId: "p1:front:1",
      }),
    /após iniciar/,
  );
  g.player("p1").mana = 20;
  command(g, "p1", {
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "ataqueFurtivo",
  });
  cast(g, instance("002"), [g.player("p2").mage.id]);
  assert.equal(g.player("p1").counters.spells, 1);
});

test("feitiços de assinatura e comuns usam limites separados", () => {
  const g = later();
  for (let i = 0; i < 2; i++)
    cast(
      g,
      instance("002", "p1", {
        efeitos: [{ id: "mana", valor: 0 }],
        alvo: "Global",
      }),
      [],
    );
  assert.throws(() => cast(g, instance("001"), []), /Limite/);
  cast(
    g,
    instance("002", "p1", {
      assinatura: true,
      efeitos: [{ id: "mana", valor: 0 }],
      alvo: "Global",
    }),
    [],
  );
  assert.equal(g.player("p1").counters.spells, 2);
  assert.equal(g.player("p1").counters.unique, 1);
});

test("veneno, queimadura e sangramento têm acúmulos distintos e dano uma vez por rodada completa", () => {
  const statuses: Instance["statuses"] = [];
  for (let i = 0; i < 9; i++) {
    applyStatus(statuses, "Envenenamento", 9);
    applyStatus(statuses, "Queimando", 9);
    applyStatus(statuses, "Sangramento", 9);
  }
  assert.deepEqual(
    statuses.map((s) => [s.nome, s.valor, s.turnosRestantes]),
    [
      ["Envenenado", 1, 5],
      ["Queimado", 3, 5],
      ["Sangrando", 5, 3],
    ],
  );
  assert.equal(tickRound(statuses), 9);
  const g = battle(),
    c = instance("021", "p2");
  slot(g, "p2:front:0").card = c;
  applyStatus(c.statuses, "Envenenado", 3);
  command(g, "p1", { type: "endTurn" });
  assert.equal(slot(g, "p2:front:0").card!.hpAtual, c.hpAtual);
  command(g, "p2", { type: "endTurn" });
  assert.equal(slot(g, "p2:front:0").card!.hpAtual, c.hpAtual - 1);
  assert.equal(slot(g, "p2:front:0").card!.statuses[0].turnosRestantes, 2);
});

test("estrutura exige tropa e absorve o golpe inteiro; ataque próprio não recebe bônus de armamento", () => {
  const g = later(),
    structure = instance("021", "p1", { tipo: "Estrutura", hp: 1, ataque: 2 });
  g.player("p1").hand.push(structure);
  assert.throws(() =>
    command(g, "p1", {
      type: "play",
      cardId: structure.id,
      slotId: "p1:front:0",
    }),
  );
  slot(g, "p1:front:0").card = instance("021");
  command(g, "p1", {
    type: "play",
    cardId: structure.id,
    slotId: "p1:front:0",
  });
  slot(g, "p1:arm:front-left").card = instance("021", "p1", {
    tipo: "Armamento",
    bonusAtaque: 20,
    bonusHp: 0,
  });
  const hp = g.player("p2").mage.hpAtual;
  command(g, "p1", {
    type: "attack",
    source: "structure",
    slotId: "p1:front:0",
    targetId: "p2:front:2",
  });
  assert.equal(g.player("p2").mage.hpAtual, hp - 2);
  command(g, "p1", { type: "endTurn" });
  const troopHp = slot(g, "p1:front:0").card!.hpAtual;
  cast(g, instance("002", "p2"), [slot(g, "p1:front:0").card!.id]);
  assert.equal(slot(g, "p1:front:0").structure, null);
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, troopHp);
});

test("mago ataca apenas sem tropas; congelado não bloqueia e descongela no fim do próximo turno", () => {
  const g = later(),
    c = instance("021", "p2");
  slot(g, "p2:front:1").card = c;
  applyStatus(c.statuses, "Congelado", 2, undefined, g.state.turn);
  const hp = g.player("p2").mage.hpAtual;
  command(g, "p1", {
    type: "attack",
    slotId: "p1:mage",
    targetId: "p2:front:1",
  });
  assert.equal(g.player("p2").mage.hpAtual, hp - 2);
  command(g, "p1", { type: "endTurn" });
  assert.ok(slot(g, "p2:front:1").card!.statuses.length);
  command(g, "p2", { type: "endTurn" });
  assert.equal(slot(g, "p2:front:1").card!.statuses.length, 0);
  slot(g, "p1:front:0").card = instance("021");
  assert.throws(
    () =>
      command(g, "p1", {
        type: "attack",
        slotId: "p1:mage",
        targetId: "p2:front:1",
      }),
    /enquanto tiver tropas/,
  );
});

test("sacrifício gratuito consome habilidade do mago e ativa a passiva do Necromante", () => {
  const g = later();
  slot(g, "p1:front:0").card = instance("021");
  g.player("p1").mage.hpAtual = 10;
  g.player("p1").mana = 5;
  command(g, "p1", { type: "sacrifice", slotId: "p1:front:0" });
  assert.equal(g.player("p1").mage.hpAtual, 12);
  assert.equal(g.player("p1").mana, 7);
  assert.equal(g.player("p1").mage.usedAbility, true);
  assert.equal(slot(g, "p1:front:0").card, null);
  assert.throws(() =>
    command(g, "p1", {
      type: "ability",
      slotId: "p1:mage",
      abilityId: "enganarAMorte",
    }),
  );
});

test("reviver só dispara ao mobilizar a tropa devolvida à mão", () => {
  const g = later();
  g.player("p1").mana = 20;
  const returned = instance("021"),
    other = instance("027");
  g.player("p1").graveyard.push(other, returned);
  command(g, "p1", {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "ressurreicaoSombria",
    targets: [returned.id],
  });
  assert.equal(g.player("p1").graveyard.length, 1);
  command(g, "p1", { type: "play", cardId: returned.id, slotId: "p1:front:0" });
  assert.equal(g.player("p1").graveyard.length, 0);
  assert.ok(g.player("p1").hand.some((c) => c.id === other.id));
});

test("Lama impede mobilização; Lama + Água floresce plantas e envenena as demais", () => {
  assert.equal(elementalReaction("Lama", "Agua"), "Florescer");
  const g = later(),
    c = instance("021", "p2", { elemento: "Terra", hp: 30 });
  slot(g, "p2:front:0").card = c;
  cast(g, instance("002"), [c.id]);
  assert.equal(slot(g, "p2:front:0").terrain?.nome, "Lama");
  cast(g, instance("002"), [c.id]);
  assert.equal(slot(g, "p2:front:0").card!.statuses[0].nome, "Envenenado");
  command(g, "p1", { type: "endTurn" });
  slot(g, "p2:front:0").card = null;
  assert.throws(
    () =>
      command(g, "p2", {
        type: "play",
        cardId: g.player("p2").hand[0].id,
        slotId: "p2:front:0",
      }),
    /pântano/,
  );
  const h = later(),
    plant = instance("021", "p2", { subtipo: "Planta", hp: 20 });
  plant.appliedElement = "Lama";
  slot(h, "p2:front:0").card = plant;
  cast(
    h,
    instance("002", "p1", {
      efeitos: [{ id: "heal", valor: 0 }],
      alvo: "UnicoInimigo",
    }),
    [plant.id],
  );
  assert.equal(slot(h, "p2:front:0").card!.hpAtual, 21);
});

test("Erosão descarta duas; Lava perfura adjacentes; Explosão transfere excesso; Zarcos restaura mana", () => {
  const g = later(),
    target = instance("021", "p2", { hp: 30, elemento: "Terra" });
  slot(g, "p2:front:1").card = target;
  const count = g.player("p2").deck.length;
  cast(
    g,
    instance("002", "p1", {
      elemento: "Ar",
      efeitos: [{ id: "heal", valor: 0 }],
      alvo: "UnicoInimigo",
    }),
    [target.id],
  );
  assert.equal(g.player("p2").deck.length, count - 2);
  const side = instance("021", "p2");
  slot(g, "p2:front:0").card = side;
  slot(g, "p2:front:0").structure = instance("021", "p2", {
    tipo: "Estrutura",
  });
  slot(g, "p2:front:1").card!.appliedElement = "Terra";
  cast(g, instance("002", "p1", { elemento: "Fogo" }), [target.id]);
  assert.equal(slot(g, "p2:front:0").card!.hpAtual, side.hpAtual - 2);
  const h = later();
  slot(h, "p2:front:0").card = instance("021", "p2", { hp: 1, elemento: "Ar" });
  const mageHp = h.player("p2").mage.hpAtual;
  cast(h, instance("002", "p1", { elemento: "Fogo" }), [
    slot(h, "p2:front:0").card!.id,
  ]);
  assert.equal(h.player("p2").mage.hpAtual, mageHp - 3);
  const z = later(),
    spell = instance("002", "p1", { elemento: "Zarcos", custoMana: 3 });
  cast(z, spell, [z.player("p2").mage.id]);
  assert.equal(z.player("p1").mana, 19);
});

test("Campo livre move uma vez por turno; Herança permanece; Flanquear permite slot de armamento", () => {
  const g = later(),
    troop = instance("021", "p1", {
      palavrasChave: ["Campo livre", "Flanquear"],
    });
  slot(g, "p1:front:0").card = troop;
  command(g, "p1", {
    type: "move",
    slotId: "p1:front:0",
    destinationId: "p1:front:1",
  });
  assert.throws(() =>
    command(g, "p1", {
      type: "move",
      slotId: "p1:front:1",
      destinationId: "p1:front:2",
    }),
  );
  const flank = instance("021", "p1", { palavrasChave: ["Flanquear"] });
  g.player("p1").hand.push(flank);
  command(g, "p1", {
    type: "play",
    cardId: flank.id,
    slotId: "p1:arm:back-left",
  });
  assert.equal(slot(g, "p1:arm:back-left").card!.id, flank.id);
  const h = later();
  slot(h, "p1:front:0").card = instance("021");
  const inherited = instance("021", "p1", {
    tipo: "Armamento",
    bonusAtaque: 1,
    bonusHp: 0,
    palavrasChave: ["Herança"],
  });
  slot(h, "p1:arm:front-left").card = inherited;
  command(h, "p1", { type: "sacrifice", slotId: "p1:front:0" });
  assert.equal(slot(h, "p1:arm:front-left").card!.id, inherited.id);
});

test("cartas banidas/esquecidas não voltam pelo cemitério", () => {
  for (const effect of ["banish", "forget"]) {
    const g = later(),
      removed = instance("021", "p2");
    slot(g, "p2:front:0").card = removed;
    cast(g, instance("002", "p1", { efeitos: [{ id: effect }] }), [removed.id]);
    assert.equal(g.player("p2").graveyard.length, 0);
    assert.equal(
      g.player("p2")[effect === "banish" ? "banished" : "forgotten"][0].id,
      removed.id,
    );
    command(g, "p1", { type: "endTurn" });
    assert.throws(() =>
      command(g, "p2", {
        type: "ability",
        slotId: "p2:mage",
        abilityId: "ressurreicaoSombria",
        targets: [removed.id],
      }),
    );
  }
});

test("fraqueza dobra dano, resistência arredonda para baixo e Vapor remove resistência só neste turno", () => {
  for (const [fraqueza, resistencia, expected] of [
    [["Fogo"], [], 6],
    [[], ["Fogo"], 1],
  ] as const) {
    const g = later(),
      c = instance("021", "p2", {
        hp: 30,
        elemento: "Neutro",
        fraqueza: [...fraqueza],
        resistencia: [...resistencia],
      });
    slot(g, "p2:front:0").card = c;
    cast(
      g,
      instance("002", "p1", {
        elemento: "Fogo",
        efeitos: [{ id: "damage", valor: 3 }],
      }),
      [c.id],
    );
    assert.equal(slot(g, "p2:front:0").card!.hpAtual, 30 - expected);
  }
  const g = later(),
    c = instance("021", "p2", {
      hp: 30,
      elemento: "Fogo",
      resistencia: ["Agua"],
    });
  slot(g, "p2:front:0").card = c;
  cast(g, instance("002", "p1", { efeitos: [{ id: "damage", valor: 3 }] }), [
    c.id,
  ]);
  assert.equal(slot(g, "p2:front:0").card!.hpAtual, 27);
  assert.ok(
    slot(g, "p2:front:0").card!.statuses.some((s) => s.nome === "Vapor"),
  );
  command(g, "p1", { type: "endTurn" });
  assert.ok(
    !slot(g, "p2:front:0").card!.statuses.some((s) => s.nome === "Vapor"),
  );
});

test("feitiços elementais afetam campos vazios e Lama impede sua ocupação", () => {
  const g = later();
  const field = (elemento: Card["elemento"]) =>
    instance("002", "p1", {
      elemento,
      alvo: "CampoInimigo",
      efeitos: [{ id: "field" }],
    });
  cast(g, field("Terra"), ["p2:front:1"]);
  cast(g, field("Agua"), ["p2:front:1"]);
  assert.equal(slot(g, "p2:front:1").terrain?.nome, "Lama");
  command(g, "p1", { type: "endTurn" });
  assert.throws(
    () =>
      command(g, "p2", {
        type: "play",
        cardId: g.player("p2").hand[0].id,
        slotId: "p2:front:1",
      }),
    /pântano/,
  );
});

test("regeneração inclui tropas flanqueadas e respeita teto de 20 mana", () => {
  const g = later();
  slot(g, "p2:arm:back-left").card = instance("021", "p2", {
    manaGerada: 7,
    palavrasChave: ["Flanquear"],
  });
  g.player("p2").mana = 0;
  command(g, "p1", { type: "endTurn" });
  assert.equal(g.player("p2").mana, 10);
  command(g, "p2", { type: "endTurn" });
  g.player("p2").mana = 19;
  command(g, "p1", { type: "endTurn" });
  assert.equal(g.player("p2").mana, 20);
});

test("preparação rejeita dano indireto de passiva com rollback completo", () => {
  const g = make();
  slot(g, "p1:front:0").card = instance("020");
  const target = instance("021", "p2", { hp: 30 });
  slot(g, "p2:front:0").card = target;
  const spell = instance("002", "p1", {
    elemento: "Neutro",
    efeitos: [{ id: "status", status: "Incapacitado", duracao: 2 }],
  });
  g.player("p1").hand.push(spell);
  const before = JSON.stringify(g.state);
  assert.throws(
    () =>
      command(g, "p1", {
        type: "play",
        cardId: spell.id,
        targets: [target.id],
      }),
    /preparação/,
  );
  assert.equal(JSON.stringify(g.state), before);
});

test("timeout inclui compensação pendente mesmo após os dois confirmarem", () => {
  const g = make();
  command(g, "p2", { type: "endTurn" });
  g.player("p1").hand = Array.from({ length: 5 }, () => instance("001"));
  command(g, "p1", { type: "mulligan" });
  command(g, "p1", { type: "endTurn" });
  assert.equal(g.state.phase, "PREPARATION");
  g.timeout();
  assert.equal(g.state.status, "ACTIVE");
  assert.equal(g.state.phase, "BATTLE");
  assert.equal(g.player("p2").preparation.bonusDraws, 0);
  assert.equal(g.player("p2").inactivityStreak, 1);
});

test("alvos de ataque seguem as três direções do PDF em todas as colunas", () => {
  for (const direction of ["Frente", "Diagonal", "Universal"] as const) {
    for (const column of [0, 1, 2]) {
      const g = later();
      const user = g.state.current,
        enemy = user === "p1" ? "p2" : "p1";
      const from = slot(g, `${user}:front:${column}`);
      from.card = instance("021", user, { direcaoAtaque: direction });
      for (const c of [0, 1, 2])
        slot(g, `${enemy}:front:${c}`).card = instance("021", enemy);
      const targets = g.snapshot(user).slots.find((s) => s.id === from.id)!
        .attackTargets!.card;
      const expected = [0, 1, 2].filter((c) =>
        direction === "Universal"
          ? Math.abs(c - (2 - column)) <= 1
          : Math.abs(c - (2 - column)) === (direction === "Frente" ? 0 : 1),
      );
      assert.deepEqual(
        targets,
        expected.map((c) => `${enemy}:front:${c}`),
      );
      const invalid = [0, 1, 2].find((c) => !expected.includes(c));
      if (invalid !== undefined)
        assert.throws(
          () =>
            command(g, user, {
              type: "attack",
              slotId: from.id,
              targetId: `${enemy}:front:${invalid}`,
            }),
          /alcance/,
        );
      command(g, user, {
        type: "attack",
        slotId: from.id,
        targetId: targets[0],
      });
      assert.deepEqual(
        g.snapshot(user).slots.find((s) => s.id === from.id)!.attackTargets!
          .card,
        [],
        "Não oferece outro ataque após o uso.",
      );
    }
  }
});

test("mago exposto é alvo direto, mas tropas e guardiões mantêm proteção", () => {
  const g = later();
  const user = g.state.current,
    enemy = user === "p1" ? "p2" : "p1";
  const from = slot(g, `${user}:front:0`);
  from.card = instance("021", user, { direcaoAtaque: "Diagonal" });
  const mage = slot(g, `${enemy}:mage`);
  assert.deepEqual(
    g.snapshot(user).slots.find((s) => s.id === from.id)!.attackTargets!.card,
    [mage.id],
  );
  const guard = slot(g, `${enemy}:front:2`);
  guard.card = instance("021", enemy, { palavrasChave: ["Guardar"] });
  assert.deepEqual(
    g.snapshot(user).slots.find((s) => s.id === from.id)!.attackTargets!.card,
    [guard.id],
    "Guardar redireciona mesmo fora da diagonal.",
  );
  assert.throws(
    () =>
      command(g, user, { type: "attack", slotId: from.id, targetId: mage.id }),
    /Guardião/,
  );
  slot(g, guard.id).card!.palavrasChave = ["Esconder"];
  slot(g, from.id).card!.direcaoAtaque = "Frente";
  assert.deepEqual(
    g.snapshot(user).slots.find((s) => s.id === from.id)!.attackTargets!.card,
    [],
  );
  assert.throws(
    () =>
      command(g, user, { type: "attack", slotId: from.id, targetId: mage.id }),
    /protegido/,
  );
  slot(g, guard.id).card = null;
  const hp = slot(g, mage.id).card!.hpAtual;
  command(g, user, { type: "attack", slotId: from.id, targetId: mage.id });
  assert.ok(slot(g, mage.id).card!.hpAtual < hp);
});

test("timeout passa turno e derrota somente na terceira inatividade consecutiva", () => {
  const g = battle();
  const user = g.state.current;
  const enemy = user === "p1" ? "p2" : "p1";
  for (let n = 1; n <= 3; n++) {
    const version = g.state.version;
    g.timeout();
    assert.equal(g.player(user).inactivityStreak, n);
    assert.ok(g.state.version > version);
    assert.match(g.state.log.join("\n"), /não fez nada, turno passado/);
    if (n < 3) {
      assert.equal(g.state.status, "ACTIVE");
      assert.equal(g.state.current, enemy);
      command(g, enemy, { type: "endTurn" });
    }
  }
  assert.equal(g.state.winner, enemy);
  assert.match(g.state.reason!, /três turnos consecutivos/);
});

test("ação válida e passagem manual interrompem inatividade; comando inválido não", () => {
  const g = battle();
  const user = g.state.current;
  const enemy = user === "p1" ? "p2" : "p1";
  g.timeout();
  command(g, enemy, { type: "endTurn" });
  assert.throws(() =>
    command(g, user, {
      type: "attack",
      slotId: `${user}:front:0`,
      targetId: `${enemy}:mage`,
    }),
  );
  assert.equal(g.player(user).inactivityStreak, 1);
  const troop = g.player(user).hand.find((c) => c.tipo === "Tropa")!;
  command(g, user, {
    type: "play",
    cardId: troop.id,
    slotId: `${user}:front:0`,
  });
  assert.equal(g.player(user).inactivityStreak, 0);
  g.timeout();
  assert.equal(
    g.player(user).inactivityStreak,
    0,
    "Prazo após ações passa o turno sem cobrar inatividade.",
  );
  command(g, enemy, { type: "endTurn" });
  g.timeout();
  command(g, enemy, { type: "endTurn" });
  assert.equal(g.player(user).inactivityStreak, 1);
  command(g, user, { type: "endTurn" });
  assert.equal(g.player(user).inactivityStreak, 0);
});

test("habilidades automáticas não pedem alvos: próprio cavaleiro, mago e todas as tropas", () => {
  const g = battle();
  g.state.turn = 3;
  const user = g.state.current,
    enemy = user === "p1" ? "p2" : "p1";
  g.player(user).mana = 20;
  const knight = slot(g, `${user}:front:0`);
  knight.card = instance("021", user);
  command(g, user, {
    type: "ability",
    slotId: knight.id,
    abilityId: "armaduraPoderosa",
    targets: [],
  });
  assert.ok(
    slot(g, knight.id).card!.statuses.some((s) => s.nome === "Guardar"),
  );
  const assassin = slot(g, `${user}:front:1`);
  assassin.card = instance("020", user);
  const hp = g.player(enemy).mage.hpAtual;
  command(g, user, {
    type: "ability",
    slotId: assassin.id,
    abilityId: "ataqueFurtivo",
    targets: [],
  });
  assert.equal(g.player(enemy).mage.hpAtual, hp - 2);
  const other = slot(g, `${user}:front:2`);
  other.card = instance("021", user);
  for (const id of [`${enemy}:front:0`, `${enemy}:arm:front-left`])
    slot(g, id).card = instance("021", enemy);
  command(g, user, {
    type: "ability",
    slotId: other.id,
    abilityId: "ordemDaEspada",
    targets: [],
  });
  for (const id of [`${enemy}:front:0`, `${enemy}:arm:front-left`])
    assert.equal(slot(g, id).card!.hpAtual, 9);
  assert.equal(g.player(enemy).mage.hpAtual, hp - 2);
});

test("abertura bloqueia ataque, habilidade e dano para ambos; mana só cresce após preparação", () => {
  const g = make();
  for (const user of ["p1", "p2"]) {
    assert.equal(g.player(user).mana, 5);
    slot(g, `${user}:front:0`).card = instance("020", user, { manaGerada: 2 });
  }
  for (const phase of ["prep", "first", "second"]) {
    for (const user of phase === "prep" ? ["p1", "p2"] : [g.state.current]) {
      const p = g.player(user),
        enemy = g.player(user === "p1" ? "p2" : "p1"),
        spell = instance("001", user);
      p.hand.push(spell);
      const mana = p.mana;
      const actions = [
        { type: "play", cardId: spell.id, targets: [enemy.mage.id] },
        {
          type: "attack",
          slotId: `${user}:front:0`,
          targetId: `${enemy.id}:mage`,
        },
        {
          type: "ability",
          slotId: `${user}:front:0`,
          abilityId: "ataqueFurtivo",
        },
      ];
      for (const action of actions)
        assert.throws(() => command(g, user, action), /bloquead/);
      assert.equal(g.player(user).mana, mana);
      assert.deepEqual(
        g.snapshot(user).slots.find((s) => s.id === `${user}:front:0`)!
          .attackTargets!.card,
        [],
      );
    }
    if (phase === "prep") {
      command(g, "p1", { type: "endTurn" });
      command(g, "p2", { type: "endTurn" });
      assert.equal(g.player("p1").mana, 10);
      assert.equal(g.player("p2").mana, 5);
    } else command(g, g.state.current, { type: "endTurn" });
  }
  assert.equal(g.state.turn, 3);
  assert.equal(g.snapshot("p1").openingBlocked, false);
  command(g, "p1", {
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "ataqueFurtivo",
  });
});

test("eventos visuais são públicos, persistidos e idempotentes; não revelam a mão", () => {
  const g = make(),
    card = g.player("p1").hand.find((c) => c.tipo === "Tropa")!;
  const cmd = {
    type: "play",
    slotId: "p1:front:0",
    cardId: card.id,
    actionId: randomUUID(),
    version: g.state.version,
  };
  g.execute("p1", cmd);
  const events = g.snapshot("p2").events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "summon");
  assert.equal(events[0].card.id, card.id);
  g.execute("p1", cmd);
  assert.deepEqual(g.snapshot("p2").events, events);
  assert.deepEqual(
    Game.restore(JSON.parse(JSON.stringify(g.exportState()))).snapshot("p2")
      .events,
    events,
  );
  assert.ok(!JSON.stringify(events).includes(g.player("p1").hand[0].id));
});
