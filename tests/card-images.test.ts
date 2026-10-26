import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import { prepareAvatar } from "../src/services/avatars";
import Avatar from "../src/db/models/avatar";
import { cardSchema } from "../src/types/card";
import raw from "../src/data/catalog.json";

test("arte de carta é WebP sem recorte ou metadados, preservando todas as bordas", async () => {
  const png = await sharp({
    create: { width: 1600, height: 2400, channels: 3, background: "orange" },
  })
    .png()
    .toBuffer();
  const { data } = await prepareAvatar(png, "card");
  const info = await sharp(data).metadata();
  assert.equal(info.format, "webp");
  assert.equal(info.width, 1120);
  assert.equal(info.height, 1680);
  assert.equal(info.exif, undefined);
  const doc = new Avatar({
    _id: "a".repeat(64),
    data,
    kind: "card",
    name: "Arte",
  });
  await doc.validate();
  assert.equal(doc.kind, "card");
});
test("galeria exige admin, hospeda arte deduplicada e permite reutilizar URL na carta", async () => {
  process.env.SECRET = "card-image-test-01234567890123456789012345";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  const token = (i: number) =>
    jwt.sign({ id: String(i).repeat(24) }, process.env.SECRET!);
  const png = await sharp({
    create: { width: 400, height: 600, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const upload = (auth = "") =>
    fetch(
      base +
        "/admin/card-images?nome=" +
        encodeURIComponent("Imagem [terra].png"),
      {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          ...(auth ? { Authorization: "Bearer " + auth } : {}),
        },
        body: png,
      },
    );
  try {
    assert.equal((await upload()).status, 401);
    assert.equal((await upload(token(1))).status, 401);
    const headers = { Authorization: "Bearer " + token(3) };
    const response = await upload(token(3));
    assert.equal(response.status, 200);
    const result: any = await response.json();
    assert.match(result.image.url, /^\/avatars\/[a-f0-9]{64}\.webp$/);
    const again: any = await (await upload(token(3))).json();
    assert.equal(again.image.url, result.image.url);
    const stored: any = await Avatar.findById(
      result.image.url.split("/").pop().split(".")[0],
    ).select("+original +originalType");
    assert.equal(stored.kind, "card");
    assert.equal(stored.original, undefined);
    assert.equal(stored.originalType, undefined);
    const image = await fetch(base + result.image.url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/webp");
    const info = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    assert.equal(info.width, 400);
    assert.equal(info.height, 600);
    const gallery: any = await (
      await fetch(
        base + "/admin/card-images?q=" + encodeURIComponent("[terra]"),
        { headers },
      )
    ).json();
    assert.equal(gallery.images.length, 1);
    assert.equal(gallery.images[0].url, result.image.url);
    assert.equal(gallery.images[0].data, undefined);
    const native: any = await (
      await fetch(base + "/admin/card-images?q=Toupeira", { headers })
    ).json();
    assert.ok(native.images.some((i: any) => i.url.includes("Toupeira")));
    const card = cardSchema.parse(raw.find((c) => c.numeroCatalogo === "042"));
    card.imgURL = result.image.url;
    const save = await fetch(base + "/admin/cards/042", {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ card, expectedVersion: card.versao }),
    });
    assert.equal(save.status, 200);
    assert.equal(((await save.json()) as any).card.imgURL, result.image.url);
    const bad = await fetch(base + "/admin/card-images", {
      method: "POST",
      headers: { ...headers, "Content-Type": "image/png" },
      body: Buffer.from("invalid"),
    });
    assert.equal(bad.status, 422);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
