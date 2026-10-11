import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("menu lateral preserva as ações existentes e restaura navegação ao voltar ao desktop", async () => {
  const dom = new JSDOM(
    `<header class="topbar"><a class="brand" href="/">Zacornia</a><nav aria-label="Principal"><a href="/">Decks</a><a href="/HTML/index.html">Jogar</a><a href="/HTML/perfil.html">Perfil</a></nav><div id="account"><a href="/HTML/perfil.html">Duelista</a><button>Sair</button></div></header>`,
    { url: "https://example.test/" },
  );
  let resize = () => {};
  const media = {
    matches: true,
    addEventListener: (_: string, cb: () => void) => {
      resize = cb;
    },
  };
  dom.window.matchMedia = (() => media) as any;
  const modulePath = "../public/JS/site-navigation.js";
  const { createSiteNavigation } = await import(modulePath);
  const doc = dom.window.document,
    header = doc.querySelector("header")!,
    originalNav = doc.querySelector("nav")!,
    logout = doc.querySelector("#account button") as HTMLButtonElement;
  let signedOut = 0;
  logout.onclick = () => {
    signedOut++;
  };
  createSiteNavigation(header);
  const menu = doc.querySelector<HTMLDialogElement>("#site-menu")!,
    trigger = doc.querySelector<HTMLButtonElement>(".site-menu-toggle")!;
  menu.showModal = () => {
    menu.open = true;
  };
  menu.close = () => {
    menu.open = false;
    menu.dispatchEvent(new dom.window.Event("close"));
  };
  assert.equal(menu.querySelector("nav"), originalNav);
  assert.equal(menu.querySelectorAll("[data-destination]").length, 6);
  assert.equal(
    menu.querySelector('[data-destination="ranking"]')!.getAttribute("href"),
    "/ranking",
  );
  assert.equal(
    menu.querySelector('[data-destination="rules"]')!.getAttribute("href"),
    "/regras",
  );
  assert.equal(
    menu.querySelector('[data-destination="play"]')!.textContent,
    "Jogar",
  );
  trigger.click();
  assert.equal(menu.open, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(doc.body.classList.contains("site-menu-open"));
  (menu.querySelector(".site-menu-close") as HTMLButtonElement).click();
  assert.equal(menu.open, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  logout.click();
  assert.equal(signedOut, 1);
  trigger.click();
  media.matches = false;
  resize();
  assert.equal(menu.open, false);
  assert.equal(header.querySelector("nav"), originalNav);
  assert.equal(header.querySelector("#account button"), logout);
  assert.equal(trigger.hidden, true);
  assert.equal(doc.body.classList.contains("site-menu-open"), false);
  media.matches = true;
  resize();
  createSiteNavigation(header);
  assert.equal(doc.querySelectorAll("#site-menu").length, 1);
  assert.equal(menu.querySelector("#account button"), logout);
  dom.window.close();
});
