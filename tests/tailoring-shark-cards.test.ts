import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import type { Instance } from "../src/game/state";
import { Game } from "../src/game/engine";
import { currentBasicAttack } from "../src/game/passives";
import { playableErrors } from "../src/game/capabilities";
import { tailoringSharkPatch } from "../scripts/update-tailoring-shark-cards";
import CardModel from "../src/db/models/Card";
const catalog = raw.map((c) => cardSchema.parse(c));
function setup(mage = "016", roll = 0.4) {
  const refs = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    [
      { id: "p", nome: "P", deck: { nome: "P", mago: mage, cartas: refs } },
      { id: "q", nome: "Q", deck: { nome: "Q", mago: "016", cartas: refs } },
    ],
    catalog,
    () => roll,
  );
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.current = "p";
  for (const p of g.state.players) {
    p.hand = [];
    p.mana = 20;
    p.preparation.ready = true;
  }
  const card = (
    ref: string,
    owner = "p",
    over: Partial<Instance> = {},
  ): Instance => {
    const c = catalog.find((c) => c.numeroCatalogo === ref)!;
    return {
      ...structuredClone(c),
      id: randomUUID(),
      ownerId: owner,
      hpAtual: c.hp ?? 0,
      attacked: false,
      usedAbility: false,
      statuses: [],
      ...over,
    };
  };
  const slot = (owner: string, column: number) =>
    g.state.slots.find((s) => s.id === owner + ":front:" + column)!;
  const place = (
    ref: string,
    owner = "p",
    column = 0,
    over: Partial<Instance> = {},
  ) => {
    const c = card(ref, owner, over);
    slot(owner, column).card = c;
    return c;
  };
  const run = (cmd: Record<string, unknown>, owner = g.state.current) =>
    g.execute(owner, {
      ...cmd,
      version: g.state.version,
      actionId: randomUUID(),
    });
  const play = (ref: string, extra: Record<string, unknown> = {}) => {
    const c = card(ref, g.state.current);
    g.player(g.state.current).hand.push(c);
    run({ type: "play", cardId: c.id, ...extra });
    return c;
  };
  const attack = (owner = "p", column = 0, target = "q:front:2") =>
    run(
      { type: "attack", slotId: owner + ":front:" + column, targetId: target },
      owner,
    );
  const pass = () => run({ type: "endTurn" });
  const live = (c: Instance) =>
    g.state.slots
      .flatMap((s) => [s.card, s.rider, s.structure])
      .find((x) => x?.id === c.id)!;
  return { g, card, slot, place, run, play, attack, pass, live };
}

test("Costureira e Tubarão são executáveis, persistem e migram preservando arte", async () => {
  for (const id of ["137", "138"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.deepEqual(playableErrors(c), []);
    const doc = new CardModel(c);
    await doc.validate();
    const { _id, __v, ...obj } = doc.toObject() as any;
    assert.deepEqual(cardSchema.parse(obj), c);
    const patch = tailoringSharkPatch({
      ...c,
      imgURL: "/avatars/existing.webp",
      habilidadesAtivas: [],
      habilidadesPassivas: [],
      publicado: false,
      versao: 7,
    });
    assert.equal(patch.patch.publicado, true);
    assert.equal(patch.patch.imgURL, undefined);
  }
});
test("desconto de feitiços acumula, respeita dono e zero e desaparece ao sair do campo", () => {
  const b = setup();
  b.place("138");
  const second = b.place("138", "p", 1);
  const own = b.card("097"),
    enemy = b.card("097", "q"),
    free = b.card("039");
  b.g.player("p").hand = [own, free];
  b.g.player("q").hand = [enemy];
  assert.equal(
    b.g
      .snapshot("p")
      .players.find((p: any) => p.id === "p")!
      .hand!.find((c: any) => c.id === own.id)!.custoMana,
    2,
  );
  assert.equal(
    b.g
      .snapshot("p")
      .players.find((p: any) => p.id === "p")!
      .hand!.find((c: any) => c.id === free.id)!.custoMana,
    0,
  );
  assert.equal(
    b.g.snapshot("q").players.find((p: any) => p.id === "q")!.hand![0]
      .custoMana,
    4,
  );
  second.statuses = [{ nome: "Congelado", turnosRestantes: 2 }];
  assert.equal(
    b.g.snapshot("p").players.find((p: any) => p.id === "p")!.hand![0]
      .custoMana,
    2,
  );
  b.slot("p", 1).card = null;
  b.run({ type: "play", cardId: own.id, targets: [] });
  assert.equal(b.g.player("p").mana, 17);
});
test("Ponto Cruz causa dano e Sangramento só em tropas inimigas e respeita Torre", () => {
  const b = setup();
  b.place("138");
  const a = b.place("020", "q", 0, {
    hp: 20,
    hpAtual: 20,
    resistencia: [],
    fraqueza: [],
  });
  const protectedTroop = b.place("020", "q", 1, {
    resistencia: [],
    fraqueza: [],
  });
  b.slot("q", 1).structure = b.card("056", "q");
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "pontoCruz",
    targets: [],
  });
  assert.equal(b.live(a).hpAtual, 19);
  assert.equal(
    b.live(a).statuses.find((s) => s.nome === "Sangrando")?.turnosRestantes,
    3,
  );
  assert.equal(
    b.live(protectedTroop).statuses.some((s) => s.nome === "Sangrando"),
    false,
  );
  assert.equal(b.slot("q", 1).structure!.hpAtual, 9);
  assert.equal(b.g.player("q").mage.hpAtual, 20);
  assert.equal(b.g.player("p").mana, 17);
  b.pass();
  assert.equal(b.live(a).hpAtual, 19);
  b.pass();
  assert.equal(b.live(a).hpAtual, 18);
});
test("Mordida usa ataque e arma, ganha bônus contra Sangramento e não consome ataque", () => {
  const b = setup();
  const shark = b.place("137", "p", 0, { attacked: true, attacksMade: 1 });
  b.g.state.slots.find((s) => s.id === "p:arm:front-left")!.card =
    b.card("037");
  const target = b.place("020", "q", 2, {
    hp: 20,
    hpAtual: 20,
    resistencia: [],
    fraqueza: [],
    statuses: [{ nome: "Sangrando", turnosRestantes: 3 }],
  });
  b.g.player("p").counters.attacks = 2;
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "mordida",
    targets: [],
  });
  assert.equal(b.live(target).hpAtual, 14);
  assert.equal(
    b.live(target).statuses.find((s) => s.nome === "Incapacitado")
      ?.turnosRestantes,
    1,
  );
  assert.equal(b.live(shark).attacksMade, 1);
  assert.equal(b.g.player("p").counters.attacks, 2);
  assert.equal(b.live(shark).usedAbility, true);
  assert.equal(b.g.player("p").mana, 15);
});
test("bônus do Tubarão só se aplica ao alvo com Sangramento e também vale no ataque básico", () => {
  for (const bleeding of [true, false]) {
    const b = setup();
    b.place("137");
    const target = b.place("020", "q", 2, {
      hp: 20,
      hpAtual: 20,
      resistencia: [],
      fraqueza: [],
      statuses: bleeding ? [{ nome: "Sangrando", turnosRestantes: 3 }] : [],
    });
    assert.equal(currentBasicAttack(b.slot("p", 0).card!, b.g.state.slots), 2);
    b.attack();
    assert.equal(b.live(target).hpAtual, bleeding ? 16 : 18);
  }
});
test("Mordida respeita estrutura e protege do Incapacitado", () => {
  const b = setup();
  b.place("137");
  const target = b.place("020", "q", 2);
  b.slot("q", 2).structure = b.card("056", "q");
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "mordida",
    targets: [],
  });
  assert.equal(
    b.live(target).statuses.some((s) => s.nome === "Incapacitado"),
    false,
  );
  assert.equal(b.slot("q", 2).structure!.hpAtual, 8);
});
test("Marionete usa arma inimiga e gasta ataque da controlada sem alterar contadores dos magos", () => {
  const b = setup();
  const tailor = b.place("138");
  const actor = b.place("020", "q", 2, {
    ataque: 3,
    resistencia: [],
    fraqueza: [],
  });
  b.g.state.slots.find((s) => s.id === "q:arm:front-right")!.card = b.card(
    "037",
    "q",
  );
  const victim = b.place("020", "q", 1, {
    hp: 20,
    hpAtual: 20,
    resistencia: [],
    fraqueza: [],
  });
  b.g.player("p").counters.attacks = 1;
  b.g.player("q").counters.attacks = 2;
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "marionete",
    targets: [victim.id],
  });
  assert.equal(b.live(victim).hpAtual, 15);
  assert.equal(b.live(actor).attacksMade, 1);
  assert.equal(b.live(actor).attacked, true);
  assert.equal(b.live(tailor).attacked, false);
  assert.equal(b.live(tailor).usedAbility, true);
  assert.equal(b.g.player("p").counters.attacks, 1);
  assert.equal(b.g.player("q").counters.attacks, 2);
});
test("Marionete rejeita alvo distante, própria tropa e controlada indisponível sem cobrar mana", () => {
  for (const mode of [
    "far",
    "own",
    "Atordoado",
    "Congelado",
    "Incapacitado",
    "spent",
    "absent",
  ]) {
    const b = setup();
    b.place("138");
    const actor = b.place("020", "q", 2);
    const victim = b.place("020", "q", mode === "far" ? 0 : 1);
    if (["Atordoado", "Congelado", "Incapacitado"].includes(mode))
      actor.statuses = [{ nome: mode, turnosRestantes: 2 }];
    if (mode === "spent") actor.attacked = true;
    if (mode === "absent") b.slot("q", 2).card = null;
    const before = JSON.stringify(b.g.exportState());
    assert.throws(() =>
      b.run({
        type: "ability",
        slotId: "p:front:0",
        abilityId: "marionete",
        targets: [mode === "own" ? b.slot("p", 0).card!.id : victim.id],
      }),
    );
    assert.equal(JSON.stringify(b.g.exportState()), before, mode);
  }
});
test("Marionete pode errar por Cego e ainda consome o ataque controlado", () => {
  const b = setup();
  b.place("138");
  const actor = b.place("020", "q", 2, {
    statuses: [{ nome: "Cego", turnosRestantes: 2 }],
  });
  const victim = b.place("020", "q", 1);
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "marionete",
    targets: [victim.id],
  });
  assert.equal(b.live(victim).hpAtual, victim.hp);
  assert.equal(b.live(actor).attacked, true);
  assert.ok(b.g.state.events?.some((e) => e.kind === "miss"));
});

test("Marionete e Mordida mantêm uma escolha de desvio e não reaplicam dano ou status", () => {
  for (const ability of ["marionete", "mordida"]) {
    const b = setup();
    const source = b.place(ability === "marionete" ? "138" : "137");
    const golem = b.place("026", "q", 2);
    const victim = ability === "marionete" ? b.place("020", "q", 1) : golem;
    b.run({
      type: "ability",
      slotId: "p:front:0",
      abilityId: ability,
      targets: ability === "marionete" ? [victim.id] : [],
    });
    assert.equal(b.g.state.pendingImpact?.request.cardId, golem.id);
    b.run(
      {
        type: "respondDodge",
        dodge: true,
        choiceKey: b.g.state.pendingImpact!.request.key,
      },
      "q",
    );
    assert.equal(b.live(victim).hpAtual, victim.hp);
    assert.equal(
      b.live(golem).statuses.some((s) => s.nome === "Incapacitado"),
      false,
    );
    assert.equal(b.g.player("p").mana, 15);
    assert.equal(b.live(source).usedAbility, true);
    assert.equal(b.live(source).attacked, false);
  }
});
test("golpe e bônus de status funcionam em outra carta sem depender do número de catálogo", () => {
  const b = setup();
  const c = b.place("020", "p", 0, {
    ataque: 4,
    habilidadesAtivas: [
      {
        id: "outraMordida",
        nome: "Golpe genérico",
        custoMana: 2,
        alvo: "UnicoInimigo",
        efeitos: [
          {
            id: "basicStrike",
            ataque: { origem: "fonte", consumirUso: false },
          },
        ],
      },
    ],
    habilidadesPassivas: [
      {
        gatilho: "continuous",
        escopo: "proprio",
        filtroAlvo: { status: "Sangrando" },
        efeitos: [{ id: "attackBonus", valor: 3 }],
      },
    ],
  });
  const target = b.place("020", "q", 2, {
    hp: 20,
    hpAtual: 20,
    resistencia: [],
    fraqueza: [],
    statuses: [{ nome: "Sangrando", turnosRestantes: 3 }],
  });
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "outraMordida",
    targets: [target.id],
  });
  assert.equal(b.live(target).hpAtual, 13);
  assert.equal(b.live(c).attacked, false);
});
