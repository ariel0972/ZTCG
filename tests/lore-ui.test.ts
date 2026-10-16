import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";

test("interface lore: busca local, leitura sem login, vínculo da carta e edição segura de rascunho/publicação", async () => {
  process.env.SECRET = "lore-dom-only-012345678901234567890123456789";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    nativeFetch = globalThis.fetch;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let dom: JSDOM;
  const requests: { path: string; authorization?: string }[] = [];
  const set = (key: string, value: unknown) => {
    if (!descriptors.has(key))
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  async function page(name: string, path: string) {
    dom?.window.dispatchEvent(new dom.window.Event("pagehide"));
    dom?.window.close();
    dom = new JSDOM(await fs.readFile(`public/HTML/${name}`, "utf8"), {
      url: base + path,
    });
    for (const key of [
      "window",
      "document",
      "location",
      "history",
      "sessionStorage",
      "localStorage",
    ])
      set(key, (dom.window as any)[key]);
    set("fetch", (url: string, options: any = {}) => {
      requests.push({
        path: url,
        authorization: options.headers?.Authorization,
      });
      return nativeFetch(new URL(url, base), options);
    });
    set("confirm", () => true);
    return dom.window.document;
  }
  async function until(check: () => boolean) {
    const deadline = Date.now() + 6000;
    while (!check()) {
      if (Date.now() > deadline)
        throw Error("A interface de lore não chegou ao estado esperado.");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    let doc = await page("lore.html", "/lore");
    const publicModule = "../public/JS/lore.js";
    await import(publicModule);
    await until(() => doc.querySelectorAll(".lore-tile").length === 2);
    assert.ok(doc.querySelector('a[data-destination="lore"]'));
    const search = doc.getElementById("lore-search") as HTMLInputElement;
    search.value = "dukái";
    search.dispatchEvent(new dom!.window.Event("input"));
    assert.equal(doc.querySelectorAll(".lore-tile").length, 1);
    assert.equal(
      requests.filter((r) => r.path === "/lore-data").length,
      1,
      "busca não faz novas consultas",
    );
    (doc.querySelector(".lore-tile") as HTMLAnchorElement).click();
    await until(() => !!doc.querySelector(".lore-prose"));
    assert.match(doc.getElementById("lore-article")!.textContent!, /Oronai/);
    assert.equal(dom!.window.location.pathname, "/lore/llan-dukai");
    assert.ok(doc.querySelector(".lore-related img"));
    assert.ok(
      requests
        .filter((r) => r.path.startsWith("/lore-data"))
        .every((r) => !r.authorization),
    );
    const viewModule = "../public/JS/lore-view.js";
    const { renderLoreArticle } = await import(viewModule);
    const host = doc.createElement("article");
    renderLoreArticle(host, {
      titulo: "<img src=x onerror=alert(1)>",
      texto: "<script>alert(1)</script>",
      categoria: "universo",
      fonteURL: "javascript:alert(1)",
    });
    assert.equal(host.querySelector("script,img,a"), null);
    assert.match(host.textContent!, /<script>/);
    doc = await page("admin-lore.html", "/HTML/admin-lore.html");
    dom!.window.sessionStorage.setItem(
      "token",
      jwt.sign({ id: "3".repeat(24) }, process.env.SECRET!),
    );
    const preview = doc.getElementById("lore-preview") as HTMLDialogElement;
    preview.showModal = () => {
      preview.open = true;
    };
    preview.close = () => {
      preview.open = false;
    };
    const adminModule = "../public/JS/admin-lore.js";
    await import(adminModule);
    await until(
      () => !!(doc.getElementById("story-title") as HTMLInputElement).value,
    );
    (doc.getElementById("new-story") as HTMLButtonElement).click();
    const title = doc.getElementById("story-title") as HTMLInputElement;
    title.value = "Nova crônica";
    title.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
    assert.equal(
      (doc.getElementById("story-slug") as HTMLInputElement).value,
      "nova-cronica",
    );
    const text = doc.getElementById("story-text") as HTMLTextAreaElement;
    text.value = "<img src=x onerror=alert(1)>\n\nHistória em revisão.";
    text.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
    (doc.getElementById("preview-story") as HTMLButtonElement).click();
    assert.equal(preview.open, true);
    assert.equal(preview.querySelector(".lore-prose img"), null);
    (doc.getElementById("close-preview") as HTMLButtonElement).click();
    (doc.getElementById("save-draft") as HTMLButtonElement).click();
    await until(
      () =>
        db.lores.some((r) => r.slug === "nova-cronica") &&
        !(doc.getElementById("save-draft") as HTMLButtonElement).disabled,
    );
    assert.equal(
      db.lores.find((r) => r.slug === "nova-cronica").published,
      null,
    );
    assert.equal(
      (await nativeFetch(base + "/lore-data/nova-cronica")).status,
      404,
    );
    (doc.getElementById("story-summary") as HTMLTextAreaElement).value =
      "Resumo da crônica.";
    doc
      .getElementById("lore-form")!
      .dispatchEvent(
        new dom!.window.Event("submit", { cancelable: true, bubbles: true }),
      );
    await until(
      () =>
        !!db.lores.find((r) => r.slug === "nova-cronica")?.published &&
        !(doc.getElementById("publish-story") as HTMLButtonElement).disabled,
    );
    assert.match(
      (await (await nativeFetch(base + "/lore-data/nova-cronica")).json()).entry
        .texto,
      /História em revisão/,
    );
    text.value = "Alteração não salva";
    text.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
    set("confirm", () => false);
    const select = doc.getElementById("story-select") as HTMLSelectElement;
    select.value = "arena-de-thumos";
    select.dispatchEvent(new dom!.window.Event("change"));
    assert.equal(select.value, "nova-cronica");
    assert.equal(text.value, "Alteração não salva");
  } finally {
    dom!.window.dispatchEvent(new dom!.window.Event("pagehide"));
    dom!.window.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.restore();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
