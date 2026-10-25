import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { necroRevivePatch } from "../scripts/update-necro-revive";
import initial from "../src/data/catalog.json";

test("estrutura tem imagem e vida próprias; aura acompanha apenas o lado com amplificação ativa", async () => {
  const dom = new JSDOM(
    '<main><div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div></main>',
    { url: "http://localhost" },
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const path = "../public/JS/battle-ui.js";
    const { structureFace, renderSpellAura } = await import(path);
    const card = {
      id: "tower",
      nome: "Torre",
      hp: 50,
      hpAtual: 37,
      tipo: "Estrutura",
      imgURL: "/assets/Cards/Torre.png",
    };
    const face = structureFace(card);
    assert.equal(face.dataset.liveCardId, "tower");
    assert.ok(face.querySelector(".structure-portrait svg image"));
    assert.ok(face.textContent.includes("37 / 50 PV"));
    assert.equal(face.querySelector("progress").value, 37);
    assert.equal(face.querySelector("progress").max, 50);
    const rows = ["a", "b", "c", "d"].map((id) =>
      dom.window.document.getElementById(id)!,
    );
    const owner = {
      id: "one",
      mage: {
        statuses: [
          { nome: "Amplificar", turnosRestantes: 2, spellBoost: { bonus: 1 } },
        ],
      },
    };
    renderSpellAura(owner, rows[0], rows[1]);
    renderSpellAura({ id: "two", mage: { statuses: [] } }, rows[2], rows[3]);
    assert.equal(
      dom.window.document.querySelectorAll(".spell-boost-field").length,
      2,
    );
    assert.equal(rows[2].classList.contains("spell-boost-field"), false);
    renderSpellAura(owner, rows[0], rows[1]);
    assert.equal(rows[0].querySelectorAll(".spell-boost-label").length, 1);
    owner.mage.statuses[0].turnosRestantes = 0;
    renderSpellAura(owner, rows[0], rows[1]);
    assert.equal(
      dom.window.document.querySelectorAll(
        ".spell-boost-field,.spell-boost-label",
      ).length,
      0,
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});
test("migração do Necromante preserva ajustes administrativos e é idempotente", () => {
  const original = structuredClone(
    initial.find((c) => c.numeroCatalogo === "108")!,
  ) as any;
  original.hp = 29;
  original.resistencia = [];
  original.imgURL = "/custom.png";
  original.versao = 18;
  original.habilidadesAtivas[0].custoVida = 4;
  original.habilidadesAtivas[0].maxAlvos = 3;
  original.habilidadesAtivas[0].efeitos = [
    { id: "shuffleGraveyard", valor: 3 },
  ];
  const patch = necroRevivePatch(original).patch;
  assert.deepEqual(Object.keys(patch), ["habilidadesAtivas"]);
  const next = { ...original, ...patch };
  assert.equal(next.hp, 29);
  assert.deepEqual(next.resistencia, []);
  assert.equal(next.imgURL, "/custom.png");
  assert.equal(next.versao, 18);
  assert.equal(next.habilidadesAtivas[0].custoVida, 5);
  assert.deepEqual(necroRevivePatch(next).patch, {});
});
