import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("transporte aplica resposta sem GET extra e descarta snapshot atrasado", async () => {
  const path = "../public/JS/game-transport.js";
  const { gameTransport } = await import(path);
  let source: any,
    reads = 0;
  const data = (version: number) => ({
    success: true,
    queued: false,
    match: {
      id: "match",
      version,
      revision: version,
      deadline: 1000,
      status: "ACTIVE",
    },
  });
  const states: number[] = [];
  const transport = gameTransport({
    getToken: () => "fixture",
    request: async (path: string) => {
      if (path === "/game/state") reads++;
      return { success: true, state: data(2) };
    },
    fetchStream: async (_url: string, options: any) =>
      new Response(
        new ReadableStream({
          start(controller) {
            source = controller;
            options.signal.addEventListener("abort", () => controller.close());
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  });
  const wait = () => new Promise((r) => setTimeout(r, 15));
  transport.on("match:state", (s: any) => states.push(s.version));
  try {
    await wait();
    source.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(data(1))}\n\n`),
    );
    await wait();
    await new Promise<void>((resolve, reject) =>
      transport.emit("match:command", {}, (_err: any, result: any) =>
        result.success ? resolve() : reject(result),
      ),
    );
    assert.deepEqual(states, [1, 2]);
    assert.equal(reads, 0);
    source.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(data(1))}\n\n`),
    );
    await wait();
    assert.deepEqual(states, [1, 2]);
  } finally {
    transport.close();
  }
});

test("avisos de jogadas não repetem após reconexão e mostram morte sem carta presente", async () => {
  const dom = new JSDOM("<body></body>"),
    old = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  const path = "../public/JS/battle-events.js";
  const { createBattleEvents } = await import(path);
  const view = createBattleEvents();
  try {
    const event = {
      sequence: 1,
      kind: "summon",
      card: { id: "c", nome: "Cavaleiro", imgURL: "" },
    };
    view.update({ id: "a", events: [event] });
    assert.equal(
      dom.window.document.querySelectorAll(".battle-event").length,
      0,
    );
    const next = { ...event, sequence: 2, kind: "death" };
    view.update({ id: "a", events: [event, next] });
    view.update({ id: "a", events: [event, next] });
    assert.equal(
      dom.window.document.querySelectorAll(".battle-event").length,
      1,
    );
    assert.match(dom.window.document.body.textContent!, /cemitério.*Cavaleiro/);
    const passive = {
      ...event,
      sequence: 3,
      kind: "passive",
      message: "Curou 2 de vida",
    };
    const ability = {
      ...event,
      sequence: 4,
      kind: "ability",
      message: "A Ordem da Espada",
    };
    view.update({ id: "a", events: [event, next, passive, ability] });
    view.update({ id: "a", events: [event, next, passive, ability] });
    assert.match(
      dom.window.document.body.textContent!,
      /Passiva ativada.*Curou 2 de vida/,
    );
    assert.match(
      dom.window.document.body.textContent!,
      /Habilidade usada.*A Ordem da Espada/,
    );
    view.notify({
      ...event,
      kind: "block",
      message: "A passiva impede este ataque básico.",
    });
    assert.match(
      dom.window.document.body.textContent!,
      /Ataque impedido.*passiva impede/,
    );
    assert.equal(
      dom.window.document.querySelectorAll(".battle-event--passive").length,
      1,
    );
    assert.equal(
      dom.window.document.querySelectorAll(".battle-event--block").length,
      1,
    );
    view.update({ id: "b", events: [] });
    assert.equal(
      dom.window.document.querySelectorAll(".battle-event").length,
      0,
    );
  } finally {
    view.close();
    if (old) Object.defineProperty(globalThis, "document", old);
    else delete (globalThis as any).document;
    dom.window.close();
  }
});

test("evento confirmado não é reenviado nem reportado como falha por erro posterior de sincronização", async () => {
  const path = "../public/JS/game-transport.js";
  const { gameTransport } = await import(path);
  let posts = 0;
  const transport = gameTransport({
    getToken: () => "fixture",
    request: async (url: string) => {
      if (url === "/game/state") throw new Error("consulta indisponível");
      posts++;
      return { success: true, waiting: true };
    },
    fetchStream: async (_url: string, options: any) =>
      new Response(
        new ReadableStream({
          start(controller) {
            options.signal.addEventListener("abort", () => controller.close());
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  });
  try {
    const result = await new Promise<any>((resolve) =>
      transport.emit("match:rematch", {}, (_error: unknown, data: unknown) =>
        resolve(data),
      ),
    );
    assert.equal(result.success, true);
    assert.equal(posts, 1);
  } finally {
    transport.close();
  }
});
