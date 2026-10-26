import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { JSDOM } from "jsdom";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
test("interface real em DOM: catálogo, filtros, limites, detalhes, salvamento e admin", async () => {
  process.env.SECRET = "secret-only-for-tests-01234567890123456789";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`,
    nativeFetch = globalThis.fetch;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  function global(key: string, value: unknown) {
    if (!descriptors.has(key))
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  async function page(name: string, user = "1".repeat(24)) {
    const html = await fs.readFile(
      path.join(__dirname, "../public/HTML", name),
      "utf8",
    );
    const dom = new JSDOM(html, { url: base + "/HTML/" + name });
    for (const key of [
      "window",
      "document",
      "location",
      "localStorage",
      "sessionStorage",
      "FileReader",
      "FormData",
      "MutationObserver",
    ])
      global(key, (dom.window as any)[key]);
    global("confirm", () => true);
    dom.window.sessionStorage.setItem(
      "token",
      jwt.sign({ id: user }, process.env.SECRET!, { expiresIn: "1h" }),
    );
    global("fetch", (url: string, options: RequestInit) =>
      nativeFetch(new URL(url, base), options),
    );
    return dom;
  }
  async function until(check: () => boolean) {
    const end = Date.now() + 4000;
    while (!check()) {
      if (Date.now() > end)
        throw new Error("A interface não chegou ao estado esperado.");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  let dom: JSDOM | undefined;
  try {
    dom = await page("deckbuilder.html");
    const builderModule = "../public/JS/deckbuilder.js";
    await import(builderModule);
    await until(
      () =>
        dom!.window.document.querySelectorAll("#card-list .card-tile")
          .length === 131,
    );
    const doc = dom.window.document;
    assert.equal(doc.getElementById("deck-count")!.textContent, "40 / 40");
    const type = doc.getElementById("type") as HTMLSelectElement;
    type.value = "Mago";
    type.dispatchEvent(new dom.window.Event("input"));
    assert.equal(doc.querySelectorAll("#card-list .card-tile").length, 8);
    type.value = "";
    type.dispatchEvent(new dom.window.Event("input"));
    const query = doc.getElementById("search") as HTMLInputElement;
    query.value = "não existe";
    query.dispatchEvent(new dom.window.Event("input"));
    assert.equal(doc.querySelectorAll("#card-list .card-tile").length, 0);
    query.value = "";
    query.dispatchEvent(new dom.window.Event("input"));
    const dialog = doc.getElementById("card-detail") as any;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };
    (doc.querySelector("#card-list .card-tile") as HTMLButtonElement).click();
    assert.ok(dialog.open);
    assert.ok(doc.getElementById("detail-name")!.textContent);
    assert.equal(
      (doc.getElementById("detail-add") as HTMLButtonElement).disabled,
      true,
    );
    assert.match(doc.getElementById("detail-limit")!.textContent!, /40 cartas/);
    const name = doc.getElementById("deck-name") as HTMLInputElement;
    name.value = "<img src=x onerror=alert(1)>";
    name.dispatchEvent(new dom.window.Event("input"));
    assert.equal(doc.querySelectorAll("#deck-list img").length, 1);
    assert.equal(
      doc.querySelector("#deck-list img")!.getAttribute("src"),
      "/assets/icons/neutro.svg",
    );
    assert.equal(doc.querySelectorAll("#deck-list [onerror]").length, 0);
    (doc.getElementById("save-deck") as HTMLButtonElement).click();
    await until(
      () =>
        db.decks[0].revisao === 1 &&
        !(doc.getElementById("save-deck") as HTMLButtonElement).disabled &&
        doc.getElementById("save-status")?.textContent === "Salvo na conta",
    );
    assert.equal(db.decks[0].nome, "<img src=x onerror=alert(1)>");
    dialog.close();
    (doc.getElementById("new-deck") as HTMLButtonElement).click();
    type.value = "Mago";
    type.dispatchEvent(new dom.window.Event("input"));
    const draftTile = doc
      .querySelector("#card-list .badge.draft")!
      .closest("button")!;
    const draftName = draftTile.querySelector(".card-name")!.textContent;
    draftTile.click();
    assert.match(doc.getElementById("detail-quantity")!.textContent!, /^0 de /);
    assert.equal(
      (doc.getElementById("detail-remove") as HTMLButtonElement).disabled,
      true,
    );
    (doc.getElementById("detail-add") as HTMLButtonElement).click();
    assert.match(doc.getElementById("detail-quantity")!.textContent!, /^1 de /);
    assert.ok(dialog.open);
    assert.equal(
      doc.querySelector("#mage-slot .card-name")!.textContent,
      draftName,
    );
    assert.equal(
      doc.querySelector("#mage-slot .draft")!.textContent,
      "Rascunho",
    );
    (doc.getElementById("detail-remove") as HTMLButtonElement).click();
    assert.match(doc.getElementById("detail-quantity")!.textContent!, /^0 de /);
    dialog.close();
    // A draft spell stays editable, while its status is visible in the deck rows.
    type.value = "Feitico";
    type.dispatchEvent(new dom.window.Event("input"));
    const spellTile = doc
      .querySelector("#card-list .badge.draft")!
      .closest("button")!;
    spellTile.click();
    for (let n = 1; n <= 3; n++) {
      (doc.getElementById("detail-add") as HTMLButtonElement).click();
      assert.equal(
        doc.getElementById("detail-quantity")!.textContent,
        `${n} de 3 cópias no baralho`,
      );
    }
    assert.equal(
      (doc.getElementById("detail-add") as HTMLButtonElement).disabled,
      true,
    );
    assert.equal(
      doc.querySelector("#deck-cards .deck-draft")!.textContent,
      "Rascunho",
    );
    (doc.getElementById("detail-remove") as HTMLButtonElement).click();
    assert.equal(
      doc.getElementById("detail-quantity")!.textContent,
      "2 de 3 cópias no baralho",
    );
    assert.equal(
      (doc.getElementById("detail-add") as HTMLButtonElement).disabled,
      false,
    );
    assert.equal(
      JSON.parse(dom.window.sessionStorage.getItem("ztcg:editor-draft")!).cartas
        .length,
      2,
    );
    dom.window.close();
    dom = await page("admin.html", "3".repeat(24));
    const adminModule = "../public/JS/admin.js";
    await import(adminModule);
    await until(
      () =>
        dom!.window.document.querySelectorAll("#catalog-select option")
          .length === 131,
    );
    const adminDoc = dom.window.document;
    (adminDoc.getElementById("new-type") as HTMLSelectElement).value =
      "Armamento";
    (adminDoc.getElementById("new-card") as HTMLButtonElement).click();
    const definition = JSON.parse(
      (adminDoc.getElementById("card-json") as HTMLTextAreaElement).value,
    );
    assert.equal(definition.tipo, "Armamento");
    assert.equal(definition.bonusHp, 0);
    (adminDoc.getElementById("validate-card") as HTMLButtonElement).click();
    await until(() => !!adminDoc.getElementById("validation")!.textContent);
    assert.match(adminDoc.getElementById("validation")!.textContent!, /válida/);
  } finally {
    dom?.window.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.restore();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
