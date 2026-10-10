import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const modulePath = "../public/JS/social-view.js";
const tick = () => new Promise<void>((r) => setImmediate(r));
test("amizade acompanha envio, cancelamento, aceite e remoção sem duplicar ações", async () => {
  const { friendshipButtons } = await import(modulePath);
  const dom = new JSDOM('<div id="actions"></div>'),
    controls = dom.window.document.getElementById("actions")!;
  const actions: string[] = [],
    errors: unknown[] = [];
  let next: any;
  friendshipButtons(
    controls,
    undefined,
    async (action: string) => {
      actions.push(action);
      await tick();
      return next;
    },
    (error: unknown) => errors.push(error),
  );
  next = { status: "pending", incoming: false };
  const send = controls.querySelector("button")!;
  send.click();
  send.click();
  assert.equal(controls.getAttribute("aria-busy"), "true");
  await tick();
  await tick();
  assert.deepEqual(actions, ["send"]);
  assert.equal(controls.querySelector("button")!.textContent, "Pedido Enviado");
  assert.equal(controls.querySelector("button")!.disabled, true);
  assert.equal(
    controls.querySelector(".friendship-cancel")!.textContent,
    "Cancelar envio",
  );
  next = undefined;
  (controls.querySelector(".friendship-cancel") as HTMLButtonElement).click();
  await tick();
  await tick();
  assert.equal(controls.textContent, "Pedir amizade");
  friendshipButtons(
    controls,
    { status: "pending", incoming: true },
    async (action: string) => {
      actions.push(action);
      return { status: "accepted" };
    },
    (e: unknown) => errors.push(e),
  );
  assert.equal(
    controls.querySelector("button")!.textContent,
    "Aceitar amizade",
  );
  controls.querySelector("button")!.click();
  await tick();
  assert.equal(
    controls.querySelector(".friendship-remove")!.textContent,
    "Desfazer amizade",
  );
  assert.deepEqual(actions, ["send", "remove", "accept"]);
  friendshipButtons(
    controls,
    { status: "accepted" },
    async () => {
      throw Error("Falha de rede");
    },
    (e: unknown) => errors.push(e),
  );
  controls.querySelector("button")!.click();
  await tick();
  assert.equal(errors.length, 1);
  assert.equal(controls.querySelector("button")!.disabled, false);
  assert.equal(controls.textContent, "Desfazer amizade");
  dom.window.close();
});
test("tela de amigos separa relações, filtra amigos e mantém pedidos na busca", async () => {
  const helpers = await import(modulePath);
  const html = await readFile("public/HTML/friends.html", "utf8"),
    dom = new JSDOM(html, { url: "http://localhost/HTML/friends.html" }),
    doc = dom.window.document;
  const relations = [
    { id: "2".repeat(24), nome: "Áriel", status: "accepted" },
    { id: "3".repeat(24), nome: "Bruno", status: "pending", incoming: false },
    { id: "4".repeat(24), nome: "Catarina", status: "pending", incoming: true },
  ];
  const api = async (path: string) =>
    path === "/decks"
      ? { decks: [] }
      : path === "/friends"
        ? { relations }
        : path === "/friends/invites"
          ? { invites: [] }
          : { users: [relations[1]] };
  const node = (tag: string, text = "", className = "") => {
    const e = doc.createElement(tag);
    e.textContent = text;
    e.className = className;
    return e;
  };
  const source = (await readFile("public/JS/friends.js", "utf8")).replace(
    /^import[\s\S]*?from ".*?";\s*/gm,
    "",
  );
  new Function(
    "document",
    "window",
    "FormData",
    "location",
    "api",
    "navbar",
    "message",
    "node",
    "profilePath",
    "splitRelations",
    "filterFriends",
    "friendshipButtons",
    "createSocialTabs",
    "setInterval",
    source,
  )(
    doc,
    dom.window,
    dom.window.FormData,
    dom.window.location,
    api,
    async () => ({ id: "1".repeat(24) }),
    () => {},
    node,
    (id: string) => `/thumosplayer/${id}`,
    helpers.splitRelations,
    helpers.filterFriends,
    helpers.friendshipButtons,
    helpers.createSocialTabs,
    () => 0,
  );
  await tick();
  await tick();
  assert.match(doc.getElementById("friend-list")!.textContent!, /Áriel/);
  assert.doesNotMatch(
    doc.getElementById("friend-list")!.textContent!,
    /Bruno|Catarina/,
  );
  assert.match(
    doc.getElementById("outgoing-requests")!.textContent!,
    /Bruno.*Pedido Enviado.*Cancelar envio/,
  );
  assert.match(
    doc.getElementById("incoming-requests")!.textContent!,
    /Catarina.*Aceitar amizade/,
  );
  const input = doc.getElementById("friends-filter") as HTMLInputElement;
  input.value = "ariel";
  input.dispatchEvent(new dom.window.Event("input"));
  assert.match(doc.getElementById("friend-list")!.textContent!, /Áriel/);
  input.value = "Bruno";
  input.dispatchEvent(new dom.window.Event("input"));
  assert.match(doc.getElementById("friend-list")!.textContent!, /Nenhum amigo/);
  (doc.getElementById("requests-tab") as HTMLButtonElement).click();
  assert.equal(doc.getElementById("friends-panel")!.hidden, true);
  assert.equal(doc.getElementById("requests-panel")!.hidden, false);
  doc.querySelector<HTMLInputElement>('[name="q"]')!.value = "Bruno";
  doc
    .getElementById("friend-search")!
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await tick();
  assert.match(
    doc.getElementById("search-results")!.textContent!,
    /Pedido Enviado.*Cancelar envio/,
  );
  assert.doesNotMatch(
    doc.getElementById("search-results")!.textContent!,
    /Pedir amizade/,
  );
  doc
    .getElementById("requests-tab")!
    .dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
  assert.equal(doc.getElementById("invites-panel")!.hidden, false);
  assert.equal(doc.getElementById("requests-panel")!.hidden, true);
  dom.window.close();
});
