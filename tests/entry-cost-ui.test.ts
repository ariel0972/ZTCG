import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
async function withDocument(html: string, run: (dom: JSDOM) => Promise<void>) {
  const dom = new JSDOM(html, {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  const old = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
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
    await run(dom);
  } finally {
    if (old) Object.defineProperty(globalThis, "document", old);
    else delete (globalThis as any).document;
    dom.window.close();
  }
}
test("seletor exige quantidade exata, distingue mão/campo e cancela sem enviar pagamento", async () =>
  withDocument("<body></body>", async (dom) => {
    const path = "../public/JS/entry-cost.js";
    const { createMaterialChoice, describeEntryCost } = await import(path);
    const choice = createMaterialChoice(dom.window.document.body);
    const card = {
      nome: "Nova carta",
      elemento: "Agua",
      custoEntrada: {
        quantidade: 2,
        tiposCarta: ["Tropa"],
        origens: ["mao", "campo"],
        mesmoElemento: true,
      },
      materiaisEntrada: [
        {
          id: "a",
          nome: "Primeira",
          tipo: "Tropa",
          custoMana: 1,
          origemMaterial: "mao",
        },
        {
          id: "b",
          nome: "Segunda",
          tipo: "Tropa",
          custoMana: 2,
          origemMaterial: "campo",
        },
      ],
    };
    const state = { id: "match", version: 2, status: "ACTIVE" };
    const pending = choice.choose(card, state);
    const doc = dom.window.document,
      confirm = doc.querySelector<HTMLButtonElement>(
        ".material-choice .primary",
      )!;
    assert.equal(confirm.disabled, true);
    const cards = doc.querySelectorAll<HTMLButtonElement>(".card-tile");
    cards[0].click();
    assert.equal(confirm.disabled, true);
    cards[1].click();
    assert.equal(confirm.disabled, false);
    assert.match(
      doc.querySelector(".material-options")!.textContent!,
      /Descartar da mão/,
    );
    confirm.click();
    assert.deepEqual(await pending, ["a", "b"]);
    const cancel = choice.choose(card, state);
    doc.querySelector<HTMLButtonElement>(".material-choice .quiet")!.click();
    assert.equal(await cancel, null);
    const stale = choice.choose(card, state);
    choice.update({ ...state, version: 3 });
    assert.equal(await stale, null);
    assert.match(describeEntryCost(card), /mesmo elemento original/);
    choice.close();
  }));
test("editor do catálogo configura quantidade, tipo, elemento e origem no JSON", async () =>
  withDocument(
    await readFile("public/HTML/admin.html", "utf8"),
    async (dom) => {
      const path = "../public/JS/entry-cost-editor.js";
      const { createEntryCostEditor } = await import(path);
      const doc = dom.window.document;
      let changes = 0;
      const editor = createEntryCostEditor(doc, {
        onChange: () => changes++,
        onError: (e: Error) => {
          throw e;
        },
      });
      const card = { nome: "Teste", subtipo: "Invocação", elemento: "Neutro" };
      (doc.getElementById("card-json") as HTMLTextAreaElement).value =
        JSON.stringify(card);
      editor.show(card);
      (doc.getElementById("entry-quantity") as HTMLInputElement).value = "2";
      for (const i of doc.querySelectorAll<HTMLInputElement>(
        'input[name="entry-type"]',
      ))
        i.checked = i.value === "Feitico";
      for (const i of doc.querySelectorAll<HTMLInputElement>(
        'input[name="entry-origin"]',
      ))
        i.checked = i.value === "campo";
      (doc.getElementById("entry-element") as HTMLSelectElement).value = "Fogo";
      (doc.getElementById("apply-entry-cost") as HTMLButtonElement).click();
      const updated = JSON.parse(
        (doc.getElementById("card-json") as HTMLTextAreaElement).value,
      );
      assert.deepEqual(updated.custoEntrada, {
        quantidade: 2,
        tiposCarta: ["Feitico"],
        origens: ["campo"],
        elementos: ["Fogo"],
      });
      assert.equal(changes, 1);
      (doc.getElementById("remove-entry-cost") as HTMLButtonElement).click();
      assert.equal(
        JSON.parse(
          (doc.getElementById("card-json") as HTMLTextAreaElement).value,
        ).custoEntrada,
        undefined,
      );
      assert.match(
        doc.getElementById("entry-cost-help")!.textContent!,
        /mesmo elemento original/,
      );
    },
  ));
