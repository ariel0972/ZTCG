import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import {
  adjacentAttackBonus,
  spellDamageBonus,
  targetAttackBonus,
} from "../src/game/passives";
import CardModel from "../src/db/models/Card";
import { cleanCard } from "../src/services/catalog";
const catalog = raw.map((c) => cardSchema.parse(c));
test("Golém calcula +1 pelo alvo efetivo abaixo de metade, sem bônus permanente", () => {
  for (const tipo of ["Tropa", "Mago", "Estrutura"] as const) {
    const g = make();
    const golem = instance("025", "p1");
    const target = instance(tipo === "Mago" ? "108" : "020", "p2", {
      tipo,
      hp: 20,
    });
    slot(g, "p1", 0).card = golem;
    target.hpAtual = 10;
    assert.equal(targetAttackBonus(golem, target, g.state.slots), 0);
    target.hpAtual = 9;
    assert.equal(targetAttackBonus(golem, target, g.state.slots), 1);
    assert.equal(adjacentAttackBonus(golem, g.state.slots), 0);
    assert.equal(golem.ataque, 4);
  }
  const g = make();
  slot(g, "p1", 0).card = instance("025", "p1");
  slot(g, "p2", 2).card = instance("020", "p2", {
    hp: 20,
    resistencia: [],
    fraqueza: [],
  });
  slot(g, "p2", 2).card!.hpAtual = 8;
  act(g, { type: "attack", slotId: "p1:front:0", targetId: "p2:front:2" });
  assert.equal(slot(g, "p2", 2).card!.hpAtual, 3);
  assert.equal(slot(g, "p1", 0).card!.ataque, 4);
  assert.ok(
    g.state.log.some((line) => /Golém ganhou \+1 neste ataque/.test(line)),
  );
});
test("Escudeiros concedem aura acumulável só ao Cavaleiro adjacente", () => {
  const g = make();
  slot(g, "p1", 0).card = instance("075", "p1");
  slot(g, "p1", 1).card = instance("021", "p1");
  slot(g, "p1", 2).card = instance("075", "p1");
  assert.equal(adjacentAttackBonus(slot(g, "p1", 1).card!, g.state.slots), 4);
  assert.equal(adjacentAttackBonus(slot(g, "p1", 0).card!, g.state.slots), 0);
  slot(g, "p1", 1).card = instance("020", "p1");
  assert.equal(adjacentAttackBonus(slot(g, "p1", 1).card!, g.state.slots), 0);
  const restored = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  assert.deepEqual(restored.state.slots, g.state.slots);
  assert.deepEqual(
    playableErrors(
      cardSchema.parse(catalog.find((c) => c.numeroCatalogo === "025")),
    ),
    [],
  );
  assert.deepEqual(
    playableErrors(
      cardSchema.parse(catalog.find((c) => c.numeroCatalogo === "075")),
    ),
    [],
  );
});
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
function apprentice(g: Game, owner: string) {
  const mage = instance("028", owner);
  g.player(owner).mage = mage;
  g.state.slots.find((s) => s.kind === "Mago" && s.ownerId === owner)!.card =
    mage;
  return mage;
}
function respond(
  g: Game,
  owner: string,
  reflect: boolean,
  actionId = randomUUID(),
) {
  return g.execute(owner, {
    type: "respondAttack",
    reflect,
    actionId,
    version: g.state.version,
  });
}
test("Aprendiz substitui recuperação 3 por 5, soma geração e respeita teto 20", () => {
  for (const enemyPresent of [false, true]) {
    const g = make();
    apprentice(g, "p1");
    slot(g, "p1", 0).card = instance("095", "p1");
    if (enemyPresent) slot(g, "p2", 0).card = instance("020", "p2");
    g.player("p1").mana = 0;
    g.state.current = "p2";
    g.execute("p2", {
      type: "endTurn",
      actionId: randomUUID(),
      version: g.state.version,
    });
    assert.equal(g.player("p1").mana, enemyPresent ? 5 : 7);
    g.player("p1").mana = 19;
    (g as any).recoverMana(g.player("p1"));
    assert.equal(g.player("p1").mana, 20);
    g.player("p1").mage.recuperacaoMana = 8;
    g.player("p1").mana = 0;
    (g as any).recoverMana(g.player("p1"));
    assert.equal(
      g.player("p1").mana,
      enemyPresent ? 10 : 7,
      "efeito substitui a recuperação, inclusive de outro mago",
    );
  }
});
test("Refazer caminhos escolhe só feitiço próprio, custa 5 e usa habilidade", () => {
  const g = make(),
    mage = apprentice(g, "p1"),
    spell = instance("001", "p1"),
    troop = instance("020", "p1");
  g.player("p1").graveyard = [spell, troop];
  const mageSlot = g.state.slots.find((s) => s.card?.id === mage.id)!;
  const command = {
    type: "ability",
    abilityId: "refazerCaminhos",
    slotId: mageSlot.id,
  };
  assert.throws(() => act(g, { ...command, targets: [troop.id] }), /feitiço/);
  assert.equal(g.player("p1").mana, 20);
  act(g, { ...command, targets: [spell.id] });
  assert.equal(g.player("p1").mana, 15);
  assert.ok(g.player("p1").hand.some((c) => c.id === spell.id));
  assert.equal(g.player("p1").graveyard.length, 1);
  assert.equal(g.player("p1").mage.usedAbility, true);
  assert.throws(() => act(g, { ...command, targets: [troop.id] }), /utilizada/);
});
test("Aprendiz devolve opcionalmente uma vez por rodada, fora de turno, sem mana e independente da habilidade", () => {
  let g = make();
  const mage = apprentice(g, "p2");
  mage.usedAbility = true;
  g.player("p2").mana = 0;
  const targetId = g.state.slots.find((s) => s.card?.id === mage.id)!.id;
  for (const column of [0, 1])
    slot(g, "p1", column).card = instance("020", "p1", { hp: 20, ataque: 4 });
  act(g, { type: "attack", slotId: slot(g, "p1", 0).id, targetId });
  assert.ok(g.state.pendingAttack);
  assert.equal(g.player("p2").mage.hpAtual, 18);
  assert.equal(slot(g, "p1", 0).card!.attacked, true);
  assert.throws(() => act(g, { type: "endTurn" }), /resposta/);
  assert.throws(() => respond(g, "p1", true), /disponível/);
  g = Game.restore(g.exportState());
  const actionId = randomUUID();
  respond(g, "p2", true, actionId);
  assert.equal(g.state.pendingAttack, undefined);
  assert.equal(g.player("p2").mage.hpAtual, 18);
  assert.equal(slot(g, "p1", 0).card!.hpAtual, 16);
  assert.equal(g.player("p2").mana, 0);
  assert.equal(respond(g, "p2", true, actionId).duplicate, true);
  act(g, { type: "attack", slotId: slot(g, "p1", 1).id, targetId });
  assert.equal(g.state.pendingAttack, undefined);
  assert.equal(g.player("p2").mage.hpAtual, 14);
  g.state.round++;
  slot(g, "p1", 0).card!.attacked = false;
  g.player("p1").counters.attacks = 0;
  act(g, { type: "attack", slotId: slot(g, "p1", 0).id, targetId });
  assert.ok(g.state.pendingAttack);
  respond(g, "p2", false);
  assert.equal(g.player("p2").mage.hpAtual, 10);
});
test("reação também funciona em outra carta e não intercepta feitiço ou habilidade", () => {
  const g = make(),
    from = slot(g, "p1", 0),
    to = slot(g, "p2", 2);
  from.card = instance("095", "p1");
  to.card = instance("020", "p2", {
    hp: 20,
    habilidadesPassivas: [
      {
        gatilho: "onTargeted",
        escopo: "proprio",
        efeitos: [{ id: "reflectAttack" }],
      },
    ],
  });
  act(g, {
    type: "ability",
    slotId: from.id,
    abilityId: "deslocar",
    targets: [],
  });
  assert.equal(to.card!.hpAtual, 17);
  assert.equal(g.state.pendingAttack, undefined);
  to.card!.statuses = [];
  act(g, { type: "attack", slotId: from.id, targetId: to.id });
  assert.ok(g.state.pendingAttack);
  respond(g, "p2", true);
  assert.equal(from.card!.hpAtual, 4);
});
test("congelado recebe o ataque sem acionar reação do mago; estrutura continua protegendo", () => {
  const g = make(),
    from = slot(g, "p1", 0),
    to = slot(g, "p2", 2);
  apprentice(g, "p2");
  from.card = instance("020", "p1", { hp: 20, ataque: 4 });
  to.card = instance("020", "p2", { hp: 20 });
  to.card.statuses = [{ nome: "Congelado", turnosRestantes: 2 }];
  act(g, { type: "attack", slotId: from.id, targetId: to.id });
  assert.equal(g.state.pendingAttack, undefined);
  assert.equal(g.player("p2").mage.hpAtual, 18);
  assert.equal(to.card!.hpAtual, 16);
  assert.equal(from.card!.hpAtual, 20);
  const protectedGame = make(),
    source = slot(protectedGame, "p1", 0),
    destination = slot(protectedGame, "p2", 2);
  source.card = instance("020", "p1", { ataque: 4 });
  destination.card = instance("020", "p2", {
    hp: 20,
    habilidadesPassivas: [
      {
        gatilho: "onTargeted",
        escopo: "proprio",
        efeitos: [{ id: "reflectAttack" }],
      },
    ],
  });
  destination.structure = instance("020", "p2", { tipo: "Estrutura", hp: 20 });
  destination.card.statuses = [{ nome: "Congelado", turnosRestantes: 2 }];
  act(protectedGame, {
    type: "attack",
    slotId: source.id,
    targetId: destination.id,
  });
  assert.equal(protectedGame.state.pendingAttack, undefined);
  assert.equal(destination.card!.hpAtual, 20);
  assert.equal(destination.structure!.hpAtual, 16);
});
test("Aprendiz devolve ataques de tropas, mas não de magos", () => {
  const g = make(),
    mage = apprentice(g, "p2");
  const source = g.state.slots.find(
    (s) => s.ownerId === "p1" && s.kind === "Mago",
  )!;
  const target = g.state.slots.find((s) => s.card?.id === mage.id)!;
  const damage = source.card!.ataque!;
  act(g, { type: "attack", slotId: source.id, targetId: target.id });
  assert.equal(g.state.pendingAttack, undefined);
  assert.equal(g.player("p2").mage.hpAtual, 18 - damage);
});
test("Esqueleto ganha ataque em cada retorno de tropa revivida; Deslocar é frontal automático e custa 4", () => {
  const g = make(),
    skeleton = slot(g, "p1", 0);
  skeleton.card = instance("095", "p1");
  assert.throws(
    () =>
      act(g, {
        type: "ability",
        slotId: skeleton.id,
        abilityId: "deslocar",
        targets: [],
      }),
    /frente/,
  );
  assert.equal(g.player("p1").mana, 20);
  for (const col of [1, 2]) {
    const revived = instance("020", "p1");
    revived.revivedFromGraveyard = true;
    g.player("p1").hand.push(revived);
    act(g, { type: "play", cardId: revived.id, slotId: slot(g, "p1", col).id });
  }
  assert.equal(skeleton.card!.ataque, 5);
  const enemy = slot(g, "p2", 2);
  enemy.card = instance("023", "p2", { hp: 20 });
  const mana = g.player("p1").mana;
  act(g, {
    type: "ability",
    slotId: skeleton.id,
    abilityId: "deslocar",
    targets: [],
  });
  assert.equal(g.player("p1").mana, mana - 4);
  assert.equal(enemy.card!.hpAtual, 17, "bônus básico não aumenta habilidade");
  assert.ok(enemy.card!.statuses.some((s) => s.nome === "Atordoado"));
  assert.equal(skeleton.card!.usedAbility, true);
});
test("Palhaço ganha vida por mortes dos dois lados, ignora estruturas e não volta à vida em morte simultânea", () => {
  const g = make(),
    clown = slot(g, "p1", 0);
  clown.card = instance("098", "p1");
  for (const [owner, col] of [
    ["p1", 1],
    ["p2", 2],
  ] as const) {
    const victim = slot(g, owner, col);
    victim.card = instance("020", owner);
    victim.card.hpAtual = 0;
    (g as any).resolve();
  }
  assert.equal(clown.card!.hp, 7);
  assert.equal(clown.card!.hpAtual, 7);
  const victim = slot(g, "p2", 1);
  victim.structure = instance("020", "p2", { tipo: "Estrutura" });
  victim.structure.hpAtual = 0;
  (g as any).resolve();
  assert.equal(clown.card!.hpAtual, 7);
  slot(g, "p2", 2).card = instance("020", "p2");
  slot(g, "p2", 2).card!.hpAtual = 0;
  clown.card!.hpAtual = 0;
  (g as any).resolve();
  assert.equal(clown.card, null);
  assert.equal(
    g.player("p1").graveyard.find((c) => c.numeroCatalogo === "098")!.hpAtual,
    0,
  );
});
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

test("passiva declarativa combina gatilho, elemento, jogador e vários efeitos sem novo caso por carta", () => {
  const g = make(),
    watcher = slot(g, "p2", 1),
    target = slot(g, "p2", 2);
  watcher.card = instance("021", "p2", {
    habilidadesPassivas: [
      {
        gatilho: "onDeath",
        escopo: "aliado",
        excluirFonte: true,
        filtroEvento: { tipo: "Tropa", elemento: "Agua" },
        efeitos: [
          { id: "mana", jogador: "aliado", valor: 3 },
          { id: "draw", jogador: "aliado", valor: 1 },
          { id: "heal", alvo: "magoAliado", valor: 2 },
        ],
      },
    ],
  });
  target.card = instance("021", "p2", { hp: 1, elemento: "Agua" });
  slot(g, "p1", 0).card = instance("021", "p1");
  g.player("p2").mana = 5;
  g.player("p2").mage.hpAtual = 15;
  const before = g.player("p2").hand.length;
  act(g, { type: "attack", slotId: "p1:front:0", targetId: target.id });
  assert.equal(g.player("p2").mana, 8);
  assert.equal(g.player("p2").hand.length, before + 1);
  assert.equal(g.player("p2").mage.hpAtual, 17);
  assert.equal(
    g.state.events!.filter(
      (e) => e.kind === "passive" && e.card.id === watcher.card!.id,
    ).length,
    1,
  );
});

test("cura efetiva distingue quem cura e quem recebe cura; habilidade e passivas geram avisos", () => {
  const g = make(),
    healer = slot(g, "p1", 0),
    target = slot(g, "p1", 1);
  healer.card = instance("021", "p1", {
    habilidadesAtivas: [
      {
        id: "curaGenerica",
        nome: "Cura de teste",
        custoMana: 2,
        alvo: "UnicoAliado",
        efeitos: [{ id: "heal", valor: 3 }],
      },
    ],
    habilidadesPassivas: [
      {
        gatilho: "onHeal",
        escopo: "proprio",
        efeitos: [{ id: "mana", jogador: "aliado", valor: 1 }],
      },
    ],
  });
  target.card = instance("021", "p1", {
    habilidadesPassivas: [
      {
        gatilho: "onHealed",
        escopo: "proprio",
        efeitos: [{ id: "draw", jogador: "aliado", valor: 1 }],
      },
    ],
  });
  target.card.hpAtual = 5;
  g.player("p1").mana = 10;
  const hand = g.player("p1").hand.length;
  act(g, {
    type: "ability",
    slotId: healer.id,
    abilityId: "curaGenerica",
    targets: [target.card.id],
  });
  assert.equal(target.card!.hpAtual, 8);
  assert.equal(g.player("p1").mana, 9);
  assert.equal(g.player("p1").hand.length, hand + 1);
  assert.equal(g.state.events!.filter((e) => e.kind === "passive").length, 2);
  assert.equal(
    g.state.events!.find((e) => e.kind === "ability")!.message,
    "Cura de teste",
  );
  healer.card!.usedAbility = false;
  target.card!.hpAtual = target.card!.hp!;
  act(g, {
    type: "ability",
    slotId: healer.id,
    abilityId: "curaGenerica",
    targets: [target.card!.id],
  });
  assert.equal(
    g.player("p1").hand.length,
    hand + 1,
    "cura sem ganho real não dispara passiva",
  );
});

test("destruir estrutura dispara evento geral e não ativa regras antigas de morte de tropa", () => {
  const g = make(),
    from = slot(g, "p1", 0),
    target = slot(g, "p2", 2),
    swarm = slot(g, "p2", 1);
  from.card = instance("021", "p1", {
    habilidadesPassivas: [
      {
        gatilho: "onStructureDestroyed",
        escopo: "inimigo",
        efeitos: [{ id: "draw", jogador: "aliado", valor: 1 }],
      },
    ],
  });
  target.card = instance("021", "p2");
  target.structure = instance(
    catalog.find((c) => c.tipo === "Estrutura")!.numeroCatalogo,
    "p2",
    { hp: 1 },
  );
  swarm.card = instance("042", "p2");
  const hand = g.player("p1").hand.length,
    hp = swarm.card.hpAtual,
    troopHp = target.card.hpAtual;
  act(g, { type: "attack", slotId: from.id, targetId: target.id });
  assert.equal(target.structure, null);
  assert.equal(target.card!.hpAtual, troopHp);
  assert.equal(g.player("p1").hand.length, hand + 1);
  assert.equal(swarm.card!.hpAtual, hp);
});

test("percentual de vida distingue menor e menorOuIgual e recalcula sem acumular bônus", () => {
  const g = make(),
    source = slot(g, "p1", 0);
  source.card = instance("023", "p1", { hp: 12 });
  source.card.hpAtual = 6;
  assert.equal(adjacentAttackBonus(source.card, g.state.slots), 0);
  const rule = source.card.habilidadesPassivas[0];
  assert.ok("efeitos" in rule && rule.condicoes?.[0].tipo === "vidaPercentual");
  if ("efeitos" in rule && rule.condicoes?.[0].tipo === "vidaPercentual")
    rule.condicoes[0].comparacao = "menorOuIgual";
  assert.equal(adjacentAttackBonus(source.card, g.state.slots), 1);
  source.card.hpAtual = 5;
  assert.equal(adjacentAttackBonus(source.card, g.state.slots), 1);
  source.card.hpAtual = 7;
  assert.equal(adjacentAttackBonus(source.card, g.state.slots), 0);
  assert.equal(source.card.ataque, 3);
});

test("Piranha ocupa vaga com cópia do baralho sem mana/limite e só uma fonte vence a disputa", () => {
  const g = make(),
    target = slot(g, "p2", 2);
  slot(g, "p1", 0).card = instance("021", "p1");
  slot(g, "p2", 0).card = instance("041", "p2");
  slot(g, "p2", 1).card = instance("041", "p2");
  target.card = instance("021", "p2", { hp: 1 });
  const copies = [instance("041", "p2"), instance("041", "p2")];
  g.player("p2").deck = copies;
  const counters = structuredClone(g.player("p2").counters);
  act(g, { type: "attack", slotId: "p1:front:0", targetId: target.id });
  assert.equal(target.card!.numeroCatalogo, "041");
  assert.equal(g.player("p2").deck.length, 1);
  assert.equal(g.player("p2").mana, 20);
  assert.deepEqual(g.player("p2").counters, counters);
  assert.equal(g.state.events!.filter((e) => e.kind === "summon").length, 1);
  assert.equal(
    Game.restore(g.exportState())
      .snapshot("p2")
      .slots.find((s) => s.id === target.id)!.card!.id,
    target.card!.id,
  );
});

test("Rato em campo se move para a vaga aliada preservando identidade e sem criar cópia", () => {
  const g = make(),
    rat = slot(g, "p2", 1),
    target = slot(g, "p2", 2);
  slot(g, "p1", 0).card = instance("021", "p1");
  rat.card = instance("027", "p2");
  target.card = instance("021", "p2", { hp: 1 });
  const id = rat.card.id;
  act(g, { type: "attack", slotId: "p1:front:0", targetId: target.id });
  assert.equal(rat.card, null);
  assert.equal(target.card!.id, id);
  assert.ok(target.card!.moved);
  assert.equal(
    g.state.events!.filter((e) => e.kind === "passive" && e.card.id === id)
      .length,
    1,
  );
});

test("Cavaleiro cura por abate em ataque e habilidade, não por morte sem autoria", () => {
  for (const ability of [false, true]) {
    const g = make(),
      from = slot(g, "p1", 0),
      target = slot(g, "p2", 2);
    from.card = instance("021", "p1");
    from.card.hpAtual = 6;
    target.card = instance("021", "p2", { hp: 1 });
    act(
      g,
      ability
        ? {
            type: "ability",
            slotId: from.id,
            abilityId: "ordemDaEspada",
            targets: [],
          }
        : { type: "attack", slotId: from.id, targetId: target.id },
    );
    assert.equal(from.card!.hpAtual, 8);
    assert.equal(
      g.state.events!.filter(
        (e) => e.kind === "passive" && e.card.id === from.card!.id,
      ).length,
      1,
    );
  }
  const g = make(),
    from = slot(g, "p1", 0);
  from.card = instance("021", "p1");
  from.card.hpAtual = 6;
  slot(g, "p2", 2).card = instance("021", "p2", { hp: 1 });
  slot(g, "p2", 2).card!.hpAtual = 0;
  act(g, { type: "endTurn" });
  assert.equal(from.card!.hpAtual, 6);
});

test("Arqueiro converte Cegueira em incapacidade por 1 rodada e encadeia o Assassino", () => {
  const g = make(),
    target = slot(g, "p2", 2);
  slot(g, "p1", 0).card = instance("024", "p1");
  slot(g, "p1", 1).card = instance("020", "p1");
  target.card = instance("021", "p2");
  const spell = instance("001", "p1", {
    elemento: "Neutro",
    alvo: "UnicoInimigo",
    efeitos: [{ id: "status", status: "Cego", duracao: 2 }],
  });
  g.player("p1").hand = [spell];
  act(g, { type: "play", cardId: spell.id, targets: [target.card.id] });
  assert.equal(target.card!.hpAtual, 8);
  assert.equal(
    target.card!.statuses.find((s) => s.nome === "Incapacitado")!
      .turnosRestantes,
    1,
  );
  const notices = g.snapshot("p2").events.filter((e) => e.kind === "passive");
  assert.equal(notices.length, 2);
  assert.ok(notices.every((e) => !!e.message));
});

test("ciclo de passivas é limitado e faz rollback incluindo eventos", () => {
  const g = make(),
    target = slot(g, "p1", 0);
  target.card = instance("021", "p1", {
    habilidadesPassivas: [
      {
        gatilho: "onStatusApplied",
        escopo: "proprio",
        filtroEvento: { status: "Escudo" },
        efeitos: [
          {
            id: "status",
            alvo: "fonte",
            status: "Escudo",
            duracao: 2,
            valor: 3,
          },
        ],
      },
    ],
  });
  const spell = instance("001", "p1", {
    elemento: "Neutro",
    alvo: "UnicoAliado",
    efeitos: [{ id: "status", status: "Escudo", duracao: 2 }],
  });
  g.player("p1").hand = [spell];
  const before = g.exportState();
  assert.throws(
    () =>
      act(g, { type: "play", cardId: spell.id, targets: [target.card!.id] }),
    /Ciclo de passivas/,
  );
  assert.deepEqual(g.exportState(), before);
});

test("Mongo e Zod preservam passivas declarativas e antigas sem inserir defaults incompatíveis", () => {
  for (const id of [
    "020",
    "021",
    "023",
    "024",
    "027",
    "041",
    "044",
    "111",
    "117",
  ]) {
    const card = catalog.find((c) => c.numeroCatalogo === id)!;
    const record = new CardModel(card);
    assert.equal(record.validateSync(), undefined);
    const restored = cleanCard(record.toObject() as any);
    assert.deepEqual(restored.habilidadesPassivas, card.habilidadesPassivas);
    assert.deepEqual(playableErrors(restored), []);
  }
});

test("motivo de bloqueio é projetado apenas para slots próprios e consultar não cria aviso público", () => {
  const g = make(),
    from = slot(g, "p1", 0),
    target = slot(g, "p2", 2);
  from.card = instance("021", "p1", { elemento: "Agua" });
  target.card = instance("117", "p2");
  const before = structuredClone(g.state);
  const viewer = g.snapshot("p1"),
    other = g.snapshot("p2");
  assert.match(
    viewer.slots.find((s) => s.id === from.id)!.attackBlockReasons!.card[
      target.id
    ],
    /passiva/,
  );
  assert.equal(
    other.slots.find((s) => s.id === from.id)!.attackBlockReasons,
    undefined,
  );
  assert.deepEqual(g.state, before);
});

test("bônus de feitiço usa elemento e contador configuráveis e sobrevive à restauração", () => {
  let g = make();
  g.player("p1").mage.habilidadesPassivas = [
    {
      gatilho: "onSpellCast",
      escopo: "aliado",
      filtroEvento: { elemento: "Ar" },
      efeitos: [
        {
          id: "spellDamageBonus",
          elemento: "Ar",
          contador: "vento",
          aCada: 2,
          valor: 1,
        },
      ],
    },
  ];
  const spells = [
    instance("001", "p1", {
      elemento: "Ar",
      alvo: "Global",
      efeitos: [{ id: "mana", valor: 1 }],
    }),
    instance("001", "p1", {
      elemento: "Ar",
      alvo: "Global",
      efeitos: [{ id: "mana", valor: 1 }],
    }),
  ];
  g.player("p1").hand = spells;
  act(g, { type: "play", cardId: spells[0].id, targets: [] });
  assert.equal(spellDamageBonus(g.player("p1").mage, "Ar"), 0);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  act(g, { type: "play", cardId: spells[1].id, targets: [] });
  assert.equal(spellDamageBonus(g.player("p1").mage, "Ar"), 1);
  assert.equal(spellDamageBonus(g.player("p1").mage, "Fogo"), 0);
  assert.equal(g.player("p1").mage.fireSpellsCast, undefined);
});

test("condição contínua avisa só ao ativar e consulta/reconexão não gera eventos", () => {
  const g = make(),
    from = slot(g, "p1", 0),
    target = slot(g, "p2", 2);
  from.card = instance("021", "p1", { ataque: 7 });
  target.card = instance("023", "p2");
  act(g, { type: "attack", slotId: from.id, targetId: target.id });
  const notices = g.state.events!.filter(
    (e) => e.kind === "passive" && e.card.id === target.card!.id,
  );
  assert.equal(notices.length, 1);
  const before = structuredClone(g.state.events);
  g.snapshot("p1");
  g.snapshot("p2");
  assert.deepEqual(g.state.events, before);
  const restored = Game.restore(g.exportState());
  assert.deepEqual(restored.state.events, before);
});

test("publicação rejeita passivas sem alvo de evento ou com operações contínuas incompatíveis", () => {
  for (const h of [
    {
      gatilho: "onTurnStart",
      escopo: "aliado",
      efeitos: [{ id: "damage", alvo: "cartaEvento", valor: 1 }],
    },
    {
      gatilho: "continuous",
      escopo: "proprio",
      efeitos: [{ id: "draw", jogador: "aliado", valor: 1 }],
    },
    {
      gatilho: "onSpellCast",
      escopo: "aliado",
      efeitos: [
        { id: "status", alvo: "atacante", status: "Doente", duracao: 1 },
      ],
    },
    {
      gatilho: "onTargeted",
      escopo: "proprio",
      efeitos: [{ id: "blockAttack" }],
    },
  ]) {
    const card = cardSchema.parse({
      ...catalog.find((c) => c.numeroCatalogo === "021"),
      habilidadesPassivas: [h],
    });
    assert.ok(playableErrors(card).length);
  }
});
