import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import { progression } from "../src/services/profiles";
import { deckDTO } from "../src/services/decks";
test("nível deriva de todas as partidas concluídas", () => {
  assert.equal(progression(0).nivel, 1);
  assert.equal(progression(9).nivel, 1);
  assert.equal(progression(10).nivel, 2);
  assert.equal(progression(41).nivel, 5);
  assert.equal(progression(41).progresso, 1);
});
test("perfis usam totais reais, paginam histórico e respeitam baralhos privados", async () => {
  process.env.SECRET = "profiles-test-only-012345678901234567890";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    id = "1".repeat(24),
    other = "2".repeat(24);
  for (let i = 0; i < 41; i++)
    db.matches.push({
      matchId: randomUUID(),
      players: [
        { userId: id, nome: "Um", deckId: "private" },
        { userId: other, nome: "Dois", deckId: "private" },
      ],
      winner: i < 31 ? id : i < 36 ? other : null,
      turns: 10,
      finishedAt: new Date(2026, 9, 1, 0, i),
      reason: "Mago derrotado.",
    });
  const call = async (path: string, who = other, body?: object) => {
    const response = await fetch(base + path, {
      method: body ? "PUT" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt.sign({ id: who }, process.env.SECRET!)}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  try {
    const publicProfile = await call(`/profiles/${id}`);
    assert.equal(publicProfile.status, 200);
    const data = publicProfile.data;
    assert.equal(data.stats.partidas, 41);
    assert.equal(data.stats.vitorias, 31);
    assert.equal(data.stats.empates, 5);
    assert.equal(data.stats.derrotas, 5);
    assert.equal(data.stats.nivel, 5);
    assert.equal(data.matches.length, 20);
    assert.equal(data.hasMore, true);
    assert.deepEqual(data.decks, []);
    assert.equal(data.user.email, undefined);
    assert.equal(data.user.senha, undefined);
    assert.equal(data.user.admin, undefined);
    assert.equal(data.matches[0].players[0].deckId, undefined);
    const second = (await call(`/profiles/${id}?page=1`)).data,
      third = (await call(`/profiles/${id}?page=2`)).data;
    assert.equal(second.matches.length, 20);
    assert.equal(third.matches.length, 1);
    assert.equal(third.hasMore, false);
    assert.equal(
      new Set(
        [...data.matches, ...second.matches, ...third.matches].map(
          (m) => m.matchId,
        ),
      ).size,
      41,
    );
    const own = (await call(`/profiles/${id}`, id)).data;
    assert.equal(own.owner, true);
    assert.ok(own.decks.length);
    const deck = own.decks[0];
    const input = {
      nome: deck.nome,
      cartas: deck.cartas,
      mago: deck.mago,
      icone: deck.icone,
      verso: deck.verso,
      revisao: deck.revisao,
      publico: true,
    };
    assert.equal((await call(`/decks/${deck._id}`, other, input)).status, 404);
    const saved = await call(`/decks/${deck._id}`, id, input);
    assert.equal(saved.status, 200);
    const shared = (await call(`/profiles/${id}`)).data.decks;
    assert.equal(shared.length, 1);
    assert.deepEqual(shared[0].cartas, deck.cartas);
    assert.equal(shared[0].userId, undefined);
    assert.equal(
      (
        await call(`/decks/${deck._id}`, id, {
          ...input,
          revisao: saved.data.deck.revisao,
          publico: false,
        })
      ).status,
      200,
    );
    assert.deepEqual((await call(`/profiles/${id}`)).data.decks, []);
    assert.equal((await call("/profiles/not-valid")).status, 422);
    assert.equal((await call(`/profiles/${"f".repeat(24)}`)).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
