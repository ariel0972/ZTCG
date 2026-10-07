import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("inspeção das cartas: hover, teclado, toque e remoção do nó", async () => {
  const dom = new JSDOM(
    '<main id="match"><button id="card">Carta</button></main>',
    { url: "http://localhost/" },
  );
  const keys = [
    "window",
    "document",
    "MutationObserver",
    "location",
    "localStorage",
    "sessionStorage",
  ];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of keys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: (dom.window as any)[key],
    });
  try {
    const modulePath = "../public/JS/card-inspection.js";
    const { createCardInspector } = await import(modulePath);
    const inspector = createCardInspector();
    const card = {
      nome: "Carta de teste",
      imgURL: "/teste.png",
      tipo: "Tropa",
      custoMana: 3,
      hp: 8,
      hpAtual: 6,
      ataque: 2,
      manaGerada: 1,
      habilidadesAtivas: [],
      habilidadesPassivas: [],
      palavrasChave: [],
      efeitos: [],
      resistencia: [],
      fraqueza: [],
      statuses: [{ nome: "Envenenado", turnosRestantes: 3 }],
      usedAbility: true,
    };
    const button = dom.window.document.getElementById("card")!;
    const preview = dom.window.document.querySelector(
      ".card-preview",
    ) as HTMLElement;
    const dialog = dom.window.document.querySelector("dialog") as any;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };
    inspector.bind(button, card);
    button.dispatchEvent(new dom.window.Event("pointerenter"));
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(preview.hidden, false);
    assert.match(preview.textContent!, /Vida atual: 6/);
    assert.match(preview.textContent!, /nesta rodada/);
    button.dispatchEvent(new dom.window.Event("pointerleave"));
    assert.equal(preview.hidden, true);
    button.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "i" }));
    assert.equal(dialog.open, true);
    const artwork = dom.window.document.querySelector(".card-artwork") as any;
    artwork.showModal = () => {
      artwork.open = true;
    };
    artwork.close = () => {
      artwork.open = false;
      artwork.dispatchEvent(new dom.window.Event("close"));
    };
    (dialog.querySelector(".inspection-image") as HTMLButtonElement).click();
    assert.equal(dialog.open, false);
    assert.equal(artwork.open, true);
    assert.equal(artwork.querySelector("img").alt, card.nome);
    assert.equal(artwork.querySelector(".inspection-details"), null);
    assert.equal(artwork.textContent, "Fechar");
    artwork.close();
    assert.equal(dialog.open, true);
    dialog.close();
    const touch = new dom.window.Event("pointerdown");
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    button.dispatchEvent(touch);
    await new Promise((r) => setTimeout(r, 470));
    assert.equal(dialog.open, true);
    let played = false;
    button.addEventListener("click", () => {
      played = true;
    });
    button.dispatchEvent(
      new dom.window.MouseEvent("click", { cancelable: true }),
    );
    assert.equal(played, false);
    dialog.close();
    button.dispatchEvent(new dom.window.Event("focus"));
    button.remove();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(preview.hidden, true);
    dom.window.document.body.append(button);
    button.dispatchEvent(new dom.window.Event("focus"));
    assert.equal(preview.hidden, false);
    const zone = dom.window.document.createElement("dialog");
    dom.window.document.body.append(zone);
    zone.open = true;
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(
      preview.hidden,
      true,
      "Abrir uma zona remove a prévia anterior.",
    );
    button.dispatchEvent(new dom.window.Event("focus"));
    button.dispatchEvent(new dom.window.Event("pointerenter"));
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(
      preview.hidden,
      true,
      "Foco e hover não mostram prévias por trás de diálogos.",
    );
    zone.remove();
    const menu = dom.window.document.createElement("section");
    menu.id = "card-menu";
    dom.window.document.body.append(menu, button);
    button.dispatchEvent(new dom.window.Event("focus"));
    assert.equal(
      preview.hidden,
      true,
      "A prévia não pode cobrir o menu de ações.",
    );
    button.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { cancelable: true }),
    );
    assert.equal(
      dialog.open,
      true,
      "O botão direito continua ampliando a carta.",
    );
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
