import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import type { Instance } from "../src/game/state";
import { Game } from "../src/game/engine";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { airCardPatch } from "../scripts/update-air-cards";
const catalog = raw.map((c) => cardSchema.parse(c));
function setup(limit = 2) {
  const cards = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const game = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: { nome: "Teste", mago: "108", cartas: cards },
    })),
    catalog,
    () => 0.8,
  );
  game.state.phase = "BATTLE";
  game.state.turn = 3;
  game.state.round = 3;
  game.state.current = "p1";
  game.player("p1").mage.limites[0].tropaAtacam = 6;
  const instance = (ownerId: string): Instance => {
    const card = cardSchema.parse({
      ...catalog.find((c) => c.numeroCatalogo === "021"),
      hp: 40,
      ataque: 2,
      fraqueza: [],
      resistencia: [],
      habilidadesAtivas: [],
      habilidadesPassivas:
        ownerId === "p1"
          ? [
              {
                gatilho: "continuous",
                escopo: "proprio",
                efeitos: [{ id: "attackLimit", valor: limit }],
              },
            ]
          : [],
    });
    return {
      ...card,
      id: randomUUID(),
      ownerId,
      hpAtual: 40,
      attacked: false,
      usedAbility: false,
      statuses: [],
    };
  };
  game.state.slots.find((s) => s.id === "p1:front:0")!.card = instance("p1");
  game.state.slots.find((s) => s.id === "p2:front:2")!.card = instance("p2");
  return game;
}
function command(game: Game, data: object) {
  return game.execute(game.state.current, {
    ...data,
    actionId: randomUUID(),
    version: game.state.version,
  });
}
const attack = { type: "attack", slotId: "p1:front:0", targetId: "p2:front:2" };
const troop = (game: Game) =>
  game.state.slots.find((s) => s.id === "p1:front:0")!.card!;
test("limite declarativo permite dois ataques, persiste o gasto e rejeita o terceiro sem alterar o estado", () => {
  let game = setup();
  command(game, attack);
  assert.equal(troop(game).attacksMade, 1);
  assert.ok(
    game.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.attackTargets!
      .card.length,
  );
  game = Game.restore(JSON.parse(JSON.stringify(game.exportState())));
  command(game, attack);
  assert.equal(troop(game).attacksMade, 2);
  assert.equal(game.player("p1").counters.attacks, 2);
  const before = JSON.stringify(game.exportState());
  assert.throws(() => command(game, attack), /Limite de ataque/);
  assert.equal(JSON.stringify(game.exportState()), before);
  command(game, { type: "endTurn" });
  command(game, { type: "endTurn" });
  assert.equal(troop(game).attacksMade, 0);
  command(game, attack);
});
test("ataques adicionais respeitam limite geral, incapacitação e bloqueio inicial", () => {
  const game = setup();
  game.player("p1").mage.limites[0].tropaAtacam = 1;
  command(game, attack);
  assert.throws(() => command(game, attack), /Limite de ataque/);
  const other = setup();
  troop(other).statuses = [{ nome: "Incapacitado", turnosRestantes: 1 }];
  assert.throws(() => command(other, attack), /incapacitada/);
  assert.equal(troop(other).attacksMade, undefined);
  troop(other).statuses = [];
  other.state.turn = 1;
  assert.throws(() => command(other, attack), /só é permitido mobilizar/);
});
test("passiva de limite é validada, persistida e exclusiva de tropas e gatilho contínuo", async () => {
  const card = troop(setup());
  assert.deepEqual(playableErrors(card), []);
  const {
    id,
    ownerId,
    hpAtual,
    attacked,
    usedAbility,
    statuses,
    ...definition
  } = card;
  const document = new CardModel(definition);
  await document.validate();
  const { _id, __v, ...stored } = document.toObject();
  assert.deepEqual(
    cardSchema.parse(stored).habilidadesPassivas,
    card.habilidadesPassivas,
  );
  assert.ok(
    playableErrors(cardSchema.parse({ ...definition, tipo: "Estrutura" }))
      .length,
  );
  assert.ok(
    playableErrors(
      cardSchema.parse({
        ...definition,
        habilidadesPassivas: [
          {
            gatilho: "onAttack",
            escopo: "proprio",
            efeitos: [{ id: "attackLimit", valor: 2 }],
          },
        ],
      }),
    ).length,
  );
});

function card(
  id: string,
  ownerId = "p1",
  extra: Record<string, unknown> = {},
): Instance {
  const data = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id),
    ...extra,
  });
  return {
    ...structuredClone(data),
    id: randomUUID(),
    ownerId,
    hpAtual: data.hp ?? 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
}
const position = (game: Game, id: string) =>
  game.state.slots.find((s) => s.id === id)!;
function ready() {
  const g = setup();
  for (const p of g.state.players) p.mana = 20;
  return g;
}
function airMage(g: Game) {
  const mage = card("019");
  g.player("p1").mage = mage;
  g.state.slots.find((s) => s.ownerId === "p1" && s.kind === "Mago")!.card =
    mage;
}
function cast(g: Game, id: string, targetId: string, destinationId?: string) {
  const spell = card(id);
  g.player("p1").hand.push(spell);
  command(g, {
    type: "play",
    cardId: spell.id,
    targets: [targetId],
    ...(destinationId ? { destinationId } : {}),
  });
  return spell;
}
test("as quatro cartas estão publicadas, executáveis e preservadas no banco", async () => {
  for (const id of ["043", "019", "057", "094"]) {
    const definition = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(definition.publicado, true);
    assert.deepEqual(playableErrors(definition), [], definition.nome);
    const document = new CardModel(definition);
    await document.validate();
    const { _id, __v, ...stored } = document.toObject();
    assert.deepEqual(cardSchema.parse(stored), definition);
  }
});
test("Beija-flor tem atributos finais, ataca duas vezes e reposiciona uma vez", () => {
  const g = ready();
  position(g, "p1:front:0").card = card("043");
  assert.equal(troop(g).hpAtual, 8);
  assert.equal(troop(g).manaGerada, 3);
  assert.equal(troop(g).direcaoAtaque, "Universal");
  command(g, attack);
  command(g, attack);
  assert.throws(() => command(g, attack), /Limite/);
  command(g, {
    type: "move",
    slotId: "p1:front:0",
    destinationId: "p1:front:1",
  });
  assert.throws(
    () =>
      command(g, {
        type: "move",
        slotId: "p1:front:1",
        destinationId: "p1:front:0",
      }),
    /movimento por turno/,
  );
});
test("Bater das Asas empurra um espaço e mantém montaria e ocupante na borda", () => {
  const g = ready();
  position(g, "p1:front:0").card = card("043");
  position(g, "p2:front:2").card = null;
  const target = card("074", "p2");
  const rider = card("021", "p2");
  position(g, "p2:front:1").card = target;
  position(g, "p2:front:1").rider = rider;
  const ability = (id: string) => ({
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "baterDasAsas",
    targets: [id],
  });
  command(g, ability(rider.id));
  assert.equal(position(g, "p2:front:1").card, null);
  assert.equal(position(g, "p2:front:2").card!.id, target.id);
  assert.equal(position(g, "p2:front:2").rider!.id, rider.id);
  assert.equal(g.player("p1").mana, 17);
  assert.ok(g.state.events?.some((e) => e.kind === "ability"));
  command(g, { type: "endTurn" });
  command(g, { type: "endTurn" });
  command(g, ability(target.id));
  assert.equal(position(g, "p2:front:2").card!.id, target.id);
  assert.equal(position(g, "p2:front:2").rider!.id, rider.id);
  assert.ok(
    !g.player("p2").hand.some((c) => [target.id, rider.id].includes(c.id)),
  );
  assert.equal(position(g, "p1:front:0").card!.usedAbility, true);
  assert.equal(g.player("p1").mana, 17);
});
test("empurrão rejeita espaço ocupado, estrutura, alvo mago e Lama sem gastar habilidade ou mana", () => {
  for (const kind of ["ocupado", "estrutura", "mago", "lama"]) {
    const g = ready();
    position(g, "p1:front:0").card = card("043");
    const target = card("020", "p2");
    position(g, "p2:front:1").card = target;
    position(g, "p2:front:2").card = null;
    if (kind === "ocupado") position(g, "p2:front:2").card = card("020", "p2");
    if (kind === "estrutura")
      position(g, "p2:front:1").structure = card("020", "p2", {
        tipo: "Estrutura",
        hp: 10,
      });
    if (kind === "lama")
      position(g, "p2:front:2").terrain = { nome: "Lama", rodadasRestantes: 2 };
    const before = JSON.stringify(g.exportState());
    assert.throws(() =>
      command(g, {
        type: "ability",
        slotId: "p1:front:0",
        abilityId: "baterDasAsas",
        targets: [kind === "mago" ? g.player("p2").mage.id : target.id],
      }),
    );
    assert.equal(JSON.stringify(g.exportState()), before, kind);
  }
});
test("deslocamento forçado aceita tropas cegas, congeladas e incapacitadas", () => {
  for (const name of ["Cego", "Congelado", "Incapacitado"]) {
    const g = ready();
    position(g, "p1:front:0").card = card("043");
    const target = position(g, "p2:front:2").card!;
    position(g, "p2:front:1").card = target;
    position(g, "p2:front:2").card = null;
    target.statuses = [{ nome: name, turnosRestantes: 2 }];
    command(g, {
      type: "ability",
      slotId: "p1:front:0",
      abilityId: "baterDasAsas",
      targets: [target.id],
    });
    assert.equal(position(g, "p2:front:2").card!.id, target.id);
    assert.ok(!g.player("p2").hand.some((c) => c.id === target.id));
  }
});
test("Esfera move para vizinho escolhido, leva ocupante e causa somente 2 de dano ao alvo", () => {
  const g = ready();
  const target = position(g, "p2:front:2").card!;
  const rider = card("021", "p2", { hp: 20, fraqueza: [], resistencia: [] });
  position(g, "p2:front:2").rider = rider;
  cast(g, "094", rider.id, "p2:front:1");
  assert.equal(position(g, "p2:front:2").card, null);
  assert.equal(position(g, "p2:front:1").card!.id, target.id);
  assert.equal(position(g, "p2:front:1").rider!.hpAtual, 18);
  assert.equal(position(g, "p2:front:1").card!.hpAtual, 40);
  assert.equal(g.player("p1").mana, 16);
});
test("Esfera atinge só estrutura com 5, não move nem exige vizinho livre, inclusive ao destruí-la", () => {
  for (const hp of [5, 20]) {
    const g = ready();
    const target = position(g, "p2:front:2").card!;
    const structure = card("020", "p2", {
      tipo: "Estrutura",
      hp,
      elemento: "Neutro",
      fraqueza: [],
      resistencia: [],
    });
    position(g, "p2:front:2").structure = structure;
    position(g, "p2:front:1").card = card("020", "p2");
    cast(g, "094", target.id);
    assert.equal(position(g, "p2:front:2").card!.id, target.id);
    assert.equal(position(g, "p2:front:2").card!.hpAtual, 40);
    if (hp === 5) {
      assert.equal(position(g, "p2:front:2").structure, null);
      assert.ok(g.player("p2").graveyard.some((c) => c.id === structure.id));
    } else assert.equal(position(g, "p2:front:2").structure!.hpAtual, 15);
  }
});
test("Esfera recusa destino não vizinho, ocupado ou aliado e reverte compra passiva", () => {
  for (const destination of ["p2:front:0", "p1:front:1", "p2:front:1"]) {
    const g = ready();
    airMage(g);
    position(g, "p2:front:1").card = card("020", "p2");
    const spell = card("094");
    g.player("p1").hand.push(spell);
    const before = JSON.stringify(g.exportState());
    assert.throws(() =>
      command(g, {
        type: "play",
        cardId: spell.id,
        targets: [position(g, "p2:front:2").card!.id],
        ...(destination ? { destinationId: destination } : {}),
      }),
    );
    assert.equal(JSON.stringify(g.exportState()), before);
  }
});
test("Mago de Ar compra só por feitiços próprios de Ar, sem buscar Lâmina por morte", () => {
  const g = ready();
  airMage(g);
  const hand = g.player("p1").hand.length;
  const beforeDeck = g.player("p1").deck.length;
  cast(g, "057", position(g, "p2:front:2").card!.id);
  assert.equal(g.player("p1").hand.length, hand + 1);
  assert.equal(g.player("p1").deck.length, beforeDeck - 1);
  assert.equal(g.player("p1").mana, 14);
  assert.ok(
    g.state.events?.some(
      (e) => e.kind === "passive" && e.card.id === g.player("p1").mage.id,
    ),
  );
  assert.equal(g.player("p1").mage.habilidadesPassivas.length, 1);
  const spell = card("057", "p1", { elemento: "Neutro" });
  g.player("p1").hand.push(spell);
  const count = g.player("p1").hand.length;
  command(g, {
    type: "play",
    cardId: spell.id,
    targets: [position(g, "p2:front:2").card!.id],
  });
  assert.equal(g.player("p1").hand.length, count - 1);
});
test("Mover livremente concede Campo livre até fim do turno, sem renovar movimento nem alterar palavras-chave", () => {
  const g = ready();
  airMage(g);
  troop(g).moved = true;
  const other = card("020");
  position(g, "p1:front:2").card = other;
  command(g, {
    type: "ability",
    slotId: g.state.slots.find((s) => s.ownerId === "p1" && s.kind === "Mago")!
      .id,
    abilityId: "moverLivremente",
    targets: [],
  });
  assert.equal(g.player("p1").mana, 17);
  assert.ok(troop(g).statuses.some((s) => s.nome === "Campo livre"));
  assert.equal(troop(g).palavrasChave.includes("Campo livre"), false);
  assert.throws(
    () =>
      command(g, {
        type: "move",
        slotId: "p1:front:0",
        destinationId: "p1:front:1",
      }),
    /movimento por turno/,
  );
  command(g, {
    type: "move",
    slotId: "p1:front:2",
    destinationId: "p1:front:1",
  });
  command(g, { type: "endTurn" });
  assert.ok(
    !position(g, "p1:front:1").card!.statuses.some(
      (s) => s.nome === "Campo livre",
    ),
  );
});
test("Lâmina custa 6 e aplica impedimento só na próxima rodada completa sem bloquear habilidades ou movimento", () => {
  let g = ready();
  const target = position(g, "p2:front:2").card!;
  target.elemento = "Terra";
  target.palavrasChave = ["Campo livre"];
  target.habilidadesAtivas = [
    {
      id: "curar",
      nome: "Curar",
      custoMana: 0,
      alvo: "UnicoAliado",
      alvoAutomatico: "Proprio",
      efeitos: [{ id: "heal", valor: 1 }],
    },
  ];
  cast(g, "057", target.id);
  assert.equal(g.player("p1").mana, 14);
  assert.equal(position(g, "p2:front:2").card!.hpAtual, 37);
  assert.equal(
    position(g, "p2:front:2").card!.statuses.some(
      (s) => s.nome === "SemAtaque",
    ),
    false,
  );
  assert.equal(position(g, "p2:front:2").card!.scheduledStatuses![0].round, 4);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  command(g, { type: "endTurn" });
  command(g, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
  command(g, { type: "endTurn" });
  command(g, { type: "endTurn" });
  assert.equal(g.state.round, 4);
  assert.throws(
    () =>
      command(g, {
        type: "attack",
        slotId: "p2:front:2",
        targetId: "p1:front:0",
      }),
    /incapacitada/,
  );
  command(g, {
    type: "ability",
    slotId: "p2:front:2",
    abilityId: "curar",
    targets: [],
  });
  command(g, {
    type: "move",
    slotId: "p2:front:2",
    destinationId: "p2:front:1",
  });
  command(g, { type: "endTurn" });
  command(g, { type: "endTurn" });
  assert.equal(g.state.round, 5);
  assert.ok(
    !position(g, "p2:front:1").card!.statuses.some(
      (s) => s.nome === "SemAtaque",
    ),
  );
});
test("Lâmina não bloqueia tropa de outro elemento e rejeita mago Terra", () => {
  for (const mage of [false, true]) {
    const g = ready();
    const target = mage ? g.player("p2").mage : position(g, "p2:front:2").card!;
    target.elemento = mage ? "Terra" : "Ar";
    if (mage) assert.throws(() => cast(g, "057", target.id), /Tipo de alvo/);
    else cast(g, "057", target.id);
    assert.equal(
      (mage ? g.player("p2").mage : position(g, "p2:front:2").card!)
        .scheduledStatuses,
      undefined,
    );
  }
});

test("atualização das quatro cartas preserva imagem e versão, remove passivas antigas e é idempotente", () => {
  for (const id of ["019", "043", "057", "094"]) {
    const original = structuredClone(
      catalog.find((c) => c.numeroCatalogo === id)!,
    );
    const record = {
      ...original,
      imgURL: "/assets/custom.png",
      versao: 17,
      publicado: false,
      descricao: "antiga",
      habilidadesPassivas: [],
      habilidadesAtivas: [],
      ...(original.tipo === "Feitico"
        ? { alvoAutomatico: "UltimoAtacanteTropa" as const }
        : {}),
    };
    const plan = airCardPatch(record);
    assert.ok(Object.keys(plan.patch).length);
    assert.equal(plan.version, 17);
    assert.equal(
      Object.prototype.hasOwnProperty.call(plan.patch, "imgURL"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(plan.patch, "versao"),
      false,
    );
    const after: Record<string, unknown> = { ...record, ...plan.patch };
    for (const key of Object.keys(plan.unset)) delete after[key];
    const again = airCardPatch(after);
    assert.deepEqual(again.patch, {});
    assert.deepEqual(again.unset, {});
    assert.equal(after.imgURL, record.imgURL);
    assert.equal(after.versao, 17);
  }
  assert.throws(() => airCardPatch({ ...catalog[0] }));
});

test("atualização de equilíbrio altera só as duas cartas e preserva metadados administrativos", async () => {
  const { openingAirCardPatch } =
    await import("../scripts/update-opening-air-cards");
  for (const id of ["043", "057"]) {
    const original = catalog.find((c) => c.numeroCatalogo === id)!;
    const record = {
      ...structuredClone(original),
      imgURL: "/custom.png",
      versao: 25,
      publicado: false,
      custoMana: 11,
      descricao: "anterior",
      ...(id === "043"
        ? { habilidadesAtivas: [] }
        : {
            tiposAlvo: ["Tropa", "Mago"],
            efeitos: [{ id: "damage", valor: 5 }],
          }),
    };
    const plan = openingAirCardPatch(record);
    const result = { ...record, ...plan.patch };
    assert.equal(result.imgURL, "/custom.png");
    assert.equal(result.custoMana, 11);
    assert.equal(result.publicado, false);
    assert.equal(result.versao, 25);
    assert.deepEqual(openingAirCardPatch(result).patch, {});
  }
  assert.throws(
    () => openingAirCardPatch(catalog.find((c) => c.numeroCatalogo === "019")!),
    /fora/,
  );
});
