import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import { adjacentAttackBonus, spellDamageBonus } from "../src/game/passives";
import CardModel from "../src/db/models/Card";
import { cleanCard } from "../src/services/catalog";
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
