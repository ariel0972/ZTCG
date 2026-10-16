import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import { invalidateRankings } from "../src/services/ranking-cache";
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
        finishedAt: new Date(2026, 9, 1, 0, i),
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
    assert.equal(wins.podium[0].nivel, 5);
    assert.equal(wins.podium[0].xp, 1020);
    assert.equal(wins.podium[0].titulo, "Thumo praticante");
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
          "titulo",
          "xp",
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
    assert.equal(rules.experience.maximumMultiplier, 1.5);
    assert.equal(rules.experience.interrupted, 20);
    assert.equal(rules.experience.thresholds[30].xp, 82100);
    assert.equal(rules.experience.titles.at(-1).max, null);
    db.matches.length = 0;
    invalidateRankings();
    assert.equal((await read("/rankings?mode=rate")).total, 0);
    db.users.length = 0;
    invalidateRankings();
    const empty = await read("/rankings");
    assert.deepEqual(empty.podium, []);
    assert.deepEqual(empty.players, []);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});

test("baralhos públicos: mínimo por deck, dono correto, desempates, histórico após editar e privacidade", async () => {
  const db = await fakeDatabase();
  db.decks.length = 0;
  const owner = "1".repeat(24),
    other = "2".repeat(24);
  const id = (n: number) => n.toString(16).padStart(24, "0");
  function deck(
    n: number,
    wins: number,
    games: number,
    publico = true,
    userId = owner,
  ) {
    const value = {
      _id: id(n),
      userId,
      nome: `Estratégia ${n}`,
      publico,
      cartas: ["023"],
      mago: "108",
      icone: "/assets/icons/fogo.svg",
      createdAt: new Date(2026, 0, n),
    };
    db.decks.push(value);
    for (let i = 0; i < games; i++)
      db.matches.push({
        matchId: `deck-${n}-${i}`,
        players: [{ userId, deckId: id(n) }],
        winner: i < wins ? userId : null,
      });
    return value;
  }
  const first = deck(1, 14, 20);
  deck(2, 7, 10);
  deck(3, 7, 10);
  deck(4, 9, 9); // Not yet eligible, even though its owner has many games.
  deck(5, 10, 10, false);
  deck(6, 10, 10, true, "f".repeat(24)); // Owner no longer exists.
  for (let n = 7; n <= 30; n++) deck(n, 0, 10);
  // Never combine this owner's unrelated deck with the other player's deckId.
  db.matches.push({
    matchId: "wrong-participant",
    players: [
      { userId: owner, deckId: id(99) },
      { userId: other, deckId: id(1) },
    ],
    winner: owner,
  });
  const server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const read = async (query = "") =>
    (await fetch(`${base}/rankings?mode=decks${query}`)).json() as Promise<any>;
  try {
    const ranking = await read();
    assert.deepEqual(
      ranking.podium.map((d: any) => d.id),
      [id(1), id(2), id(3)],
    );
    assert.equal(ranking.total, 27);
    assert.equal(ranking.minimumMatches, 10);
    assert.equal(ranking.podium[0].partidas, 20);
    assert.equal(ranking.podium[0].taxaVitorias, 70);
    assert.equal(ranking.decks.length, 20);
    assert.equal(ranking.hasMore, true);
    for (const d of [...ranking.podium, ...ranking.decks]) {
      assert.deepEqual(
        Object.keys(d).sort(),
        [
          "id",
          "nome",
          "icone",
          "partidas",
          "vitorias",
          "taxaVitorias",
          "position",
          "dono",
        ].sort(),
      );
      assert.deepEqual(Object.keys(d.dono).sort(), ["id", "nome"]);
      assert.equal(d.dono.id, owner);
      assert.notEqual(d.id, id(5));
      assert.notEqual(d.id, id(6));
    }
    const last = await read("&page=1");
    assert.equal(last.decks[0].position, 24);
    assert.equal(last.decks.length, 4);
    assert.equal(last.hasMore, false);
    first.cartas = ["001"];
    first.mago = "028";
    assert.equal((await read()).podium[0].partidas, 20);
    first.publico = false;
    const hidden = await read();
    assert.equal(hidden.total, 26);
    assert.ok(![...hidden.podium, ...hidden.decks].some((d) => d.id === id(1)));
    db.matches.length = 0;
    invalidateRankings();
    assert.deepEqual((await read()).podium, []);
    assert.deepEqual((await read()).decks, []);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
