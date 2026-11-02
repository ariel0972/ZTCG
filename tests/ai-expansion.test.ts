import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { validateDeck, deckRules } from "../src/domain/deck";
import { randomAiDeck } from "../src/game/ai-deck";
import { aiEntry, chooseAiCommand } from "../src/game/ai";
import { aiStrategy } from "../src/game/ai-strategy";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
const catalog = raw.map((c) => cardSchema.parse(c));
function rng(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function setup() {
  const bot = aiEntry(catalog, 0, { mageId: "016" }, rng(1)),
    human = {
      ...aiEntry(catalog, 0, { mageId: "016" }, rng(2)),
      id: "human",
      nome: "Aprendiz",
      bot: false,
    };
  const g = new Game(randomUUID(), [human, bot], catalog, rng(3));
  g.state.phase = "BATTLE";
  g.state.turn = 3;
  g.state.current = bot.id;
  for (const p of g.state.players) {
    p.mana = 20;
    p.hand = [];
    p.preparation.ready = true;
  }
  const card = (ref: string, owner = bot.id): Instance => {
    const c = catalog.find((c) => c.numeroCatalogo === ref)!;
    return {
      ...structuredClone(c),
      id: randomUUID(),
      ownerId: owner,
      hpAtual: c.hp ?? 0,
      attacked: false,
      usedAbility: false,
      statuses: [],
    };
  };
  const execute = (command: Record<string, unknown>) =>
    g.execute(bot.id, {
      ...command,
      version: g.state.version,
      actionId: randomUUID(),
    });
  return { g, bot, human, card, execute };
}
test("baralhos aleatórios respeitam cópias, publicações e mago, incluindo armas e estruturas", () => {
  const signatures = new Set<string>(),
    mages = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) {
    const d = randomAiDeck(catalog, undefined, rng(seed));
    assert.deepEqual(validateDeck(d, catalog, true), []);
    assert.equal(d.cartas.length, 40);
    mages.add(d.mago!);
    signatures.add(d.cartas.join(","));
    assert.ok(
      d.cartas.some(
        (id) =>
          catalog.find((c) => c.numeroCatalogo === id)!.tipo === "Armamento",
      ),
    );
    assert.ok(
      d.cartas.some(
        (id) =>
          catalog.find((c) => c.numeroCatalogo === id)!.tipo === "Estrutura",
      ),
    );
    for (const id of new Set(d.cartas)) {
      const c = catalog.find((c) => c.numeroCatalogo === id)!;
      assert.ok(
        d.cartas.filter((x) => x === id).length <= deckRules.copias[c.tipo],
      );
      assert.ok(
        !c.requerElementoMago ||
          c.requerElementoMago ===
            catalog.find((c) => c.numeroCatalogo === d.mago)!.elemento,
      );
    }
  }
  assert.ok(signatures.size > 40);
  assert.ok(mages.size >= 4);
  for (const mage of catalog.filter((c) => c.publicado && c.tipo === "Mago"))
    assert.equal(
      randomAiDeck(catalog, mage.numeroCatalogo, rng(1)).mago,
      mage.numeroCatalogo,
    );
  assert.throws(() => randomAiDeck(catalog, "001", rng(1)));
});
test("IA prioriza o mago exposto, inclusive com uma finalização por feitiço", () => {
  const { g, bot, human, card, execute } = setup();
  const direct = chooseAiCommand(g, bot.id)!;
  assert.equal(direct.type, "attack");
  assert.equal(direct.targetId, human.id + ":mage");
  g.player(human.id).mage.hpAtual = 1;
  g.player(bot.id).mage.attacked = true;
  g.player(bot.id).hand = [card("064")];
  const spell = chooseAiCommand(g, bot.id)!;
  assert.equal(spell.type, "play");
  execute(spell);
  assert.equal(g.state.winner, bot.id);
});
test("IA antecipa arma seguida de ataque letal e pode colocar estrutura na preparação", () => {
  const { g, bot, human, card, execute } = setup();
  g.player(human.id).mage.hpAtual = 5;
  g.player(bot.id).hand = [card("037")];
  const equip = chooseAiCommand(g, bot.id)!;
  assert.equal(equip.type, "play");
  assert.ok(String(equip.slotId).includes(":arm:back-"));
  execute(equip);
  const kill = chooseAiCommand(g, bot.id)!;
  assert.equal(kill.type, "attack");
  execute(kill);
  assert.equal(g.state.winner, bot.id);
  const two = setup();
  two.g.state.phase = "PREPARATION";
  two.g.state.turn = 1;
  two.g.player(two.bot.id).preparation.ready = false;
  two.g.state.slots.find((s) => s.id === two.bot.id + ":front:0")!.card =
    two.card("023");
  two.g.player(two.bot.id).hand = [two.card("056")];
  const tower = chooseAiCommand(two.g, two.bot.id)!;
  assert.equal(tower.type, "play");
  two.execute(tower);
  assert.equal(
    two.g.state.slots.find((s) => s.id === tower.slotId)!.structure
      ?.numeroCatalogo,
    "056",
  );
});
test("IA adapta prioridade à mão, vida e campo e não gasta feitiço de dano sem alvo", () => {
  const { g, bot, human, card } = setup();
  assert.equal(aiStrategy(g, bot.id), "pressure");
  g.player(bot.id).hand = [card("023")];
  assert.equal(aiStrategy(g, bot.id), "develop");
  g.player(bot.id).mage.hpAtual = 3;
  assert.equal(aiStrategy(g, bot.id), "survive");
  g.player(human.id).mage.hpAtual = 2;
  assert.equal(aiStrategy(g, bot.id), "finish");
  g.player(human.id).mage.hpAtual = 20;
  g.player(bot.id).mage.hpAtual = 20;
  g.player(bot.id).mage.attacked = true;
  g.player(bot.id).hand = [card("001")];
  assert.equal(chooseAiCommand(g, bot.id)!.type, "endTurn");
});

test("previsão de roubo não consulta a carta oculta do baralho inimigo", () => {
  const { g, bot, human, card } = setup();
  g.player(bot.id).mage.hpAtual = 10;
  g.player(bot.id).mage.attacked = true;
  g.player(human.id).mage.hpAtual = 3;
  const steal = {
    ...card("066"),
    id: "steal",
    custoMana: 1,
    alvo: "Global" as const,
    efeitos: [{ id: "stealDeck", valor: 1 }],
    habilidadesPassivas: [],
  };
  const heal = {
    ...card("002"),
    id: "heal",
    custoMana: 1,
    elemento: "Neutro" as const,
    alvo: "UnicoAliado" as const,
    efeitos: [{ id: "heal", valor: 2 }],
  };
  g.player(bot.id).hand = [steal, heal];
  g.player(human.id).deck = [card("001", human.id)];
  const before = chooseAiCommand(g, bot.id);
  g.player(human.id).deck = [card("027", human.id)];
  assert.deepEqual(chooseAiCommand(g, bot.id), before);
});
