import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, type Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
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
function make(turn: number) {
  const cards = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: { nome: "Teste", mago: id === "p1" ? "016" : "108", cartas: cards },
    })),
    catalog,
    () => 0.8,
  );
  g.state.phase = "BATTLE";
  g.state.turn = turn;
  g.state.round = 3;
  g.state.current = "p1";
  for (const p of g.state.players) {
    p.mana = 20;
    p.hand = [];
    p.mage.habilidadesPassivas = [];
    p.mage.limites[0].feiticosUsados = 20;
  }
  slot(g, "p2:front:2").card = instance("023", "p2", {
    hp: 40,
    elemento: "Neutro",
    fraqueza: [],
    resistencia: [],
    habilidadesPassivas: [],
    habilidadesAtivas: [],
  });
  return g;
}
const slot = (g: Game, id: string) => g.state.slots.find((s) => s.id === id)!;
const act = (g: Game, data: object) =>
  g.execute(g.state.current, {
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
) {
  const c = instance(id, "p1", extra);
  g.player("p1").hand.push(c);
  act(g, { type: "play", cardId: c.id, targets });
}
for (const turn of [3, 4]) {
  test(
    "status e dano periódico esperam ciclos completos; ativação no turno " +
      turn,
    () => {
      let g = make(turn);
      const c = slot(g, "p2:front:2").card!;
      applyStatus(c.statuses, "Cego", 1, undefined, turn);
      applyStatus(c.statuses, "Envenenado", 3, undefined, turn);
      end(g);
      assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40);
      assert.ok(
        slot(g, "p2:front:2").card!.statuses.some((s) => s.nome === "Cego"),
      );
      g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
      end(g);
      assert.equal(slot(g, "p2:front:2").card!.hpAtual, 39);
      assert.ok(
        !slot(g, "p2:front:2").card!.statuses.some((s) => s.nome === "Cego"),
      );
      end(g);
      assert.equal(slot(g, "p2:front:2").card!.hpAtual, 39);
      end(g);
      assert.equal(slot(g, "p2:front:2").card!.hpAtual, 38);
      end(g);
      end(g);
      assert.equal(slot(g, "p2:front:2").card!.hpAtual, 37);
      assert.equal(slot(g, "p2:front:2").card!.statuses.length, 0);
    },
  );
  test(
    "feitiço contínuo, campo e terreno mantêm duração após passar; turno " +
      turn,
    () => {
      const g = make(turn);
      cast(g, "009");
      cast(g, "031");
      slot(g, "p1:front:0").terrain = {
        nome: "Lama",
        rodadasRestantes: 1,
        nextTickTurn: turn + 1,
      };
      end(g);
      assert.equal(g.state.fieldEffects![0].rounds, 3);
      assert.equal(g.state.ongoingSpells![0].rounds, 1);
      assert.ok(slot(g, "p1:front:0").terrain);
      assert.equal(slot(g, "p2:front:2").card!.hpAtual, 40);
      end(g);
      assert.equal(g.state.fieldEffects![0].rounds, 2);
      assert.equal(g.state.ongoingSpells!.length, 0);
      assert.equal(slot(g, "p1:front:0").terrain, undefined);
      assert.ok(slot(g, "p2:front:2").card!.hpAtual < 40);
    },
  );
  test(
    "Cauterizar cura só após os dois jogadores passarem; turno " + turn,
    () => {
      let g = make(turn);
      g.player("p1").mage.hpAtual = 10;
      cast(g, "104", [g.player("p1").mage.id]);
      assert.equal(g.player("p1").mage.hpAtual, 9);
      end(g);
      assert.equal(g.player("p1").mage.hpAtual, 9);
      g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
      end(g);
      assert.equal(g.player("p1").mage.hpAtual, 12);
      assert.equal(g.player("p1").mage.scheduledHeals!.length, 0);
      end(g);
      end(g);
      assert.equal(g.player("p1").mage.hpAtual, 12);
    },
  );
  test(
    "efeito agendado inicia após ciclo e dura um novo ciclo; turno " + turn,
    () => {
      const g = make(turn);
      const c = slot(g, "p2:front:2").card!;
      c.elemento = "Terra";
      cast(g, "057", [c.id]);
      end(g);
      assert.equal(slot(g, "p2:front:2").card!.statuses.length, 0);
      end(g);
      assert.ok(
        slot(g, "p2:front:2").card!.statuses.some(
          (s) => s.nome === "SemAtaque",
        ),
      );
      end(g);
      assert.ok(
        slot(g, "p2:front:2").card!.statuses.some(
          (s) => s.nome === "SemAtaque",
        ),
      );
      end(g);
      assert.equal(slot(g, "p2:front:2").card!.statuses.length, 0);
    },
  );
}
test("efeitos por turno mantêm expiração imediata e estados antigos recebem relógio seguro", () => {
  const g = make(4);
  const c = slot(g, "p2:front:2").card!;
  applyStatus(c.statuses, "BonusAtaque", 1, 1, 4, "turno");
  c.statuses.push({ nome: "Cego", turnosRestantes: 1 });
  end(g);
  assert.ok(
    !slot(g, "p2:front:2").card!.statuses.some((s) => s.nome === "BonusAtaque"),
  );
  assert.ok(
    slot(g, "p2:front:2").card!.statuses.some((s) => s.nome === "Cego"),
  );
  end(g);
  assert.equal(slot(g, "p2:front:2").card!.statuses.length, 0);
});
