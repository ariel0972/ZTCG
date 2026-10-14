import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const modulePath = "../public/JS/deck-selector.js";
test("escolha de baralho persiste entre jogar e amigos, por conta, sem reaproveitar IDs excluídos", async () => {
  const { createDeckSelector } = await import(modulePath);
  const dom = new JSDOM(
    '<select id="public"></select><select id="friends"></select><select id="other"></select>',
    { url: "https://example.test" },
  );
  const doc = dom.window.document;
  const prototype = dom.window.HTMLDialogElement.prototype;
  prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new dom.window.Event("close"));
  };
  const decks = [
    {
      _id: "one",
      nome: "Baralho 1",
      mago: "016",
      cartas: Array(40).fill("020"),
    },
    {
      _id: "two",
      nome: "Baralho 2",
      mago: "017",
      cartas: Array(40).fill("020"),
    },
  ];
  const selector = (
    id: string,
    userId: string,
    storage = dom.window.localStorage,
  ) =>
    createDeckSelector(doc.getElementById(id), {
      userId,
      storage,
      catalog: [
        { numeroCatalogo: "016", nome: "Mago de Fogo", imgURL: "/fogo.png" },
      ],
    });
  try {
    const publicSelector = selector("public", "player-a");
    publicSelector.setDecks(decks);
    assert.equal(publicSelector.selected()._id, "one");
    (doc.querySelector(".deck-selection-trigger") as HTMLButtonElement).click();
    assert.ok(doc.querySelector("dialog[open]"));
    (
      doc.querySelectorAll(".deck-selection-option")[1] as HTMLButtonElement
    ).click();
    assert.equal(publicSelector.selected()._id, "two");
    assert.equal(doc.querySelector("dialog[open]"), null);
    const friendsSelector = selector("friends", "player-a");
    friendsSelector.setDecks(decks);
    assert.equal(friendsSelector.selected()._id, "two");
    const other = selector("other", "player-b");
    other.setDecks(decks);
    assert.equal(other.selected()._id, "one");
    friendsSelector.setDecks(decks, "one");
    assert.equal(
      friendsSelector.selected()._id,
      "one",
      "link explícito tem prioridade",
    );
    publicSelector.setDecks([decks[1]]);
    assert.equal(publicSelector.selected()._id, "two");
    (doc.getElementById("public") as HTMLSelectElement).disabled = true;
    publicSelector.sync();
    assert.equal(
      (doc.querySelector(".deck-selection-trigger") as HTMLButtonElement)
        .disabled,
      true,
    );
    publicSelector.setDecks([]);
    assert.equal(publicSelector.selected(), undefined);
    assert.match(
      doc.querySelector(".deck-selection-info")!.textContent!,
      /Nenhum baralho/,
    );
  } finally {
    dom.window.close();
  }
});

test("seletor funciona com armazenamento bloqueado e escolhe primeiro baralho completo ao iniciar", async () => {
  const { createDeckSelector } = await import(modulePath);
  const dom = new JSDOM("<select></select>", { url: "https://example.test" });
  try {
    const selector = createDeckSelector(
      dom.window.document.querySelector("select"),
      {
        userId: "player",
        storage: {
          getItem() {
            throw Error("denied");
          },
          setItem() {
            throw Error("denied");
          },
        },
      },
    );
    selector.setDecks([
      { _id: "draft", nome: "Rascunho", cartas: [] },
      {
        _id: "complete",
        nome: "Pronto",
        mago: "016",
        cartas: Array(40).fill("020"),
      },
    ]);
    assert.equal(selector.selected()._id, "complete");
  } finally {
    dom.window.close();
  }
});
