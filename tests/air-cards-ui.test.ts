import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Esfera permite escolher apenas vizinho vazio e dispensa destino contra estrutura", async () => {
  const path = "../public/JS/battle-targets.js";
  const { displacementChoice, spellSlotTarget } = await import(path);
  const action = {
    alvo: "UnicoInimigo",
    tiposAlvo: ["Tropa"],
    efeitos: [{ id: "displace", direcao: "vizinho", estrutura: "manter" }],
  };
  const slots: any[] = [
    { id: "a", ownerId: "p2", kind: "Tropa", column: 0, card: null },
    {
      id: "b",
      ownerId: "p2",
      kind: "Tropa",
      column: 1,
      card: { id: "bird", tipo: "Tropa", hp: 8 },
      rider: { id: "rider" },
    },
    { id: "c", ownerId: "p2", kind: "Tropa", column: 2, card: null },
    { id: "own", ownerId: "p1", kind: "Tropa", column: 0, card: null },
  ];
  assert.deepEqual(displacementChoice(action, ["rider"], slots), {
    required: true,
    destinations: ["a", "c"],
  });
  slots[0].terrain = { nome: "Lama" };
  assert.deepEqual(displacementChoice(action, ["bird"], slots).destinations, [
    "c",
  ]);
  slots[2].card = { id: "other", tipo: "Tropa" };
  assert.deepEqual(displacementChoice(action, ["bird"], slots), {
    required: true,
    destinations: [],
  });
  slots[1].structure = { id: "wall" };
  assert.deepEqual(displacementChoice(action, ["bird"], slots), {
    required: false,
    destinations: [],
  });
  assert.equal(spellSlotTarget(action, slots[1], "p1"), true);
  assert.equal(
    spellSlotTarget(
      {
        ...action,
        efeitos: [
          { id: "displace", direcao: "direita", estrutura: "impedirUso" },
        ],
      },
      slots[1],
      "p1",
    ),
    false,
  );
  assert.equal(
    spellSlotTarget(
      action,
      { ...slots[1], card: { id: "mage", tipo: "Mago" }, structure: null },
      "p1",
    ),
    false,
  );
});
test("tabuleiro mostra gasto do ataque duplo e impedimento agendado para próxima rodada", async () => {
  const dom = new JSDOM("<body></body>");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const path = "../public/JS/battle-ui.js";
    const { cardFace } = await import(path);
    const face = cardFace({
      nome: "Teste",
      tipo: "Tropa",
      hp: 8,
      hpAtual: 8,
      ataque: 2,
      limiteAtaques: 2,
      attacksMade: 1,
      scheduledStatuses: [
        { round: 4, status: { nome: "SemAtaque", turnosRestantes: 1 } },
      ],
    });
    assert.ok(face.textContent.includes("Ataques: 1/2"));
    assert.match(
      face.querySelector(".effect-token").getAttribute("aria-label"),
      /Próxima rodada.*SemAtaque/,
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});
