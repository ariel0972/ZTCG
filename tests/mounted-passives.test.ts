import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { Card, cardSchema } from "../src/types/card";
import { Game } from "../src/game/engine";
import { Instance } from "../src/game/state";
import { applyStatus } from "../src/game/status";
import { adjacentAttackBonus, canMount } from "../src/game/passives";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { passiveTemplates, targetAttackBonus } from "../src/game/passives";
import { blockedOwnAttack } from "../src/game/passives";
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
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.round = 3;
  g.state.current = "p1";
  for (const p of g.state.players) p.mana = 20;
  return g;
}
const slot = (g: Game, id: string) => g.state.slots.find((s) => s.id === id)!;
const act = (g: Game, data: object, user = g.state.current) =>
  g.execute(user, {
    ...data,
    actionId: randomUUID(),
    version: g.state.version,
  });
function mounted(g: Game, owner = "p1", column = 0) {
  const s = slot(g, `${owner}:front:${column}`);
  s.card = instance("074", owner, { fraqueza: [], resistencia: [] });
  s.rider = instance("021", owner, { fraqueza: [], resistencia: [] });
  return s;
}
test("montaria filtra por catálogo, permite qualquer tropa sem filtro e persiste duas tropas", async () => {
  const g = make(),
    horse = instance("074"),
    knight = instance("021");
  assert.equal(canMount(horse, knight), true);
  assert.equal(canMount(horse, instance("023")), false);
  assert.equal(canMount({ ...horse, montaria: {} }, instance("023")), true);
  assert.equal(canMount(horse, knight, true), false);
  for (const id of ["025", "063", "074", "075"]) {
    const card = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.deepEqual(playableErrors(card), []);
    const doc = new CardModel(card);
    assert.equal(doc.validateSync(), undefined);
    const { _id, __v, ...persisted } = doc.toObject();
    assert.deepEqual(
      cardSchema.parse(persisted).habilidadesPassivas,
      card.habilidadesPassivas,
    );
    assert.deepEqual(cardSchema.parse(persisted).montaria, card.montaria);
  }
});
test("mobilizar diretamente na montaria usa mana e limite normal; ambos atacam e geram mana", () => {
  const g = make();
  slot(g, "p1:front:0").card = instance("074");
  const knight = instance("021");
  g.player("p1").hand = [knight];
  act(g, {
    type: "play",
    cardId: knight.id,
    slotId: "p1:front:0",
    targets: [],
  });
  assert.equal(g.player("p1").mana, 16);
  assert.equal(g.player("p1").counters.summons, 1);
  assert.equal(slot(g, "p1:front:0").rider!.id, knight.id);
  const saved = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  assert.equal(
    saved.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.rider!.id,
    knight.id,
  );
  slot(saved, "p2:front:2").card = instance("020", "p2", {
    hp: 30,
    fraqueza: [],
    resistencia: [],
  });
  act(saved, { type: "attack", slotId: "p1:front:0", targetId: "p2:front:2" });
  act(saved, {
    type: "attack",
    slotId: "p1:front:0",
    source: "rider",
    targetId: "p2:front:2",
  });
  assert.equal(slot(saved, "p2:front:2").card!.hpAtual, 23);
  assert.equal(saved.player("p1").counters.attacks, 2);
  saved.player("p1").mana = 0;
  (saved as any).recoverMana(saved.player("p1"));
  assert.equal(
    saved.player("p1").mana,
    (saved.player("p1").mage.recuperacaoMana ?? 0) + 6,
  );
});
test("montar em campo consome ataque, é idempotente e desmontar exige vaga direita", () => {
  const g = make();
  slot(g, "p1:front:0").card = instance("074");
  slot(g, "p1:front:2").card = instance("021");
  const command = {
    type: "mount",
    slotId: "p1:front:2",
    destinationId: "p1:front:0",
    actionId: randomUUID(),
    version: g.state.version,
  };
  g.execute("p1", command);
  assert.equal(g.execute("p1", command).duplicate, true);
  assert.equal(g.player("p1").mana, 20);
  assert.equal(g.player("p1").counters.attacks, 1);
  assert.equal(slot(g, "p1:front:2").card, null);
  assert.equal(slot(g, "p1:front:0").rider!.attacked, true);
  assert.throws(
    () => act(g, { type: "dismount", slotId: "p1:front:0" }),
    /ataque|atacou/i,
  );
  act(g, { type: "endTurn" });
  act(g, { type: "endTurn" });
  slot(g, "p1:front:1").terrain = { nome: "Lama", rodadasRestantes: 2 };
  assert.throws(
    () => act(g, { type: "dismount", slotId: "p1:front:0" }),
    /direita/,
  );
  delete slot(g, "p1:front:1").terrain;
  act(g, { type: "dismount", slotId: "p1:front:0" });
  assert.equal(slot(g, "p1:front:0").rider, null);
  assert.equal(slot(g, "p1:front:1").card!.numeroCatalogo, "021");
  assert.equal(slot(g, "p1:front:1").card!.attacked, true);
});
test("Cavalo só ataca com Cavaleiro em campo e movimento leva o ocupante", () => {
  const g = make();
  slot(g, "p1:front:0").card = instance("074");
  slot(g, "p2:front:2").card = instance("020", "p2");
  assert.equal(
    g.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.attackTargets!
      .card.length,
    0,
  );
  assert.throws(
    () =>
      act(g, { type: "attack", slotId: "p1:front:0", targetId: "p2:front:2" }),
    /passiva/,
  );
  const rider = instance("021");
  slot(g, "p1:front:0").rider = rider;
  act(g, { type: "move", slotId: "p1:front:0", destinationId: "p1:front:1" });
  assert.equal(slot(g, "p1:front:0").card, null);
  assert.equal(slot(g, "p1:front:1").rider!.id, rider.id);
  assert.throws(
    () =>
      act(g, {
        type: "move",
        slotId: "p1:front:1",
        destinationId: "p1:front:2",
      }),
    /movimento/,
  );
});
test("excedente passa pelas proteções do cavaleiro; estrutura continua absorvendo primeiro", () => {
  const g = make(),
    s = mounted(g);
  s.card!.hpAtual = 2;
  s.rider!.resistencia = ["Fogo"];
  applyStatus(s.rider!.statuses, "Escudo", 2, 1);
  (g as any).damage(s.id, 7, undefined, false, "Fogo");
  (g as any).resolve();
  assert.equal(slot(g, s.id).card!.hpAtual, 11);
  assert.equal(slot(g, s.id).card!.numeroCatalogo, "021");
  assert.equal(slot(g, s.id).rider, null);
  assert.ok(g.state.log.some((line) => /Excedente de Cavalo/.test(line)));
  const protectedGame = make(),
    p = mounted(protectedGame);
  p.structure = instance("020", "p1", {
    tipo: "Estrutura",
    hp: 2,
    fraqueza: [],
    resistencia: [],
  });
  (protectedGame as any).damage(
    p.id,
    20,
    instance("020", "p2"),
    false,
    "Neutro",
  );
  (protectedGame as any).resolve();
  assert.equal(slot(protectedGame, p.id).card!.hpAtual, 9);
  assert.equal(slot(protectedGame, p.id).rider!.hpAtual, 12);
});
test("feitiço individual escolhe o ocupante; área atinge ambos mais o excedente", () => {
  const g = make(),
    s = mounted(g, "p2");
  const riderId = s.rider!.id;
  const spell = instance("001", "p1", {
    custoMana: 0,
    elemento: "Neutro",
    alvo: "UnicoInimigo",
    efeitos: [{ id: "damage", valor: 4 }],
  });
  g.player("p1").hand = [spell];
  act(g, { type: "play", cardId: spell.id, targets: [riderId] });
  assert.equal(slot(g, s.id).card!.hpAtual, 9);
  assert.equal(slot(g, s.id).rider!.hpAtual, 8);
  slot(g, s.id).card!.hpAtual = 2;
  const area = instance("001", "p1", {
    custoMana: 0,
    elemento: "Neutro",
    alvo: "TodasTropasInimigas",
    efeitos: [{ id: "damage", valor: 5 }],
  });
  g.player("p1").hand = [area];
  act(g, { type: "play", cardId: area.id, targets: [] });
  assert.equal(slot(g, s.id).card, null);
  assert.ok(g.player("p2").graveyard.some((c) => c.id === riderId));
});
test("Cachorro retalia cada ataque contra o mago, fora do alcance e mesmo em golpe fatal", () => {
  for (const fatal of [false, true]) {
    const g = make();
    g.state.current = "p2";
    g.state.turn = 4;
    slot(g, "p1:front:1").card = instance("063");
    slot(g, "p1:front:1").card!.attacked = true;
    slot(g, "p1:front:2").card = null;
    slot(g, "p2:front:0").card = instance("020", "p2", {
      hp: 30,
      ataque: 4,
      fraqueza: [],
      resistencia: [],
    });
    if (fatal) g.player("p1").mage.hpAtual = 3;
    act(g, { type: "attack", slotId: "p2:front:0", targetId: "p1:front:2" });
    assert.equal(slot(g, "p2:front:0").card!.hpAtual, 27);
    assert.equal(g.player("p1").counters.attacks, 0);
    assert.equal(slot(g, "p1:front:1").card!.attacked, true);
    assert.equal(g.state.status, fatal ? "FINISHED" : "ACTIVE");
    if (!fatal) {
      slot(g, "p2:front:1").card = instance("020", "p2", {
        hp: 30,
        ataque: 4,
        direcaoAtaque: "Universal",
        resistencia: [],
        fraqueza: [],
      });
      act(g, { type: "attack", slotId: "p2:front:1", targetId: "p1:front:2" });
      assert.equal(slot(g, "p2:front:1").card!.hpAtual, 27);
    }
  }
});
test("Escudeiro intercepta coluna central e prioridade esquerda inclui Guerreiro", () => {
  for (const central of [false, true]) {
    const g = make();
    g.state.current = "p2";
    g.state.turn = 4;
    slot(g, "p1:front:0").card = instance("075", "p1", {
      fraqueza: [],
      resistencia: [],
    });
    slot(g, "p1:front:2").card = instance("020", "p1", {
      hp: 12,
      fraqueza: [],
      resistencia: [],
    });
    const col = central ? 1 : 0;
    slot(g, `p2:front:${col}`).card = instance("020", "p2", {
      ataque: 4,
      direcaoAtaque: "Universal",
      resistencia: [],
      fraqueza: [],
    });
    act(g, {
      type: "attack",
      slotId: `p2:front:${col}`,
      targetId: "p1:front:2",
    });
    assert.equal(slot(g, "p1:front:0").card!.hpAtual, central ? 5 : 9);
    assert.equal(slot(g, "p1:front:2").card!.hpAtual, central ? 12 : 8);
  }
  const g = make();
  slot(g, "p1:front:0").card = instance("023");
  slot(g, "p1:front:1").card = instance("075");
  slot(g, "p1:front:2").card = instance("020");
  act(g, {
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "modoDefensivo",
    targets: [],
  });
  act(g, { type: "endTurn" });
  slot(g, "p2:front:1").card = instance("020", "p2", {
    ataque: 4,
    direcaoAtaque: "Universal",
  });
  act(g, { type: "attack", slotId: "p2:front:1", targetId: "p1:front:2" });
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 9);
  assert.equal(slot(g, "p1:front:1").card!.hpAtual, 9);
});

test("retaliação respeita incapacidades e a estrutura do atacante", () => {
  for (const status of [
    "Atordoado",
    "Incapacitado",
    "Congelado",
    "Estrutura",
  ]) {
    const g = make();
    g.state.current = "p2";
    g.state.turn = 4;
    const dog = instance("063");
    slot(g, "p1:front:0").card = dog;
    slot(g, "p1:front:2").card = null;
    if (status !== "Estrutura") applyStatus(dog.statuses, status, 2);
    const attack = slot(g, "p2:front:1");
    attack.card = instance("020", "p2", {
      ataque: 2,
      direcaoAtaque: "Universal",
      hp: 30,
      fraqueza: [],
      resistencia: [],
    });
    if (status === "Estrutura")
      attack.structure = instance("020", "p2", {
        tipo: "Estrutura",
        hp: 10,
        fraqueza: [],
        resistencia: [],
      });
    act(g, { type: "attack", slotId: attack.id, targetId: "p1:front:2" });
    assert.equal(slot(g, attack.id).card!.hpAtual, 30);
    if (status === "Estrutura")
      assert.equal(slot(g, attack.id).structure!.hpAtual, 7);
  }
});

test("armamento aplica vida e ataque às duas tropas; movimento ajusta ambos", () => {
  const g = make(),
    s = mounted(g);
  const weapon = instance("001", "p1", {
    tipo: "Armamento",
    bonusHp: 3,
    bonusAtaque: 2,
    custoMana: 0,
    efeitos: [],
    alvo: undefined,
  });
  g.player("p1").hand = [weapon];
  act(g, {
    type: "play",
    cardId: weapon.id,
    slotId: "p1:arm:front-left",
    targets: [],
  });
  assert.equal(slot(g, s.id).card!.hpAtual, 12);
  assert.equal(slot(g, s.id).rider!.hpAtual, 15);
  slot(g, "p2:front:2").card = instance("020", "p2", {
    hp: 30,
    fraqueza: [],
    resistencia: [],
  });
  act(g, { type: "attack", slotId: s.id, targetId: "p2:front:2" });
  act(g, {
    type: "attack",
    slotId: s.id,
    source: "rider",
    targetId: "p2:front:2",
  });
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 19);
  act(g, { type: "move", slotId: s.id, destinationId: "p1:front:1" });
  assert.equal(slot(g, "p1:front:1").card!.hpAtual, 9);
  assert.equal(slot(g, "p1:front:1").rider!.hpAtual, 12);
});

test("morte e status em área incluem ocupante e não perdem passivas ou identidade", () => {
  const g = make(),
    s = mounted(g, "p2");
  s.rider!.numeroCatalogo = "098";
  s.rider!.habilidadesPassivas = instance("098").habilidadesPassivas;
  s.card!.hpAtual = 2;
  const riderId = s.rider!.id;
  (g as any).damage(s.card!.id, 2, undefined, false, "Neutro");
  (g as any).resolve();
  assert.equal(slot(g, s.id).card!.id, riderId);
  assert.equal(slot(g, s.id).card!.hpAtual, 13);
  const area = instance("001", "p1", {
    custoMana: 0,
    alvo: "TodasTropasInimigas",
    efeitos: [{ id: "status", status: "Atordoado", duracao: 1 }],
  });
  g.player("p1").hand = [area];
  act(g, { type: "play", cardId: area.id, targets: [] });
  assert.ok(slot(g, s.id).card!.statuses.some((s) => s.nome === "Atordoado"));
});

test("habilidades do ocupante, ocultação individual e aura por catálogo funcionam montado", () => {
  const g = make(),
    s = mounted(g);
  s.rider = instance("023");
  act(g, {
    type: "ability",
    slotId: s.id,
    source: "rider",
    abilityId: "modoOfensivo",
    targets: [],
  });
  assert.ok(
    slot(g, s.id).rider!.statuses.some((s) => s.nome === "BonusAtaque"),
  );
  slot(g, s.id).rider!.numeroCatalogo = "021";
  slot(g, "p1:front:1").card = instance("075");
  assert.equal(adjacentAttackBonus(slot(g, s.id).rider!, g.state.slots), 2);
  const enemy = mounted(g, "p2");
  applyStatus(enemy.rider!.statuses, "Esconder", 2);
  const spell = instance("001", "p1", {
    custoMana: 0,
    alvo: "UnicoInimigo",
    efeitos: [{ id: "damage", valor: 1 }],
  });
  g.player("p1").hand = [spell];
  assert.throws(
    () =>
      act(g, { type: "play", cardId: spell.id, targets: [enemy.rider!.id] }),
    /escondida/,
  );
});

test("ocupante pode interceptar e Golém mede a vida máxima com armamento", () => {
  const g = make(),
    s = mounted(g);
  s.rider = instance("075", "p1", { fraqueza: [], resistencia: [] });
  g.state.current = "p2";
  g.state.turn = 4;
  slot(g, "p1:front:2").card = instance("020");
  slot(g, "p2:front:1").card = instance("020", "p2", {
    ataque: 3,
    direcaoAtaque: "Universal",
  });
  act(g, { type: "attack", slotId: "p2:front:1", targetId: "p1:front:2" });
  assert.equal(slot(g, s.id).card!.hpAtual, 9);
  assert.equal(slot(g, s.id).rider!.hpAtual, 6);
  const golem = instance("025", "p2");
  slot(g, "p2:front:1").card = golem;
  const position = slot(g, s.id);
  position.card = instance("020", "p1", { hp: 10 });
  position.card.hpAtual = 6;
  position.rider = null;
  slot(g, "p1:arm:front-left").card = instance("001", "p1", {
    tipo: "Armamento",
    bonusHp: 4,
    bonusAtaque: 0,
  });
  assert.equal(targetAttackBonus(golem, position.card, g.state.slots), 1);
});

test("modelos reutilizáveis são válidos e novas combinações incompatíveis são recusadas", () => {
  for (const model of passiveTemplates) {
    const tipo = model.passiva.efeitos.some((e) => e.id === "manaRecovery")
      ? "Mago"
      : "Tropa";
    const card = cardSchema.parse({
      ...catalog.find(
        (c) => c.numeroCatalogo === (tipo === "Mago" ? "028" : "025"),
      ),
      habilidadesPassivas: [model.passiva],
    });
    assert.deepEqual(playableErrors(card), [], model.nome);
  }
  for (const patch of [
    { tipo: "Mago", montaria: {} },
    { palavrasChave: [], montaria: {} },
    {
      habilidadesPassivas: [
        {
          gatilho: "continuous",
          escopo: "proprio",
          efeitos: [{ id: "counterAttack", alvo: "cartaEvento" }],
        },
      ],
    },
    {
      habilidadesPassivas: [
        {
          gatilho: "onDamageTaken",
          escopo: "proprio",
          efeitos: [{ id: "interceptAttack" }],
        },
      ],
    },
  ])
    assert.throws(() => {
      const card = cardSchema.parse({
        ...catalog.find((c) => c.numeroCatalogo === "074"),
        ...patch,
      });
      const errors = playableErrors(card);
      if (errors.length) throw Error(errors.join("; "));
    });
});

test("presença em campo pode exigir armamento sem vida e ignora tropa morta", () => {
  const g = make();
  const horse = instance("074", "p1", {
    habilidadesPassivas: [
      {
        gatilho: "continuous",
        escopo: "proprio",
        condicoes: [
          {
            tipo: "cartaEmCampo",
            jogador: "aliado",
            filtro: { tipo: "Armamento" },
            presente: false,
          },
        ],
        efeitos: [{ id: "blockOwnAttack" }],
      },
    ],
  });
  slot(g, "p1:front:0").card = horse;
  assert.equal(blockedOwnAttack(horse, g.state.slots), true);
  slot(g, "p1:arm:front-left").card = instance("001", "p1", {
    tipo: "Armamento",
    hp: undefined,
    bonusHp: 0,
    bonusAtaque: 1,
  });
  assert.equal(blockedOwnAttack(horse, g.state.slots), false);
  const original = instance("074");
  slot(g, "p1:front:1").card = instance("021");
  slot(g, "p1:front:1").card!.hpAtual = 0;
  assert.equal(blockedOwnAttack(original, g.state.slots), true);
});
