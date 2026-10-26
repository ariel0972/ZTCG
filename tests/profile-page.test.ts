import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import initial from "../src/data/catalog.json";
test("perfil real com baralho e ícone carrega nome, aparência e histórico até o fim", async () => {
  const id = "1".repeat(24),
    other = "2".repeat(24);
  const html = await readFile("public/HTML/perfil.html", "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/thumosplayer/" + id });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  for (const key of [
    "window",
    "document",
    "location",
    "history",
    "localStorage",
    "sessionStorage",
    "MutationObserver",
    "navigator",
  ])
    install(key, (dom.window as any)[key]);
  const user = {
    id,
    nome: "Ariel",
    avatarURL: "/assets/avatar.png",
    bannerURL: "",
    avatarFrame: "gold",
  };
  const stats = {
    partidas: 1,
    vitorias: 1,
    derrotas: 0,
    empates: 0,
    taxaVitorias: 100,
    nivel: 1,
    titulo: "Iniciante",
    progresso: 40,
    proximoNivel: 100,
    xp: 40,
    xpParaProximoNivel: 60,
    sequenciaVitorias: 1,
    maiorSequenciaVitorias: 1,
    multiplicadorProximaVitoria: 1.1,
    multiplicadorProximaDerrota: 1,
    historicoCount: 1,
  };
  install("fetch", async (url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    const payload =
      path === "/auth/me"
        ? { user }
        : path === "/cards"
          ? { cards: initial }
          : path === "/profiles/" + id
            ? {
                owner: true,
                user,
                stats,
                decks: [
                  {
                    _id: "3".repeat(24),
                    nome: "Baralho com ícone",
                    icone: "/assets/icons/fogo.svg",
                    cartas: ["023"],
                    mago: "016",
                    publico: true,
                    revisao: 0,
                  },
                ],
                matches: [
                  {
                    winner: id,
                    players: [
                      { id, nome: "Ariel" },
                      { id: other, nome: "Oponente" },
                    ],
                    turns: 8,
                    reason: "Mago derrotado.",
                    finishedAt: "2026-10-25T18:00:00.000Z",
                    xpGanho: 40,
                  },
                ],
                hasMore: false,
              }
            : path === "/friends"
              ? { relations: [] }
              : path === "/friends/invites"
                ? { invitations: [] }
                : {};
    return new Response(JSON.stringify({ success: true, ...payload }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  dom.window.sessionStorage.setItem("token", "fixture-token");
  try {
    const path = "../public/JS/profile.js";
    await import(path);
    const doc = dom.window.document,
      deadline = Date.now() + 3000;
    while (
      !doc.querySelector("#history .profile-match") &&
      !doc.getElementById("message")!.textContent
    ) {
      if (Date.now() > deadline)
        throw Error("O perfil não concluiu o carregamento.");
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(doc.getElementById("message")!.textContent, "");
    assert.equal(doc.getElementById("player-name")!.textContent, "Ariel");
    assert.equal(doc.getElementById("avatar")!.dataset.frame, "gold");
    assert.equal(doc.getElementById("edit-section")!.hidden, false);
    assert.equal(doc.querySelectorAll("#decks .profile-deck").length, 1);
    assert.equal(
      doc.querySelector("#decks img")!.getAttribute("src"),
      "/assets/icons/fogo.svg",
    );
    assert.equal(doc.querySelectorAll("#history .profile-match").length, 1);
    assert.match(doc.getElementById("history")!.textContent!, /Oponente/);
    assert.equal(
      (doc.getElementById("more-history") as HTMLButtonElement).hidden,
      true,
    );
    const dialog = doc.getElementById("profile-deck-dialog") as any;
    dialog.showModal = () => {
      dialog.open = true;
    };
    (
      doc.querySelector("#decks .profile-deck-open") as HTMLButtonElement
    ).click();
    assert.equal(dialog.open, true);
    assert.equal(
      doc.querySelectorAll("#profile-deck-cards .card-tile").length,
      2,
    );
  } finally {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
