import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("pilhas usam o verso do baralho e ignoram a antiga preferência global", async () => {
  const dom = new JSDOM(
    `<dialog><input id="piles-on-field" type="checkbox"><div id="picker"></div></dialog><div id="field"><button id="deck-zone"><img><b id="deck-pile-count"></b></button><button id="graveyard"><img><b id="graveyard-pile-count"></b></button></div><div id="footer"></div>`,
    { url: "http://localhost" },
  );
  const doc = dom.window.document;
  const storage = dom.window.localStorage;
  storage.setItem("ztcg:drafts", "cartas do jogador");
  storage.setItem("ztcg:card-back", "fire");
  const modulePath = "../public/JS/card-backs.js";
  const { createCardBacks } = await import(modulePath);
  const controller = createCardBacks({
    dialog: doc.querySelector("dialog"),
    picker: doc.querySelector("#picker"),
    field: doc.querySelector("#field"),
    footer: doc.querySelector("#footer"),
    storage,
  });
  assert.equal(doc.querySelectorAll("#picker button").length, 0);
  controller.update(28, 3, "water");
  assert.match(
    doc.querySelector("#field img")!.getAttribute("src")!,
    /water.png$/,
  );
  controller.update(28, 3, "earth");
  assert.match(
    doc.querySelector("#field img")!.getAttribute("src")!,
    /earth.png$/,
  );
  assert.equal(storage.getItem("ztcg:card-back"), "fire");
  assert.equal(storage.getItem("ztcg:drafts"), "cartas do jogador");
  assert.equal(doc.querySelector("#deck-pile-count")!.textContent, "28");
  assert.equal(doc.querySelector("#graveyard-pile-count")!.textContent, "3");
  const toggle = doc.querySelector<HTMLInputElement>("input")!;
  toggle.checked = false;
  toggle.dispatchEvent(new dom.window.Event("change"));
  assert.equal((doc.querySelector("#field") as HTMLElement).hidden, true);
  assert.equal((doc.querySelector("#footer") as HTMLElement).hidden, false);
  assert.equal(storage.getItem("ztcg:zone-piles"), "false");
  dom.window.close();
});

test("descrições explicam habilidades fixas e só as escolhas reais pedem alvos", async () => {
  const modulePath = "../public/JS/card-view.js";
  const { abilityNeedsTarget, abilityDescription, describe } = await import(
    modulePath
  );
  for (const id of [
    "ataqueFurtivo",
    "armaduraPoderosa",
    "ordemDaEspada",
    "enganarAMorte",
  ]) {
    assert.equal(abilityNeedsTarget({ id }), false);
    assert.match(abilityDescription({ id }), /automático/);
  }
  assert.equal(abilityNeedsTarget({ id: "ressurreicaoSombria" }), true);
  assert.equal(abilityNeedsTarget({ id: "protecaoAquatica" }), true);
  assert.equal(
    abilityNeedsTarget({ id: "generic", alvo: "TodosInimigos" }),
    false,
  );
  assert.equal(
    abilityNeedsTarget({ id: "generic", alvo: "UnicoAliado" }),
    true,
  );
  assert.match(
    describe({
      tipo: "Tropa",
      custoMana: 3,
      habilidadesAtivas: [
        { id: "ataqueFurtivo", nome: "Ataque Furtivo", custoMana: 4 },
      ],
      habilidadesPassivas: [
        { gatilho: "onDeath", efeito: "ganharVida", valor: 2 },
      ],
    }),
    /diretamente ao mago inimigo/,
  );
});
