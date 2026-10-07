import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("construtor no celular troca telas sem perder filtros ou rascunho e restaura desktop", async () => {
  const dom = new JSDOM(
    `<main><aside data-deck-screen="decks"></aside><section data-deck-screen="cards"><input value="Fogo"></section><aside data-deck-screen="editor"><input value="Meu deck"></aside></main><nav><button data-deck-view="decks"></button><button data-deck-view="cards"></button><button data-deck-view="editor"></button></nav>`,
  );
  let onResize = () => {};
  const media = {
    matches: true,
    addEventListener: (_: string, handler: () => void) => {
      onResize = handler;
    },
  };
  dom.window.matchMedia = (() => media) as any;
  dom.window.scrollTo = () => {};
  const modulePath = "../public/JS/deck-navigation.js";
  const { createDeckNavigation } = await import(modulePath);
  const doc = dom.window.document;
  const nav = doc.querySelector("nav")!;
  createDeckNavigation(doc.querySelector("main"), nav);
  const screens = [...doc.querySelectorAll<HTMLElement>("[data-deck-screen]")];
  const tabs = [...nav.querySelectorAll("button")];
  assert.deepEqual(
    screens.map((s) => s.hidden),
    [false, true, true],
  );
  tabs[1].click();
  assert.deepEqual(
    screens.map((s) => s.hidden),
    [true, false, true],
  );
  tabs[2].click();
  assert.deepEqual(
    screens.map((s) => s.hidden),
    [true, true, false],
  );
  assert.equal(tabs[2].getAttribute("aria-current"), "page");
  assert.deepEqual(
    [...doc.querySelectorAll("input")].map((i) => i.value),
    ["Fogo", "Meu deck"],
  );
  media.matches = false;
  onResize();
  assert.equal(nav.hidden, true);
  assert.ok(screens.every((s) => !s.hidden));
  media.matches = true;
  onResize();
  assert.deepEqual(
    screens.map((s) => s.hidden),
    [true, true, false],
  );
  dom.window.close();
});
