import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import CardModel from "../src/db/models/Card";
import { necromancerCardPatch } from "../scripts/update-necromancer-cards";
import { playableErrors } from "../src/game/capabilities";
const catalog = raw.map((c) => cardSchema.parse(c));
function instance(
  id: string,
  ownerId = "p1",
  extra: Partial<Card> = {},
): Instance {
  const card = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id),
    ...extra,
  });
  return {
    ...structuredClone(card),
    id: randomUUID(),
    ownerId,
    hpAtual: card.hp ?? 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
}
function make(secondNecro = false) {
  const cards = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: {
        nome: "Teste",
        mago: id === "p1" || secondNecro ? "108" : "019",
        cartas: cards,
      },
    })),
    catalog,
    () => 0.8,
  );
  Object.assign(g.state, { phase: "BATTLE", turn: 3, round: 3, current: "p1" });
  for (const p of g.state.players) {
    p.hand = [];
    p.mana = 20;
    p.mage.limites[0].feiticosUsados = 20;
  }
  return g;
}
const slot = (g: Game, id: string) => g.state.slots.find((s) => s.id === id)!;
const act = (g: Game, data: object, user = g.state.current) =>
  g.execute(user, {
    ...data,
    actionId: randomUUID(),
    version: g.state.version,
  });
function dead(g: Game, owner = "p1") {
  const c = instance("023", owner, {
    hp: 8,
    ataque: 2,
    habilidadesPassivas: [],
    habilidadesAtivas: [],
    fraqueza: [],
    resistencia: [],
  });
  c.hpAtual = 0;
  g.player(owner).graveyard.push(c);
  return c;
}
function cast(
  g: Game,
  id: string,
  targets: string[] = [],
  destinationId?: string,
  extra: Partial<Card> = {},
  user = g.state.current,
) {
  const c = instance(id, user, extra);
  g.player(user).hand.push(c);
  act(g, { type: "play", cardId: c.id, targets, destinationId }, user);
  return c;
}
const deceive = (g: Game, targets: string[]) =>
  act(g, {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "enganarAMorte",
    targets,
  });
function reaction(g: Game, target: string, user = "p1") {
  return cast(
    g,
    "057",
    [target],
    undefined,
    {
      elemento: "Zarcos",
      custoMana: 0,
      alvo:
        user === g.player("p1").mage.ownerId &&
        target === g.player("p1").mage.id
          ? "UnicoAliado"
          : "UnicoInimigo",
      efeitos: [{ id: "damage", valor: 0 }],
    },
    user,
  );
}
function choose(
  g: Game,
  card: Instance,
  destinationId = "p1:front:0",
  user = "p1",
) {
  act(g, { type: "chooseRevive", cardId: card.id, destinationId }, user);
}
test("Necromante e Reviver Tropa seguem as artes e todos os parâmetros persistem no catálogo", async () => {
  for (const id of ["108", "080"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), []);
    const model = new CardModel(c);
    await model.validate();
    const { _id, __v, ...stored } = model.toObject();
    assert.deepEqual(cardSchema.parse(stored), c);
  }
  const g = make();
  const m = g.player("p1").mage;
  assert.equal(m.hp, 18);
  assert.equal(m.recuperacaoMana, 4);
  assert.equal(m.habilidadesAtivas.length, 1);
  assert.equal(m.habilidadesAtivas[0].custoVida, 4);
});
test("Enganar escolhe até três tropas, paga só vida e embaralha sem reviver", () => {
  const g = make();
  g.player("p1").mana = 0;
  const cards = Array.from({ length: 4 }, () => dead(g));
  deceive(g, [cards[0].id, cards[2].id]);
  assert.equal(g.player("p1").mage.hpAtual, 14);
  assert.equal(g.player("p1").mana, 0);
  assert.deepEqual(
    g.player("p1").graveyard.map((c) => c.id),
    [cards[1].id, cards[3].id],
  );
  assert.ok(
    g.player("p1").deck.some((c) => c.id === cards[0].id && c.hpAtual === 8),
  );
  assert.equal(g.player("p1").mage.statuses.length, 0);
  assert.equal(g.player("p1").mage.usedAbility, true);
});
test("custos de vida e alvos inválidos revertem toda a ação; segunda habilidade não existe", () => {
  for (const hp of [1, 4]) {
    const g = make();
    const c = dead(g);
    g.player("p1").mage.hpAtual = hp;
    const before = JSON.stringify(g.exportState());
    assert.throws(() => deceive(g, [c.id]), /Vida insuficiente/);
    assert.equal(JSON.stringify(g.exportState()), before);
  }
  for (const target of ["empty", "enemy", "spell", "duplicate"]) {
    const g = make();
    const c = dead(g);
    const enemy = dead(g, "p2");
    const spell = instance("057");
    g.player("p1").graveyard.push(spell);
    const before = JSON.stringify(g.exportState());
    assert.throws(() =>
      deceive(
        g,
        target === "empty"
          ? []
          : target === "enemy"
            ? [enemy.id]
            : target === "spell"
              ? [spell.id]
              : [c.id, c.id],
      ),
    );
    assert.equal(JSON.stringify(g.exportState()), before);
  }
  const g = make();
  dead(g);
  assert.throws(
    () =>
      act(g, {
        type: "ability",
        slotId: "p1:mage",
        abilityId: "ressurreicaoSombria",
        targets: [],
      }),
    /não possui/,
  );
});
test("Reviver Tropa entra diretamente em campo com bônus e dispara passivas de ressurreição", () => {
  const g = make();
  const c = dead(g);
  const skeleton = instance("095");
  slot(g, "p1:front:0").card = skeleton;
  const atk = skeleton.ataque!;
  g.player("p1").counters.summons = 1;
  cast(g, "080", [c.id], "p1:front:1");
  const revived = slot(g, "p1:front:1").card!;
  assert.equal(revived.id, c.id);
  assert.equal(revived.hp, 11);
  assert.equal(revived.hpAtual, 11);
  assert.equal(revived.ataque, 4);
  assert.equal(g.player("p1").mana, 15);
  assert.equal(g.player("p1").counters.summons, 1);
  assert.equal(slot(g, "p1:front:0").card!.ataque, atk + 1);
  assert.equal(
    g
      .player("p1")
      .mage.statuses.find((s) => s.nome === "Bônus de dano de feitiço")!.valor,
    2,
  );
});
test("reviver valida cemitério próprio, tropa, espaço, Lama e reverte custo", () => {
  for (const mode of [
    "enemy",
    "spell",
    "occupied",
    "mud",
    "foreign",
    "missing",
  ]) {
    const g = make();
    const c = dead(g);
    const enemy = dead(g, "p2");
    const spell = instance("057");
    g.player("p1").graveyard.push(spell);
    if (mode === "occupied") slot(g, "p1:front:0").card = instance("023");
    if (mode === "mud")
      slot(g, "p1:front:0").terrain = { nome: "Lama", rodadasRestantes: 2 };
    const card = instance("080");
    g.player("p1").hand.push(card);
    const before = JSON.stringify(g.exportState());
    assert.throws(() =>
      act(g, {
        type: "play",
        cardId: card.id,
        targets: [
          mode === "enemy" ? enemy.id : mode === "spell" ? spell.id : c.id,
        ],
        destinationId:
          mode === "foreign"
            ? "p2:front:0"
            : mode === "missing"
              ? undefined
              : "p1:front:0",
      }),
    );
    assert.equal(JSON.stringify(g.exportState()), before);
  }
});
test("ressurreições acumulam bônus de todos os feitiços e ele expira no fim do turno", () => {
  let g = make();
  for (const col of [0, 1]) {
    const c = dead(g);
    cast(g, "080", [c.id], "p1:front:" + col);
  }
  const enemy = instance("023", "p2", {
    hp: 40,
    habilidadesPassivas: [],
    fraqueza: [],
    resistencia: [],
  });
  slot(g, "p2:front:2").card = enemy;
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  cast(g, "057", [enemy.id]);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 31);
  act(g, { type: "endTurn" });
  assert.ok(
    !g
      .player("p1")
      .mage.statuses.some((s) => s.nome === "Bônus de dano de feitiço"),
  );
});
test("feitiço contínuo usa o bônus somente enquanto o turno ainda o possui", () => {
  const g = make();
  g.state.turn = 4;
  const c = dead(g);
  cast(g, "080", [c.id], "p1:front:0");
  const enemy = instance("023", "p2", {
    hp: 40,
    habilidadesPassivas: [],
    fraqueza: [],
    resistencia: [],
  });
  slot(g, "p2:front:2").card = enemy;
  cast(g, "057", [], undefined, {
    custoMana: 0,
    elemento: "Ar",
    alvo: "TodosInimigos",
    efeitos: [{ id: "arrowRain", valor: 3, duracao: 2, variantesMago: [] }],
  });
  assert.equal(g.state.ongoingSpells![0].damage, 3);
  act(g, { type: "endTurn" });
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 35);
  act(g, { type: "endTurn" });
  act(g, { type: "endTurn" });
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 32);
});
test("morte na rodada devolve 6 mana uma única vez e remove bônus; morte posterior não recompensa", () => {
  for (const later of [false, true]) {
    const g = make();
    const c = dead(g);
    cast(g, "080", [c.id], "p1:front:0");
    if (later) {
      act(g, { type: "endTurn" });
      act(g, { type: "endTurn" });
    }
    g.player("p1").mana = 0;
    const revived = slot(g, "p1:front:0").card!;
    revived.hpAtual = 1;
    cast(g, "104", [revived.id], undefined, {
      custoMana: 0,
      elemento: "Neutro",
      efeitos: [{ id: "damage", valor: 1, perfurante: true }],
    });
    assert.equal(g.player("p1").mana, later ? 0 : 6);
    const corpse = g.player("p1").graveyard.find((x) => x.id === c.id)!;
    assert.equal(corpse.hp, 8);
    assert.equal(corpse.ataque, 2);
    assert.equal(corpse.deathReward, undefined);
  }
});
test("devolução para a mão remove bônus e não concede recompensa por morte", () => {
  const g = make();
  const c = dead(g);
  cast(g, "080", [c.id], "p1:front:0");
  act(g, { type: "endTurn" });
  cast(
    g,
    "057",
    [c.id],
    undefined,
    {
      custoMana: 0,
      alvo: "UnicoInimigo",
      elemento: "Ar",
      efeitos: [{ id: "tornado" }],
    },
    "p2",
  );
  const returned = g.player("p1").hand.find((x) => x.id === c.id)!;
  assert.equal(returned.hp, 8);
  assert.equal(returned.ataque, 2);
  assert.equal(returned.deathReward, undefined);
  assert.equal(g.player("p1").mana, 15);
});
test("Zarconizado causado ou recebido oferece uma ressurreição, mantém mana e persiste", () => {
  for (const receive of [false, true]) {
    let g = make();
    const corpse = dead(g);
    const target = receive
      ? g.player("p1").mage
      : instance("023", "p2", {
          elemento: "Zarcos",
          hp: 40,
          habilidadesPassivas: [],
          fraqueza: [],
          resistencia: [],
        });
    if (receive) {
      g.player("p1").mage.appliedElement = "Zarcos";
      g.state.current = "p2";
    } else slot(g, "p2:front:0").card = target;
    g.player(receive ? "p2" : "p1").mana = 0;
    reaction(g, target.id, receive ? "p2" : "p1");
    assert.equal(g.player(receive ? "p2" : "p1").mana, 2);
    assert.equal(g.state.pendingRevives!.length, 1);
    assert.equal(g.snapshot("p1").pendingRevive!.ownerId, "p1");
    const before = JSON.stringify(g.exportState());
    assert.throws(() => choose(g, corpse, "p1:front:0", "p2"));
    assert.equal(JSON.stringify(g.exportState()), before);
    g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
    choose(g, corpse);
    assert.equal(slot(g, "p1:front:0").card!.hpAtual, 8);
    assert.equal(g.player("p1").counters.summons, 0);
    assert.equal(g.state.pendingRevives!.length, 0);
    assert.equal(
      g
        .player("p1")
        .mage.statuses.find((s) => s.nome === "Bônus de dano de feitiço")!
        .valor,
      2,
    );
  }
});
test("Zarconizado sobre o próprio Necromante não duplica a escolha; campo cheio e cemitério vazio não bloqueiam", () => {
  const g = make();
  const c = dead(g);
  g.player("p1").mage.appliedElement = "Zarcos";
  reaction(g, g.player("p1").mage.id);
  assert.equal(g.state.pendingRevives!.length, 1);
  assert.throws(() => act(g, { type: "endTurn" }), /escolha/);
  g.resolvePendingChoice();
  assert.equal(g.state.pendingRevives!.length, 0);
  assert.ok(g.player("p1").graveyard.some((x) => x.id === c.id));
  for (const full of [false, true]) {
    const h = make();
    if (full) {
      dead(h);
      for (const col of [0, 1, 2])
        slot(h, "p1:front:" + col).card = instance("023");
    }
    const enemy = instance("023", "p2", {
      elemento: "Zarcos",
      hp: 40,
      habilidadesPassivas: [],
    });
    slot(h, "p2:front:0").card = enemy;
    h.player("p1").mana = 0;
    reaction(h, enemy.id);
    assert.equal(h.player("p1").mana, 2);
    assert.equal(h.state.pendingRevives?.length ?? 0, 0);
  }
});
test("sacrifício recupera 2 de vida e 1 mana", () => {
  const g = make();
  g.player("p1").mage.hpAtual = 10;
  g.player("p1").mana = 0;
  slot(g, "p1:front:0").card = instance("023");
  act(g, { type: "sacrifice", slotId: "p1:front:0" });
  assert.equal(g.player("p1").mage.hpAtual, 12);
  assert.equal(g.player("p1").mana, 1);
});

test("dois Necromantes resolvem escolhas separadas e receber a reação numa tropa não ativa o indicador do mago", () => {
  const g = make(true);
  const first = dead(g),
    second = dead(g, "p2");
  g.player("p2").mage.appliedElement = "Zarcos";
  reaction(g, g.player("p2").mage.id);
  assert.equal(g.state.pendingRevives!.length, 2);
  for (const id of ["p1", "p2"]) {
    const choice = g.state.pendingRevives![0];
    choose(
      g,
      choice.ownerId === "p1" ? first : second,
      choice.ownerId + ":front:0",
      choice.ownerId,
    );
  }
  assert.equal(g.state.pendingRevives!.length, 0);
  assert.ok(slot(g, "p1:front:0").card);
  assert.ok(slot(g, "p2:front:0").card);
  const h = make();
  dead(h);
  const ally = instance("023", "p1", {
    elemento: "Zarcos",
    hp: 30,
    habilidadesPassivas: [],
  });
  slot(h, "p1:front:0").card = ally;
  h.state.current = "p2";
  reaction(h, ally.id, "p2");
  assert.equal(h.state.pendingRevives?.length ?? 0, 0);
});
test("migração preserva arte e versão e não altera outras cartas", () => {
  for (const id of ["080", "108"]) {
    const c = structuredClone(catalog.find((c) => c.numeroCatalogo === id)!);
    assert.deepEqual(necromancerCardPatch(c).patch, {});
    const old = {
      ...c,
      imgURL: "/arte-propria.png",
      versao: 12,
      descricao: "Antigo",
      ...(id === "108" ? { hp: 20 } : { custoMana: 2, publicado: false }),
    };
    const plan = necromancerCardPatch(old);
    const next = { ...old, ...plan.patch };
    for (const key of Object.keys(plan.unset)) delete (next as any)[key];
    assert.equal(next.imgURL, "/arte-propria.png");
    assert.equal(next.versao, 12);
    assert.deepEqual(necromancerCardPatch(next).patch, {});
  }
  assert.throws(
    () =>
      necromancerCardPatch(catalog.find((c) => c.numeroCatalogo === "016")!),
    /fora/,
  );
});

test("bônus ativado na conjuração não reduz a base de efeitos contínuos", () => {
  for (const field of [false, true]) {
    const g = make();
    g.player("p1").mage.habilidadesPassivas = [
      {
        gatilho: "onSpellCast",
        escopo: "aliado",
        efeitos: [{ id: "spellDamageTurn", valor: 2, acumulavel: true }],
      },
    ];
    if (field) {
      cast(g, "031", [], undefined, { requerElementoMago: "Neutro" });
      assert.equal(g.state.fieldEffects![0].damage, 2);
    } else {
      cast(g, "057", [], undefined, {
        custoMana: 0,
        alvo: "TodosInimigos",
        efeitos: [{ id: "arrowRain", valor: 3, duracao: 2, variantesMago: [] }],
      });
      assert.equal(g.state.ongoingSpells![0].damage, 3);
    }
  }
});
