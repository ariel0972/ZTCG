import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("moeda mostra escolhas públicas, restringe escolha e não reinicia animação em snapshots repetidos", async (t) => {
  const dom = new JSDOM('<body><button id="back">Voltar</button></body>');
  const old = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  const modulePath = "../public/JS/coin-toss.js";
  const { createCoinToss } = await import(modulePath);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const calls: string[] = [];
  const view = createCoinToss(dom.window.document.body, {
    getViewerId: () => "p1",
    onChoose: async (face: string) => {
      calls.push(face);
    },
  });
  const state = {
    id: "a",
    status: "ACTIVE",
    phase: "COIN_TOSS",
    players: [
      { id: "p1", nome: "<script>nome</script>" },
      { id: "p2", nome: "Oponente" },
    ],
    coinToss: {
      chooserId: "p1",
      choices: {} as Record<string, string>,
      result: undefined as string | undefined,
      winnerId: undefined as string | undefined,
    },
  };
  try {
    view.update(state);
    const overlay = dom.window.document.querySelector(
      ".coin-toss",
    ) as HTMLElement;
    assert.equal(overlay.hidden, false);
    assert.equal(overlay.querySelector("script"), null);
    const heads = overlay.querySelector(
      '[data-face="heads"]',
    ) as HTMLButtonElement;
    heads.click();
    heads.click();
    await Promise.resolve();
    assert.deepEqual(calls, ["heads"]);
    state.coinToss.choices = { p1: "heads", p2: "tails" };
    state.coinToss.result = "tails";
    state.coinToss.winnerId = "p2";
    view.update(state);
    assert.match(overlay.textContent!, /Oponente: Coroa/);
    assert.match(overlay.textContent!, /moeda está girando/);
    t.mock.timers.tick(1800);
    assert.match(overlay.textContent!, /Oponente começa/);
    assert.equal(
      (overlay.querySelector(".coin-toss__buttons") as HTMLElement).hidden,
      true,
    );
    const coin = overlay.querySelector(".coin-toss__coin")!;
    assert.equal(coin.getAttribute("data-result"), "tails");
    view.update(state);
    assert.equal(coin, overlay.querySelector(".coin-toss__coin"));
    state.phase = "BATTLE";
    view.update(state);
    assert.equal(overlay.hidden, true);
  } finally {
    view.close();
    t.mock.timers.reset();
    if (old) Object.defineProperty(globalThis, "document", old);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});
