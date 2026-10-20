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
test("cinco definições e parâmetros novos sobrevivem ao Mongo e continuam executáveis", () => {
  for (const id of ["030", "039", "079", "120", "127"]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.deepEqual(playableErrors(c), []);
    const doc = new CardModel(c);
    assert.equal(doc.validateSync(), undefined);
    const restored = cardSchema.parse(cleanCard(doc.toObject()));
    assert.deepEqual(restored.efeitos, c.efeitos);
    assert.deepEqual(restored.habilidadesPassivas, c.habilidadesPassivas);
  }
});
test("Sifão confere mana antes do custo, arredonda para baixo e não transfere valores inexistentes", () => {
  const g = make();
  g.player("p1").mana = 4;
  g.player("p2").mana = 9;
  cast(g, "039");
  assert.equal(g.player("p1").mana, 7);
  assert.equal(g.player("p2").mana, 5);
  const h = make();
  h.player("p1").mana = 5;
  const c = card("039");
  h.player("p1").hand = [c];
  const before = JSON.stringify(h.exportState());
  assert.throws(() => act(h, { type: "play", cardId: c.id }), /Mana acima/);
  assert.equal(JSON.stringify(h.exportState()), before);
  const empty = make();
  empty.player("p1").mana = 4;
  empty.player("p2").mana = 0;
  cast(empty, "039");
  assert.equal(empty.player("p1").mana, 3);
  assert.equal(empty.player("p2").mana, 0);
});
test("Sifão retorna só por outra carta Zarcos própria e uma vez por cópia no ciclo, sem repetir a ação", () => {
  let g = make();
  g.player("p1").mana = 4;
  const siphon = cast(g, "039");
  cast(g, "040", [], { custoMana: 0 });
  assert.ok(g.player("p1").hand.some((c) => c.id === siphon.id));
  g.player("p1").mana = 4;
  act(g, { type: "play", cardId: siphon.id });
  cast(g, "040", [], { custoMana: 0 });
  assert.ok(g.player("p1").graveyard.some((c) => c.id === siphon.id));
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  assert.ok(g.player("p1").returnUsedUntil?.[siphon.id]);
});
for (const start of [3, 4])
  test(
    "Raiz responde a qualquer jogador só no turno da aplicação e no seguinte; início " +
      start,
    () => {
      const g = make(start);
      const target = g.player("p1").mage;
      const root = cast(g, "079", [target.id]);
      assert.equal(g.state.attachments!.length, 1);
      assert.equal(
        g.snapshot("p1").slots.find((s) => s.id === "p1:mage")!.card!
          .manaRecovery,
        5,
      );
      end(g);
      cast(g, "040", [], { custoMana: 0 });
      assert.equal(g.state.attachments!.length, 0);
      assert.ok(g.player("p1").graveyard.some((c) => c.id === root.id));
      const h = make(start);
      const persistent = cast(h, "079", [h.player("p1").mage.id]);
      end(h);
      end(h);
      cast(h, "040", [], { custoMana: 0 });
      assert.ok(
        h.state.attachments!.some((a) => a.source.id === persistent.id),
      );
    },
  );
test("Raízes acumulam após a janela e saem quando o receptor morre", () => {
  const g = make();
  const ally = card("023", "p1", {
    hp: 20,
    elemento: "Neutro",
    habilidadesPassivas: [],
  });
  slot(g, "p1:front:0").card = ally;
  cast(g, "079", [ally.id]);
  end(g);
  end(g);
  cast(g, "079", [ally.id]);
  assert.equal(g.state.attachments!.length, 2);
  assert.equal(
    g.snapshot("p1").slots.find((s) => s.id === "p1:front:0")!.card!
      .manaRecovery,
    4,
  );
  const current = slot(g, "p1:front:0").card!;
  current.hpAtual = 0;
  (g as any).resolve();
  assert.equal(g.state.attachments!.length, 0);
  assert.equal(
    g.player("p1").graveyard.filter((c) => c.numeroCatalogo === "079").length,
    2,
  );
});
test("Amplificar acumula sem aumentar seu próprio bônus, desconta custos até zero e expira por ciclo", () => {
  const g = make();
  const first = cast(g, "127");
  assert.equal(g.player("p1").mana, 14);
  const second = cast(g, "127");
  assert.equal(g.player("p1").mana, 10);
  assert.deepEqual(
    g
      .player("p1")
      .mage.statuses.map((s) => [
        s.spellBoost?.bonus,
        s.spellBoost?.descontoMana,
        s.turnosRestantes,
      ]),
    [
      [1, 2, 2],
      [1, 2, 3],
    ],
  );
  assert.equal(first.custoMana, 6);
  assert.equal(second.custoMana, 6);
  assert.equal(modifiedSpell(card("039"), g.player("p1").mage).custoMana, 0);
  end(g);
  end(g);
  assert.deepEqual(
    g.player("p1").mage.statuses.map((s) => s.turnosRestantes),
    [1, 2],
  );
  end(g);
  end(g);
  assert.equal(g.player("p1").mage.statuses.length, 1);
  end(g);
  end(g);
  assert.equal(g.player("p1").mage.statuses.length, 0);
});
test("Amplificar aumenta dano, duração, bônus de reviver e mana, preservando alvos e recompensas", () => {
  const g = make();
  cast(g, "127");
  const buff = modifiedSpell(card("064"), g.player("p1").mage);
  assert.equal(buff.efeitos[0].valor, 2);
  assert.equal(buff.efeitos[1].duracao, 3);
  const revived = modifiedSpell(card("080"), g.player("p1").mage);
  assert.equal(revived.efeitos[0].bonusAtaque, 3);
  assert.equal(revived.efeitos[0].bonusHp, 4);
  assert.equal(revived.efeitos[0].recompensaMorteRodada!.mana, 6);
  assert.equal(revived.maxAlvos, 1);
  const before = g.player("p1").mana;
  cast(g, "040");
  assert.equal(g.player("p1").mana, before + 4);
  const enemy = slot(g, "p2:front:2").card!;
  cast(g, "054", [enemy.id]);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 34);
});
test("Olho descarta pelo custo atual, sem custo ou limite de feitiço; preparação e turno 1 rejeitam", () => {
  const g = make();
  cast(g, "127");
  const eye = card("030");
  g.player("p1").hand.push(eye);
  g.player("p1").mana = 0;
  const used = g.player("p1").counters.spells;
  const data = {
    type: "discardHand",
    cardId: eye.id,
    actionId: randomUUID(),
    version: g.state.version,
  };
  g.execute("p1", data);
  g.execute("p1", data);
  assert.equal(g.player("p1").mana, 2);
  assert.equal(g.player("p1").counters.spells, used);
  assert.ok(g.player("p1").graveyard.some((c) => c.id === eye.id));
  for (const phase of ["PREPARATION", "BATTLE"] as const) {
    const h = make(1);
    h.state.phase = phase;
    const c = card("030");
    h.player("p1").hand = [c];
    assert.throws(
      () => act(h, { type: "discardHand", cardId: c.id }),
      /mobilizar|Descarte/,
    );
  }
  assert.throws(
    () => act(g, { type: "discardHand", cardId: card("023").id }),
    /não permite/,
  );
});
test("Chuva Ácida preserva duração por dois ciclos, atinge tropas e mago, estruturas absorvem e duplicata reverte", () => {
  let g = make(4);
  slot(g, "p2:front:2").structure = card("056", "p2", {
    hp: 20,
    elemento: "Neutro",
    fraqueza: [],
    resistencia: [],
  });
  cast(g, "120");
  const before = g.player("p2").mage.hpAtual;
  const duplicate = card("120");
  g.player("p1").hand.push(duplicate);
  const state = JSON.stringify(g.exportState());
  assert.throws(() => act(g, { type: "play", cardId: duplicate.id }), /já tem/);
  assert.equal(JSON.stringify(g.exportState()), state);
  end(g);
  assert.equal(slot(g, "p2:front:2").structure!.hpAtual, 20);
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  end(g);
  assert.equal(slot(g, "p2:front:2").structure!.hpAtual, 18);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40);
  assert.equal(g.player("p2").mage.hpAtual, before - 2);
  end(g);
  end(g);
  assert.equal(slot(g, "p2:front:2").structure!.hpAtual, 16);
  assert.equal(g.state.ongoingSpells!.length, 0);
});

test("Amplificar fortalece dano e duração dos status secundários da Chuva de Flechas", () => {
  const g = make();
  g.player("p1").mage.elemento = "Ar";
  cast(g, "127");
  cast(g, "005");
  const c = slot(g, "p2:front:2").card!;
  assert.equal(c.statuses[0].nome, "Sangrando");
  assert.equal(c.statuses[0].valor, 2);
  assert.equal(c.statuses[0].turnosRestantes, 4);
  end(g);
  end(g);
  assert.equal(slot(g, "p2:front:2").card!.hpAtual, 34);
});

test("migração das cinco cartas preserva arte, versão e campos fora da regra, e é idempotente", async () => {
  const { zarcosExpansionPatch } =
    await import("../scripts/update-zarcos-expansion");
  for (const id of ["030", "039", "079", "120", "127"]) {
    const base = catalog.find((c) => c.numeroCatalogo === id)!;
    const record = {
      ...structuredClone(base),
      versao: 19,
      imgURL: "/custom.png",
      descricao: "antiga",
      ...(id === "030"
        ? { habilidadesPassivas: [] }
        : { efeitos: [], publicado: false }),
    };
    const p = zarcosExpansionPatch(record);
    const next = { ...record, ...p.patch } as Record<string, unknown>;
    for (const key of Object.keys(p.unset)) delete next[key];
    assert.equal(next.imgURL, "/custom.png");
    assert.equal(next.versao, 19);
    assert.deepEqual(zarcosExpansionPatch(next).patch, {});
  }
  assert.throws(
    () =>
      zarcosExpansionPatch(catalog.find((c) => c.numeroCatalogo === "021")!),
    /fora/,
  );
});
test("Sifão amplificado rouba mais 1 e fica gratuito, mantendo a checagem de mana anterior", () => {
  const g = make();
  cast(g, "127");
  g.player("p1").mana = 4;
  g.player("p2").mana = 9;
  cast(g, "039");
  assert.equal(g.player("p1").mana, 9);
  assert.equal(g.player("p2").mana, 4);
});
