import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import { slotCards, type Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { cleanCard } from "../src/services/catalog";
const catalog = raw.map((c) => cardSchema.parse(c));
function act(g: Game, user: string, cmd: object) {
  return g.execute(user, {
    ...cmd,
    actionId: randomUUID(),
    version: g.state.version,
  });
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
    () => 0.2,
  );
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
  g.state.turn = 3;
  g.state.current = "p1";
  for (const p of g.state.players) {
    p.mana = 20;
    p.mage.habilidadesPassivas = [];
    p.mage.limites[0].tropaAtacam = 20;
  }
  return g;
}
function instance(
  ref: string,
  owner = "p1",
  extra: Partial<Card> = {},
): Instance {
  const c = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === ref),
    ...extra,
  });
  return {
    ...c,
    id: randomUUID(),
    ownerId: owner,
    hpAtual: c.hp ?? 0,
    statuses: [],
    attacked: false,
    usedAbility: false,
  };
}
function put(
  g: Game,
  ref: string,
  column: number,
  owner = "p1",
  extra: Partial<Card> = {},
) {
  const s = g.state.slots.find(
    (s) => s.ownerId === owner && s.kind === "Tropa" && s.column === column,
  )!;
  s.card = instance(ref, owner, extra);
  return s.card.id;
}
function get(g: Game, id: string) {
  return g.state.slots.flatMap(slotCards).find((c) => c.id === id)!;
}
function ability(g: Game, id: string, name: string, targets: string[] = []) {
  const slot = g.state.slots.find((s) =>
    slotCards(s).some((c) => c.id === id),
  )!;
  return act(g, get(g, id).ownerId, {
    type: "ability",
    slotId: slot.id,
    source: slot.rider?.id === id ? "rider" : "card",
    abilityId: name,
    targets,
  });
}

const shadows = {
  id: "caminharnassombras",
  nome: "Caminhando nas Sombras",
  custoMana: 5,
  alvo: "TodasTropasInimigas" as const,
  efeitos: [
    { id: "damage", valor: 2 },
    {
      id: "status",
      alvo: "Proprio" as const,
      status: "Esconder",
      duracao: 2,
      unidade: "turno" as const,
    },
  ],
};

test("efeitos mistos persistem e atingem inimigos e a própria fonte separadamente", () => {
  const g = make(),
    a = put(g, "020", 0, "p1", { habilidadesAtivas: [shadows] }),
    ally = put(g, "023", 1),
    enemy = put(g, "023", 2, "p2", { resistencia: [], fraqueza: [] });
  const horse = put(g, "074", 1, "p2", { resistencia: [], fraqueza: [] });
  const mounted = g.state.slots.find((s) => s.card?.id === horse)!;
  mounted.rider = instance("021", "p2", { resistencia: [], fraqueza: [] });
  const rider = mounted.rider.id;
  const c = cardSchema.parse({
      ...catalog.find((c) => c.numeroCatalogo === "020"),
      habilidadesAtivas: [shadows],
    }),
    model = new CardModel(c);
  assert.deepEqual(playableErrors(c), []);
  assert.equal(model.validateSync(), undefined);
  assert.deepEqual(
    cleanCard(model.toObject()).habilidadesAtivas,
    c.habilidadesAtivas,
  );
  ability(g, a, shadows.id);
  assert.equal(get(g, enemy).hpAtual, 9);
  assert.equal(get(g, horse).hpAtual, 7);
  assert.equal(get(g, rider).hpAtual, 10);
  assert.equal(get(g, a).hpAtual, 9);
  assert.equal(get(g, ally).hpAtual, 11);
  assert.ok(get(g, a).statuses.some((s) => s.nome === "Esconder"));
  for (const id of [enemy, horse, rider, ally])
    assert.equal(
      get(g, id).statuses.some((s) => s.nome === "Esconder"),
      false,
    );
  assert.equal(g.player("p1").mana, 15);
  assert.equal(get(g, a).attacked, false);
  assert.throws(() => ability(g, a, shadows.id), /utilizada/);
});

test("efeito Proprio usa o ocupante montado e funciona mesmo sem tropas inimigas", () => {
  const g = make(),
    horse = put(g, "074", 0),
    s = g.state.slots.find((s) => s.card?.id === horse)!;
  s.rider = instance("020", "p1", { habilidadesAtivas: [shadows] });
  const rider = s.rider.id;
  ability(g, rider, shadows.id);
  assert.ok(get(g, rider).statuses.some((s) => s.nome === "Esconder"));
  assert.equal(
    get(g, horse).statuses.some((s) => s.nome === "Esconder"),
    false,
  );
  assert.equal(g.player("p2").mage.hpAtual, g.player("p2").mage.hp);
});

test("Esconder em dois turnos cobre o próximo turno adversário de qualquer posição da rodada", () => {
  for (const turn of [3, 4]) {
    let g = make();
    g.state.turn = turn;
    const assassin = put(g, "020", 0, "p1", { habilidadesAtivas: [shadows] });
    put(g, "023", 2, "p2");
    ability(g, assassin, shadows.id);
    g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
    act(g, "p1", { type: "endTurn" });
    assert.ok(get(g, assassin).statuses.some((s) => s.nome === "Esconder"));
    assert.throws(
      () =>
        act(g, "p2", {
          type: "attack",
          slotId: "p2:front:2",
          targetId: "p1:front:0",
        }),
      /escondid/i,
    );
    act(g, "p2", { type: "endTurn" });
    assert.equal(
      get(g, assassin).statuses.some((s) => s.nome === "Esconder"),
      false,
    );
  }
});

test("alvo por efeito rejeita feitiços e efeitos sem alvo de carta", () => {
  const assassin = catalog.find((c) => c.numeroCatalogo === "020")!;
  const invalid = cardSchema.parse({
    ...assassin,
    habilidadesAtivas: [
      { ...shadows, efeitos: [{ id: "draw", valor: 1, alvo: "Proprio" }] },
    ],
  });
  assert.ok(
    playableErrors(invalid).some((e) => e.includes("Proprio por efeito")),
  );
  const spell = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === "001"),
    efeitos: [{ id: "damage", valor: 2, alvo: "Proprio" }],
  });
  assert.ok(
    playableErrors(spell).some((e) => e.includes("Proprio por efeito")),
  );
  assert.equal(
    cardSchema.safeParse({
      ...assassin,
      habilidadesAtivas: [
        {
          ...shadows,
          efeitos: [
            { id: "status", alvo: "Fonte", status: "Esconder", duracao: 1 },
          ],
        },
      ],
    }).success,
    false,
  );
});
test("novas habilidades declarativas são publicáveis; opções incompatíveis são rejeitadas", () => {
  for (const id of ["111", "075"])
    assert.deepEqual(
      playableErrors(catalog.find((c) => c.numeroCatalogo === id)!),
      [],
    );
  const card = structuredClone(
    catalog.find((c) => c.numeroCatalogo === "111")!,
  );
  card.habilidadesAtivas[0].maxAlvos = 3;
  card.habilidadesAtivas[0].alvo = "UnicoInimigo";
  assert.ok(playableErrors(card).some((e) => e.includes("maxAlvos")));
  card.habilidadesAtivas[0].efeitos = [
    { id: "guardTarget", valor: 2, duracao: 1 },
  ];
  assert.ok(playableErrors(card).some((e) => e.includes("guardTarget")));
});
test("Rodopio seleciona até dois inimigos distintos, sem aumentar dano pela aura", () => {
  const g = make(),
    d = put(g, "111", 0),
    ally = put(g, "110", 1),
    a = put(g, "023", 0, "p2", { resistencia: [], fraqueza: [] }),
    b = put(g, "023", 1, "p2", { resistencia: [], fraqueza: [] });
  assert.throws(
    () => ability(g, d, "rodopio", [a, b, g.player("p2").mage.id]),
    /limite/,
  );
  const s = g.state.slots.find((s) => s.card?.id === a)!;
  assert.throws(() => ability(g, d, "rodopio", [a, s.id]), /diferentes/);
  ability(g, d, "rodopio", [a, b]);
  assert.equal(get(g, a).hpAtual, 8);
  assert.equal(get(g, b).hpAtual, 8);
  assert.equal(g.player("p1").mana, 16);
  assert.equal(get(g, d).attacked, false);
  assert.ok(get(g, ally));
});
test("Rodopio respeita a estrutura e pode atingir o mago", () => {
  const g = make(),
    d = put(g, "111", 0),
    a = put(g, "023", 0, "p2");
  const slot = g.state.slots.find((s) => s.card?.id === a)!;
  slot.structure = instance("023", "p2", {
    tipo: "Estrutura",
    hp: 10,
    fraqueza: [],
    resistencia: [],
    habilidadesPassivas: [],
  });
  const structure = slot.structure.id,
    before = g.player("p2").mage.hpAtual;
  ability(g, d, "rodopio", [a, g.player("p2").mage.id]);
  assert.equal(get(g, a).hpAtual, 11);
  assert.equal(get(g, structure).hpAtual, 7);
  assert.equal(g.player("p2").mage.hpAtual, before - 3);
});
test("Elevar Moral cura os aliados, incluindo estruturas e montaria, limita vida e consome ataque", () => {
  const g = make(),
    d = put(g, "111", 0),
    horse = put(g, "074", 2);
  const slot = g.state.slots.find((s) => s.card?.id === horse)!;
  slot.rider = instance("021");
  slot.rider.hpAtual = 11;
  slot.structure = instance("023", "p1", {
    tipo: "Estrutura",
    hp: 8,
    habilidadesPassivas: [],
  });
  slot.structure.hpAtual = 4;
  const rider = slot.rider.id,
    structure = slot.structure.id;
  get(g, d).hpAtual = 8;
  get(g, horse).hpAtual = 4;
  g.player("p1").mage.hpAtual -= 2;
  const max = g.player("p1").mage.hp!;
  ability(g, d, "elevarMoral");
  assert.equal(get(g, d).hpAtual, 10);
  assert.equal(get(g, horse).hpAtual, 7);
  assert.equal(get(g, rider).hpAtual, 12);
  assert.equal(get(g, structure).hpAtual, 7);
  assert.equal(g.player("p1").mage.hpAtual, max);
  assert.equal(get(g, d).attacked, true);
  assert.equal(g.player("p1").counters.attacks, 1);
  assert.equal(g.player("p1").mana, 15);
  const blocked = make(),
    unit = put(blocked, "111", 0);
  get(blocked, unit).attacked = true;
  assert.throws(() => ability(blocked, unit, "elevarMoral"), /ataque|atac/i);
  assert.equal(blocked.player("p1").mana, 20);
});
test("Ajudante cura somente Cavaleiro aliado, montado e sem adjacência", () => {
  const g = make(),
    s = put(g, "075", 0),
    horse = put(g, "074", 2),
    wrong = put(g, "023", 1);
  const slot = g.state.slots.find((s) => s.card?.id === horse)!;
  slot.rider = instance("021");
  slot.rider.hpAtual = 6;
  const rider = slot.rider.id;
  assert.throws(() => ability(g, s, "ajudante", [wrong]), /filtro/);
  ability(g, s, "ajudante", [rider]);
  assert.equal(get(g, rider).hpAtual, 10);
  assert.equal(g.player("p1").mana, 17);
  assert.throws(() => ability(g, s, "emGuarda", [rider]), /utilizada/);
});
test("filtro de habilidade automática seleciona somente os aliados compatíveis", () => {
  const g = make(),
    s = put(g, "075", 0),
    c = put(g, "021", 2);
  get(g, s).habilidadesAtivas = [
    {
      ...get(g, s).habilidadesAtivas[0],
      id: "ajudanteColetivo",
      alvo: "TodosAliados",
    },
  ];
  get(g, s).hpAtual = 4;
  get(g, c).hpAtual = 3;
  assert.deepEqual(playableErrors(get(g, s)), []);
  ability(g, s, "ajudanteColetivo");
  assert.equal(get(g, c).hpAtual, 7);
  assert.equal(get(g, s).hpAtual, 4);
});
test("Em Guarda intercepta o Cavaleiro escolhido, reduz dois, e a estrutura do Escudeiro absorve primeiro", () => {
  for (const withStructure of [false, true]) {
    const g = make(),
      s = put(g, "075", 0),
      c = put(g, "021", 2),
      attacker = put(g, "023", 0, "p2");
    const defenderSlot = g.state.slots.find((p) => p.card?.id === s)!;
    if (withStructure)
      defenderSlot.structure = instance("023", "p1", {
        tipo: "Estrutura",
        hp: 8,
        fraqueza: [],
        resistencia: [],
        habilidadesPassivas: [],
      });
    const structure = defenderSlot.structure?.id;
    ability(g, s, "emGuarda", [c]);
    g.state.current = "p2";
    act(g, "p2", {
      type: "attack",
      slotId: g.state.slots.find((p) => p.card?.id === attacker)!.id,
      targetId: g.state.slots.find((p) => p.card?.id === c)!.id,
    });
    assert.equal(get(g, c).hpAtual, 12);
    assert.equal(get(g, s).hpAtual, withStructure ? 9 : 8);
    if (structure) assert.equal(get(g, structure).hpAtual, 5);
    assert.ok(g.state.events?.some((e) => e.message?.includes("Em Guarda")));
  }
});
test("Em Guarda protege apenas o excedente do Cavalo e dura até o próximo turno adversário", () => {
  const g = make(),
    s = put(g, "075", 0, "p2"),
    horse = put(g, "074", 2, "p2"),
    attacker = put(g, "023", 0, "p1", { ataque: 7 });
  const slot = g.state.slots.find((p) => p.card?.id === horse)!;
  slot.rider = instance("021", "p2");
  slot.card!.hpAtual = 2;
  const rider = slot.rider.id;
  g.state.turn = 4;
  g.state.current = "p2";
  ability(g, s, "emGuarda", [rider]);
  act(g, "p2", { type: "endTurn" });
  assert.ok(get(g, s).statuses.some((t) => t.nome === "Interceptar"));
  act(g, "p1", {
    type: "attack",
    slotId: g.state.slots.find((p) => p.card?.id === attacker)!.id,
    targetId: slot.id,
  });
  assert.ok(g.player("p2").graveyard.some((c) => c.id === horse));
  assert.equal(get(g, rider).hpAtual, 12);
  assert.equal(get(g, s).hpAtual, 6);
  act(g, "p1", { type: "endTurn" });
  assert.ok(!get(g, s).statuses.some((t) => t.nome === "Interceptar"));
});
