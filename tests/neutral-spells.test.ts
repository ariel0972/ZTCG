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

function play(g: Game, id: string, targets: string[] = [], extra: object = {}) {
  const c = card(id, g.state.current);
  g.player(g.state.current).hand.push(c);
  act(g, { type: "play", cardId: c.id, targets, ...extra });
  return c;
}
const troop = (owner = "p1", extra: Partial<Card> = {}) =>
  card("023", owner, {
    hp: 20,
    ataque: 3,
    subtipo: "Humano",
    elemento: "Neutro",
    fraqueza: [],
    resistencia: [],
    habilidadesPassivas: [],
    ...extra,
  });
const structure = (owner: string) =>
  card("023", owner, {
    tipo: "Estrutura",
    hp: 40,
    fraqueza: [],
    resistencia: [],
    habilidadesPassivas: [],
  });
test("cinco cartas publicadas, executáveis e persistentes no Mongo", () => {
  for (const id of ["051", "060", "073", "115", "129"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), []);
    const doc = new CardModel(c);
    assert.equal(doc.validateSync(), undefined);
    const restored = cardSchema.parse(cleanCard(doc.toObject()));
    assert.deepEqual(restored.efeitos, c.efeitos);
    assert.deepEqual(restored.opcoes, c.opcoes);
  }
});
test("Chamar permite vários armamentos sem mana somente em tropas durante o turno atual", () => {
  const g = make();
  g.player("p1").mana = 5;
  g.player("p1").counters.equipment = 1;
  slot(g, "p1:front:0").card = troop();
  slot(g, "p1:front:2").card = troop();
  const first = card("047"),
    second = card("047"),
    mageWeapon = card("047");
  g.player("p1").hand = [first, second, mageWeapon];
  play(g, "051", [], { mode: "equipar" });
  assert.equal(g.player("p1").mana, 0);
  for (const [c, s] of [
    [first, "p1:arm:front-left"],
    [second, "p1:arm:front-right"],
  ] as const)
    act(g, { type: "play", cardId: c.id, slotId: s });
  assert.equal(g.player("p1").counters.equipment, 3);
  assert.equal(g.player("p1").mana, 0);
  const before = JSON.stringify(g.exportState());
  assert.throws(
    () =>
      act(g, {
        type: "play",
        cardId: mageWeapon.id,
        slotId: "p1:arm:back-left",
      }),
    /um armamento/,
  );
  assert.equal(JSON.stringify(g.exportState()), before);
  end(g);
  assert.equal(
    g.snapshot("p1").players.find((p) => p.id === "p1")!.hand![0].custoMana,
    mageWeapon.custoMana,
  );
});
test("Chamar recicla até dois armamentos e rejeita tropas sem gastar recursos", () => {
  const g = make(),
    a = card("047"),
    b = card("047"),
    t = troop(),
    c = card("051");
  g.player("p1").graveyard = [a, b, t];
  g.player("p1").hand = [c];
  const before = JSON.stringify(g.exportState());
  assert.throws(() =>
    act(g, { type: "play", cardId: c.id, mode: "reciclar", targets: [t.id] }),
  );
  assert.equal(JSON.stringify(g.exportState()), before);
  act(g, {
    type: "play",
    cardId: c.id,
    mode: "reciclar",
    targets: [a.id, b.id],
  });
  for (const id of [a.id, b.id])
    assert(g.player("p1").deck.some((x) => x.id === id));
  assert(g.player("p1").graveyard.some((x) => x.id === t.id));
});
for (const subtype of ["Humano", "Animal", "Monstro"] as const)
  test(
    "armadilha é oculta, persiste e causa dano direto contra " + subtype,
    () => {
      let g = make();
      const casterHp = g.player("p1").mage.hpAtual,
        trap = play(g, "129", ["p1:front:0"]);
      assert(!g.player("p1").graveyard.some((c) => c.id === trap.id));
      assert(JSON.stringify(g.snapshot("p1")).includes("Armadilha de Urso"));
      for (const snapshot of [g.snapshot("p2"), g.spectatorSnapshot()]) {
        const json = JSON.stringify(snapshot);
        assert(!json.includes("Armadilha de Urso"));
        assert(!json.includes("bonusContraSubtipos"));
        assert.equal(
          (snapshot.slots.find((s) => s.id === "p1:front:0")!.card as any)
            .oculta,
          true,
        );
      }
      g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
      slot(g, "p2:front:2").card = troop("p2", { subtipo: subtype });
      slot(g, "p2:front:2").structure = structure("p2");
      end(g);
      act(g, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
      const actual = slot(g, "p2:front:2").card!;
      assert.equal(actual.hpAtual, subtype === "Humano" ? 15 : 14);
      assert.equal(slot(g, "p2:front:2").structure!.hpAtual, 40);
      assert(actual.statuses.some((s) => s.nome === "Incapacitado"));
      assert.equal(g.player("p1").mage.hpAtual, casterHp);
      assert.equal(slot(g, "p1:front:0").card, null);
      assert.equal(
        g.player("p1").graveyard.filter((c) => c.id === trap.id).length,
        1,
      );
      assert.equal(g.player("p2").counters.attacks, 1);
      end(g);
      assert(
        slot(g, "p2:front:2").card!.statuses.some(
          (s) => s.nome === "Incapacitado",
        ),
      );
      end(g);
      assert(
        !slot(g, "p2:front:2").card!.statuses.some(
          (s) => s.nome === "Incapacitado",
        ),
      );
    },
  );
test("armadilha ocupa espaço sem tropa, não expira e rejeita espaço ocupado", () => {
  const g = make();
  slot(g, "p1:front:0").card = troop();
  const c = card("129");
  g.player("p1").hand = [c];
  const before = JSON.stringify(g.exportState());
  assert.throws(() =>
    act(g, { type: "play", cardId: c.id, targets: ["p1:front:0"] }),
  );
  assert.equal(JSON.stringify(g.exportState()), before);
  act(g, { type: "play", cardId: c.id, targets: ["p1:front:1"] });
  for (let i = 0; i < 4; i++) end(g);
  assert.equal(slot(g, "p1:front:1").card!.id, c.id);
});
test("Sacrifício ignora estrutura e ativa recompensas e passivas do Necromante", () => {
  const g = make(),
    p = g.player("p1");
  p.mana = 7;
  p.mage.hpAtual = 5;
  p.mage.habilidadesPassivas = structuredClone(
    catalog.find((c) => c.numeroCatalogo === "108")!.habilidadesPassivas,
  );
  const t = troop("p1", { subtipo: "Animal" });
  slot(g, "p1:front:0").card = t;
  slot(g, "p1:front:0").structure = structure("p1");
  play(g, "115", [t.id]);
  assert.equal(g.player("p1").mana, 8);
  assert.equal(g.player("p1").mage.hpAtual, 12);
  assert.equal(slot(g, "p1:front:0").card, null);
  assert.equal(slot(g, "p1:front:0").structure!.hpAtual, 40);
  assert(g.player("p1").graveyard.some((c) => c.id === t.id));
});
test("Sacrifício cura 2 em tropa comum, 5 em invocação e rejeita mago", () => {
  for (const [subtype, heal] of [
    ["Humano", 2],
    ["Invocação", 5],
  ] as const) {
    const g = make();
    g.player("p1").mage.hpAtual = 5;
    const t = troop("p1", { subtipo: subtype });
    slot(g, "p1:front:0").card = t;
    play(g, "115", [t.id]);
    assert.equal(g.player("p1").mage.hpAtual, 5 + heal);
  }
  const g = make(),
    c = card("115");
  g.player("p1").hand = [c];
  const before = JSON.stringify(g.exportState());
  assert.throws(() =>
    act(g, { type: "play", cardId: c.id, targets: [g.player("p1").mage.id] }),
  );
  assert.equal(JSON.stringify(g.exportState()), before);
});
test("Cegueira restaura contadores normais sem remover status, movimentos ou uso de habilidade", () => {
  const g = make(),
    t = card("043", "p1");
  Object.assign(t, {
    attacked: true,
    attacksMade: 2,
    usedAbility: true,
    moved: true,
    statuses: [{ nome: "Incapacitado", turnosRestantes: 1 }],
  });
  slot(g, "p1:front:0").card = t;
  g.player("p1").counters.attacks = 2;
  g.player("p1").mage.attacked = true;
  g.player("p1").mage.attacksMade = 1;
  g.player("p1").combatStarted = true;
  play(g, "073");
  const actual = slot(g, "p1:front:0").card!;
  assert.equal(g.player("p1").counters.attacks, 0);
  assert.equal(actual.attacksMade, 0);
  assert.equal(actual.attacked, false);
  assert.equal(actual.usedAbility, true);
  assert.equal(actual.moved, true);
  assert.equal(g.player("p1").mage.attacked, false);
  assert.deepEqual(
    g.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.attackTargets!
      .card,
    [],
  );
  assert.equal(g.player("p1").combatStarted, true);
});
test("Traição transfere par preservando estado, deixa estrutura e equipamentos e altera cemitério", () => {
  let g = make();
  const mount = troop("p2", { palavrasChave: ["Montaria"] }),
    rider = troop("p2");
  Object.assign(mount, { attacked: true, attacksMade: 1 });
  Object.assign(rider, {
    usedAbility: true,
    hpAtual: 16,
    statuses: [{ nome: "Incapacitado", turnosRestantes: 1 }],
  });
  slot(g, "p2:front:2").card = mount;
  slot(g, "p2:front:2").rider = rider;
  slot(g, "p2:front:2").structure = structure("p2");
  slot(g, "p2:arm:front-right").card = card("047", "p2");
  play(g, "060", [rider.id], { destinationId: "p1:front:1" });
  const from = slot(g, "p2:front:2"),
    to = slot(g, "p1:front:1");
  assert.equal(from.card, null);
  assert.equal(from.rider ?? null, null);
  assert(from.structure);
  assert(slot(g, "p2:arm:front-right").card);
  assert.equal(to.card!.id, mount.id);
  assert.equal(to.rider!.id, rider.id);
  assert.equal(to.rider!.hpAtual, 11);
  assert.equal(to.card!.ownerId, "p1");
  assert.equal(to.rider!.ownerId, "p1");
  assert.equal(to.card!.attacksMade, 1);
  assert.equal(to.rider!.usedAbility, true);
  assert.equal(to.rider!.statuses[0].nome, "Incapacitado");
  assert.equal(g.player("p1").counters.summons, 0);
  assert.equal(g.player("p1").mana, 16);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  slot(g, "p1:front:1").rider!.hpAtual = 0;
  end(g);
  assert(g.player("p1").graveyard.some((c) => c.id === rider.id));
  assert(!g.player("p2").graveyard.some((c) => c.id === rider.id));
});
test("Traição leva par à mão com campo cheio e rejeita destino inválido atomicamente", () => {
  const g = make();
  for (let i = 0; i < 3; i++) slot(g, "p1:front:" + i).card = troop();
  const mount = troop("p2"),
    rider = troop("p2");
  Object.assign(mount, {
    hpAtual: 2,
    statuses: [{ nome: "Congelado", turnosRestantes: 2 }],
  });
  slot(g, "p2:front:2").card = mount;
  slot(g, "p2:front:2").rider = rider;
  play(g, "060", [mount.id]);
  for (const id of [mount.id, rider.id]) {
    const t = g.player("p1").hand.find((c) => c.id === id)!;
    assert(t);
    assert.equal(t.ownerId, "p1");
    assert.deepEqual(t.statuses, []);
    assert.equal(t.hpAtual, t.hp);
  }
  const h = make(),
    c = card("060");
  h.player("p1").hand = [c];
  const before = JSON.stringify(h.exportState());
  assert.throws(() =>
    act(h, {
      type: "play",
      cardId: c.id,
      targets: [slot(h, "p2:front:2").card!.id],
      destinationId: "p2:front:1",
    }),
  );
  assert.equal(JSON.stringify(h.exportState()), before);
});
test("Amplificar aumenta dano e duração da armadilha e preserva recompensas de sacrifício", () => {
  const g = make();
  g.player("p1").mage.statuses = [
    {
      nome: "Amplificar",
      turnosRestantes: 2,
      spellBoost: { elementos: ["Neutro"], bonus: 1, descontoMana: 2 },
    },
  ];
  const t = modifiedSpell(card("129"), g.player("p1").mage);
  assert.equal(t.efeitos[0].valor, 6);
  assert.equal(t.efeitos[0].duracao, 2);
  assert.deepEqual(
    modifiedSpell(card("115"), g.player("p1").mage).efeitos[0]
      .recompensaSacrificio,
    card("115").efeitos[0].recompensaSacrificio,
  );
});

test("efeitos genéricos funcionam em habilidades de todos os tipos de carta em campo", () => {
  for (const tipo of ["Tropa", "Mago", "Estrutura", "Armamento"] as const) {
    const g = make(),
      s = slot(
        g,
        tipo === "Mago"
          ? "p1:mage"
          : tipo === "Armamento"
            ? "p1:arm:back-left"
            : "p1:front:0",
      );
    const c =
      tipo === "Mago"
        ? g.player("p1").mage
        : troop("p1", { tipo, bonusAtaque: 1, bonusHp: 1 });
    c.habilidadesAtivas = [
      {
        id: "restaurar",
        nome: "Restaurar ataques",
        custoMana: 0,
        alvo: "Global",
        efeitos: [{ id: "resetAttacks" }],
      },
    ];
    if (tipo === "Estrutura") {
      s.card = troop();
      s.structure = c;
    } else s.card = c;
    g.player("p1").counters.attacks = 2;
    assert.deepEqual(playableErrors(c), []);
    act(g, {
      type: "ability",
      slotId: s.id,
      source: tipo === "Estrutura" ? "structure" : "card",
      abilityId: "restaurar",
    });
    assert.equal(g.player("p1").counters.attacks, 0);
  }
});
test("habilidade gera armadilha sem remover nem duplicar a origem", () => {
  const g = make(),
    source = troop();
  source.habilidadesAtivas = [
    {
      id: "armar",
      nome: "Armar",
      custoMana: 0,
      alvo: "CampoAliado",
      efeitos: [{ id: "trap", valor: 2, status: "Incapacitado", duracao: 1 }],
    },
  ];
  slot(g, "p1:front:1").card = source;
  assert.deepEqual(playableErrors(source), []);
  act(g, {
    type: "ability",
    slotId: "p1:front:1",
    abilityId: "armar",
    targets: ["p1:front:0"],
  });
  assert.equal(slot(g, "p1:front:1").card!.id, source.id);
  assert(slot(g, "p1:front:0").card!.concealedTrap?.generated);
  end(g);
  act(g, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
  assert.equal(slot(g, "p1:front:0").card, null);
  assert(!g.player("p1").graveyard.some((c) => c.id === source.id));
});
test("migração preserva arte e versão e rejeita cartas fora das cinco solicitadas", async () => {
  const { neutralSpellsPatch } =
    await import("../scripts/update-neutral-spells");
  const current = catalog.find((c) => c.numeroCatalogo === "051")!;
  const old = {
    ...current,
    custoMana: 2,
    efeitos: [],
    opcoes: undefined,
    publicado: false,
    imgURL: "/assets/custom.png",
    versao: 7,
  };
  const plan = neutralSpellsPatch(old);
  assert.equal(plan.patch.custoMana, 5);
  assert.equal(plan.version, 7);
  assert.equal(plan.patch.imgURL, undefined);
  assert.deepEqual(neutralSpellsPatch({ ...old, ...plan.patch }).patch, {});
  assert.throws(
    () => neutralSpellsPatch(catalog.find((c) => c.numeroCatalogo === "108")!),
    /fora/,
  );
});

test("Sacrifício não consome bônus de dano da próxima ação", () => {
  const g = make();
  g.player("p1").mage.statuses.push({
    nome: "Dano da próxima ação",
    valor: 1,
    turnosRestantes: 1,
    unidade: "turno",
  });
  const t = troop();
  slot(g, "p1:front:0").card = t;
  play(g, "115", [t.id]);
  assert(
    g.player("p1").mage.statuses.some((s) => s.nome === "Dano da próxima ação"),
  );
});
