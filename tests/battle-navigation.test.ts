import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("setas da mão aparecem por overflow e alcançam as duas extremidades", async () => {
  const dom = new JSDOM(
    '<div id="hand"></div><button id="previous"></button><button id="next"></button>',
  );
  const doc = dom.window.document,
    track = doc.getElementById("hand")!,
    previous = doc.getElementById("previous") as HTMLButtonElement,
    next = doc.getElementById("next") as HTMLButtonElement;
  let width = 1200;
  Object.defineProperty(track, "scrollWidth", { get: () => width });
  Object.defineProperty(track, "clientWidth", { value: 400 });
  const modulePath = "../public/JS/hand-navigation.js";
  const { createHandNavigation } = await import(modulePath);
  (track as any).scrollBy = ({ left }: { left: number }) => {
    track.scrollLeft = Math.max(
      0,
      Math.min(width - 400, track.scrollLeft + left),
    );
    track.dispatchEvent(new dom.window.Event("scroll"));
  };
  const nav = createHandNavigation(track, previous, next);
  nav.update();
  assert.equal(previous.disabled, true);
  assert.equal(next.hidden, false);
  next.click();
  next.click();
  next.click();
  assert.equal(track.scrollLeft, 800);
  assert.equal(next.disabled, true);
  previous.click();
  previous.click();
  previous.click();
  assert.equal(track.scrollLeft, 0);
  width = 300;
  nav.update();
  assert.equal(previous.hidden, true);
  assert.equal(next.hidden, true);
  nav.close();
  dom.window.close();
});
test("aviso de turno não repete em ações/polling e troca o lado iluminado", async () => {
  const dom = new JSDOM('<div id="arena"></div><div id="banner" hidden></div>');
  const arena = dom.window.document.getElementById("arena")!,
    banner = dom.window.document.getElementById("banner")!;
  let animations = 0;
  (banner as any).animate = () => animations++;
  const modulePath = "../public/JS/turn-announcement.js";
  const { createTurnAnnouncement } = await import(modulePath);
  const turn = createTurnAnnouncement(arena, banner);
  const state = {
    id: "match",
    status: "ACTIVE",
    phase: "BATTLE",
    turn: 1,
    current: "me",
  };
  turn.update(state, "me");
  assert.equal(banner.textContent, "Seu turno");
  assert.equal(arena.dataset.activeSide, "me");
  turn.update({ ...state, version: 3 }, "me");
  assert.equal(animations, 1);
  turn.update({ ...state, turn: 2, current: "enemy" }, "me");
  assert.equal(banner.textContent, "Turno do oponente");
  assert.equal(arena.dataset.activeSide, "enemy");
  turn.update({ ...state, status: "FINISHED" }, "me");
  assert.equal(banner.hidden, true);
  assert.equal(arena.dataset.activeSide, "");
  turn.close();
  dom.window.close();
});
test("feitiços distinguem aliado, inimigo, mago, campo vazio, estrutura e zonas", async () => {
  const modulePath = "../public/JS/battle-targets.js";
  const {
    spellSlotTarget: target,
    slotTargetId,
    zoneCardAllowed,
  } = await import(modulePath);
  const troop = { id: "troop", tipo: "Tropa", hp: 10, statuses: [] };
  const ally = {
    id: "ally:front:0",
    ownerId: "me",
    kind: "Tropa",
    card: troop,
  };
  const enemy = { ...ally, id: "enemy:front:0", ownerId: "enemy" };
  const mage = { ...enemy, kind: "Mago", card: { ...troop, tipo: "Mago" } };
  assert.equal(target({ alvo: "UnicoAliado" }, ally, "me"), true);
  assert.equal(target({ alvo: "UnicoAliado" }, enemy, "me"), false);
  assert.equal(target({ alvo: "UnicoInimigo" }, mage, "me"), true);
  assert.equal(
    target({ alvo: "UnicoInimigo" }, { ...enemy, card: null }, "me"),
    false,
  );
  assert.equal(
    target({ alvo: "CampoInimigo" }, { ...enemy, card: null }, "me"),
    true,
  );
  assert.equal(target({ alvo: "CampoInimigo" }, mage, "me"), false);
  assert.equal(target({ alvo: "TodasTropasInimigas" }, mage, "me"), false);
  assert.equal(target({ alvo: "TodosInimigos" }, mage, "me"), true);
  assert.equal(
    target(
      {
        alvo: "TodasTropasInimigas",
        casterElement: "Terra",
        efeitos: [{ id: "tremor" }],
      },
      mage,
      "me",
    ),
    true,
  );
  assert.equal(
    target({ alvo: "UnicoInimigo", efeitos: [{ id: "tornado" }] }, mage, "me"),
    false,
  );
  assert.equal(
    target({ alvo: "UnicoInimigo", efeitos: [{ id: "banish" }] }, mage, "me"),
    false,
  );
  const hidden = {
    ...enemy,
    card: { ...troop, statuses: [{ nome: "Esconder", turnosRestantes: 1 }] },
  };
  assert.equal(target({ alvo: "UnicoInimigo" }, hidden, "me"), false);
  assert.equal(target({ alvo: "TodosInimigos" }, hidden, "me"), true);
  const structure = {
    ...ally,
    structure: { id: "structure", tipo: "Estrutura", hp: 5 },
  };
  assert.equal(target({ alvo: "Estrutura" }, structure, "me"), true);
  assert.equal(slotTargetId({ alvo: "Estrutura" }, structure), "structure");
  assert.equal(slotTargetId({ alvo: "CampoAliado" }, ally), ally.id);
  for (const alvo of ["Deck", "Cemiterio", "Mao", "Global"])
    assert.equal(target({ alvo }, ally, "me"), false);
  assert.equal(
    zoneCardAllowed(
      { efeitos: [{ id: "searchElemental" }] },
      { tipo: "Feitico", elemento: "Fogo" },
    ),
    true,
  );
  assert.equal(
    zoneCardAllowed(
      { efeitos: [{ id: "searchElemental" }] },
      { tipo: "Feitico", elemento: "Neutro" },
    ),
    false,
  );
});
