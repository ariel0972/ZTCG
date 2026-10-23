import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { applyStatus } from "../src/game/status";
import { abilityManaCost, currentBasicAttack } from "../src/game/passives";
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
  g.state.round = 2;
  g.state.current = "p1";
  for (const p of g.state.players) {
    p.mana = 20;
    p.hand = [];
    p.mage.habilidadesPassivas = [];
    p.mage.habilidadesAtivas = [];
    p.mage.limites[0].feiticosUsados = 20;
    p.mage.limites[0].tropaAtacam = 10;
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
function troop(g: Game, where: string, id = "023", extra: Partial<Card> = {}) {
  const c = instance(id, where.startsWith("p1") ? "p1" : "p2", extra);
  slot(g, where).card = c;
  return c;
}
const dummy = (g: Game, where: string, extra: Partial<Card> = {}) =>
  troop(g, where, "023", {
    hp: 30,
    ataque: 2,
    elemento: "Neutro",
    direcaoAtaque: "Universal",
    resistencia: [],
    fraqueza: [],
    habilidadesPassivas: [],
    habilidadesAtivas: [],
    ...extra,
  });
function cast(
  g: Game,
  id: string,
  targets: string[],
  extra: Partial<Card> = {},
) {
  const c = instance(id, g.state.current, extra);
  g.player(g.state.current).hand.push(c);
  act(g, { type: "play", cardId: c.id, targets });
  return c.id;
}
const ability = (g: Game, where: string, id: string, targets: string[] = []) =>
  act(g, { type: "ability", slotId: where, abilityId: id, targets });
const cycle = (g: Game) => {
  act(g, { type: "endTurn" });
  act(g, { type: "endTurn" });
};
const attack = { type: "attack", slotId: "p1:front:0", targetId: "p2:front:2" };
test("seis cartas publicadas são executáveis e persistem parâmetros sem perda", async () => {
  for (const id of ["009", "022", "044", "057", "077", "103"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), [], c.nome);
    const doc = new CardModel(c);
    await doc.validate();
    const { _id, __v, ...stored } = doc.toObject();
    assert.deepEqual(cardSchema.parse(stored), c);
  }
});
test("Arder envenena apenas tropas inimigas, inclusive ocupante, e reaplica até cinco ciclos", () => {
  const g = make();
  troop(g, "p1:front:0", "044");
  dummy(g, "p1:front:1");
  dummy(g, "p2:front:2");
  slot(g, "p2:front:2").rider = instance("023", "p2", {
    hp: 30,
    elemento: "Neutro",
    habilidadesPassivas: [],
  });
  ability(g, "p1:front:0", "arder");
  assert.equal(g.player("p1").mana, 17);
  for (const c of [slot(g, "p2:front:2").card!, slot(g, "p2:front:2").rider!]) {
    assert.equal(c.statuses[0].nome, "Envenenado");
    assert.equal(c.statuses[0].valor, 1);
    assert.equal(c.statuses[0].turnosRestantes, 3);
  }
  assert.equal(slot(g, "p1:front:1").card!.statuses.length, 0);
  assert.equal(g.player("p2").mage.statuses.length, 0);
  for (let i = 0; i < 4; i++) {
    slot(g, "p1:front:0").card!.usedAbility = false;
    g.player("p1").mana = 20;
    ability(g, "p1:front:0", "arder");
  }
  assert.equal(slot(g, "p2:front:2").card!.statuses[0].turnosRestantes, 5);
  const hp = slot(g, "p2:front:2").card!.hpAtual;
  act(g, { type: "endTurn" });
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, hp);
  act(g, { type: "endTurn" });
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, hp - 1);
});
test("Salamandra envenena atacante mesmo com golpe fatal", () => {
  const g = make();
  dummy(g, "p1:front:0", { ataque: 20 });
  troop(g, "p2:front:2", "044");
  act(g, attack);
  assert.equal(slot(g, "p2:front:2").card, null);
  assert.equal(
    slot(g, "p1:front:0").card!.statuses.find((s) => s.nome === "Envenenado")
      ?.turnosRestantes,
    3,
  );
});
test("Regenerar espera o próximo turno próprio, persiste e permite atacar em ambas as posições do ciclo", () => {
  for (const turn of [3, 4]) {
    let g = make();
    g.state.turn = turn;
    troop(g, "p1:front:0", "044");
    dummy(g, "p2:front:2");
    slot(g, "p1:front:0").card!.hpAtual = 4;
    ability(g, "p1:front:0", "regenerar");
    assert.equal(slot(g, "p1:front:0").card!.hpAtual, 4);
    assert.equal(g.player("p1").mana, 16);
    act(g, attack);
    g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
    act(g, { type: "endTurn" });
    assert.equal(slot(g, "p1:front:0").card!.hpAtual, 4);
    act(g, { type: "endTurn" });
    assert.equal(slot(g, "p1:front:0").card!.hpAtual, 7);
  }
});
test("Goblin ataca duas vezes e Fogo frontal bloqueia só ataque básico", () => {
  const g = make();
  troop(g, "p1:front:0", "022");
  dummy(g, "p2:front:2");
  dummy(g, "p2:front:0");
  act(g, attack);
  act(g, attack);
  assert.throws(() => act(g, attack), /Limite/);
  cycle(g);
  slot(g, "p2:front:2").appliedElement = "Fogo";
  assert.throws(() => act(g, attack), /passiva/);
  const hp = slot(g, "p2:front:0").card!.hpAtual;
  ability(g, "p1:front:0", "arranhar", [slot(g, "p2:front:0").card!.id]);
  assert.equal(slot(g, "p2:front:0").card!.hpAtual, hp - 3);
  assert.equal(g.player("p1").mana, 16);
  slot(g, "p2:front:2").appliedElement = undefined;
  slot(g, "p2:front:2").card!.elemento = "Fogo";
  assert.throws(() => act(g, attack), /passiva/);
});
test("Arranhar rejeita mago e preserva mana e uso da habilidade", () => {
  const g = make();
  troop(g, "p1:front:0", "022");
  assert.throws(
    () => ability(g, "p1:front:0", "arranhar", [g.player("p2").mage.id]),
    /filtro/,
  );
  assert.equal(g.player("p1").mana, 20);
  assert.equal(slot(g, "p1:front:0").card!.usedAbility, false);
});
test("desconto usa ataque atual com bônus e não vida perdida nem quantidade de inimigos", () => {
  const g = make();
  const dark = troop(g, "p1:front:0", "077");
  dummy(g, "p2:front:2", { ataque: 3 });
  slot(g, "p2:front:2").card!.hpAtual = 1;
  assert.equal(abilityManaCost(dark, 5, g.state.slots), 5);
  slot(g, "p2:arm:front-right").card = instance("047", "p2", {
    bonusAtaque: 2,
    bonusHp: 0,
  });
  assert.equal(
    currentBasicAttack(slot(g, "p2:front:2").card!, g.state.slots),
    5,
  );
  g.player("p2").mage.ataque = 8;
  assert.equal(abilityManaCost(dark, 5, g.state.slots), 3);
  const view = g.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.card!;
  assert.equal(
    view.habilidadesAtivas.find((h) => h.id === "teleportar")!.custoMana,
    2,
  );
  ability(g, "p1:front:0", "teleportar", ["p1:front:1"]);
  assert.equal(g.player("p1").mana, 18);
});
test("mago e estrutura também ativam desconto incluindo status e bônus de campo", () => {
  const g = make();
  const dark = troop(g, "p1:front:0", "077");
  g.player("p2").mage.ataque = 4;
  applyStatus(g.player("p2").mage.statuses, "BonusAtaque", 2, 1);
  assert.equal(abilityManaCost(dark, 4, g.state.slots), 2);
  g.player("p2").mage.statuses = [];
  g.player("p2").mage.ataque = 2;
  const structure = instance("023", "p2", { tipo: "Estrutura", ataque: 4 });
  slot(g, "p2:front:2").structure = structure;
  structure.fieldModifiers = [{ source: "Teste", grant: { bonusAtaque: 1 } }];
  assert.equal(abilityManaCost(dark, 4, g.state.slots), 2);
});
test("Teleportar troca grupos montados preservando estruturas, armamentos e bônus", () => {
  const g = make();
  const dark = troop(g, "p1:front:0", "077");
  const other = dummy(g, "p1:front:2");
  slot(g, "p1:front:0").rider = instance("023");
  const rider = slot(g, "p1:front:0").rider!.id;
  slot(g, "p1:front:0").structure = instance("023", "p1", {
    tipo: "Estrutura",
  });
  const structure = slot(g, "p1:front:0").structure!.id;
  slot(g, "p1:arm:front-left").card = instance("047", "p1", { bonusHp: 0 });
  dark.fieldModifiers = [{ source: "Concessão", grant: { bonusAtaque: 2 } }];
  ability(g, "p1:front:0", "teleportar", ["p1:front:2"]);
  assert.equal(slot(g, "p1:front:2").card!.id, dark.id);
  assert.equal(slot(g, "p1:front:2").rider!.id, rider);
  assert.equal(slot(g, "p1:front:0").card!.id, other.id);
  assert.equal(slot(g, "p1:front:0").structure!.id, structure);
  assert.equal(slot(g, "p1:front:2").structure, null);
  assert.equal(slot(g, "p1:front:2").card!.fieldModifiers!.length, 1);
});
test("Teleportar rejeita Lama, tropas imóveis e campo inimigo sem gastar mana", () => {
  for (const reason of ["lama", "status", "enemy"]) {
    const g = make();
    troop(g, "p1:front:0", "077");
    dummy(g, "p1:front:1");
    if (reason === "lama")
      slot(g, "p1:front:1").terrain = { nome: "Lama", rodadasRestantes: 1 };
    if (reason === "status")
      applyStatus(slot(g, "p1:front:1").card!.statuses, "Incapacitado", 1);
    assert.throws(() =>
      ability(g, "p1:front:0", "teleportar", [
        reason === "enemy" ? "p2:front:1" : "p1:front:1",
      ]),
    );
    assert.equal(g.player("p1").mana, 20);
    assert.equal(slot(g, "p1:front:0").card!.usedAbility, false);
  }
});
test("Golpe no escuro aceita uso depois do ataque, atordoa um ciclo e não causa dano", () => {
  const g = make();
  troop(g, "p1:front:0", "077");
  dummy(g, "p2:front:2");
  act(g, attack);
  const hp = g.player("p2").mage.hpAtual;
  ability(g, "p1:front:0", "golpeNoEscuro", [g.player("p2").mage.id]);
  assert.equal(g.player("p1").mana, 15);
  assert.equal(g.player("p2").mage.hpAtual, hp);
  assert.ok(g.player("p2").mage.statuses.some((s) => s.nome === "Atordoado"));
  assert.ok(
    slot(g, "p1:front:0").card!.statuses.some((s) => s.nome === "SemAtaque"),
  );
  act(g, { type: "endTurn" });
  assert.ok(g.player("p2").mage.statuses.some((s) => s.nome === "Atordoado"));
  act(g, { type: "endTurn" });
  assert.ok(!g.player("p2").mage.statuses.some((s) => s.nome === "Atordoado"));
  assert.ok(
    !slot(g, "p1:front:0").card!.statuses.some((s) => s.nome === "SemAtaque"),
  );
});
test("Asas acumulam ataque, mudam elemento, concedem movimento e são banidas", () => {
  let g = make();
  const c = dummy(g, "p1:front:0");
  dummy(g, "p2:front:1", { fraqueza: ["Fogo"] });
  const a = cast(g, "103", [c.id]);
  cast(g, "103", [c.id]);
  assert.equal(g.player("p1").banished.length, 2);
  assert.ok(!g.player("p1").graveyard.some((c) => c.id === a));
  assert.equal(
    currentBasicAttack(slot(g, "p1:front:0").card!, g.state.slots),
    6,
  );
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  const view = g.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.card!;
  assert.ok(view.palavrasChave.includes("Campo livre"));
  assert.equal(view.bonusAtaquePassivo, 4);
  act(g, { type: "move", slotId: "p1:front:0", destinationId: "p1:front:1" });
  assert.equal(slot(g, "p1:front:1").card!.fieldModifiers!.length, 2);
  act(g, { type: "attack", slotId: "p1:front:1", targetId: "p2:front:1" });
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 18);
});
test("Asas perdem bônus ao morrer e não atingem magos", () => {
  const g = make();
  const c = dummy(g, "p1:front:0", { hp: 4 });
  dummy(g, "p2:front:2", { ataque: 10 });
  assert.throws(() => cast(g, "103", [g.player("p1").mage.id]), /Tipo de alvo/);
  cast(g, "103", [c.id]);
  act(g, { type: "endTurn" });
  act(g, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
  const dead = g.player("p1").graveyard.find((x) => x.id === c.id)!;
  assert.equal(dead.fieldModifiers, undefined);
  assert.equal(dead.ataque, 2);
  assert.ok(!dead.palavrasChave.includes("Campo livre"));
});
test("Asas respeitam cancelamento e escudo sem conceder propriedades", () => {
  const g = make();
  const c = dummy(g, "p1:front:0");
  c.statuses = [{ nome: "EscudoProtecao", valor: 1, turnosRestantes: 2 }];
  cast(g, "103", [c.id]);
  assert.equal(slot(g, "p1:front:0").card!.fieldModifiers, undefined);
  assert.equal(g.player("p1").banished.length, 1);
  const h = make();
  const t = dummy(h, "p1:front:0");
  const water = instance("002", "p2");
  h.player("p2").hand.push(water);
  cast(h, "103", [t.id]);
  assert.ok(h.state.pendingSpell);
  act(h, { type: "respondSpell", cardId: water.id }, "p2");
  assert.equal(slot(h, "p1:front:0").card!.fieldModifiers, undefined);
  assert.equal(h.player("p1").banished.length, 1);
});
test("Lâmina compra só pela morte no dano inicial e Sangramento não compra depois", () => {
  const g = make();
  dummy(g, "p2:front:2", { hp: 3 });
  const before = g.player("p1").hand.length;
  cast(g, "057", [slot(g, "p2:front:2").card!.id]);
  assert.equal(g.player("p1").hand.length, before + 1);
  const h = make();
  dummy(h, "p2:front:2", { hp: 4 });
  cast(h, "057", [slot(h, "p2:front:2").card!.id]);
  assert.equal(h.player("p1").hand.length, 0);
  assert.equal(slot(h, "p2:front:2").card!.hpAtual, 1);
  assert.ok(
    slot(h, "p2:front:2").card!.statuses.some((s) => s.nome === "Sangrando"),
  );
  cycle(h);
  assert.equal(slot(h, "p2:front:2").card, null);
  assert.equal(h.player("p1").hand.length, 1); // apenas compra normal do turno
});
test("matar estrutura com Lâmina não compra e mago não pode ser escolhido", () => {
  const g = make();
  dummy(g, "p2:front:2");
  slot(g, "p2:front:2").structure = instance("023", "p2", {
    tipo: "Estrutura",
    hp: 3,
    resistencia: [],
    fraqueza: [],
    habilidadesPassivas: [],
  });
  cast(g, "057", [slot(g, "p2:front:2").card!.id]);
  assert.equal(g.player("p1").hand.length, 0);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 30);
  assert.throws(() => cast(g, "057", [g.player("p2").mage.id]), /Tipo de alvo/);
});
test("novos efeitos funcionam em cartas de outro número e nome", () => {
  const g = make();
  const source = dummy(g, "p1:front:0", {
    numeroCatalogo: "800001",
    nome: "Outra criatura",
    habilidadesAtivas: [
      {
        id: "saltos",
        nome: "Salto",
        custoMana: 1,
        alvo: "CampoAliado",
        efeitos: [{ id: "relocate" }],
      },
      {
        id: "curarDepois",
        nome: "Curar depois",
        custoMana: 1,
        alvo: "UnicoAliado",
        alvoAutomatico: "Proprio",
        efeitos: [{ id: "heal", valor: 4, inicio: "proximoTurnoAliado" }],
      },
    ],
  });
  cast(g, "103", [source.id], {
    numeroCatalogo: "800002",
    nome: "Outro encantamento",
    elemento: "Neutro",
    efeitos: [
      {
        id: "fieldModifier",
        concessao: {
          bonusAtaque: 3,
          palavrasChave: ["Campo livre"],
          elementoAtaque: "Agua",
        },
      },
    ],
  });
  ability(g, "p1:front:0", "saltos", ["p1:front:1"]);
  assert.equal(
    currentBasicAttack(slot(g, "p1:front:1").card!, g.state.slots),
    5,
  );
  slot(g, "p1:front:1").card!.usedAbility = false;
  slot(g, "p1:front:1").card!.hpAtual = 5;
  ability(g, "p1:front:1", "curarDepois");
  cycle(g);
  assert.equal(slot(g, "p1:front:1").card!.hpAtual, 9);
});

test("concessões terminam ao voltar à mão, com campo cheio na troca de controle", () => {
  const g = make();
  const c = dummy(g, "p1:front:0");
  cast(g, "103", [c.id]);
  for (const col of [0, 1, 2]) dummy(g, "p2:front:" + col);
  act(g, { type: "endTurn" });
  cast(g, "060", [c.id]);
  const returned = g.player("p2").hand.find((x) => x.id === c.id)!;
  assert.ok(returned);
  assert.equal(returned.fieldModifiers, undefined);
  assert.equal(returned.ataque, 2);
  assert.ok(!returned.palavrasChave.includes("Campo livre"));
  assert.equal(slot(g, "p1:front:0").card, null);
});
test("catálogo rejeita dependências circulares no filtro de ataque e parâmetros sem efeito", () => {
  const base = catalog.find((c) => c.numeroCatalogo === "077")!;
  const invalid = cardSchema.parse({
    ...base,
    habilidadesPassivas: [
      {
        gatilho: "continuous",
        escopo: "proprio",
        condicoes: [
          {
            tipo: "cartaEmCampo",
            jogador: "inimigo",
            filtro: { ataqueMinimo: 5 },
          },
        ],
        efeitos: [{ id: "attackBonus", valor: 2 }],
      },
    ],
  });
  assert.ok(playableErrors(invalid).some((e) => e.includes("circular")));
  const spell = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === "103"),
    destinoAposUso: "banido",
    efeitos: [{ id: "damage", valor: 1, concessao: { bonusAtaque: 2 } }],
  });
  assert.ok(playableErrors(spell).some((e) => e.includes("Concessão")));
});

test("migração das seis cartas preserva imagens e custos não alterados e é idempotente", async () => {
  const { creatureEffectsPatch } =
    await import("../scripts/update-creature-effects");
  const current = {
    ...catalog.find((c) => c.numeroCatalogo === "057"),
    custoMana: 4,
    imgURL: "/assets/arte-revisada.png",
    efeitos: [
      { id: "damage", valor: 3 },
      { id: "draw", valor: 1 },
    ],
    versao: 7,
  };
  const plan = creatureEffectsPatch(current);
  assert.equal(plan.version, 7);
  assert.equal(plan.patch.custoMana, undefined);
  assert.equal(plan.patch.imgURL, undefined);
  assert.deepEqual(
    plan.patch.efeitos,
    catalog.find((c) => c.numeroCatalogo === "057")!.efeitos,
  );
  assert.deepEqual(
    creatureEffectsPatch({ ...current, ...plan.patch }).patch,
    {},
  );
  assert.throws(
    () => creatureEffectsPatch({ ...current, numeroCatalogo: "080" }),
    /fora/,
  );
});
test("interface mostra concessão visual por parâmetro e filtra os destinos de teleporte", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<body></body>");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const uiPath = "../public/JS/battle-ui.js",
      targetsPath = "../public/JS/battle-targets.js";
    const { cardFace } = await import(uiPath);
    const { spellSlotTarget } = await import(targetsPath);
    const c = instance("022");
    c.fieldModifiers = [
      {
        source: "Outra origem",
        grant: { visual: "asasDeFogo", bonusAtaque: 2 },
      },
    ];
    const face = cardFace({ ...c, bonusAtaquePassivo: 2 }, {});
    assert.ok(face.classList.contains("effect-fire-wings"));
    assert.ok(face.querySelector('[aria-label="Asas de fogo ativas"]'));
    assert.equal(face.querySelector(".attack").textContent, "3");
    delete c.fieldModifiers;
    assert.ok(!cardFace(c, {}).classList.contains("effect-fire-wings"));
    const action = {
      alvo: "CampoAliado",
      sourceCardId: "source",
      efeitos: [{ id: "relocate" }],
    };
    const dest = { id: "slot", ownerId: "p1", kind: "Tropa", card: null };
    assert.equal(spellSlotTarget(action, dest, "p1"), true);
    assert.equal(
      spellSlotTarget(
        action,
        { ...dest, card: { id: "ally", tipo: "Tropa" } },
        "p1",
      ),
      true,
    );
    assert.equal(
      spellSlotTarget(
        action,
        { ...dest, card: { id: "source", tipo: "Tropa" } },
        "p1",
      ),
      false,
    );
    assert.equal(
      spellSlotTarget(action, { ...dest, terrain: { nome: "Lama" } }, "p1"),
      false,
    );
    assert.equal(
      spellSlotTarget(action, { ...dest, ownerId: "p2" }, "p1"),
      false,
    );
    assert.equal(
      spellSlotTarget(
        action,
        { ...dest, card: { tipo: "Feitico", concealedTrap: {} } },
        "p1",
      ),
      false,
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("deslocamento de uma tropa alvo funciona em feitiços e habilidades de todos os tipos permanentes", () => {
  for (const kind of [
    "Feitico",
    "Tropa",
    "Mago",
    "Estrutura",
    "Armamento",
  ] as const) {
    const g = make();
    const target = dummy(g, "p1:front:1");
    const dest = dummy(g, "p1:front:2");
    const effects = [{ id: "relocate", origem: "alvo" as const }];
    if (kind === "Feitico") {
      const spell = instance("103", "p1", {
        numeroCatalogo: "800010",
        nome: "Outro deslocamento",
        tipo: "Feitico",
        elemento: "Neutro",
        alvo: "UnicoAliado",
        tiposAlvo: ["Tropa"],
        efeitos: effects,
      });
      assert.deepEqual(playableErrors(spell), []);
      g.player("p1").hand.push(spell);
      act(g, {
        type: "play",
        cardId: spell.id,
        targets: [target.id],
        destinationId: "p1:front:2",
      });
    } else {
      const source =
        kind === "Mago"
          ? g.player("p1").mage
          : instance(kind === "Armamento" ? "047" : "023", "p1", {
              tipo: kind,
            });
      source.habilidadesAtivas = [
        {
          id: "moverAlvo",
          nome: "Mover aliado",
          custoMana: 1,
          alvo: "UnicoAliado",
          tiposAlvo: ["Tropa"],
          efeitos: effects,
        },
      ];
      source.habilidadesPassivas = [];
      const where =
        kind === "Mago"
          ? "p1:mage"
          : kind === "Armamento"
            ? "p1:arm:back-left"
            : "p1:front:0";
      if (kind === "Estrutura") slot(g, where).structure = source;
      else slot(g, where).card = source;
      assert.deepEqual(playableErrors(source), [], kind);
      act(g, {
        type: "ability",
        slotId: where,
        source: kind === "Estrutura" ? "structure" : "card",
        abilityId: "moverAlvo",
        targets: [target.id],
        destinationId: "p1:front:2",
      });
    }
    assert.equal(slot(g, "p1:front:2").card!.id, target.id, kind);
    assert.equal(slot(g, "p1:front:1").card!.id, dest.id, kind);
  }
});
