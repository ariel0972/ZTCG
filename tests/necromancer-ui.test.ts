import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("ressurreição destaca apenas espaços aliados livres sem Lama e filtra tropas do cemitério", async () => {
  const modulePath = "../public/JS/battle-targets.js";
  const { destinationChoice, zoneCardAllowed } = await import(modulePath);
  const action = { alvo: "Cemiterio", efeitos: [{ id: "revive" }] };
  const slots = [
    { id: "free", ownerId: "p1", kind: "Tropa" },
    { id: "mud", ownerId: "p1", kind: "Tropa", terrain: {} },
    { id: "occupied", ownerId: "p1", kind: "Tropa", card: {} },
    { id: "mage", ownerId: "p1", kind: "Mago" },
    { id: "enemy", ownerId: "p2", kind: "Tropa" },
  ];
  assert.deepEqual(destinationChoice(action, ["corpse"], slots, "p1"), {
    required: true,
    destinations: ["free"],
  });
  assert.deepEqual(destinationChoice(action, [], slots, "p1").destinations, []);
  assert.equal(zoneCardAllowed(action, { tipo: "Tropa" }), true);
  assert.equal(zoneCardAllowed(action, { tipo: "Mago" }), false);
});
test("interface exige tropa e destino, respeita dono da escolha e exibe custo de vida", async () => {
  const dom = new JSDOM('<main id="host"></main>', {
    url: "http://localhost/",
  });
  const keys = [
    "window",
    "document",
    "location",
    "localStorage",
    "sessionStorage",
  ];
  const previous = new Map(
    keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const k of keys)
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: (dom.window as any)[k],
    });
  try {
    const modulePath = "../public/JS/revive-choice.js",
      detailsPath = "../public/JS/card-details.js";
    const { renderReviveChoice } = await import(modulePath);
    const { renderCardDetails } = await import(detailsPath);
    const host = dom.window.document.getElementById("host")!;
    const state = {
      pendingRevive: { ownerId: "p1", cards: ["dead"], source: "Necromante" },
      players: [
        {
          id: "p1",
          graveyard: [
            { id: "dead", nome: "Guerreiro" },
            { id: "other", nome: "Outra carta" },
          ],
        },
      ],
      slots: [
        { id: "free", column: 0 },
        { id: "enemy", column: 1 },
      ],
      reviveDestinations: ["free"],
    };
    let sent: any;
    renderReviveChoice(host, state, "p1", {
      onChoose: (cmd: any) => {
        sent = cmd;
      },
    });
    const selects = host.querySelectorAll("select");
    const button = host.querySelector("button")!;
    assert.equal(button.disabled, true);
    assert.equal(selects[0].options.length, 2);
    selects[0].value = "dead";
    selects[0].dispatchEvent(new dom.window.Event("change"));
    assert.equal(button.disabled, true);
    selects[1].value = "free";
    selects[1].dispatchEvent(new dom.window.Event("change"));
    button.click();
    assert.deepEqual(sent, {
      type: "chooseRevive",
      cardId: "dead",
      destinationId: "free",
    });
    host.replaceChildren();
    renderReviveChoice(host, state, "p2");
    assert.equal(host.querySelectorAll("select").length, 0);
    assert.match(host.textContent!, /oponente/);
    host.replaceChildren();
    renderCardDetails(host, {
      nome: "Necromante",
      tipo: "Mago",
      custoMana: 0,
      hp: 18,
      ataque: 2,
      habilidadesAtivas: [
        {
          id: "enganarAMorte",
          nome: "Enganar a morte",
          custoMana: 0,
          custoVida: 4,
          descricao: "Escolha tropas",
        },
      ],
      habilidadesPassivas: [
        {
          gatilho: "onElementalReaction",
          escopo: "qualquer",
          reacao: { nome: "Zarconizado", quando: "provocaOuRecebe" },
          descricao: "Reviva uma tropa",
          efeitos: [{ id: "revive", jogador: "aliado" }],
        },
      ],
      palavrasChave: [],
      fraqueza: [],
      resistencia: [],
    });
    assert.match(
      host.querySelector(".card-ability-cost")!.textContent!,
      /4 de vida/,
    );
    assert.doesNotMatch(
      host.querySelector(".card-ability-cost")!.textContent!,
      /mana/,
    );
    assert.match(host.textContent!, /Indicadores de reação/);
    assert.match(host.textContent!, /Zarconizado/);
  } finally {
    for (const k of keys) {
      const v = previous.get(k);
      if (v) Object.defineProperty(globalThis, k, v);
      else delete (globalThis as any)[k];
    }
    dom.window.close();
  }
});
