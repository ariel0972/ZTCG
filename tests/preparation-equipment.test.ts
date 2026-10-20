import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
const catalog = raw.map((c) => cardSchema.parse(c));
function make() {
  const cards = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  return new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: { nome: "Teste", mago: "108", cartas: cards },
    })),
    catalog,
    () => 0.8,
  );
}
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
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
}
const act = (g: Game, user: string, data: object) =>
  g.execute(user, {
    ...data,
    actionId: randomUUID(),
    version: g.state.version,
  });
test("nenhum feitiço do catálogo pode ser conjurado na preparação por qualquer jogador", () => {
  const g = make();
  for (const owner of ["p1", "p2"])
    for (const definition of catalog.filter((c) => c.tipo === "Feitico")) {
      const spell = card(definition.numeroCatalogo, owner);
      g.player(owner).hand = [spell];
      g.player(owner).mana = 20;
      const before = JSON.stringify(g.exportState());
      assert.throws(
        () => act(g, owner, { type: "play", cardId: spell.id, targets: [] }),
        /Feitiços são bloqueados durante a preparação/,
        definition.nome,
      );
      assert.equal(JSON.stringify(g.exportState()), before, definition.nome);
      assert.match(
        g.snapshot(owner).players.find((p) => p.id === owner)!.hand![0]
          .spellBlockedReason!,
        /preparação/,
      );
    }
});
test("assinatura sem custo e sem dano também é bloqueada antes de efeitos ou passivas", () => {
  const g = make();
  const spell = card("002", "p2", {
    assinatura: true,
    custoMana: 0,
    alvo: "Global",
    efeitos: [{ id: "mana", valor: 10 }],
  });
  g.player("p2").hand = [spell];
  g.player("p2").mana = 0;
  assert.throws(
    () => act(g, "p2", { type: "play", cardId: spell.id, targets: [] }),
    /preparação/,
  );
  assert.equal(g.player("p2").mana, 0);
  assert.equal(g.player("p2").counters.unique, 0);
});

const position = (g: Game, id: string) =>
  g.state.slots.find((s) => s.id === id)!;
function battleAt(turn = 3) {
  const g = make();
  g.state.phase = "BATTLE";
  g.state.turn = turn;
  g.state.round = 3;
  g.state.current = "p1";
  for (const p of g.state.players) {
    p.mana = 20;
    p.mage.limites[0].feiticosUsados = 20;
  }
  return g;
}
function play(g: Game, c: Instance, slotId?: string, targets: string[] = []) {
  g.player(c.ownerId).hand.push(c);
  return act(g, c.ownerId, { type: "play", cardId: c.id, slotId, targets });
}
test("armamento exige receptor da mesma coluna; mago continua válido e limite só é gasto ao equipar", () => {
  let g = battleAt();
  position(g, "p1:front:1").card = card("023");
  const weapon = card("047");
  const before = g.player("p1").mana;
  assert.throws(
    () => play(g, weapon, "p1:arm:front-left"),
    /precisa de uma tropa/,
  );
  assert.equal(g.player("p1").mana, before);
  assert.equal(g.player("p1").counters.equipment, 0);
  const hp = g.player("p1").mage.hpAtual;
  act(g, "p1", { type: "play", cardId: weapon.id, slotId: "p1:arm:back-left" });
  assert.equal(g.player("p1").mage.hpAtual, hp + 5);
  assert.equal(g.player("p1").counters.equipment, 1);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  assert.deepEqual(g.snapshot("p1").equipmentTargets, []);
  assert.throws(
    () => play(g, card("048"), "p1:arm:front-right"),
    /um armamento por turno/,
  );
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
  position(g, "p1:front:2").card = card("023");
  play(g, card("048"), "p1:arm:front-right");
  assert.equal(g.player("p1").counters.equipment, 1);
});
test("armamento frontal beneficia ocupante montado; contadores antigos começam em zero", () => {
  const g = battleAt();
  delete g.player("p1").counters.equipment;
  position(g, "p1:front:0").card = card("074");
  position(g, "p1:front:0").rider = card("021");
  const hp = position(g, "p1:front:0").rider!.hpAtual;
  play(g, card("047"), "p1:arm:front-left");
  assert.equal(position(g, "p1:front:0").rider!.hpAtual, hp + 5);
});
test("cada jogador tem limite próprio de um armamento na preparação", () => {
  const g = make();
  for (const owner of ["p1", "p2"]) {
    g.player(owner).mana = 20;
    play(g, card("048", owner), owner + ":arm:back-left");
    assert.throws(
      () => play(g, card("038", owner), owner + ":arm:back-right"),
      /um armamento por turno/,
    );
  }
});
test("abertura permite só tropas no turno 1 e libera ataques e efeitos sem dano no turno 2", () => {
  const g = battleAt(1);
  const troop = card("023", "p1", {
    habilidadesPassivas: [],
    habilidadesAtivas: [],
    direcaoAtaque: "Universal",
  });
  play(g, troop, "p1:front:0");
  for (const id of ["048", "056", "002"])
    assert.throws(
      () =>
        play(g, card(id), id === "048" ? "p1:arm:back-left" : "p1:front:0", [
          g.player("p1").mage.id,
        ]),
      /só é permitido mobilizar/,
    );
  assert.throws(
    () =>
      act(g, "p1", {
        type: "move",
        slotId: "p1:front:0",
        destinationId: "p1:front:1",
      }),
    /só é permitido mobilizar/,
  );
  assert.deepEqual(
    g.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.attackTargets!
      .card,
    [],
  );
  act(g, "p1", { type: "endTurn" });
  assert.equal(g.state.turn, 2);
  const enemy = card("023", "p2", {
    hp: 30,
    ataque: 2,
    direcaoAtaque: "Universal",
    habilidadesPassivas: [],
    habilidadesAtivas: [
      {
        id: "curar",
        nome: "Curar",
        custoMana: 0,
        alvo: "UnicoAliado",
        efeitos: [{ id: "heal", valor: 1 }],
      },
    ],
  });
  position(g, "p2:front:2").card = enemy;
  for (const id of ["048", "056"])
    assert.throws(
      () =>
        play(
          g,
          card(id, "p2"),
          id === "048" ? "p2:arm:back-left" : "p2:front:2",
        ),
      /dois primeiros turnos/,
    );
  const heal = card("002", "p2", {
    elemento: "Neutro",
    alvo: "UnicoAliado",
    efeitos: [{ id: "heal", valor: 2 }],
  });
  play(g, heal, undefined, [enemy.id]);
  const fire = card("001", "p2");
  assert.throws(
    () => play(g, fire, undefined, [troop.id]),
    /dois primeiros turnos/,
  );
  act(g, "p2", {
    type: "ability",
    slotId: "p2:front:2",
    abilityId: "curar",
    targets: [enemy.id],
  });
  assert.ok(
    g
      .snapshot("p2")
      .slots.find((s) => s.id === "p2:front:2")!
      .attackTargets!.card.includes("p1:front:0"),
  );
  act(g, "p2", {
    type: "attack",
    slotId: "p2:front:2",
    targetId: "p1:front:0",
  });
  assert.equal(g.player("p2").counters.attacks, 1);
  act(g, "p2", { type: "endTurn" });
  assert.equal(g.state.turn, 3);
  play(g, card("048"), "p1:arm:back-left");
});
test("projeção da recuperação do mago acompanha passiva contínua sem alterar o custo da mão", () => {
  const g = battleAt();
  const mage = g.player("p1").mage;
  mage.habilidadesPassivas = [
    {
      gatilho: "continuous",
      escopo: "proprio",
      efeitos: [{ id: "manaRecovery", valor: 7 }],
    },
  ];
  const projected = g
    .snapshot("p1")
    .slots.find((s) => s.kind === "Mago" && s.ownerId === "p1")!.card!;
  assert.equal(projected.manaRecovery, 7);
  assert.equal(mage.recuperacaoMana, 4);
  g.player("p1").mana = 0;
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
  assert.equal(g.player("p1").mana, 7);
});

test("custo de vida de habilidade sem dano é permitido no segundo turno", () => {
  const g = battleAt(2);
  g.state.current = "p2";
  const dead = card("023", "p2");
  g.player("p2").graveyard.push(dead);
  const hp = g.player("p2").mage.hpAtual;
  act(g, "p2", {
    type: "ability",
    slotId: "p2:mage",
    abilityId: "enganarAMorte",
    targets: [dead.id],
  });
  assert.equal(g.player("p2").mage.hpAtual, hp - 4);
  assert.ok(g.player("p2").deck.some((c) => c.id === dead.id));
});
