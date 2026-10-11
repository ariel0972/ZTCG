import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const modulePath = "../public/JS/social-notifications.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("avisos de amizade e convite: só recebidos, ativos e sem duplicação após recarregar", async () => {
  const { createSocialNotifications, socialNotices } = await import(modulePath);
  const dom = new JSDOM("<body></body>", {
      url: "https://example.test/ranking",
    }),
    doc = dom.window.document;
  const relations = [
    {
      id: "b",
      nome: "Amigo",
      status: "pending",
      incoming: true,
      requestedAt: "one",
    },
    { id: "c", nome: "Outro", status: "pending", incoming: false },
  ];
  const invite = {
    id: "i",
    to: "a",
    from: "b",
    fromName: "Amigo",
    status: "pending",
    expires: new Date(Date.now() + 60000).toISOString(),
  };
  assert.equal(
    socialNotices("a", relations, [
      invite,
      { ...invite, id: "expired", expires: new Date(0) },
      { ...invite, id: "outgoing", to: "b" },
    ]).length,
    2,
  );
  const api = async (path: string) =>
    path === "/friends" ? { relations } : { invites: [invite] };
  const create = () =>
    createSocialNotifications({
      user: { id: "a" },
      api,
      doc,
      win: dom.window,
      storage: dom.window.localStorage,
    });
  let view = create();
  try {
    await tick();
    await tick();
    assert.equal(doc.querySelectorAll(".social-notification-toast").length, 2);
    await view.poll();
    assert.equal(doc.querySelectorAll(".social-notification-toast").length, 2);
    assert.equal(
      doc.querySelector(".social-notification-count")!.textContent,
      "2",
    );
    (
      doc.querySelector(".social-notification-toggle") as HTMLButtonElement
    ).click();
    assert.equal(
      (doc.querySelector("#social-notifications") as HTMLElement).hidden,
      false,
    );
    assert.equal(
      doc.querySelector(".social-notification-count")!.textContent,
      "",
    );
    assert.equal(
      doc
        .querySelector('a[href="/HTML/friends.html#requests"]')!
        .textContent!.includes("Amigo"),
      true,
    );
    view.close();
    view = create();
    await tick();
    await tick();
    assert.equal(doc.querySelectorAll(".social-notification-toast").length, 0);
  } finally {
    view.close();
    dom.window.close();
  }
});

test("convite em segundo plano: permissão explícita, aviso persistente uma vez e sem nova solicitação automática", async () => {
  const { createSocialNotifications } = await import(modulePath);
  const dom = new JSDOM("<body></body>", { url: "https://example.test/" }),
    doc = dom.window.document,
    win = dom.window;
  const shown: any[] = [];
  let requests = 0,
    invitations: any[] = [];
  const registration = {
    showNotification: async (...args: any[]) => shown.push(args),
  };
  Object.defineProperty(win, "isSecureContext", { value: true });
  Object.defineProperty(win, "Notification", {
    value: {
      permission: "granted",
      requestPermission: async () => {
        requests++;
        return "granted";
      },
    },
  });
  Object.defineProperty(win.navigator, "serviceWorker", {
    value: {
      register: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
  const view = createSocialNotifications({
    user: { id: "a" },
    doc,
    win,
    storage: win.localStorage,
    api: async (path: string) =>
      path === "/friends" ? { relations: [] } : { invites: invitations },
  });
  try {
    await tick();
    await tick();
    assert.equal(requests, 0);
    (
      doc.querySelector("#social-notifications > button") as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    assert.equal(requests, 1);
    invitations = [
      {
        id: "i",
        to: "a",
        fromName: "Duelista",
        status: "pending",
        expires: new Date(Date.now() + 60000),
      },
    ];
    await view.poll();
    await tick();
    assert.equal(shown.length, 1);
    assert.equal(shown[0][1].silent, false);
    assert.equal(shown[0][1].data.userId, "a");
    await view.poll();
    assert.equal(shown.length, 1);
    invitations.push({ ...invitations[0], id: "ii" });
    (
      doc.querySelector("#social-notifications > button") as HTMLButtonElement
    ).click();
    await view.poll();
    await tick();
    assert.equal(shown.length, 1);
  } finally {
    view.close();
    dom.window.close();
  }
});

test("aceite redireciona ambos os participantes fora da tela de jogo, sem repetir partidas encerradas", async () => {
  const { createSocialNotifications } = await import(modulePath);
  for (const userId of ["a", "b"]) {
    const dom = new JSDOM("<body></body>", {
        url: "https://example.test/HTML/friends.html",
      }),
      destinations: string[] = [];
    let status = "FINISHED",
      matchId = "old",
      invitations: any[] = [];
    const view = createSocialNotifications({
      user: { id: userId },
      doc: dom.window.document,
      win: dom.window,
      storage: dom.window.localStorage,
      navigate: (url: string) => destinations.push(url),
      api: async (path: string) =>
        path === "/friends"
          ? { relations: [] }
          : path === "/friends/invites"
            ? { invites: invitations }
            : { match: { id: matchId, status } },
    });
    try {
      await tick();
      await tick();
      invitations = [
        { id: "old-invite", from: "a", to: "b", status: "accepted", matchId },
      ];
      await view.poll();
      assert.equal(destinations.length, 0);
      status = "ACTIVE";
      matchId = "new";
      invitations.push({
        id: "new-invite",
        from: "a",
        to: "b",
        status: "accepted",
        matchId,
      });
      await view.poll();
      assert.deepEqual(destinations, ["/HTML/index.html"]);
      await view.poll();
      assert.equal(destinations.length, 1);
    } finally {
      view.close();
      dom.window.close();
    }
  }
});
