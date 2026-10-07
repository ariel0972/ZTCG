import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import { adjacentAttackBonus } from "../src/game/passives";
const catalog = raw.map((c) => cardSchema.parse(c));
function instance(
  id: string,
  ownerId: string,
  extra: Partial<Card> = {},
): Instance {
  const card = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id),
    ...extra,
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
function make() {
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: {
        nome: "Test",
        mago: "108",
        cartas: catalog
          .filter((c) => c.publicado && c.tipo === "Tropa")
          .flatMap((c) => Array(3).fill(c.numeroCatalogo))
          .slice(0, 40),
      },
    })),
    catalog,
    () => 0.2,
  );
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.round = 3;
  g.state.current = "p1";
  g.player("p1").mana = 20;
  g.player("p2").mana = 20;
  return g;
}
function slot(g: Game, owner: string, col: number) {
  const id = `${owner}:front:${col}`;
  return new Proxy({} as Game["state"]["slots"][number], {
    get: (_t, key) => (g.state.slots.find((s) => s.id === id)! as any)[key],
    set: (_t, key, value) => {
      (g.state.slots.find((s) => s.id === id)! as any)[key] = value;
      return true;
    },
  });
}
function act(g: Game, cmd: object) {
  return g.execute("p1", {
    ...cmd,
    version: g.state.version,
    actionId: randomUUID(),
  });
}
for (const [id, status] of [
  ["044", "Envenenado"],
  ["110", "Queimado"],
])
  test(`${id}: retalia somente atacante em golpe bloqueado ou fatal e não em feitiço`, () => {
    for (const shield of [true, false]) {
      const g = make(),
        from = slot(g, "p1", 0),
        to = slot(g, "p2", 2),
        other = slot(g, "p2", 1);
      from.card = instance("021", "p1", { ataque: 50, elemento: "Neutro" });
      to.card = instance(id, "p2");
      other.card = instance(id, "p2");
      if (shield)
        to.card.statuses = [
          { nome: "EscudoProtecao", valor: 3, turnosRestantes: 2 },
        ];
      const hp = to.card.hpAtual;
      act(g, { type: "attack", slotId: from.id, targetId: to.id });
      assert.equal(
        from.card.statuses.filter((s) => s.nome === status).length,
        1,
      );
      assert.equal(
        from.card.statuses.find((s) => s.nome === status)!.valor,
        1,
        "outra carta não deve retaliar",
      );
      if (shield) assert.equal(to.card!.hpAtual, hp);
      else assert.equal(to.card, null);
    }
    const g = make(),
      to = slot(g, "p2", 2);
    to.card = instance(id, "p2");
    const spell = instance("001", "p1");
    g.player("p1").hand = [spell];
    act(g, { type: "play", cardId: spell.id, targets: [] });
    assert.deepEqual(g.player("p1").mage.statuses, []);
  });
test("aura acumula por vizinho e por fonte, some ao mover/morrer e não altera dano de feitiços", () => {
  const g = make();
  for (const col of [0, 1, 2])
    slot(g, "p1", col).card = instance(col === 1 ? "111" : "110", "p1");
  assert.deepEqual(
    [0, 1, 2].map((c) =>
      adjacentAttackBonus(slot(g, "p1", c).card!, g.state.slots),
    ),
    [2, 4, 2],
  );
  assert.equal(
    g.snapshot("p1").slots.find((s) => s.id === "p1:front:1")!.card!
      .bonusAtaquePassivo,
    4,
  );
  slot(g, "p1", 0).card = instance("111", "p1");
  assert.deepEqual(
    [0, 1, 2].map((c) =>
      adjacentAttackBonus(slot(g, "p1", c).card!, g.state.slots),
    ),
    [4, 6, 2],
  );
  slot(g, "p1", 0).card!.hpAtual = 0;
  assert.equal(adjacentAttackBonus(slot(g, "p1", 1).card!, g.state.slots), 2);
  slot(g, "p1", 2).card = null;
  assert.equal(adjacentAttackBonus(slot(g, "p1", 1).card!, g.state.slots), 0);
  slot(g, "p1", 0).card = null;
  slot(g, "p1", 2).card = instance("110", "p1");
  const enemy = slot(g, "p2", 1);
  enemy.card = instance("021", "p2", { hp: 50, resistencia: [], fraqueza: [] });
  enemy.card.hpAtual = 50;
  act(g, { type: "attack", slotId: "p1:front:1", targetId: enemy.id });
  assert.equal(enemy.card.hpAtual, 46);
  const spell = instance("001", "p1");
  g.player("p1").hand = [spell];
  act(g, { type: "play", cardId: spell.id, targets: [] });
  assert.equal(enemy.card.hpAtual, 43);
});
test("restrição usa Água OU direção Frontal, aceita mago e não bloqueia feitiços", () => {
  for (const [tipo, elemento, direcao, banned] of [
    ["Tropa", "Agua", "Universal", true],
    ["Tropa", "Fogo", "Frente", true],
    ["Tropa", "Terra", "Universal", false],
    ["Mago", "Agua", undefined, false],
  ] as const) {
    const g = make(),
      from =
        tipo === "Mago"
          ? g.state.slots.find((s) => s.id === "p1:mage")!
          : slot(g, "p1", 0),
      to = slot(g, "p2", 2);
    if (tipo === "Tropa")
      from.card = instance("021", "p1", { elemento, direcaoAtaque: direcao! });
    else from.card!.elemento = elemento;
    to.card = instance("117", "p2");
    const targets = g.snapshot("p1").slots.find((s) => s.id === from.id)!
      .attackTargets!.card;
    assert.equal(targets.includes(to.id), !banned);
    if (banned)
      assert.throws(
        () => act(g, { type: "attack", slotId: from.id, targetId: to.id }),
        /passiva/,
      );
    else act(g, { type: "attack", slotId: from.id, targetId: to.id });
  }
  const g = make(),
    to = slot(g, "p2", 2);
  to.card = instance("117", "p2");
  const spell = instance("001", "p1");
  g.player("p1").hand = [spell];
  act(g, { type: "play", cardId: spell.id, targets: [] });
  assert.equal(to.card.hpAtual, 7);
});
test("passivas funcionam em outra carta por configuração e publicação rejeita parâmetros inválidos", () => {
  const passive = catalog.find(
    (c) => c.numeroCatalogo === "110",
  )!.habilidadesPassivas;
  const g = make(),
    from = slot(g, "p1", 0),
    to = slot(g, "p2", 2);
  from.card = instance("021", "p1");
  to.card = instance("021", "p2", { habilidadesPassivas: passive });
  act(g, { type: "attack", slotId: from.id, targetId: to.id });
  assert.equal(from.card.statuses[0].nome, "Queimado");
  const invalid = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === "110"),
    habilidadesPassivas: [
      { gatilho: "onAttacked", efeito: "aplicarStatusAtacante" },
    ],
  });
  assert.ok(playableErrors(invalid).length);
  for (const id of ["044", "110", "111", "117"])
    assert.deepEqual(
      playableErrors(catalog.find((c) => c.numeroCatalogo === id)!),
      [],
    );
});
