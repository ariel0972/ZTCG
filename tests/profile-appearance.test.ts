import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import { prepareAvatar } from "../src/services/avatars";
import Avatar from "../src/db/models/avatar";
test("imagens maiores que 200 KB são reduzidas e banners têm proporção própria sem metadados", async () => {
  const png = await sharp(randomBytes(600 * 400 * 3), {
    raw: { width: 600, height: 400, channels: 3 },
  })
    .png()
    .toBuffer();
  assert.ok(png.length > 200 * 1024);
  const avatar = await prepareAvatar(png);
  const meta = await sharp(avatar.data).metadata();
  assert.equal(meta.width, 384);
  assert.equal(meta.height, 384);
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined);
  const source = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "purple" },
  })
    .jpeg()
    .toBuffer();
  const banner = await prepareAvatar(source, "banner"),
    info = await sharp(banner.data).metadata();
  assert.equal(info.format, "webp");
  assert.equal(info.width, 1600);
  assert.equal(info.height, 500);
});
test("banner exige login, guarda apenas WebP e aparência persiste sem expor dados privados", async () => {
  process.env.SECRET = "profile-appearance-test-012345678901234567890";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port,
    id = "1".repeat(24),
    token = jwt.sign({ id }, process.env.SECRET!);
  const png = await sharp({
    create: { width: 1800, height: 900, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "image/png",
  };
  try {
    assert.equal(
      (
        await fetch(base + "/auth/banner", {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: png,
        })
      ).status,
      401,
    );
    const upload = await fetch(base + "/auth/banner", {
      method: "POST",
      headers,
      body: png,
    });
    assert.equal(upload.status, 200);
    const data: any = await upload.json();
    assert.match(data.bannerURL, /^\/avatars\/[a-f\d]{64}\.webp$/);
    const stored: any = await Avatar.findById(
      data.bannerURL.split("/").pop().split(".")[0],
    ).select("+original +originalType");
    assert.equal(stored.original, undefined);
    assert.equal(stored.originalType, undefined);
    assert.equal(stored.kind, "banner");
    const image = await fetch(base + data.bannerURL);
    assert.equal(image.headers.get("content-type"), "image/webp");
    const info = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    assert.equal(info.width, 1600);
    assert.equal(info.height, 500);
    const put = async (body: object) =>
      fetch(base + "/auth/user/edit", {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const edit = await put({
      nome: "Duelista 1",
      avatarURL: "/assets/avatar.png",
      bannerURL: data.bannerURL,
      avatarFrame: "gold",
    });
    assert.equal(edit.status, 200);
    const result: any = await edit.json();
    assert.equal(result.user.bannerURL, data.bannerURL);
    assert.equal(result.user.avatarFrame, "gold");
    const publicProfile: any = await fetch(base + "/profiles/" + id).then((r) =>
      r.json(),
    );
    assert.equal(publicProfile.user.bannerURL, data.bannerURL);
    assert.equal(publicProfile.user.avatarFrame, "gold");
    assert.equal(publicProfile.user.email, undefined);
    assert.equal(
      (
        await put({
          nome: "Duelista 1",
          avatarURL: "/assets/avatar.png",
          bannerURL: "https://invalid/banner.png",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await put({
          nome: "Duelista 1",
          avatarURL: "/assets/avatar.png",
          avatarFrame: "invalid",
        })
      ).status,
      422,
    );
    assert.equal(
      (await put({ nome: "Duelista 1", avatarURL: "/assets/avatar.png" }))
        .status,
      200,
    );
    assert.equal(db.users[0].bannerURL, data.bannerURL);
    assert.equal(db.users[0].avatarFrame, "gold");
    assert.equal(
      (
        await put({
          nome: "Duelista 1",
          avatarURL: "/assets/avatar.png",
          bannerURL: "",
          avatarFrame: "none",
        })
      ).status,
      200,
    );
    assert.equal(db.users[0].bannerURL, "");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
test("prévia aplica moldura e banner, restaura padrão e recorta sem deformar", async () => {
  const dom = new JSDOM(
      '<div id="cover"><span>Texto</span></div><img id="avatar">',
      { url: "http://localhost" },
    ),
    previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const path = "../public/JS/profile-appearance.js";
    const { applyProfileAppearance, imageCrop, prepareProfileUpload } =
      await import(path);
    const doc = dom.window.document,
      parts = {
        avatar: doc.getElementById("avatar"),
        cover: doc.getElementById("cover"),
      };
    applyProfileAppearance(parts, {
      avatarURL: "/assets/avatar.png",
      bannerURL: "/avatars/banner.webp",
      avatarFrame: "gold",
    });
    assert.equal(parts.avatar!.dataset.frame, "gold");
    assert.equal(parts.cover!.querySelectorAll("img").length, 1);
    assert.ok(parts.cover!.classList.contains("custom-banner"));
    applyProfileAppearance(parts, {
      bannerURL: "/avatars/other.webp",
      avatarFrame: "water",
    });
    assert.equal(parts.cover!.querySelectorAll("img").length, 1);
    assert.equal(parts.avatar!.dataset.frame, "water");
    applyProfileAppearance(parts, {
      bannerURL: "",
      avatarFrame: "unsupported",
    });
    assert.equal(parts.cover!.querySelectorAll("img").length, 0);
    assert.equal(parts.avatar!.dataset.frame, "none");
    assert.ok(parts.cover!.textContent!.includes("Texto"));
    assert.deepEqual(imageCrop(2000, 1000, "banner"), {
      sx: 0,
      sy: 187.5,
      sw: 2000,
      sh: 625,
      width: 1600,
      height: 500,
    });
    assert.equal(imageCrop(100, 200, "avatar").width, 100);
    await assert.rejects(
      prepareProfileUpload(
        { size: 8 * 1024 * 1024 + 1, type: "image/png" },
        "avatar",
      ),
      /8 MB/,
    );
    assert.throws(() => imageCrop(10000, 10000, "banner"), /megapixels/);
  } finally {
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
