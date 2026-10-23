import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { applyStatus } from "../src/game/status";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { DurableGame, TURN_MS } from "../src/game/durable";
import { MemoryDurableStore } from "./support/durable-store";
const catalog = raw.map((c) => cardSchema.parse(c));
function card(id: string, ownerId = "p1", extra: Partial<Card> = {}): Instance {
  const c = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id),
    ...(id === "001" ? { alvo: "UnicoInimigo" } : {}),
    ...extra,
  });
  return {
    ...c,
    id: randomUUID(),
    ownerId,
    hpAtual: c.hp ?? 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
}
function game() {
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
  Object.assign(g.state, { phase: "BATTLE", turn: 3, round: 3, current: "p1" });
  for (const p of g.state.players) {
    p.mana = 20;
    p.hand = [];
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
function cast(g: Game, c: Instance, targets: string[] = []) {
  g.player(c.ownerId).hand.push(c);
  return act(g, { type: "play", cardId: c.id, targets }, c.ownerId);
}
function restored(g: Game) {
  return Game.restore(JSON.parse(JSON.stringify(g.exportState())));
}

test("novas cartas validam catálogo e persistem capacidades e espera", () => {
  for (const id of ["006", "026", "030", "037", "045"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.deepEqual(playableErrors(c), []);
    const doc = new CardModel(c);
    assert.equal(doc.validateSync(), undefined);
    const { _id, __v, ...saved } = doc.toObject();
    assert.deepEqual(
      cardSchema.parse(saved).habilidadesAtivas,
      c.habilidadesAtivas,
    );
    assert.deepEqual(
      cardSchema.parse(saved).habilidadesPassivas,
      c.habilidadesPassivas,
    );
  }
});

test("Golém desvia golpe e efeitos, persiste a resposta sem revelar estado privado e não repete custos", () => {
  let g = game();
  slot(g, "p2:front:1").card = card("026", "p2");
  const c = card("001", "p1", {
    elemento: "Neutro",
    custoMana: 3,
    efeitos: [
      { id: "damage", valor: 4 },
      { id: "status", status: "Cego", duracao: 2 },
    ],
  });
  const id = slot(g, "p2:front:1").card!.id;
  cast(g, c, [id]);
  assert.equal(g.state.pendingImpact?.request.ownerId, "p2");
  assert.equal("base" in g.snapshot("p1").pendingImpact!, false);
  assert.throws(() => act(g, { type: "respondDodge", dodge: true }, "p1"));
  g = restored(g);
  act(g, { type: "respondDodge", dodge: true }, "p2");
  const target = slot(g, "p2:front:1").card!;
  assert.equal(target.hpAtual, 15);
  assert.deepEqual(target.statuses, []);
  assert.equal(target.dodgedRound, 3);
  assert.equal(g.player("p1").mana, 17);
  assert.equal(g.player("p1").counters.spells, 1);
  assert.equal(g.state.pendingImpact, undefined);
  cast(
    g,
    card("001", "p1", {
      elemento: "Neutro",
      custoMana: 0,
      efeitos: [{ id: "damage", valor: 3 }],
    }),
    [id],
  );
  assert.equal(g.state.pendingImpact, undefined);
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 12);
});

test("área oferece escolhas separadas e mantém os demais alvos; recusar não consome desvio", () => {
  let g = game();
  slot(g, "p2:front:0").card = card("026", "p2");
  slot(g, "p2:front:1").card = card("026", "p2");
  slot(g, "p2:front:2").card = card("023", "p2", {
    resistencia: [],
    fraqueza: [],
  });
  cast(
    g,
    card("001", "p1", {
      elemento: "Neutro",
      alvo: "TodasTropasInimigas",
      efeitos: [
        { id: "damage", valor: 3 },
        { id: "status", status: "Cego", duracao: 2 },
      ],
    }),
  );
  act(g, { type: "respondDodge", dodge: false }, "p2");
  assert.ok(g.state.pendingImpact);
  g = restored(g);
  act(g, { type: "respondDodge", dodge: true }, "p2");
  assert.equal(slot(g, "p2:front:0").card!.hpAtual, 12);
  assert.equal(slot(g, "p2:front:0").card!.dodgedRound, undefined);
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 15);
  assert.deepEqual(slot(g, "p2:front:1").card!.statuses, []);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 8);
});

test("Golém evita ataque, não evita sangramento, e aguarda uma rodada completa para desviar novamente", () => {
  const g = game();
  slot(g, "p1:front:1").card = card("023");
  slot(g, "p2:front:1").card = card("026", "p2");
  act(g, { type: "attack", slotId: "p1:front:1", targetId: "p2:front:1" });
  act(g, { type: "respondDodge", dodge: true }, "p2");
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 15);
  applyStatus(slot(g, "p2:front:1").card!.statuses, "Sangrando", 3);
  act(g, { type: "endTurn" });
  act(g, { type: "endTurn" });
  assert.equal(g.state.pendingImpact, undefined);
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 14);
  act(g, { type: "attack", slotId: "p1:front:1", targetId: "p2:front:1" });
  assert.equal(g.state.pendingImpact, undefined);
  act(g, { type: "endTurn" });
  act(g, { type: "endTurn" });
  act(g, { type: "attack", slotId: "p1:front:1", targetId: "p2:front:1" });
  assert.ok(g.state.pendingImpact);
});

test("Enchente atinge tropas e montados, aplica Água, respeita espera e deixa mago capaz", () => {
  const g = game();
  slot(g, "p1:front:1").card = card("026");
  slot(g, "p2:front:0").card = card("074", "p2");
  slot(g, "p2:front:0").rider = card("021", "p2");
  act(g, {
    type: "ability",
    slotId: "p1:front:1",
    abilityId: "enchente",
    targets: [],
  });
  assert.equal(g.player("p1").mana, 14);
  for (const c of [slot(g, "p2:front:0").card!, slot(g, "p2:front:0").rider!])
    assert.ok(c.statuses.some((s) => s.nome === "Incapacitado"));
  assert.equal(
    g.player("p2").mage.statuses.some((s) => s.nome === "Incapacitado"),
    false,
  );
  assert.equal(slot(g, "p2:front:0").appliedElement, "Agua");
  g.state.round = 4;
  slot(g, "p1:front:1").card!.usedAbility = false;
  assert.throws(
    () =>
      act(g, {
        type: "ability",
        slotId: "p1:front:1",
        abilityId: "enchente",
        targets: [],
      }),
    /aguarda/,
  );
  g.state.round = 5;
  act(g, {
    type: "ability",
    slotId: "p1:front:1",
    abilityId: "enchente",
    targets: [],
  });
});

test("Escudo protege dano e status com uma carga por feitiço, permite banimento", () => {
  const g = game();
  slot(g, "p2:front:1").card = card("023", "p2");
  const id = slot(g, "p2:front:1").card!.id;
  applyStatus(slot(g, "p2:front:1").card!.statuses, "EscudoProtecao", 2, 3);
  cast(
    g,
    card("001", "p1", {
      elemento: "Fogo",
      efeitos: [
        { id: "damage", valor: 3 },
        { id: "status", status: "Cego", duracao: 2 },
      ],
    }),
    [id],
  );
  const target = slot(g, "p2:front:1").card!;
  assert.equal(target.hpAtual, 11);
  assert.equal(target.statuses.length, 1);
  assert.equal(target.statuses[0].valor, 2);
  cast(
    g,
    card("001", "p1", { elemento: "Neutro", efeitos: [{ id: "banish" }] }),
    [id],
  );
  assert.equal(slot(g, "p2:front:1").card, null);
  assert.equal(g.player("p2").banished[0].id, id);
});

test("Olho revela somente ao conjurador, transfere identidade/dono, inclui compras e expira", () => {
  let g = game();
  const enemyCard = card("023", "p2");
  g.player("p2").hand = [enemyCard];
  const ownHand = g.player("p1").hand.length;
  cast(g, card("030"));
  assert.equal(g.snapshot("p1").players[1].revealedHand?.[0].id, enemyCard.id);
  assert.equal(g.snapshot("p2").players[0].revealedHand, undefined);
  g = restored(g);
  act(g, { type: "chooseHand", cardId: enemyCard.id });
  assert.equal(g.player("p1").hand.length, ownHand + 1);
  assert.equal(g.player("p1").hand.at(-1)?.ownerId, "p1");
  g.player("p2").hand.push(card("041", "p2"));
  assert.equal(g.snapshot("p1").players[1].revealedHand?.length, 1);
  act(g, { type: "endTurn" });
  assert.equal(g.snapshot("p1").players[1].revealedHand?.length, 2);
  act(g, { type: "endTurn" });
  assert.equal(g.snapshot("p1").players[1].revealedHand, undefined);
});

test("Olho descartado por Recuperar Energia recupera 4 além dos 3, conjuração não reembolsa", () => {
  const g = game(),
    c = card("030");
  g.player("p1").hand = [c];
  g.player("p1").mana = 0;
  g.player("p1").mage.habilidadesAtivas.push({
    id: "recuperarEnergia",
    nome: "Recuperar Energia",
    custoMana: 0,
  });
  act(g, {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "recuperarEnergia",
    targets: [c.id],
  });
  assert.equal(g.player("p1").mana, 7);
  g.player("p1").mana = 20;
  cast(g, card("030"));
  assert.equal(g.player("p1").mana, 16);
});

test("Espada cura dano efetivo com limite de sobrevida, sem bônus na montaria ocupada", () => {
  const g = game(),
    s = slot(g, "p1:front:0");
  s.card = card("074");
  s.rider = card("021", "p1", { resistencia: [], fraqueza: [] });
  s.rider.hpAtual = 10;
  slot(g, "p1:arm:front-left").card = card("037");
  slot(g, "p2:front:2").card = card("023", "p2", {
    resistencia: [],
    fraqueza: [],
    hp: 2,
  });
  act(g, {
    type: "attack",
    source: "rider",
    slotId: s.id,
    targetId: "p2:front:2",
  });
  assert.equal(slot(g, s.id).rider!.hpAtual, 12, "overkill não cura");
  assert.equal(slot(g, s.id).card!.hpAtual, 9);
  const g2 = game();
  slot(g2, "p1:front:0").card = card("023", "p1", { ataque: 20, hp: 11 });
  slot(g2, "p1:arm:front-left").card = card("037");
  slot(g2, "p2:front:2").card = card("025", "p2", {
    resistencia: [],
    fraqueza: [],
  });
  act(g2, { type: "attack", slotId: "p1:front:0", targetId: "p2:front:2" });
  assert.equal(slot(g2, "p1:front:0").card!.hpAtual, 15);
});

test("Cheiro soma 2 ao sangramento existente sem renovar e dá bônus apenas às Piranhas aliadas", () => {
  const g = game();
  slot(g, "p2:front:1").card = card("025", "p2");
  const target = slot(g, "p2:front:1").card!;
  applyStatus(target.statuses, "Sangrando", 3);
  target.statuses[0].turnosRestantes = 1;
  cast(g, card("045"));
  const bleeding = slot(g, "p2:front:1").card!.statuses[0];
  assert.equal(bleeding.valor, 3);
  assert.equal(bleeding.turnosRestantes, 1);
  assert.equal(g.player("p1").piranhaBleedingBonus, 1);
  assert.equal(g.player("p2").piranhaBleedingBonus, undefined);
  cast(g, card("045"));
  assert.equal(g.player("p1").piranhaBleedingBonus, 1);
  assert.equal(slot(g, "p2:front:1").card!.statuses[0].valor, 5);
});

test("desvio não refaz sorteios, aceite é idempotente e o timeout recusa", () => {
  let g = game();
  slot(g, "p1:front:1").card = card("023");
  applyStatus(slot(g, "p1:front:1").card!.statuses, "Cego", 2);
  slot(g, "p2:front:1").card = card("026", "p2");
  act(g, { type: "attack", slotId: "p1:front:1", targetId: "p2:front:1" });
  g = restored(g);
  (g as any).rng = () => {
    throw Error("Sorteio repetido indevidamente");
  };
  const command = {
    type: "respondDodge",
    dodge: true,
    actionId: randomUUID(),
    version: g.state.version,
  };
  g.execute("p2", command);
  assert.equal(g.execute("p2", command).duplicate, true);
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 15);
  g.state.round += 2;
  slot(g, "p1:front:1").card!.attacked = false;
  slot(g, "p1:front:1").card!.attacksMade = 0;
  slot(g, "p1:front:1").card!.statuses = [];
  act(g, { type: "attack", slotId: "p1:front:1", targetId: "p2:front:1" });
  g.resolvePendingChoice();
  assert.equal(g.state.pendingImpact, undefined);
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 12);
});

test("desvio do dano de fim de ciclo concede turno seguinte completo após resposta", async () => {
  let now = 1_000_000;
  const g = game(),
    store = new MemoryDurableStore();
  g.state.turn = 4;
  slot(g, "p2:front:1").card = card("026", "p2");
  g.state.ongoingSpells = [
    {
      id: randomUUID(),
      ownerId: "p1",
      kind: "arrowRain",
      rounds: 2,
      nextTickTurn: 4,
      damage: 3,
      element: "Neutro",
    },
  ];
  const load = async () =>
    ({
      deck: {
        nome: "Teste",
        mago: "108",
        cartas: g.player("p1").deck.map((c) => c.numeroCatalogo),
      },
      catalog,
    }) as any;
  // Use a valid 40-card fixture for room creation, then install the exact battle state.
  const ids = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const service = () =>
    new DurableGame(
      store,
      () => now,
      async () => ({
        ...(await load()),
        deck: { nome: "Teste", mago: "108", cartas: ids },
      }),
      async () => {},
    );
  await service().join("p1", "p1", "deck", randomUUID());
  await service().join("p2", "p2", "deck", randomUUID());
  const m = (await service().state("p1")).match!,
    room = store.rooms.get(m.id)!;
  room.game = g.exportState();
  room.deadline = now + 80_000;
  const result = await service().command(m.id, "p1", {
    type: "endTurn",
    version: g.state.version,
    actionId: randomUUID(),
  });
  const pending = result.state.match!;
  assert.ok(pending.pendingImpact);
  assert.equal(pending.responseDeadline, now + 20_000);
  now += 10_000;
  await store.touch("p1", now);
  await store.touch("p2", now);
  const final = await service().command(m.id, "p2", {
    type: "respondDodge",
    dodge: true,
    version: pending.version,
    actionId: randomUUID(),
  });
  assert.equal(final.state.match!.pendingImpact, undefined);
  assert.equal(final.state.match!.turn, 5);
  assert.equal(final.state.match!.deadline, now + TURN_MS);
  assert.equal(final.state.match!.ongoingSpells![0].rounds, 1);
});

test("janela do Jato seguida de desvio recebe novo prazo e preserva o tempo do turno", async () => {
  let now = 1_000_000;
  const g = game(),
    store = new MemoryDurableStore();
  slot(g, "p2:front:1").card = card("026", "p2");
  const spell = card("001", "p1", {
    alvo: "TodasTropasInimigas",
    elemento: "Fogo",
    efeitos: [{ id: "damage", valor: 4 }],
  });
  g.player("p1").hand = [spell];
  g.player("p2").hand = [card("002", "p2")];
  const cartas = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const service = () =>
    new DurableGame(
      store,
      () => now,
      async () =>
        ({ deck: { nome: "Teste", mago: "108", cartas }, catalog }) as any,
      async () => {},
    );
  await service().join("p1", "p1", "deck", randomUUID());
  await service().join("p2", "p2", "deck", randomUUID());
  const match = (await service().state("p1")).match!,
    room = store.rooms.get(match.id)!;
  room.game = g.exportState();
  room.deadline = now + 80_000;
  const a = await service().command(match.id, "p1", {
    type: "play",
    cardId: spell.id,
    version: g.state.version,
    actionId: randomUUID(),
  });
  assert.ok(a.state.match!.pendingSpell);
  now += 10_000;
  await store.touch("p1", now);
  await store.touch("p2", now);
  const b = await service().command(match.id, "p2", {
    type: "respondSpell",
    version: a.state.match!.version,
    actionId: randomUUID(),
  });
  assert.ok(b.state.match!.pendingImpact);
  assert.equal(b.state.match!.responseDeadline, now + 20_000);
  now += 5_000;
  await store.touch("p1", now);
  await store.touch("p2", now);
  const c = await service().command(match.id, "p2", {
    type: "respondDodge",
    dodge: true,
    version: b.state.match!.version,
    actionId: randomUUID(),
  });
  assert.equal(c.state.match!.pendingImpact, undefined);
  assert.equal(c.state.match!.deadline, now + 80_000);
  assert.equal(c.state.match!.players[0].counters.spells, 1);
});

test("Pedregulhos permite a cada Golém desviar do feitiço inteiro, independentemente da ordem", () => {
  for (const columns of [
    [0, 1],
    [2, 0],
  ]) {
    let g = game();
    for (const column of columns)
      slot(g, "p2:front:" + column).card = card("026", "p2");
    const spell = card("003", "p1"),
      hpMage = g.player("p2").mage.hpAtual;
    cast(g, spell);
    const chosen = new Set<string>();
    for (let i = 0; g.state.pendingImpact && i < 6; i++) {
      const request = g.state.pendingImpact.request;
      assert(
        !chosen.has(request.cardId),
        "Não deve pedir novamente para o mesmo Golém",
      );
      chosen.add(request.cardId);
      g = restored(g);
      act(g, { type: "respondDodge", dodge: true }, "p2");
    }
    assert.equal(chosen.size, 2);
    assert.equal(g.state.pendingImpact, undefined);
    for (const column of columns) {
      const troop = slot(g, "p2:front:" + column).card!;
      assert.equal(troop.hpAtual, 15);
      assert.equal(troop.dodgedRound, 3);
      assert.equal(troop.statuses.length, 0);
    }
    assert.equal(g.player("p2").mage.hpAtual, hpMage);
    assert.equal(g.player("p1").mana, 15);
    assert.equal(g.player("p1").counters.spells, 1);
  }
});
test("Pedregulhos não transfere a escolha entre Goléns, mantém os demais alvos e consome escudo por pedra", () => {
  for (const acceptFirst of [true, false]) {
    let g = game();
    for (const column of [0, 1])
      slot(g, "p2:front:" + column).card = card("026", "p2");
    cast(g, card("003", "p1"));
    const first = g.state.pendingImpact!.request.cardId;
    act(g, { type: "respondDodge", dodge: acceptFirst }, "p2");
    assert(g.state.pendingImpact);
    assert.notEqual(g.state.pendingImpact.request.cardId, first);
    g = restored(g);
    act(g, { type: "respondDodge", dodge: !acceptFirst }, "p2");
    assert.equal(g.state.pendingImpact, undefined);
    const a = slot(g, "p2:front:0").card!,
      b = slot(g, "p2:front:1").card!;
    assert.equal(a.hpAtual, acceptFirst ? 15 : 9);
    assert.equal(b.hpAtual, acceptFirst ? 11 : 15);
    assert.equal(a.dodgedRound, acceptFirst ? 3 : undefined);
    assert.equal(b.dodgedRound, acceptFirst ? undefined : 3);
  }
  const g = game();
  slot(g, "p2:front:0").card = card("023", "p2", {
    hp: 30,
    resistencia: [],
    fraqueza: [],
  });
  applyStatus(slot(g, "p2:front:0").card!.statuses, "EscudoProtecao", 2, 3);
  cast(g, card("003", "p1"));
  const target = slot(g, "p2:front:0").card!;
  assert.equal(target.hpAtual, 28);
  assert(!target.statuses.some((s) => s.nome === "EscudoProtecao"));
});

test("Pedregulhos retoma escolhas salvas no formato anterior sem perder o desvio dos Goléns", () => {
  let g = game();
  for (const column of [0, 1])
    slot(g, "p2:front:" + column).card = card("026", "p2");
  cast(g, card("003", "p1"));
  const first = g.state.pendingImpact!.request.cardId;
  g.state.pendingImpact!.request.key = "1:" + first;
  act(g, { type: "respondDodge", dodge: true }, "p2");
  const second = g.state.pendingImpact!.request.cardId;
  g.state.pendingImpact!.decisions = { ["1:" + first]: true };
  g.state.pendingImpact!.request.key = "2:" + second;
  g = restored(g);
  act(g, { type: "respondDodge", dodge: true }, "p2");
  assert.equal(g.state.pendingImpact, undefined);
  for (const column of [0, 1])
    assert.equal(slot(g, "p2:front:" + column).card!.hpAtual, 15);
});

test("resposta de um menu antigo não pode decidir o desvio do próximo Golém", () => {
  const g = game();
  for (const column of [0, 1])
    slot(g, "p2:front:" + column).card = card("026", "p2");
  cast(g, card("003", "p1"));
  const first = g.state.pendingImpact!.request.key;
  act(g, { type: "respondDodge", dodge: true, choiceKey: first }, "p2");
  const second = g.state.pendingImpact!.request.key,
    before = g.exportState();
  assert.notEqual(first, second);
  assert.throws(
    () =>
      act(g, { type: "respondDodge", dodge: false, choiceKey: first }, "p2"),
    (e: any) => e.code === "STALE_CHOICE",
  );
  assert.deepEqual(g.exportState(), before);
  act(g, { type: "respondDodge", dodge: true, choiceKey: second }, "p2");
  assert.equal(g.state.pendingImpact, undefined);
  for (const column of [0, 1])
    assert.equal(slot(g, "p2:front:" + column).card!.hpAtual, 15);
});
