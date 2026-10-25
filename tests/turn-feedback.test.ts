import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import raw from "../src/data/catalog.json";
import { Game } from "../src/game/engine";
import { cardSchema, type Card } from "../src/types/card";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
const catalog = raw.map((c) => cardSchema.parse(c));
function instance(
  id: string,
  ownerId = "p1",
  extra: Partial<Card> = {},
): Instance {
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
function make(preparation = false) {
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
  if (!preparation)
    Object.assign(g.state, {
      phase: "BATTLE",
      turn: 3,
      round: 2,
      current: "p1",
    });
  for (const p of g.state.players) {
    p.mana = 20;
    p.hand = [];
    p.mage.habilidadesPassivas = [];
    p.mage.limites[0].tropaAtacam = 10;
    p.mage.limites[0].feiticosUsados = 20;
    p.mage.limites[0].tropasMobilizadas = 4;
  }
  return g;
}
const slot = (g: Game, id: string) => g.state.slots.find((s) => s.id === id)!;
const act = (g: Game, c: object, user = g.state.current) =>
  g.execute(user, { ...c, actionId: randomUUID(), version: g.state.version });
function troop(g: Game, id: string, number = "023") {
  const c = instance(
    number,
    id.startsWith("p1") ? "p1" : "p2",
    number === "023"
      ? {
          hp: 30,
          ataque: 2,
          elemento: "Neutro",
          fraqueza: [],
          resistencia: [],
          habilidadesAtivas: [],
          habilidadesPassivas: [],
        }
      : {},
  );
  slot(g, id).card = c;
  return c;
}
function mage(g: Game, id: string) {
  g.player("p1").mage = instance(id);
  slot(g, "p1:mage").card = g.player("p1").mage;
  g.player("p1").mage.habilidadesPassivas = [];
  g.player("p1").mage.limites[0].feiticosUsados = 20;
}
function cast(
  g: Game,
  id: string,
  targets: string[] = [],
  extra: Partial<Card> = {},
) {
  const c = instance(id, g.state.current, extra);
  g.player(c.ownerId).hand.push(c);
  act(g, { type: "play", cardId: c.id, targets });
  return c.id;
}
const cycle = (g: Game) => {
  act(g, { type: "endTurn" });
  act(g, { type: "endTurn" });
};
test("Vórtice causa dano sem movimento quando todos os vizinhos estão ocupados ou com Lama", () => {
  for (const terrain of [false, true]) {
    const g = make();
    const t = troop(g, "p2:front:1");
    troop(g, "p2:front:0");
    if (terrain)
      slot(g, "p2:front:2").terrain = { nome: "Lama", rodadasRestantes: 2 };
    else troop(g, "p2:front:2");
    cast(g, "094", [t.id]);
    assert.equal(slot(g, "p2:front:1").card!.id, t.id);
    assert.equal(slot(g, "p2:front:1").card!.hpAtual, 28);
  }
  const h = make(),
    t = troop(h, "p2:front:1");
  assert.throws(() => cast(h, "094", [t.id]), /vizinho/);
});
test("Golém recebe cura, bônus e habilidades de aliados sem abrir desvio nem gastar espera", () => {
  const g = make();
  const golem = troop(g, "p1:front:0", "026");
  golem.hpAtual = 7;
  cast(g, "002", [golem.id], {
    elemento: "Neutro",
    alvo: "UnicoAliado",
    efeitos: [{ id: "heal", valor: 3 }],
  });
  assert.equal(g.state.pendingImpact, undefined);
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 10);
  assert.equal(slot(g, "p1:front:0").card!.dodgedRound, undefined);
  mage(g, "019");
  act(g, {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "moverLivremente",
    targets: [],
  });
  assert.equal(g.state.pendingImpact, undefined);
  assert.ok(
    slot(g, "p1:front:0").card!.statuses.some(
      (s) => s.nome === "Campo livre" && s.trocaAliada,
    ),
  );
  slot(g, "p1:mage").card!.usedAbility = false;
  slot(g, "p1:mage").card!.habilidadesAtivas = [
    {
      id: "curar",
      nome: "Curar aliado",
      custoMana: 0,
      alvo: "UnicoAliado",
      efeitos: [{ id: "heal", valor: 2 }],
    },
  ];
  act(g, {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "curar",
    targets: [golem.id],
  });
  assert.equal(g.state.pendingImpact, undefined);
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 12);
});
test("Golém continua podendo desviar de status e habilidades inimigas", () => {
  const g = make();
  const t = troop(g, "p2:front:1", "026");
  cast(g, "001", [t.id], {
    elemento: "Neutro",
    alvo: "UnicoInimigo",
    efeitos: [{ id: "status", status: "Cego", duracao: 1 }],
  });
  assert.equal(g.state.pendingImpact?.request.cardId, t.id);
  act(g, { type: "respondDodge", dodge: true }, "p2");
  assert.equal(slot(g, "p2:front:1").card!.statuses.length, 0);
});
test("Mover livremente troca duas tropas, gasta ambos os movimentos e mantém estruturas nos espaços", () => {
  let g = make();
  mage(g, "019");
  const a = troop(g, "p1:front:0"),
    b = troop(g, "p1:front:2");
  troop(g, "p1:front:1");
  slot(g, "p1:front:0").structure = instance("023", "p1", {
    tipo: "Estrutura",
  });
  const structure = slot(g, "p1:front:0").structure!.id;
  act(g, {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "moverLivremente",
    targets: [],
  });
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  act(g, { type: "move", slotId: "p1:front:0", destinationId: "p1:front:2" });
  assert.equal(slot(g, "p1:front:0").card!.id, b.id);
  assert.equal(slot(g, "p1:front:2").card!.id, a.id);
  assert.equal(slot(g, "p1:front:0").structure!.id, structure);
  assert.ok(
    slot(g, "p1:front:0").card!.moved && slot(g, "p1:front:2").card!.moved,
  );
  assert.throws(
    () =>
      act(g, {
        type: "move",
        slotId: "p1:front:1",
        destinationId: "p1:front:0",
      }),
    /uma vez/,
  );
});
test("troca em combate continua proibida por Lama, status e Campo livre sem permissão de troca", () => {
  for (const why of ["lama", "status", "normal"]) {
    const g = make();
    const a = troop(g, "p1:front:0");
    troop(g, "p1:front:1");
    a.statuses = [
      {
        nome: "Campo livre",
        turnosRestantes: 1,
        trocaAliada: why !== "normal",
      },
    ];
    if (why === "lama")
      slot(g, "p1:front:1").terrain = { nome: "Lama", rodadasRestantes: 1 };
    if (why === "status")
      slot(g, "p1:front:1").card!.statuses = [
        { nome: "Cego", turnosRestantes: 1 },
      ];
    assert.throws(() =>
      act(g, {
        type: "move",
        slotId: "p1:front:0",
        destinationId: "p1:front:1",
      }),
    );
  }
});
test("preparação permite trocar e retirar grupos montados, liberando mobilizações sem ganhar mana", () => {
  const g = make(true);
  const a = troop(g, "p1:front:0"),
    b = troop(g, "p1:front:2");
  slot(g, "p1:front:0").rider = instance("022");
  g.player("p1").counters.summons = 3;
  act(
    g,
    { type: "move", slotId: "p1:front:0", destinationId: "p1:front:2" },
    "p1",
  );
  assert.equal(slot(g, "p1:front:0").card!.id, b.id);
  assert.equal(slot(g, "p1:front:2").card!.id, a.id);
  act(g, { type: "withdrawPreparation", slotId: "p1:front:2" }, "p1");
  assert.equal(slot(g, "p1:front:2").card, null);
  assert.equal(g.player("p1").hand.length, 2);
  assert.equal(g.player("p1").counters.summons, 1);
  assert.equal(g.player("p1").mana, 20);
  const replacement = instance("023");
  g.player("p1").hand.push(replacement);
  act(g, { type: "play", cardId: replacement.id, slotId: "p1:front:2" }, "p1");
  assert.equal(slot(g, "p1:front:2").card!.id, replacement.id);
  g.player("p1").preparation.ready = true;
  assert.throws(
    () => act(g, { type: "withdrawPreparation", slotId: "p1:front:2" }, "p1"),
    /confirmou/,
  );
  const h = make();
  troop(h, "p1:front:0");
  assert.throws(
    () => act(h, { type: "withdrawPreparation", slotId: "p1:front:0" }),
    /preparação/,
  );
});
test("compra no início do turno emite transferência privada sem revelar carta a inimigo ou espectador", () => {
  const g = make();
  const secret = g.player("p2").deck.at(-1)!;
  const command = {
    type: "endTurn",
    actionId: randomUUID(),
    version: g.state.version,
  };
  g.execute("p1", command);
  const own = g.snapshot("p2").events.filter((e) => e.kind === "draw");
  assert.equal(own.length, 1);
  assert.equal(own[0].card.id, secret.id);
  for (const snapshot of [g.snapshot("p1"), g.spectatorSnapshot()]) {
    const event = snapshot.events.find((e) => e.kind === "draw")!;
    assert.notEqual(event.card.id, secret.id);
    assert.equal(event.card.nome, "Carta comprada");
    assert.match(event.card.imgURL!, /^\/assets\/card-backs\//);
    assert.equal(event.movement?.from, "deck");
    assert.equal(event.movement?.to, "hand");
  }
  const n = g.state.events!.length;
  assert.equal(g.execute("p1", command).duplicate, true);
  assert.equal(g.state.events!.length, n);
});
test("uso de feitiço e morte registram origem e cemitério corretos", () => {
  const g = make();
  const target = troop(g, "p2:front:2");
  target.hpAtual = 1;
  const id = cast(g, "057", [target.id]);
  const events = g
    .snapshot("p1")
    .events.filter((e) => e.kind === "zoneTransfer");
  assert.equal(events.find((e) => e.card.id === id)!.movement!.from, "hand");
  const dead = events.find((e) => e.card.id === target.id)!;
  assert.equal(dead.movement!.from, "field");
  assert.equal(dead.movement!.fromSlotId, "p2:front:2");
  assert.equal(dead.movement!.toOwnerId, "p2");
});
test("Bola de Luz mantém Cego e aplica Queimado 1 por dois ciclos somente nos inimigos", () => {
  for (const element of [
    "Neutro",
    "Ar",
    "Fogo",
    "Agua",
    "Terra",
    "Zarcos",
  ] as const) {
    const g = make();
    g.player("p1").mage.elemento = element;
    troop(g, "p1:front:0");
    troop(g, "p2:front:2");
    const hp = g.player("p2").mage.hpAtual;
    cast(g, "008");
    for (const c of [slot(g, "p2:front:2").card!, g.player("p2").mage]) {
      assert.ok(c.statuses.some((s) => s.nome === "Cego"));
      const burn = c.statuses.find((s) => s.nome === "Queimado")!;
      assert.equal(burn.valor, 1);
      assert.equal(burn.turnosRestantes, 2);
    }
    assert.equal(slot(g, "p1:front:0").card!.statuses.length, 0);
    assert.equal(g.player("p1").mage.statuses.length, 0);
    cycle(g);
    assert.equal(
      g.player("p2").mage.hpAtual,
      hp - (element === "Fogo" ? 3 : 0) - 1,
    );
    cycle(g);
    assert.equal(
      g.player("p2").mage.hpAtual,
      hp - (element === "Fogo" ? 3 : 0) - 2,
    );
    assert.ok(!g.player("p2").mage.statuses.some((s) => s.nome === "Queimado"));
  }
});
test("Furacão com Ar rouba do inimigo além da compra da passiva, e outros magos não roubam", () => {
  for (const air of [true, false]) {
    const g = make();
    if (air) {
      mage(g, "019");
      g.player("p1").mage.habilidadesPassivas = catalog.find(
        (c) => c.numeroCatalogo === "019",
      )!.habilidadesPassivas;
    }
    troop(g, "p2:front:2");
    const stolen = g.player("p2").deck.at(-1)!,
      before = g.player("p2").deck.length;
    cast(g, "009");
    assert.equal(g.player("p2").deck.length, before - (air ? 1 : 0));
    assert.equal(g.player("p1").hand.length, air ? 2 : 0);
    if (air)
      assert.equal(
        g.player("p1").hand.find((c) => c.id === stolen.id)!.ownerId,
        "p1",
      );
  }
});
test("novos parâmetros genéricos são válidos e preservados no banco", () => {
  for (const id of ["008", "009", "019", "094"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.deepEqual(playableErrors(c), []);
    const doc = new CardModel(c);
    assert.equal(doc.validateSync(), undefined);
    const { _id, __v, ...saved } = doc.toObject();
    assert.deepEqual(cardSchema.parse(saved), c);
  }
});
test("animação reutiliza posições anteriores, limpa elementos e respeita movimento reduzido", async () => {
  const dom = new JSDOM(
    "<body><div data-card-zone='deck' data-zone-owner='p1'></div><div data-card-zone='hand' data-zone-owner='p1'></div><div data-card-zone='graveyard' data-zone-owner='p1'></div><div data-live-card-id='card'></div></body>",
    { pretendToBeVisual: true },
  );
  const doc = dom.window.document;
  for (const node of [...doc.querySelectorAll("div")])
    node.getBoundingClientRect = () =>
      ({
        left: 20,
        top: 50,
        width: 80,
        height: 100,
        right: 100,
        bottom: 150,
        x: 20,
        y: 50,
        toJSON() {},
      }) as DOMRect;
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: true }),
  });
  const path = "../public/JS/card-transfers.js";
  const { createCardTransfers } = await import(path);
  const effects = createCardTransfers(doc.body);
  effects.capture();
  doc.querySelector("[data-live-card-id]")!.remove();
  effects.show({
    card: { id: "card", imgURL: "/assets/card-backs/common.png" },
    movement: {
      from: "hand",
      to: "graveyard",
      fromOwnerId: "p1",
      toOwnerId: "p1",
    },
  });
  assert.ok(doc.querySelector(".card-transfer--still"));
  assert.equal(
    doc.querySelector(".card-transfer")!.getAttribute("data-transfer"),
    "graveyard",
  );
  effects.reset();
  assert.equal(doc.querySelector(".card-transfer"), null);
  effects.close();
  assert.equal(doc.querySelector(".card-transfer-layer"), null);
  dom.window.close();
});

test("migração de Ar preserva custos de habilidades, dano e artes e não altera outras cartas", async () => {
  const { turnFeedbackPatch } = await import("../scripts/update-turn-feedback");
  const air = structuredClone(catalog.find((c) => c.numeroCatalogo === "019")!);
  air.habilidadesAtivas[0].custoMana = 7;
  delete air.habilidadesAtivas[0].efeitos![0].trocaAliada;
  const plan = turnFeedbackPatch(air);
  assert.equal(
    (plan.patch.habilidadesAtivas as Card["habilidadesAtivas"])[0].custoMana,
    7,
  );
  assert.deepEqual(turnFeedbackPatch({ ...air, ...plan.patch }).patch, {});
  const vortex = structuredClone(
    catalog.find((c) => c.numeroCatalogo === "094")!,
  );
  delete vortex.efeitos[0].semDestino;
  vortex.efeitos[1].valor = 9;
  vortex.imgURL = "/assets/custom.png";
  const v = turnFeedbackPatch(vortex);
  assert.equal((v.patch.efeitos as Card["efeitos"])[1].valor, 9);
  assert.equal(v.patch.imgURL, undefined);
  const orb = structuredClone(catalog.find((c) => c.numeroCatalogo === "008")!);
  orb.efeitos[0].valor = 8;
  orb.efeitos[0].variantesMago = [{ elemento: "Fogo", causaDano: true }];
  const o = turnFeedbackPatch(orb);
  assert.equal((o.patch.efeitos as Card["efeitos"])[0].valor, 8);
  assert.equal(
    (o.patch.efeitos as Card["efeitos"])[0].variantesMago!.length,
    6,
  );
  assert.throws(
    () => turnFeedbackPatch({ ...orb, numeroCatalogo: "080" }),
    /fora/,
  );
});
