import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { Game } from "../src/game/engine";
import { DurableGame, TURN_MS } from "../src/game/durable";
import { MemoryDurableStore } from "./support/durable-store";
import {
  resolveCoinToss,
  COIN_CHOICE_MS,
  COIN_REVEAL_MS,
} from "../src/game/coin-toss";
const catalog = raw.map((c) => cardSchema.parse(c));
const cartas = catalog
  .filter((c) => c.publicado && c.tipo === "Tropa")
  .flatMap((c) => Array(3).fill(c.numeroCatalogo))
  .slice(0, 40);
const deck = { nome: "Teste", mago: "108", cartas };
function make() {
  return new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({ id, nome: id, deck })),
    catalog,
    () => 0.2,
  );
}
const act = (g: Game, user: string, data: object) =>
  g.execute(user, {
    ...data,
    actionId: randomUUID(),
    version: g.state.version,
  });
function ready(g: Game) {
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
}
test("preparação entra em sorteio antes de compra ou recuperação, com escolha exclusiva e resultado persistido", () => {
  let g = make();
  ready(g);
  assert.equal(g.state.phase, "COIN_TOSS");
  assert.equal(g.player("p1").mana, 5);
  assert.equal(g.player("p1").hand.length, 5);
  const chooser = g.state.coinToss!.chooserId;
  const other = g.state.players.find((p) => p.id !== chooser)!.id;
  assert.throws(
    () => act(g, other, { type: "chooseCoin", face: "heads" }),
    /jogador sorteado/,
  );
  assert.throws(
    () => act(g, chooser, { type: "endTurn" }),
    /Aguarde o sorteio/,
  );
  const command = {
    type: "chooseCoin",
    face: "tails",
    actionId: randomUUID(),
    version: g.state.version,
  };
  g.execute(chooser, command);
  const outcome = structuredClone(g.state.coinToss);
  assert.equal(outcome!.choices[chooser], "tails");
  assert.equal(outcome!.choices[other], "heads");
  g.execute(chooser, command);
  assert.deepEqual(g.state.coinToss, outcome);
  assert.equal(g.state.phase, "COIN_TOSS");
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  assert.deepEqual(g.snapshot(other).coinToss, outcome);
  g.timeout();
  assert.equal(g.state.phase, "BATTLE");
  assert.equal(g.state.current, outcome!.winnerId);
  assert.equal(g.state.turn, 1);
  assert.equal(g.state.round, 2);
  assert.equal(g.player(g.state.current).hand.length, 6);
  assert.ok(g.player(g.state.current).mana > 5);
});
test("ambas as faces podem ganhar e timeout escolhe automaticamente sem penalidade de inatividade", () => {
  for (const value of [0.1, 0.9]) {
    const g = make();
    ready(g);
    resolveCoinToss(g.state.coinToss!, g.state.players, "heads", () => value);
    assert.equal(g.state.coinToss!.result, value < 0.5 ? "heads" : "tails");
    assert.equal(
      g.state.coinToss!.choices[g.state.coinToss!.winnerId!],
      g.state.coinToss!.result,
    );
  }
  const g = make();
  ready(g);
  g.timeout();
  assert.ok(g.state.coinToss!.result);
  assert.equal(g.state.phase, "COIN_TOSS");
  assert.ok(g.state.players.every((p) => p.inactivityStreak === 0));
  g.timeout();
  assert.equal(g.state.phase, "BATTLE");
});
test("serviço preserva prazos da escolha/animação em reinício e só então inicia turno completo", async () => {
  let now = 1000000;
  const store = new MemoryDurableStore();
  const service = () =>
    new DurableGame(
      store,
      () => now,
      async () => ({ deck, catalog }) as any,
      async () => {},
    );
  await service().join("p1", "Um", "deck", randomUUID());
  await service().join("p2", "Dois", "deck", randomUUID());
  const id = (await service().state("p1")).match!.id;
  for (const user of ["p1", "p2"]) {
    const s = (await service().state(user)).match!;
    await service().command(id, user, {
      type: "endTurn",
      actionId: randomUUID(),
      version: s.version,
    });
  }
  let state = (await service().state("p1")).match!;
  assert.equal(state.phase, "COIN_TOSS");
  assert.equal(state.deadline, now + COIN_CHOICE_MS);
  const chooser = state.coinToss!.chooserId;
  await service().command(id, chooser, {
    type: "chooseCoin",
    face: "heads",
    actionId: randomUUID(),
    version: state.version,
  });
  state = (await service().state("p1")).match!;
  assert.equal(state.deadline, now + COIN_REVEAL_MS);
  const winner = state.coinToss!.winnerId;
  now += COIN_REVEAL_MS - 1;
  state = (await service().state("p2")).match!;
  assert.equal(state.phase, "COIN_TOSS");
  now++;
  state = (await service().state("p2")).match!;
  assert.equal(state.phase, "BATTLE");
  assert.equal(state.current, winner);
  assert.equal(state.deadline, now + TURN_MS);
});
