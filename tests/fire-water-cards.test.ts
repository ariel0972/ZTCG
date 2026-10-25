import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { elementalCardPatch } from "../scripts/update-elemental-cards";
import { applyStatus } from "../src/game/status";
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
      deck: { nome: "Teste", mago: id === "p1" ? "016" : "108", cartas },
    })),
    catalog,
    () => 0.8,
  );
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.round = 3;
  g.state.current = "p1";
  for (const p of g.state.players) {
    p.mana = 20;
    p.hand = [];
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
function troop(
  g: Game,
  id: string,
  owner = id.startsWith("p1") ? "p1" : "p2",
  extra: Partial<Card> = {},
) {
  const c = instance("023", owner, {
    hp: 40,
    ataque: 2,
    elemento: "Neutro",
    direcaoAtaque: "Universal",
    fraqueza: [],
    resistencia: [],
    habilidadesPassivas: [],
    habilidadesAtivas: [],
    ...extra,
  });
  slot(g, id).card = c;
  return c;
}
function cast(
  g: Game,
  id: string,
  targets: string[] = [],
  extra: Partial<Card> = {},
  user = "p1",
) {
  const c = instance(id, user, extra);
  g.player(user).hand.push(c);
  act(g, { type: "play", cardId: c.id, targets }, user);
  return c;
}
function imbue(g: Game) {
  act(g, {
    type: "ability",
    slotId: "p1:mage",
    abilityId: "imbuirEmChamas",
    targets: [],
  });
}
function changeMage(g: Game, id: string, user = "p1") {
  g.player(user).mage = instance(id, user);
  slot(g, user + ":mage").card = g.player(user).mage;
}
function nextRound(g: Game) {
  act(g, { type: "endTurn" });
  act(g, { type: "endTurn" });
}
const attack = { type: "attack", slotId: "p1:front:0", targetId: "p2:front:2" };
test("cartas publicadas, regras novas e esquemas do banco preservam todos os parâmetros", async () => {
  for (const id of ["002", "009", "016", "026", "031", "035", "047", "104"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), [], c.nome);
    const doc = new CardModel(c);
    await doc.validate();
    const { _id, __v, ...stored } = doc.toObject();
    assert.deepEqual(cardSchema.parse(stored), c);
  }
});
test("Imbuir custa 3 e fortalece só o próximo ataque, com rollback de tentativa inválida", () => {
  let g = make();
  troop(g, "p1:front:0");
  troop(g, "p1:front:1");
  troop(g, "p2:front:2");
  troop(g, "p2:front:1");
  imbue(g);
  assert.equal(g.player("p1").mana, 17);
  const before = JSON.stringify(g.exportState());
  assert.throws(() => act(g, { ...attack, targetId: "p1:front:1" }));
  assert.equal(JSON.stringify(g.exportState()), before);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  act(g, attack);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 37);
  act(g, { ...attack, slotId: "p1:front:1", targetId: "p2:front:1" });
  assert.equal(slot(g, "p2:front:1").card!.hpAtual, 38);
});
test("Imbuir amplia cada alvo de um feitiço de área e mantém a passiva permanente de Fogo", () => {
  const g = make();
  for (const col of [0, 1, 2]) troop(g, "p2:front:" + col);
  imbue(g);
  cast(g, "035");
  for (const col of [0, 1, 2])
    assert.equal(slot(g, "p2:front:" + col).card!.hpAtual, 35);
  assert.equal(g.player("p2").mage.hpAtual, g.player("p2").mage.hp);
  assert.equal(g.player("p1").mage.fireDamageBonus, 1);
  assert.equal(g.player("p1").mana, 11);
});
test("Imbuir fortalece também o dano da variante de Orbe de Luz", () => {
  const g = make();
  const enemy = troop(g, "p2:front:2");
  imbue(g);
  cast(g, "008");
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 36);
});
test("Imbuir fortalece habilidade de tropa e expira no fim do turno sem consumo por cura", () => {
  const g = make();
  const own = troop(g, "p1:front:0", "p1", {
    habilidadesAtivas: [
      {
        id: "curar",
        nome: "Curar",
        custoMana: 0,
        alvo: "UnicoAliado",
        alvoAutomatico: "Proprio",
        efeitos: [{ id: "heal", valor: 1 }],
      },
    ],
  });
  const ally = troop(g, "p1:front:1", "p1", {
    habilidadesAtivas: [
      {
        id: "golpe",
        nome: "Golpe",
        custoMana: 0,
        alvo: "UnicoInimigo",
        efeitos: [{ id: "damage", valor: 3 }],
      },
    ],
  });
  const enemy = troop(g, "p2:front:2");
  imbue(g);
  act(g, {
    type: "ability",
    slotId: "p1:front:0",
    abilityId: "curar",
    targets: [],
  });
  act(g, {
    type: "ability",
    slotId: "p1:front:1",
    abilityId: "golpe",
    targets: [enemy.id],
  });
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 36);
  const h = make();
  imbue(h);
  act(h, { type: "endTurn" });
  assert.ok(
    !h
      .player("p1")
      .mage.statuses.some((s) => s.nome === "Dano da próxima ação"),
  );
});
test("reação é definida por palavra-chave, usa custo e limite e não executa o efeito normal", () => {
  let g = make();
  troop(g, "p2:front:2");
  imbue(g);
  const water = instance("053", "p2", {
    tipo: "Feitico",
    elemento: "Agua",
    custoMana: 2,
    palavrasChave: ["Reação"],
    alvo: "UnicoInimigo",
    efeitos: [{ id: "damage", valor: 999 }],
  });
  g.player("p2").hand = [water];
  cast(g, "035");
  assert.ok(g.state.pendingSpell);
  assert.ok(g.snapshot("p2").responseCards.includes(water.id));
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  act(g, { type: "respondSpell", cardId: water.id }, "p2");
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40);
  assert.equal(g.player("p1").mage.hpAtual, 20);
  assert.equal(g.player("p2").mana, 18);
  assert.equal(g.player("p2").counters.spells, 1);
  assert.ok(
    !g
      .player("p1")
      .mage.statuses.some((s) => s.nome === "Dano da próxima ação"),
  );
  const h = make();
  troop(h, "p2:front:2");
  h.player("p2").hand = [instance("002", "p2", { palavrasChave: [] })];
  cast(h, "035");
  assert.equal(h.state.pendingSpell, undefined);
});
test("Luokis concede +5 vida e +3 ataque, muda elemento só dos beneficiados e congela por rodadas", () => {
  const g = make();
  const own = troop(g, "p1:front:0", "p1", { elemento: "Fogo" });
  const enemy = troop(g, "p2:front:2", "p2", { fraqueza: ["Agua"] });
  const armor = instance("047");
  g.player("p1").hand.push(armor);
  act(g, {
    type: "play",
    cardId: armor.id,
    slotId: "p1:arm:front-left",
    targets: [],
  });
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 45);
  assert.equal(g.player("p1").mana, 13);
  act(g, attack);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 30);
  act(g, {
    type: "ability",
    slotId: "p1:arm:front-left",
    abilityId: "congelarTropa",
    targets: [enemy.id],
  });
  const frozen = slot(g, "p2:front:2").card!.statuses.find(
    (s) => s.nome === "Congelado",
  )!;
  assert.equal(frozen.unidade, "rodada");
  assert.equal(frozen.turnosRestantes, 2);
  assert.equal(g.player("p1").mana, 13);
  assert.throws(
    () =>
      act(g, {
        type: "ability",
        slotId: "p1:arm:front-left",
        abilityId: "congelarTropa",
        targets: [enemy.id],
      }),
    /utilizada/,
  );
  nextRound(g);
  assert.equal(
    slot(g, "p2:front:2").card!.statuses.find((s) => s.nome === "Congelado")!
      .turnosRestantes,
    1,
  );
  nextRound(g);
  assert.ok(
    !slot(g, "p2:front:2").card!.statuses.some((s) => s.nome === "Congelado"),
  );
});
test("congelamento padrão de dois turnos não encurta congelamento configurado de duas rodadas", () => {
  const statuses: Instance["statuses"] = [];
  applyStatus(statuses, "Congelado", 2, undefined, 3, "rodada");
  applyStatus(statuses, "Congelado", 2, undefined, 3);
  assert.equal(statuses[0].unidade, "rodada");
  assert.equal(statuses[0].turnosRestantes, 2);
});
test("Cauterizar atinge tropas e magos aliados, ignora estrutura e cura dano efetivo vezes três após reinício", () => {
  let g = make();
  changeMage(g, "108");
  const own = troop(g, "p1:front:0");
  own.hpAtual = 20;
  slot(g, "p1:front:0").structure = instance("020", "p1", {
    tipo: "Estrutura",
    hp: 10,
    elemento: "Neutro",
    habilidadesPassivas: [],
    fraqueza: [],
    resistencia: [],
  });
  cast(g, "104", [own.id]);
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 19);
  assert.equal(slot(g, "p1:front:0").structure!.hpAtual, 10);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  nextRound(g);
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 22);
  const h = make();
  changeMage(h, "108");
  h.player("p1").mage.hpAtual = 10;
  cast(h, "104", [h.player("p1").mage.id]);
  assert.equal(h.player("p1").mage.hpAtual, 9);
  nextRound(h);
  assert.equal(h.player("p1").mage.hpAtual, 12);
});
test("Cauterizar rejeita inimigos, respeita escudos, resistência e recompensa só a morte inicial de tropa", () => {
  const g = make();
  changeMage(g, "108");
  const own = troop(g, "p1:front:0");
  const enemy = troop(g, "p2:front:2");
  const spell = instance("104");
  g.player("p1").hand = [spell];
  const before = JSON.stringify(g.exportState());
  assert.throws(() =>
    act(g, { type: "play", cardId: spell.id, targets: [enemy.id] }),
  );
  assert.equal(JSON.stringify(g.exportState()), before);
  slot(g, "p1:front:0").card!.hpAtual = 1;
  g.player("p1").mana = 10;
  act(g, { type: "play", cardId: spell.id, targets: [own.id] });
  assert.equal(g.player("p1").mana, 12);
  assert.equal(slot(g, "p1:front:0").card, null);
  for (const protection of ["shield", "resistance"]) {
    const h = make();
    changeMage(h, "108");
    const target = troop(h, "p1:front:0");
    target.hpAtual = 20;
    if (protection === "shield") applyStatus(target.statuses, "Escudo", 1, 2);
    else target.resistencia = ["Fogo"];
    cast(h, "104", [target.id]);
    assert.equal(slot(h, "p1:front:0").card!.hpAtual, 20);
    assert.equal(slot(h, "p1:front:0").card!.scheduledHeals, undefined);
  }
});
test("Furacão de Areia aplica Cego e dano em tropas por um ciclo, somando roubo e compra da passiva de Ar", () => {
  const g = make();
  changeMage(g, "019");
  const enemy = troop(g, "p2:front:2");
  const oldHand = g.player("p1").hand.length;
  cast(g, "009");
  assert.equal(
    slot(g, "p2:front:2").card!.statuses.find((s) => s.nome === "Cego")!
      .turnosRestantes,
    1,
  );
  assert.equal(g.state.ongoingSpells![0].rounds, 1);
  assert.equal(g.player("p1").hand.length, oldHand + 2);
  nextRound(g);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 38);
  assert.equal(g.state.ongoingSpells!.length, 0);
  assert.ok(
    !slot(g, "p2:front:2").card!.statuses.some((s) => s.nome === "Cego"),
  );
  nextRound(g);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 38);
});
test("Barreira exige Mago de Fogo, aparece em campo e atinge depois do ataque", () => {
  const h = make();
  changeMage(h, "019");
  const blocked = instance("031");
  h.player("p1").hand = [blocked];
  const before = JSON.stringify(h.exportState());
  assert.throws(
    () => act(h, { type: "play", cardId: blocked.id, targets: [] }),
    /mago de Fogo/,
  );
  assert.equal(JSON.stringify(h.exportState()), before);
  const g = make();
  const own = troop(g, "p1:front:0");
  const enemy = troop(g, "p2:front:2");
  enemy.hpAtual = 1;
  cast(g, "031");
  assert.equal(g.state.fieldEffects!.length, 1);
  assert.equal(g.state.fieldEffects![0].rounds, 3);
  act(g, { type: "endTurn" });
  act(g, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 38);
  assert.equal(slot(g, "p2:front:2").card, null);
});
test("Barreira usa elemento do ataque com fraquezas e resistências, e Terra a remove após atacar", () => {
  for (const [element, expected] of [
    ["Agua", 1],
    ["Ar", 4],
    ["Terra", 0],
  ] as const) {
    const g = make();
    troop(g, "p1:front:0");
    troop(g, "p2:front:2", "p2", { elemento: element });
    cast(g, "031");
    act(g, { type: "endTurn" });
    act(g, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
    assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40 - expected);
    assert.equal(g.state.fieldEffects!.length, element === "Terra" ? 0 : 1);
  }
  const h = make();
  troop(h, "p1:front:0");
  troop(h, "p2:front:2", "p2", { elemento: "Ar", fraqueza: ["Fogo"] });
  cast(h, "031");
  act(h, { type: "endTurn" });
  act(h, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
  assert.equal(slot(h, "p2:front:2").card!.hpAtual, 32);
});
test("Barreira mantém proteção da estrutura e aplica a resistência dela", () => {
  const g = make();
  troop(g, "p1:front:0");
  troop(g, "p2:front:2", "p2", { elemento: "Ar" });
  slot(g, "p2:front:2").structure = instance("020", "p2", {
    hp: 10,
    fraqueza: [],
    resistencia: ["Fogo"],
  });
  cast(g, "031");
  act(g, { type: "endTurn" });
  act(g, { type: "attack", slotId: "p2:front:2", targetId: "p1:front:0" });
  assert.equal(slot(g, "p1:front:0").card!.hpAtual, 38);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40);
  assert.equal(slot(g, "p2:front:2").structure!.hpAtual, 8);
});
test("feitiços dos dois lados alteram automaticamente Barreira; estado persiste e expira após três fins de rodada", () => {
  let g = make();
  const enemy = troop(g, "p2:front:2");
  cast(g, "031");
  cast(g, "057", [enemy.id]);
  assert.equal(g.state.fieldEffects![0].damage, 4);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  act(g, { type: "endTurn" });
  cast(g, "002", [g.player("p1").mage.id], {}, "p2");
  assert.equal(g.state.fieldEffects![0].damage, 2);
  act(g, { type: "endTurn" });
  assert.equal(g.state.fieldEffects![0].rounds, 2);
  nextRound(g);
  assert.equal(g.state.fieldEffects![0].rounds, 1);
  nextRound(g);
  assert.equal(g.state.fieldEffects!.length, 0);
  const h = make();
  troop(h, "p2:front:2");
  cast(h, "031");
  cast(h, "057", [slot(h, "p2:front:2").card!.id], { elemento: "Terra" });
  assert.equal(h.state.fieldEffects!.length, 0);
});

test("atualização elemental é idempotente e preserva imagem, atributos e passiva do Mago de Fogo", () => {
  for (const id of ["002", "009", "016", "026", "031", "035", "047", "104"]) {
    const c = structuredClone(catalog.find((c) => c.numeroCatalogo === id)!);
    const old = {
      ...c,
      imgURL: "/custom.png",
      versao: 10,
      ...(id === "016" ? { hp: 29, habilidadesAtivas: [] } : {}),
      ...(id === "002" ? { palavrasChave: ["Esconder"] } : {}),
    };
    const plan = elementalCardPatch(old);
    assert.equal(
      Object.prototype.hasOwnProperty.call(plan.patch, "imgURL"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(plan.patch, "versao"),
      false,
    );
    if (id === "016") {
      assert.equal(
        Object.prototype.hasOwnProperty.call(plan.patch, "hp"),
        false,
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(plan.patch, "habilidadesPassivas"),
        false,
      );
    }
    const after: Record<string, unknown> = { ...old, ...plan.patch };
    for (const key of Object.keys(plan.unset)) delete after[key];
    const again = elementalCardPatch(after);
    assert.deepEqual(again.patch, {});
    assert.deepEqual(again.unset, {});
  }
});
test("catálogo rejeita cura posterior contra inimigo e parâmetros deslocados para efeitos sem suporte", () => {
  const base = catalog.find((c) => c.numeroCatalogo === "104")!;
  assert.ok(
    playableErrors(cardSchema.parse({ ...base, alvo: "UnicoInimigo" })).length,
  );
  assert.ok(
    playableErrors(
      cardSchema.parse({
        ...base,
        efeitos: [
          {
            id: "heal",
            valor: 1,
            curaPosterior: { multiplicador: 3, rodadas: 1 },
          },
        ],
      }),
    ).length,
  );
  assert.ok(
    playableErrors(
      cardSchema.parse({
        ...base,
        efeitos: [
          {
            id: "status",
            status: "Cego",
            duracao: 1,
            reacoesElemento: [{ elemento: "Ar", multiplicador: 2 }],
          },
        ],
      }),
    ).length,
  );
});
