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
    assert.ok(dialog.querySelector(".card-stat-icon--life"));
    assert.match(dialog.textContent!, /6 \/ 8 PV/);
    const informationToggle = dialog.querySelector(
      ".card-information-toggle",
    ) as HTMLButtonElement;
    informationToggle.click();
    assert.ok(
      [...dialog.querySelectorAll("details")].every(
        (section: any) => !section.open,
      ),
    );
    informationToggle.click();
    assert.ok(
      [...dialog.querySelectorAll("details")].every(
        (section: any) => section.open,
      ),
    );
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

test("detalhes estruturados preservam atributos, habilidades e texto seguro em todos os tipos de carta", async () => {
  const modulePath = "../public/JS/card-details.js";
  const { renderCardDetails } = await import(modulePath);
  const dom = new JSDOM('<div id="info"></div>'),
    host = dom.window.document.getElementById("info")!;
  try {
    renderCardDetails(host, {
      tipo: "Tropa",
      elemento: "Agua",
      custoMana: 0,
      hp: 12,
      ataque: 3,
      resistencia: ["Fogo", "Agua"],
      fraqueza: ["Terra"],
      habilidadesAtivas: [
        {
          nome: "<img src=x onerror=alert(1)>",
          custoMana: 3,
          descricao: "Causa 3 de dano.",
        },
      ],
      habilidadesPassivas: [{ descricao: "Cura 2 ao eliminar uma tropa." }],
      descricao: "Ataque uma vez por rodada.",
    });
    assert.match(host.textContent!, /0 mana/);
    assert.match(host.textContent!, /Fogo, Água · dano ÷2/);
    assert.match(host.textContent!, /Terra · dano ×2/);
    assert.equal(host.querySelectorAll(".card-active-ability").length, 1);
    assert.equal(host.querySelector("img"), null);
    assert.match(
      host.querySelector(".card-ability-heading")!.textContent!,
      /<img src=x/,
    );
    const sections = [...host.querySelectorAll("details")];
    assert.equal(sections[1].open, true);
    assert.equal(sections[2].open, false);
    renderCardDetails(host, {
      tipo: "Armamento",
      custoMana: 2,
      bonusAtaque: 2,
      bonusHp: 0,
    });
    assert.match(host.textContent!, /\+2 de ataque/);
    assert.match(host.textContent!, /\+0 PV/);
    assert.equal(host.querySelector(".card-active-ability"), null);
    renderCardDetails(host, {
      tipo: "Feitico",
      custoMana: 2,
      descricao: "Compre uma carta.",
      assinatura: true,
      publicado: false,
    });
    assert.equal(host.querySelector(".card-stat-icon--life"), null);
    assert.match(host.textContent!, /Assinatura/);
    assert.match(host.textContent!, /Rascunho/);
    assert.match(host.textContent!, /Compre uma carta/);
  } finally {
    dom.window.close();
  }
});
