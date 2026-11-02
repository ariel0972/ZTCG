import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import type { Instance } from "../src/game/state";
import { Game } from "../src/game/engine";
import { currentBasicAttack } from "../src/game/passives";
import { playableErrors } from "../src/game/capabilities";
import { pestCardPatch } from "../scripts/update-pest-cards";
import CardModel from "../src/db/models/Card";
const catalog = raw.map((c) => cardSchema.parse(c));
function setup(mage = "016") {
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
    () => 0.4,
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
  return { g, card, slot, place, run, play, attack, pass };
}
test("cartas de peste e armas são publicadas, executáveis e preservadas pelo schema do Mongo", async () => {
  for (const id of ["027", "048", "049", "066", "072", "089", "107"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), [], id);
    const doc = new CardModel(c);
    await doc.validate();
    const { _id, __v, ...obj } = doc.toObject() as any;
    assert.deepEqual(cardSchema.parse(obj), c);
  }
});
test("Arco escolhe Água, Fogo e Terra, cura o atacante e aplica o elemento correto", () => {
  for (const mode of ["agua", "fogo", "terra"]) {
    const { g, place, slot, play, attack } = setup();
    const source = place("023", "p", 0, { hpAtual: 8 });
    const target = place("020", "q", 2, {
      hp: 40,
      hpAtual: 40,
      resistencia: [],
      fraqueza: [],
    });
    play("049", { slotId: "p:arm:front-left", mode });
    attack();
    const s = slot("p", 0).card!,
      t = slot("q", 2).card!;
    assert.equal(currentBasicAttack(s, g.state.slots), mode === "fogo" ? 7 : 5);
    assert.equal(t.hpAtual, mode === "fogo" ? 33 : 35);
    assert.equal(
      t.appliedElement,
      ({ agua: "Agua", fogo: "Fogo", terra: "Terra" } as any)[mode],
    );
    if (mode === "agua") assert.equal(s.hpAtual, 9);
    if (mode === "terra")
      assert.ok(
        t.statuses.some(
          (s) => s.nome === "Atordoado" && s.turnosRestantes === 1,
        ),
      );
  }
});
test("Arco de Ar devolve tropa e armamentos, respeitando Ar, estrutura e montaria ocupada", () => {
  for (const kind of ["normal", "ar", "estrutura", "montado"]) {
    const { g, place, slot, play, attack } = setup();
    place("023");
    const victim = place("020", "q", 2, {
      hp: 40,
      hpAtual: 40,
      elemento: kind === "ar" ? "Ar" : "Neutro",
      resistencia: [],
      fraqueza: [],
    });
    if (kind === "estrutura")
      slot("q", 2).structure = {
        ...catalog.find((c) => c.numeroCatalogo === "056")!,
        id: randomUUID(),
        ownerId: "q",
        hpAtual: 10,
        attacked: false,
        usedAbility: false,
        statuses: [],
      };
    if (kind === "montado")
      slot("q", 2).rider = { ...victim, id: randomUUID() };
    play("049", { slotId: "p:arm:front-left", mode: "ar" });
    attack();
    assert.equal(!slot("q", 2).card, kind === "normal", kind);
    assert.equal(
      g.player("q").hand.some((c) => c.id === victim.id),
      kind === "normal",
      kind,
    );
  }
});
test("restrições dos armamentos impedem magos e animais; Machado sangra apenas com alcance compatível", () => {
  const a = setup();
  a.place("027");
  assert.throws(() => a.play("048", { slotId: "p:arm:front-left" }));
  assert.throws(() =>
    a.play("049", { slotId: "p:arm:back-left", mode: "fogo" }),
  );
  assert.equal(a.g.player("p").mana, 20);
  for (const ref of ["022", "023"]) {
    const b = setup();
    b.place(ref);
    b.place("020", "q", 2, {
      hp: 40,
      hpAtual: 40,
      resistencia: [],
      fraqueza: [],
    });
    b.play("048", { slotId: "p:arm:front-left" });
    b.attack();
    assert.equal(
      b.slot("q", 2).card!.statuses.some((s) => s.nome === "Sangrando"),
      ref === "023",
    );
  }
});
test("Peste acumula dano e aura, espera ciclo completo, inclui mago com três Ratos e limpeza encerra bônus", () => {
  const { g, place, slot, play, pass, run } = setup();
  place("027");
  place("089", "p", 1);
  place("027", "p", 2);
  place("023", "q", 2, { hp: 40, hpAtual: 40, resistencia: [], fraqueza: [] });
  place("107", "q", 1);
  play("066");
  play("066");
  assert.equal(
    slot("q", 2).card!.statuses.find((s) => s.nome === "Peste Negra")!.valor,
    2,
  );
  assert.equal(currentBasicAttack(slot("p", 0).card!, g.state.slots), 4);
  assert.ok(g.player("q").mage.statuses.some((s) => s.nome === "Peste Negra"));
  const hp = slot("q", 2).card!.hpAtual;
  pass();
  assert.equal(slot("q", 2).card!.hpAtual, hp);
  pass();
  assert.equal(slot("q", 2).card!.hpAtual, hp - 2);
  assert.equal(
    slot("q", 2).card!.statuses.find((s) => s.nome === "Peste Negra")!
      .turnosRestantes,
    1,
  );
  pass();
  run({
    type: "ability",
    slotId: "q:front:1",
    abilityId: "medicar",
    targets: [],
  });
  assert.equal(
    g.player("q").mage.statuses.some((s) => s.nome === "Peste Negra"),
    false,
  );
  assert.equal(currentBasicAttack(slot("p", 0).card!, g.state.slots), 2);
  assert.ok(
    slot("q", 1).card!.statuses.some(
      (s) => s.nome === "BonusAtaque" && s.valor === 1,
    ),
  );
});
test("Peste protege-se por Torre e sua aura também alcança Ratos que entrarem depois", () => {
  const a = setup();
  a.place("027");
  a.place("023", "q", 2);
  a.play("066");
  const newRat = a.play("027", { slotId: "p:front:1" });
  assert.equal(currentBasicAttack(a.slot("p", 1).card!, a.g.state.slots), 3);
  assert.equal(a.g.player("q").mage.statuses.length, 0);
  const b = setup();
  b.place("027");
  b.place("023", "q", 2);
  b.slot("q", 2).structure = b.card("056", "q");
  b.play("066");
  assert.equal(
    b.slot("q", 2).card!.statuses.some((s) => s.nome === "Peste Negra"),
    false,
  );
  assert.equal(currentBasicAttack(b.slot("p", 0).card!, b.g.state.slots), 2);
});
test("Cura bloqueia só o Médico, não consome ataque do mago e funciona depois de atacar", () => {
  const { g, place, slot, run } = setup();
  place("107");
  const ally = place("023", "p", 1, { hpAtual: 5 });
  place("020", "q", 1, { hp: 40, hpAtual: 40, resistencia: [], fraqueza: [] });
  run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "cura",
    targets: [ally.id],
  });
  assert.equal(slot("p", 1).card!.hpAtual, 7);
  assert.equal(g.player("p").counters.attacks, 0);
  assert.throws(() =>
    run({ type: "attack", slotId: "p:front:0", targetId: "q:front:1" }),
  );
  run({ type: "attack", slotId: "p:front:1", targetId: "q:front:1" });
  assert.equal(g.player("p").counters.attacks, 1);
  const b = setup();
  b.place("107", "p", 0, { attacked: true, attacksMade: 1 });
  b.g.player("p").counters.attacks = 1;
  b.g.player("p").mage.hpAtual = 10;
  b.run({
    type: "ability",
    slotId: "p:front:0",
    abilityId: "cura",
    targets: [b.g.player("p").mage.id],
  });
  assert.equal(b.g.player("p").mage.hpAtual, 12);
  assert.equal(b.g.player("p").counters.attacks, 1);
});
test("Propagar usa Leptospirose após sobreviver e apenas uma vez na rodada; Rato inimigo anula", () => {
  for (const blocked of [false, true]) {
    const { g, place, slot, attack } = setup();
    g.state.current = "q";
    place("089", "p", 0, { hpAtual: 8 });
    place("023", "q", 2, { ataque: 6 });
    place("023", "q", 1, { ataque: 6 });
    if (blocked) place("027", "q", 0);
    attack("q", 2, "p:front:0");
    assert.equal(g.player("q").mage.hpAtual, blocked ? 20 : 18);
    assert.equal(slot("p", 0).card!.hp, blocked ? 12 : 13);
    const mageHp = g.player("q").mage.hpAtual;
    attack("q", 1, "p:front:0");
    assert.equal(g.player("q").mage.hpAtual, mageHp);
  }
});
test("Enxame tem dois ataques e crescimento de vida é perdido ao sair do campo", () => {
  const { g, place, slot, attack, play } = setup();
  place("089");
  place("020", "q", 2, { hp: 40, hpAtual: 40, resistencia: [], fraqueza: [] });
  attack();
  attack();
  assert.throws(() => attack());
  const b = setup();
  b.place("089");
  const victim = b.place("023", "p", 1);
  b.play("115", { targets: [victim.id] });
  assert.equal(b.slot("p", 0).card!.hp, 13);
  b.g.state.current = "q";
  const bounce = b.card("004", "q");
  b.g.player("q").hand.push(bounce);
  b.run({
    type: "play",
    cardId: bounce.id,
    targets: [b.slot("p", 0).card!.id],
  });
  assert.equal(
    b.g.player("p").hand.find((c) => c.numeroCatalogo === "089")!.hp,
    12,
  );
});
test("cada Rato deixa maldição na posição roubada; comprar resolve dano e compra substituta, sem feitiço", () => {
  const { g, place, card, play, pass } = setup("019");
  place("027");
  place("027", "p", 1);
  g.player("q").hand = [];
  g.player("q").deck = [card("023", "q"), card("020", "q")];
  play("009");
  assert.equal(
    g.player("q").deck.filter((c) => c.onDrawEffects?.length).length,
    2,
  );
  assert.ok(g.player("p").hand.some((c) => c.numeroCatalogo === "020"));
  pass();
  assert.equal(g.player("q").mage.hpAtual, 18);
  assert.equal(
    g.player("q").graveyard.filter((c) => c.onDrawEffects?.length).length,
    2,
  );
  assert.equal(g.player("q").hand.length, 1);
  assert.equal(g.player("q").hand[0].numeroCatalogo, "023");
  assert.equal(g.player("q").counters.spells, 0);
});

test("migração preserva artes, versão e metadados, altera só regras e é idempotente", () => {
  for (const id of ["027", "048", "049", "066", "072", "089", "107"]) {
    const source = catalog.find((c) => c.numeroCatalogo === id)!;
    const before = {
      ...structuredClone(source),
      custoMana: 99,
      imgURL: "/avatars/custom.webp",
      versao: 13,
    };
    const plan = pestCardPatch(before),
      after = { ...before, ...plan.patch };
    for (const key of Object.keys(plan.unset)) delete (after as any)[key];
    assert.equal(after.imgURL, "/avatars/custom.webp");
    assert.equal(after.versao, 13);
    assert.equal(after.custoMana, source.custoMana);
    assert.deepEqual(pestCardPatch(after).patch, {});
    assert.deepEqual(pestCardPatch(after).unset, {});
  }
});

test("modo de armamento termina ao voltar à mão junto da tropa", () => {
  const b = setup();
  b.place("023");
  b.play("049", { slotId: "p:arm:front-left", mode: "fogo" });
  b.g.state.current = "q";
  const bounce = b.card("004", "q");
  b.g.player("q").hand.push(bounce);
  b.run({
    type: "play",
    cardId: bounce.id,
    targets: [b.slot("p", 0).card!.id],
  });
  const weapon = b.g.player("p").hand.find((c) => c.numeroCatalogo === "049")!;
  assert.equal(weapon.equipmentMode, undefined);
  assert.equal(weapon.bonusAtaque, 2);
});
