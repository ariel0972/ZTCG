import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import { prepareAvatar, storeAvatar } from "../src/services/avatars";
import {
  rebuildRankings,
  refreshPlayerRanking,
} from "../src/services/ranking-projections";
import Match from "../src/db/models/match";
import User from "../src/db/models/user";

test("avatares: WebP 192px sem metadados, formato validado e rejeição de entradas inválidas", async () => {
  const input = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const prepared = await prepareAvatar(input);
  const meta = await sharp(prepared.data).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 192);
  assert.equal(meta.height, 192);
  assert.equal(meta.exif, undefined);
  await assert.rejects(prepareAvatar(Buffer.from("not an image")), {
    status: 422,
  });
  await assert.rejects(prepareAvatar(Buffer.alloc(201 * 1024)), {
    status: 422,
  });
  await assert.rejects(
    prepareAvatar(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>',
      ),
    ),
    { status: 422 },
  );
});

test("HTTP: avatar binário retorna URL, imagem independente tem hash/cache/304 e edição aceita URL", async () => {
  process.env.SECRET = "avatar-tests-only-secret-012345678901234567890";
  const db = await fakeDatabase();
  const server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = jwt.sign({ id: "1".repeat(24) }, process.env.SECRET);
  const png = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  try {
    assert.equal(
      (
        await fetch(base + "/auth/avatar", {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: png,
        })
      ).status,
      401,
    );
    const response = await fetch(base + "/auth/avatar", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: png,
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.match(body.avatarURL, /^\/avatars\/[a-f\d]{64}\.webp$/);
    const image = await fetch(base + body.avatarURL);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/webp");
    assert.match(image.headers.get("cache-control")!, /immutable/);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      body.avatarURL.split("/").pop().split(".")[0],
    );
    const conditional = await fetch(base + body.avatarURL, {
      cache: "no-cache",
      headers: { "If-None-Match": image.headers.get("etag")! },
    });
    assert.equal(conditional.status, 304);
    const edit = await fetch(base + "/auth/user/edit", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nome: "Duelista 1", avatarURL: body.avatarURL }),
    });
    assert.equal(edit.status, 200);
    assert.equal(db.users[0].avatarURL, body.avatarURL);
    const legacy = await fetch(base + "/auth/user/edit", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nome: "Duelista 1",
        avatarURL: `data:image/png;base64,${png.toString("base64")}`,
      }),
    });
    assert.equal(legacy.status, 200);
    assert.equal(
      db.users[0].avatarURL,
      body.avatarURL,
      "old clients must also store only URLs",
    );
    const duplicate = await storeAvatar(png);
    assert.equal(duplicate, body.avatarURL);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});

test("ranking: reconstrução correta, nenhuma leitura do histórico no cache miss e snapshot antigo não sobrescreve novo", async () => {
  const db = await fakeDatabase();
  const id = "1".repeat(24);
  for (let i = 0; i < 12; i++)
    db.matches.push({
      matchId: `m-${i}`,
      players: [{ userId: id, deckId: "4".repeat(24) }],
      winner: id,
      finishedAt: new Date(2026, 0, 1, 0, i),
    });
  await rebuildRankings();
  assert.equal(db.users[0].ranking.partidas, 12);
  const xp = db.users[0].ranking.stats.xp;
  const original = Match.find;
  (Match as any).find = () => {
    throw Error("ranking must not read history");
  };
  const server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch(
      `http://127.0.0.1:${(server.address() as any).port}/rankings`,
    );
    const body = (await r.json()) as any;
    assert.equal(r.status, 200);
    assert.equal(body.podium[0].xp, xp);
    assert.equal(body.podium[0].partidas, 12);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 20000);
    (Match as any).find = original;
    db.users[0].ranking.partidas = 13;
    await refreshPlayerRanking(id);
    assert.equal(db.users[0].ranking.partidas, 13);
  } finally {
    Match.find = original;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
