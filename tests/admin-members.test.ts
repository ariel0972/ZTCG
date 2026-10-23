import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { JSDOM } from "jsdom";
import fs from "node:fs/promises";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
test("consultas administrativas exigem admin, paginam e nunca expõem credenciais", async () => {
  process.env.SECRET = "admin-members-test-only-01234567890123456789";
  const db = await fakeDatabase(),
    server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port,
    owner = "1".repeat(24),
    admin = "3".repeat(24);
  const call = async (path: string, id = admin) => {
    const r = await fetch(base + path, {
      headers: id
        ? { Authorization: "Bearer " + jwt.sign({ id }, process.env.SECRET!) }
        : {},
    });
    return { status: r.status, data: (await r.json()) as any };
  };
  try {
    for (let i = 0; i < 60; i++)
      db.users.push({
        _id: (100 + i).toString(16).padStart(24, "0"),
        nome: i === 0 ? "[Teste]" : "Membro " + i,
        email: "member" + i + "@example.test",
        senha: "secret-hash",
        resetTokenHash: "secret-reset",
        sessionVersion: 12,
        admin: false,
      });
    assert.equal((await call("/admin/users", "")).status, 401);
    assert.equal((await call("/admin/users", owner)).status, 401);
    const first = await call("/admin/users");
    assert.equal(first.status, 200);
    assert.equal(first.data.users.length, 50);
    assert.equal(first.data.hasMore, true);
    assert.equal((await call("/admin/users?page=1")).data.hasMore, false);
    for (const row of first.data.users)
      assert.deepEqual(
        Object.keys(row).sort(),
        [
          "id",
          "nome",
          "email",
          "avatarURL",
          "admin",
          "managementVersion",
          "moderation",
        ].sort(),
      );
    assert(!JSON.stringify(first.data).includes("secret-"));
    const found = await call("/admin/users?q=" + encodeURIComponent("[Teste]"));
    assert.equal(found.data.users.length, 1);
    assert.equal(found.data.users[0].nome, "[Teste]");
    assert.equal((await call("/admin/users?page=-1")).status, 422);
    for (let i = 0; i < 21; i++)
      db.matches.push({
        matchId: "admin-match-" + i,
        players: [
          { userId: owner, nome: "Um", deckId: "private" },
          { userId: "2".repeat(24), nome: "Dois", deckId: "secret" },
        ],
        winner: owner,
        turns: 12,
        reason: "Mago derrotado.",
        finishedAt: new Date(2026, 9, 23, 0, i),
      });
    const history = await call("/admin/users/" + owner + "/matches");
    assert.equal(history.status, 200);
    assert.equal(history.data.matches.length, 20);
    assert.equal(history.data.hasMore, true);
    assert.equal(history.data.matches[0].matchId, "admin-match-20");
    assert(!JSON.stringify(history.data.matches).includes("deckId"));
    assert.equal(
      (await call("/admin/users/" + owner + "/matches?page=1")).data.matches
        .length,
      1,
    );
    assert.equal((await call("/admin/users/invalid/matches")).status, 422);
    assert.equal(
      (await call("/admin/users/" + "f".repeat(24) + "/matches")).status,
      404,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.restore();
  }
});
test("barra lateral marca seção ativa e oculta conteúdo sem autorização", async () => {
  const modulePath = "../public/JS/admin-shell.js";
  const { initializeAdminShell, setAdminAccess } = await import(modulePath);
  const dom = new JSDOM(
    '<aside id="admin-navigation"></aside><p id="admin-access-status"></p><main id="admin-content" hidden></main>',
  );
  try {
    const doc = dom.window.document;
    initializeAdminShell("members", doc);
    assert.equal(doc.querySelectorAll("#admin-navigation nav a").length, 3);
    assert.match(
      doc.querySelector('[aria-current="page"]')!.textContent!,
      /Membros/,
    );
    assert.equal(setAdminAccess({ admin: false }, doc), false);
    assert.equal(doc.getElementById("admin-content")!.hidden, true);
    assert.equal(setAdminAccess({ admin: true }, doc), true);
    assert.equal(doc.getElementById("admin-content")!.hidden, false);
  } finally {
    dom.window.close();
  }
});
test("abas existentes preservam editores e membros recebe navegação compartilhada", async () => {
  for (const name of ["admin.html", "admin-lore.html", "admin-members.html"]) {
    const dom = new JSDOM(await fs.readFile("public/HTML/" + name, "utf8"));
    try {
      assert(dom.window.document.getElementById("admin-navigation"));
      assert(dom.window.document.getElementById("admin-content")!.hidden);
      assert(dom.window.document.querySelector('link[href="/CSS/admin.css"]'));
    } finally {
      dom.window.close();
    }
  }
});

test("membros renderiza dados como texto e ignora respostas antigas de outra conta", async () => {
  const modulePath = "../public/JS/admin-members.js",
    { createAdminMembers } = await import(modulePath);
  const dom = new JSDOM(
    await fs.readFile("public/HTML/admin-members.html", "utf8"),
  );
  try {
    const doc = dom.window.document,
      waiting = new Map<string, (value: unknown) => void>();
    const view = createAdminMembers(doc, (path: string) =>
      path.startsWith("/admin/users?")
        ? Promise.resolve({
            users: [
              {
                id: "1".repeat(24),
                nome: "<img src=x onerror=alert(1)>",
                email: "test@example.test",
                admin: false,
              },
            ],
            hasMore: false,
          })
        : new Promise((r) => waiting.set(path, r)),
    );
    await view.loadMembers();
    assert.equal(doc.querySelectorAll("#member-list img").length, 0);
    assert.match(doc.getElementById("member-list")!.textContent!, /<img/);
    const a = view.openMember("a".repeat(24)),
      b = view.openMember("b".repeat(24));
    waiting.get("/admin/users/" + "b".repeat(24) + "/matches?page=0")!({
      user: { id: "b".repeat(24), nome: "Conta B", email: "b@example.test" },
      matches: [],
      hasMore: false,
    });
    await b;
    waiting.get("/admin/users/" + "a".repeat(24) + "/matches?page=0")!({
      user: { id: "a".repeat(24), nome: "Conta A", email: "a@example.test" },
      matches: [],
      hasMore: false,
    });
    await a;
    assert.match(doc.getElementById("member-summary")!.textContent!, /Conta B/);
    assert(
      !doc.getElementById("member-summary")!.textContent!.includes("Conta A"),
    );
  } finally {
    dom.window.close();
  }
});

test("ações administrativas confirmam conta e prazo, e exclusão mostra os dois participantes", async () => {
  const mod = "../public/JS/admin-actions.js";
  const { createAdminActions } = await import(mod);
  const dom = new JSDOM(
    await fs.readFile("public/HTML/admin-members.html", "utf8"),
  );
  try {
    const doc = dom.window.document,
      dialog = doc.getElementById("admin-confirm") as any;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };
    const user: any = {
      id: "1".repeat(24),
      nome: "Conta <A>",
      managementVersion: 3,
      moderation: {},
    };
    const calls: any[] = [],
      selected = new Set(["b1"]);
    let changes = 0;
    const actions = createAdminActions({
      doc,
      actorId: "3".repeat(24),
      getUser: () => user,
      getSelection: () => selected,
      clearSelection: () => selected.clear(),
      onChanged: () => {
        changes++;
      },
      request: async (path: string, options: any) => {
        const data = JSON.parse(options.body);
        calls.push({ path, data });
        if (path.endsWith("history-preview"))
          return {
            count: 1,
            players: [{ nome: "Conta A" }, { nome: "Conta B" }],
            token: "preview-token",
          };
        return { content: "Concluído" };
      },
    });
    actions.renderUser();
    const duration = doc.getElementById(
      "suspension-hours",
    ) as HTMLSelectElement;
    duration.value = "72";
    const buttons = [
      ...doc.querySelectorAll<HTMLButtonElement>("#member-moderation button"),
    ];
    buttons.find((b) => b.textContent === "Aplicar suspensão")!.click();
    assert.equal(calls.length, 0);
    assert.match(
      doc.getElementById("admin-confirm-text")!.textContent!,
      /Conta <A>/,
    );
    assert.match(
      doc.getElementById("admin-confirm-text")!.textContent!,
      /3 dias/,
    );
    await (doc.getElementById("admin-confirm-apply") as any).onclick();
    assert.equal(calls[0].data.hours, 72);
    assert.equal(calls[0].data.expectedVersion, 3);
    assert.equal(changes, 1);
    await actions.deleteHistory(false);
    assert.equal(calls[1].data.all, false);
    assert.deepEqual(calls[1].data.matchIds, ["b1"]);
    assert.match(
      doc.getElementById("admin-confirm-text")!.textContent!,
      /Conta A, Conta B/,
    );
    assert.match(
      doc.getElementById("admin-confirm-text")!.textContent!,
      /recalcula XP/,
    );
    assert.equal(
      calls.filter((c) => c.path.endsWith("history-delete")).length,
      0,
    );
    await (doc.getElementById("admin-confirm-apply") as any).onclick();
    assert.equal(calls[2].data.token, "preview-token");
    assert.equal(selected.size, 0);
    user.id = "3".repeat(24);
    actions.renderUser();
    assert(
      [
        ...doc.querySelectorAll<HTMLButtonElement>("#member-moderation button"),
      ].every((b) => b.disabled),
    );
  } finally {
    dom.window.close();
  }
});
test("seleção de batalhas persiste entre páginas e é limpa ao trocar conta", async () => {
  const mod = "../public/JS/admin-members.js",
    { createAdminMembers } = await import(mod);
  const dom = new JSDOM(
    await fs.readFile("public/HTML/admin-members.html", "utf8"),
  );
  try {
    const doc = dom.window.document;
    const view = createAdminMembers(doc, async (path: string) => ({
      user: {
        id: path.includes("/b/") ? "b" : "a",
        nome: "Conta",
        email: "email@test.local",
      },
      matches: [
        {
          matchId: path.endsWith("page=1") ? "m2" : "m1",
          players: [],
          winner: "a",
          turns: 10,
          finishedAt: new Date(),
        },
      ],
      hasMore: true,
    }));
    await view.openMember("a", 0);
    (doc.querySelector("#member-matches input") as HTMLInputElement).click();
    await view.openMember("a", 1);
    (doc.querySelector("#member-matches input") as HTMLInputElement).click();
    assert.match(
      doc.getElementById("selected-battles-count")!.textContent!,
      /^2 /,
    );
    await view.openMember("a", 0);
    assert.equal(
      (doc.querySelector("#member-matches input") as HTMLInputElement).checked,
      true,
    );
    await view.openMember("b", 0);
    assert.match(
      doc.getElementById("selected-battles-count")!.textContent!,
      /^0 /,
    );
  } finally {
    dom.window.close();
  }
});
