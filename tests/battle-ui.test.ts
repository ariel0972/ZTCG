import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("cartas dinâmicas mostram vida atual, bônus de armamento e status com duração", async () => {
  const dom = new JSDOM("<body></body>");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const modulePath = "../public/JS/battle-ui.js";
    const { cardFace } = await import(modulePath);
    const card = {
      nome: "Guerreiro",
      tipo: "Tropa",
      custoMana: 3,
      hp: 10,
      hpAtual: 6,
      ataque: 2,
      statuses: [{ nome: "Envenenado", turnosRestantes: 3 }],
      attacked: true,
    };
    const slot = { id: "p1:front:0", ownerId: "p1", kind: "Tropa", column: 0 };
    const face = cardFace(card, {
      slot,
      slots: [
        { id: "p1:arm:front-left", ownerId: "p1", card: { bonusAtaque: 4 } },
      ],
    });
    const updated = cardFace(card, {
      slot,
      slots: [],
      previous: { attack: "2", health: "10" },
    });
    assert.ok(updated.querySelector(".health").classList.contains("changed"));
    assert.ok(!updated.querySelector(".attack").classList.contains("changed"));
    assert.equal(face.querySelector(".attack").textContent, "6");
    assert.equal(face.querySelector(".health").textContent, "6");
    assert.ok(face.querySelector(".health").classList.contains("damaged"));
    assert.match(
      face.querySelector(".effect-token").getAttribute("aria-label"),
      /Envenenado.*3 rodada/,
    );
    assert.match(face.textContent, /Ataque usado/);
    const structure = cardFace(
      { ...card, tipo: "Estrutura" },
      {
        slot,
        slots: [
          { id: "p1:arm:front-left", ownerId: "p1", card: { bonusAtaque: 4 } },
        ],
      },
    );
    assert.equal(structure.querySelector(".attack").textContent, "2");
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("arraste distingue clique, cancela sem jogar e executa só uma soltura em destino válido", async () => {
  const dom = new JSDOM(
    '<button id="card">Carta</button><button data-slot-id="slot">Destino</button><div data-field-drop-zone>Campo</div>',
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const modulePath = "../public/JS/battle-ui.js";
    const { bindCardDrag } = await import(modulePath);
    const card = dom.window.document.getElementById("card")!;
    const target = dom.window.document.querySelector("[data-slot-id]")!;
    (dom.window.document as any).elementFromPoint = () => target;
    let drops = 0,
      clicks = 0;
    bindCardDrag(card, {
      source: { type: "play" },
      canStart: () => true,
      actionFor: () => "play",
      onDrop: () => drops++,
    });
    card.addEventListener("click", () => clicks++);
    const pointer = (type: string, x: number) => {
      const event = new dom.window.MouseEvent(type, {
        clientX: x,
        clientY: 20,
        button: 0,
        cancelable: true,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      card.dispatchEvent(event);
    };
    pointer("pointerdown", 10);
    pointer("pointerup", 10);
    (card as any).click();
    assert.equal(clicks, 1);
    assert.equal(drops, 0);
    pointer("pointerdown", 10);
    pointer("pointermove", 40);
    pointer("pointercancel", 40);
    assert.equal(drops, 0);
    assert.equal(dom.window.document.querySelector(".drag-ghost"), null);
    pointer("pointerdown", 10);
    pointer("pointermove", 40);
    assert.ok(target.classList.contains("drop-ready"));
    pointer("pointerup", 40);
    (card as any).click();
    assert.equal(drops, 1);
    assert.equal(clicks, 1);
    assert.equal(dom.window.document.querySelector(".drag-ghost"), null);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const field = dom.window.document.querySelector("[data-field-drop-zone]")!;
    (dom.window.document as any).elementFromPoint = () => field;
    pointer("pointerdown", 10);
    pointer("pointermove", 40);
    pointer("pointerup", 40);
    assert.equal(drops, 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("feitiços automáticos aceitam campo vazio e fundo do campo; seleção individual continua obrigatória", async () => {
  const modulePath = "../public/JS/battle-ui.js";
  const { dropAction } = await import(modulePath);
  const state = { status: "ACTIVE" };
  const slot = { ownerId: "p2", kind: "Tropa", card: null };
  for (const alvo of ["Global", "TodosInimigos", "TodasTropasInimigas"]) {
    const source = { type: "play", card: { tipo: "Feitico", alvo } };
    assert.equal(dropAction(source, undefined, state, "p1"), "play");
    assert.equal(dropAction(source, slot, state, "p1"), "play");
    assert.equal(dropAction(source, slot, { status: "FINISHED" }, "p1"), null);
  }
  const chosen = {
    type: "play",
    card: { tipo: "Feitico", alvo: "UnicoInimigo" },
  };
  assert.equal(dropAction(chosen, undefined, state, "p1"), null);
  assert.equal(dropAction(chosen, slot, state, "p1"), null);
});

test("destinos de arraste respeitam preparação, lados, pântano e bloqueio após atacar", async () => {
  const modulePath = "../public/JS/battle-ui.js";
  const { dropAction } = await import(modulePath);
  const state = {
    status: "ACTIVE",
    phase: "PREPARATION",
    players: [{ id: "p1", combatStarted: false }],
    slots: [],
  };
  const source = { type: "play", card: { tipo: "Tropa", palavrasChave: [] } };
  const own = {
    id: "p1:front:0",
    ownerId: "p1",
    kind: "Tropa",
    column: 0,
    card: null,
  };
  assert.equal(dropAction(source, own, state, "p1"), "play");
  assert.equal(
    dropAction(source, { ...own, ownerId: "p2" }, state, "p1"),
    null,
  );
  assert.equal(
    dropAction(source, { ...own, terrain: { nome: "Lama" } }, state, "p1"),
    null,
  );
  state.players[0].combatStarted = true;
  assert.equal(dropAction(source, own, state, "p1"), null);
  const attack = {
    type: "field",
    card: { tipo: "Tropa", direcaoAtaque: "Frente", palavrasChave: [] },
    slot: own,
  };
  assert.equal(
    dropAction(attack, { ...own, ownerId: "p2", column: 2 }, state, "p1"),
    null,
  );
  state.phase = "BATTLE";
  assert.equal(
    dropAction(attack, { ...own, ownerId: "p2", column: 2 }, state, "p1"),
    "attack",
  );
});

test("arraste usa os alvos calculados pelo servidor, inclusive mago e Guardar", async () => {
  const modulePath = "../public/JS/battle-ui.js";
  const { dropAction } = await import(modulePath);
  const mage = { id: "p2:mage", ownerId: "p2", kind: "Mago", column: 1 };
  const state = { status: "ACTIVE", phase: "BATTLE", players: [], slots: [] };
  const source = {
    type: "field",
    card: { tipo: "Tropa" },
    slot: { ownerId: "p1", attackTargets: { card: [mage.id], structure: [] } },
  };
  assert.equal(dropAction(source, mage, state, "p1"), "attack");
  assert.equal(
    dropAction(
      source,
      { ...mage, id: "p2:front:1", kind: "Tropa" },
      state,
      "p1",
    ),
    null,
  );
  source.card.tipo = "Estrutura";
  assert.equal(
    dropAction(source, mage, state, "p1"),
    null,
    "Estrutura possui seu próprio conjunto de alvos.",
  );
});

test("arraste mobiliza na montaria, monta em campo e distingue ataque do ocupante", async () => {
  const modulePath = "../public/JS/battle-ui.js";
  const { dropAction, fieldSource, mountAllowed } = await import(modulePath);
  const horse = {
    id: "horse",
    tipo: "Tropa",
    ownerId: "p1",
    palavrasChave: ["Montaria"],
    montaria: { filtro: { numeroCatalogo: "021" } },
  };
  const knight = {
    id: "knight",
    tipo: "Tropa",
    ownerId: "p1",
    numeroCatalogo: "021",
    palavrasChave: [],
  };
  const dest = { id: "p1:front:0", kind: "Tropa", ownerId: "p1", card: horse };
  const state = {
    status: "ACTIVE",
    phase: "BATTLE",
    players: [{ id: "p1", combatStarted: false }],
    slots: [dest],
  };
  assert.equal(mountAllowed(horse, knight), true);
  assert.equal(
    mountAllowed(horse, { ...knight, numeroCatalogo: "023" }),
    false,
  );
  assert.equal(
    dropAction({ type: "play", card: knight }, dest, state, "p1"),
    "play",
  );
  assert.equal(
    dropAction(
      { type: "play", card: knight },
      { ...dest, rider: knight },
      state,
      "p1",
    ),
    null,
  );
  const source = {
    type: "field",
    card: knight,
    slot: {
      id: "p1:front:2",
      ownerId: "p1",
      kind: "Tropa",
      card: knight,
      mountTargets: [dest.id],
    },
  };
  assert.equal(dropAction(source, dest, state, "p1"), "mount");
  const field = {
    ...dest,
    rider: knight,
    attackTargets: { card: [], rider: ["p2:front:2"] },
  };
  assert.equal(fieldSource(knight, field), "rider");
  assert.equal(
    dropAction(
      { type: "field", card: knight, slot: field },
      { id: "p2:front:2", ownerId: "p2", kind: "Tropa" },
      state,
      "p1",
    ),
    "attack",
  );
});

test("arraste recusa feitiços de qualquer alvo durante preparação", async () => {
  const modulePath = "../public/JS/battle-ui.js";
  const { dropAction } = await import(modulePath);
  const state = {
    status: "ACTIVE",
    phase: "PREPARATION",
    players: [{ id: "p1" }],
    slots: [],
  };
  for (const alvo of ["Global", "UnicoAliado", "TodosInimigos"])
    assert.equal(
      dropAction(
        { type: "play", card: { tipo: "Feitico", alvo } },
        {
          id: "ally",
          ownerId: "p1",
          kind: "Mago",
          card: { tipo: "Mago", hp: 18 },
        },
        state,
        "p1",
      ),
      null,
    );
});

test("mana mostra custo na mão e recuperação nas cartas em campo", async () => {
  const dom = new JSDOM("<body></body>");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const modulePath = "../public/JS/battle-ui.js";
    const { cardFace } = await import(modulePath);
    for (const tipo of ["Tropa", "Estrutura", "Armamento", "Mago"]) {
      const card = {
        nome: "Teste",
        tipo,
        custoMana: 6,
        manaGerada: 2,
        recuperacaoMana: 4,
        manaRecovery: tipo === "Mago" ? 7 : 2,
        statuses: [],
      };
      const slot = { kind: tipo, ownerId: "p1", column: 0 };
      const field = cardFace(card, { slot, slots: [] }).querySelector(
        ".live-cost",
      )!;
      assert.equal(field.textContent, tipo === "Mago" ? "+7" : "+2");
      assert.match(field.getAttribute("aria-label")!, /Recupera/);
      assert.equal(
        cardFace(card, { hand: true }).querySelector(".live-cost")!.textContent,
        "6",
      );
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("estados persistentes e uso de ações têm sinais independentes, sem revelar cartas ocultas", async () => {
  const dom = new JSDOM("<body></body>");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const modulePath = "../public/JS/battle-ui.js";
    const { cardFace } = await import(modulePath);
    const base = {
      nome: "Teste",
      tipo: "Tropa",
      custoMana: 5,
      hp: 12,
      hpAtual: 12,
      ataque: 3,
      limiteAtaques: 2,
      palavrasChave: ["Esconder", "Guardar"],
      statuses: [
        { nome: "Atordoamento", turnosRestantes: 1 },
        { nome: "Cegueira", turnosRestantes: 2 },
        { nome: "Incapacitado", turnosRestantes: 1 },
      ],
    };
    const face = cardFace({
      ...base,
      attacksMade: 1,
      attacked: false,
      usedAbility: true,
    });
    for (const key of ["hidden", "guard", "stunned", "blind", "disabled"])
      assert.ok(face.querySelector(".card-state--" + key));
    assert.equal(face.dataset.actionUsage, "both");
    assert.ok(face.classList.contains("used-both"));
    assert.match(
      face.querySelector('[aria-label="Em guarda"]').title,
      /Em guarda/,
    );
    assert.equal(face.querySelectorAll(".card-state-layer").length, 1);
    const fresh = cardFace({
      ...base,
      palavrasChave: [],
      statuses: base.statuses.map((s) => ({ ...s, turnosRestantes: 0 })),
      attacked: false,
      usedAbility: false,
    });
    assert.equal(fresh.querySelector(".card-state-layer"), null);
    assert.equal(fresh.dataset.actionUsage, "none");
    assert.equal(fresh.querySelector(".effect-token"), null);
    const hidden = cardFace({ ...base, oculta: true });
    assert.equal(hidden.querySelector(".card-state-layer"), null);
    assert.equal(hidden.dataset.actionUsage, undefined);
    const hand = cardFace(
      { ...base, attacked: true, usedAbility: true },
      { hand: true },
    );
    assert.equal(hand.querySelector(".card-state-layer"), null);
    assert.equal(hand.classList.contains("used-both"), false);
    for (const [attacked, usedAbility, usage] of [
      [true, false, "attack"],
      [false, true, "ability"],
      [true, true, "both"],
    ])
      assert.equal(
        cardFace({ ...base, attacked, usedAbility }).dataset.actionUsage,
        usage,
      );
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("Marionete destaca somente vizinhas da tropa frontal, sem incluir mago ou outra coluna", async () => {
  const modulePath = "../public/JS/battle-targets.js";
  const { spellSlotTarget } = await import(modulePath);
  const action = {
    alvo: "UnicoInimigo",
    sourceColumn: 0,
    tiposAlvo: ["Tropa"],
    efeitos: [
      { id: "basicStrike", ataque: { origem: "frontal", consumirUso: true } },
    ],
  };
  const slot = {
    ownerId: "q",
    kind: "Tropa",
    column: 1,
    card: { id: "t", tipo: "Tropa", hp: 12 },
  };
  assert.equal(spellSlotTarget(action, slot, "p"), true);
  for (const column of [0, 2])
    assert.equal(spellSlotTarget(action, { ...slot, column }, "p"), false);
  assert.equal(
    spellSlotTarget(
      action,
      { ...slot, kind: "Mago", card: { id: "m", tipo: "Mago", hp: 20 } },
      "p",
    ),
    false,
  );
});

test("menu oferece estrutura só à tropa operadora e carga preserva limites e acessibilidade", async () => {
  const dom = new JSDOM("<body></body>");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  try {
    const path = "../public/JS/structure-actions.js";
    const { structureAttackOption, createChargeControl } = await import(path);
    const mount = { id: "m", tipo: "Tropa" },
      rider = { id: "r", tipo: "Tropa" },
      structure = { tipo: "Estrutura", nome: "Canhão", ataque: 4 };
    const slot = {
      card: mount,
      rider,
      structure,
      attackTargets: { structure: ["enemy"] },
    };
    assert.equal(structureAttackOption(mount, slot), null);
    const option = structureAttackOption(rider, slot);
    assert.equal(option.source, "structure");
    assert.match(option.label, /Canhão.*4/);
    assert.equal(option.reason, "");
    assert.equal(
      structureAttackOption(mount, {
        ...slot,
        rider: null,
        structure: { ...structure, ataque: 0 },
      }),
      null,
    );
    const card = {
      ...structure,
      estrutura: { carga: { minimoMana: 2, manaPorDano: 2 } },
      storedMana: 3,
    };
    let charged = 0;
    const control = createChargeControl(card, {
      mana: 7,
      onCharge: (n: number) => (charged = n),
    });
    const input = control.querySelector("input");
    input.value = "5";
    control.querySelector("button").click();
    assert.equal(charged, 5);
    assert.equal(input.min, "2");
    assert.equal(input.max, "7");
    assert.match(input.getAttribute("aria-label"), /Canhão/);
    const blocked = createChargeControl(card, {
      mana: 1,
      onCharge: () => assert.fail(),
    });
    assert.equal(blocked.querySelector("button").disabled, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});
