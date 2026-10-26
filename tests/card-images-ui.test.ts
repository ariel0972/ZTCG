import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("editor envia arte, reutiliza galeria e não troca imagem da carta aberta durante upload", async () => {
  const html = await readFile("public/HTML/admin.html", "utf8"),
    dom = new JSDOM(html, { url: "http://localhost" }),
    doc = dom.window.document;
  const old = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: doc,
    configurable: true,
  });
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    },
    close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new dom.window.Event("close"));
    },
  });
  try {
    const path = "../public/JS/card-image-editor.js";
    const { createCardImageEditor } = await import(path);
    const calls: any[] = [];
    let release: any;
    let delay = false;
    const editor = createCardImageEditor(doc, {
      prepare: async () => ({
        blob: new dom.window.Blob(["webp"], { type: "image/webp" }),
      }),
      api: async (path: string, options: any) => {
        calls.push({ path, options });
        if (options?.method === "POST") {
          if (delay) await new Promise((r) => (release = r));
          return { image: { url: "/avatars/upload.webp" } };
        }
        return {
          images: [{ url: "/avatars/shared.webp", name: "<b>Arte segura</b>" }],
          hasMore: false,
        };
      },
    });
    const json = doc.getElementById("card-json") as HTMLTextAreaElement,
      input = doc.getElementById("upload-card-image") as HTMLInputElement;
    const first = {
      numeroCatalogo: "042",
      nome: "Toupeira",
      imgURL: "/old.png",
      hp: 9,
    };
    json.value = JSON.stringify(first);
    editor.show(first);
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new dom.window.File(["png"], "terra.png", { type: "image/png" })],
    });
    await input.onchange!({} as Event);
    assert.equal(JSON.parse(json.value).imgURL, "/avatars/upload.webp");
    assert.equal(JSON.parse(json.value).hp, 9);
    assert.equal(calls[0].options.headers["Content-Type"], "image/webp");
    (doc.getElementById("choose-card-image") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const option = doc.querySelector(".card-image-option") as HTMLButtonElement;
    assert.equal(option.querySelector("b"), null);
    option.click();
    assert.equal(JSON.parse(json.value).imgURL, "/avatars/shared.webp");
    delay = true;
    const pending = input.onchange!({} as Event);
    await new Promise((r) => setTimeout(r, 0));
    const second = { numeroCatalogo: "018", nome: "Mago", imgURL: "/mage.png" };
    json.value = JSON.stringify(second);
    editor.show(second);
    release();
    await pending;
    assert.equal(JSON.parse(json.value).imgURL, "/mage.png");
    assert.match(
      doc.getElementById("card-image-status")!.textContent!,
      /salva na galeria/,
    );
  } finally {
    if (old) Object.defineProperty(globalThis, "document", old);
    else Reflect.deleteProperty(globalThis, "document");
    dom.window.close();
  }
});
