import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import { playerName, playerNameKey } from "../src/services/player-name";
import User from "../src/db/models/user";
test("nomes normalizam acentos, caixa e espaços; o banco define exclusividade", () => {
  assert.equal(playerName.parse("  Áriel   Silva  "), "Áriel Silva");
  assert.equal(playerNameKey("  ÁRIEL   Silva "), playerNameKey("ariel silva"));
  assert.equal(playerName.safeParse("abc").success, false);
  assert.ok(
    User.schema
      .indexes()
      .some(([key, options]) => key.nomeKey === 1 && options.unique),
  );
});
test("cadastro e edição rejeitam nome curto, duplicado e corrida entre cadastros", async () => {
  process.env.SECRET = "names-test-012345678901234567890123456";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (path: string, body: object, id?: string) => {
    const response = await fetch(base + path, {
      method: id ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(id
          ? { Authorization: `Bearer ${jwt.sign({ id }, process.env.SECRET!)}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  const registration = (nome: string, email: string) => ({
    nome,
    email,
    senha: "segredo-123",
    confirmPassword: "segredo-123",
  });
  try {
    assert.equal(
      (await call("/auth/registrar", registration("abc", "short@test.local")))
        .status,
      422,
    );
    assert.equal(
      (
        await call(
          "/auth/registrar",
          registration("Duélísta 1", "duplicate@test.local"),
        )
      ).status,
      409,
    );
    const concurrent = await Promise.all([
      call(
        "/auth/registrar",
        registration("Nome Concorrente", "first@test.local"),
      ),
      call(
        "/auth/registrar",
        registration("NOME CONCORRENTE", "second@test.local"),
      ),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      concurrent.find((r) => r.status === 409)?.data.code,
      "NAME_TAKEN",
    );
    const id = "1".repeat(24),
      avatarURL = "/assets/avatar.png";
    assert.equal(
      (await call("/auth/user/edit", { nome: "abc", avatarURL }, id)).status,
      422,
    );
    assert.equal(
      (await call("/auth/user/edit", { nome: "DUELISTA 2", avatarURL }, id))
        .status,
      409,
    );
    assert.equal(
      (await call("/auth/user/edit", { nome: "Duelista 1", avatarURL }, id))
        .status,
      200,
    );
    assert.equal(
      (await call("/auth/user/edit", { nome: "Novo nome", avatarURL }, id))
        .status,
      200,
    );
    assert.equal(
      (
        await call(
          "/auth/registrar",
          registration("DUELISTA 1", "released@test.local"),
        )
      ).status,
      201,
    );
    assert.equal(db.users.find((u) => u._id === id).nomeKey, "novo nome");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
