import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("mensagens expiram e uma mensagem nova renova o prazo", async (t) => {
  const dom = new JSDOM('<p id="message" hidden></p>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const modulePath = "../public/JS/auth.js";
    const { message } = await import(modulePath);
    const toast = dom.window.document.getElementById("message")!;
    message("Salvo");
    t.mock.timers.tick(4000);
    assert.equal(toast.hidden, false);
    message("Atualizado");
    t.mock.timers.tick(500);
    assert.equal(toast.textContent, "Atualizado");
    assert.equal(toast.hidden, false);
    t.mock.timers.tick(4000);
    assert.equal(toast.hidden, true);
    assert.equal(toast.textContent, "");
    message("Falha", true);
    t.mock.timers.tick(4500);
    assert.equal(toast.hidden, false);
    t.mock.timers.tick(3500);
    assert.equal(toast.hidden, true);
    message("Outra");
    message("");
    assert.equal(toast.hidden, true);
  } finally {
    t.mock.timers.reset();
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
  }
});
