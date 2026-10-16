import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("feitiços ativos ficam separados por dono e o modal acompanha rodadas e término", async () => {
  const dom = new JSDOM('<div id="me"></div><div id="enemy"></div>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const modulePath = "../public/JS/ongoing-spells.js";
    const { createOngoingSpells } = await import(modulePath);
    const doc = dom.window.document,
      own = doc.getElementById("me")!,
      enemy = doc.getElementById("enemy")!;
    const ui = createOngoingSpells(own, enemy);
    const dialog = doc.querySelector("dialog") as any;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
      dialog.dispatchEvent(new dom.window.Event("close"));
    };
    const state = {
      players: [
        { id: "me", nome: "Meu jogador", graveyard: [] },
        { id: "enemy", nome: "Adversário", graveyard: [] },
      ],
      ongoingSpells: [
        {
          id: "one",
          ownerId: "me",
          kind: "arrowRain",
          damage: 5,
          rounds: 2,
          card: { nome: "Chuva de Flechas", imgURL: "/arte.png" },
        },
        {
          id: "two",
          ownerId: "enemy",
          kind: "arrowRain",
          damage: 3,
          rounds: 2,
        },
      ],
    };
    ui.update(state, "me");
    assert.equal(own.querySelectorAll("button").length, 1);
    assert.equal(enemy.querySelectorAll("button").length, 1);
    assert.equal(own.querySelector("button")!.dataset.side, "me");
    assert.equal(enemy.querySelector("button")!.dataset.side, "enemy");
    own.querySelector("button")!.click();
    assert.equal(dialog.open, true);
    assert.match(dialog.textContent, /5 de dano/);
    assert.match(dialog.textContent, /2 rodada/);
    state.ongoingSpells[0].rounds = 1;
    ui.update(state, "me");
    assert.match(dialog.textContent, /1 rodada/);
    assert.equal(own.querySelector(".ongoing-spell-counter")!.textContent, "1");
    state.ongoingSpells.shift();
    ui.update(state, "me");
    assert.equal(own.hidden, true);
    assert.match(dialog.textContent, /terminou/);
    dialog.close();
    enemy.querySelector("button")!.click();
    assert.match(dialog.textContent, /Adversário/);
    assert.match(dialog.textContent, /3 de dano/);
    assert.equal(
      dialog.querySelector("img")!.getAttribute("src"),
      "/assets/Cards/Chuva de Flechas.png",
    );
    state.ongoingSpells.length = 0;
    ui.update(state, "me");
    assert.equal(enemy.hidden, true);
  } finally {
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("Barreira aparece entre as tropas e detalha dano após ataque, reações e expiração", async () => {
  const dom = new JSDOM(
    '<div class="arena-divider"><span>✧</span></div><div id="me"></div><div id="enemy"></div>',
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const path = "../public/JS/ongoing-spells.js";
    const { createOngoingSpells } = await import(path);
    const doc = dom.window.document;
    const ui = createOngoingSpells(
      doc.getElementById("me"),
      doc.getElementById("enemy"),
    );
    const state = {
      players: [
        { id: "me", nome: "Eu" },
        { id: "enemy", nome: "Outro" },
      ],
      fieldEffects: [
        {
          id: "field",
          ownerId: "me",
          affectedOwnerId: "enemy",
          rounds: 3,
          damage: 2,
          reactions: [
            { elemento: "Agua", multiplicador: 0.5 },
            { elemento: "Ar", multiplicador: 2 },
            { elemento: "Terra", remover: true },
          ],
          card: {
            nome: "Barreira Ígnea",
            imgURL: "/assets/Cards/Barreira Ígnea.png",
          },
        },
      ],
    };
    ui.update(state, "me");
    const divider = doc.querySelector(".arena-divider")!;
    assert.ok(divider.classList.contains("has-field-effects"));
    const button = divider.querySelector("button")!;
    assert.match(button.textContent, /Barreira/);
    const dialog = doc.querySelector("dialog") as any;
    dialog.showModal = () => {
      dialog.open = true;
    };
    button.click();
    assert.match(dialog.textContent, /após cada ataque/);
    assert.match(dialog.textContent, /Outro/);
    assert.match(dialog.textContent, /Água/);
    assert.match(dialog.textContent, /remove o efeito/);
    state.fieldEffects = [];
    ui.update(state, "me");
    assert.ok(!divider.classList.contains("has-field-effects"));
    assert.match(dialog.textContent, /terminou/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    dom.window.close();
  }
});
