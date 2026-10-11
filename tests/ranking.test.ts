import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
test("rankings públicos usam histórico real, desempates, mínimo de 10 e paginação sem expor a conta", async () => {
  const db = await fakeDatabase();
  db.users.length = 0;
  const id = (n: number) => n.toString(16).padStart(24, "0");
  const player = (n: number, wins: number, matches: number) => {
    db.users.push({
      _id: id(n),
      nome: `Duelista ${n}`,
      avatarURL: "/assets/avatar.png",
      senha: "private",
      email: "private",
      admin: true,
      vitorias: 99999,
      partidas: 99999,
    });
    for (let i = 0; i < matches; i++)
      db.matches.push({
        matchId: `${n}-${i}`,
        players: [{ userId: id(n) }],
        winner: i < wins ? id(n) : null,
      });
  };
  player(1, 12, 24);
  player(2, 8, 10);
  player(3, 8, 12);
  player(4, 8, 12);
  player(5, 1, 1);
  for (let n = 6; n <= 27; n++) player(n, 0, 1);
  player(28, 0, 0);
  const server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const read = async (path: string) =>
    (await fetch(base + path)).json() as Promise<any>;
  try {
    const wins = await read("/rankings");
    assert.deepEqual(
      wins.podium.map((p: any) => p.id),
      [id(1), id(2), id(3)],
    );
    assert.equal(wins.total, 27);
    assert.equal(wins.minimumMatches, 1);
    assert.equal(wins.players.length, 20);
    assert.equal(wins.hasMore, true);
    assert.equal(wins.podium[0].vitorias, 12);
    assert.equal(wins.podium[0].nivel, 3);
    assert.equal(wins.players[0].id, id(4));
    assert.equal(wins.players[0].position, 4);
    for (const p of [...wins.podium, ...wins.players])
      assert.deepEqual(
        Object.keys(p).sort(),
        [
          "id",
          "nome",
          "avatarURL",
          "partidas",
          "vitorias",
          "taxaVitorias",
          "nivel",
          "position",
        ].sort(),
      );
    const second = await read("/rankings?page=1");
    assert.equal(second.players.length, 4);
    assert.equal(second.players[0].position, 24);
    assert.equal(second.hasMore, false);
    const rate = await read("/rankings?mode=rate");
    assert.equal(rate.minimumMatches, 10);
    assert.equal(rate.total, 4);
    assert.deepEqual(
      rate.podium.map((p: any) => p.id),
      [id(2), id(3), id(4)],
    );
    assert.equal(rate.podium[0].taxaVitorias, 80);
    assert.equal(rate.players[0].id, id(1));
    assert.equal((await fetch(base + "/rankings?mode=wrong")).status, 422);
    assert.equal((await fetch(base + "/rankings?page=-1")).status, 422);
    for (const path of ["/ranking", "/regras"])
      assert.equal((await fetch(base + path)).status, 200);
    const rules = await read("/rules-data");
    assert.equal(Object.keys(rules.reactions).length, 8);
    db.matches.length = 0;
    assert.equal((await read("/rankings?mode=rate")).total, 0);
    db.users.length = 0;
    const empty = await read("/rankings");
    assert.deepEqual(empty.podium, []);
    assert.deepEqual(empty.players, []);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
