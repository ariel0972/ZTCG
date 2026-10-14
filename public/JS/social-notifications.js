// Current social state is authoritative; storage only prevents duplicate alerts.
export function socialNotices(userId, relations, invites) {
  return [
    ...relations
      .filter((r) => r.incoming && r.status === "pending")
      .map((r) => ({
        id: `friend:${r.id}:${r.requestedAt || ""}`,
        title: "Pedido de amizade",
        body: `${r.nome} quer adicionar você como amigo.`,
        url: "/HTML/friends.html#requests",
        kind: "friend",
      })),
    ...invites
      .filter(
        (i) =>
          i.to === userId &&
          i.status === "pending" &&
          new Date(i.expires).getTime() > Date.now(),
      )
      .map((i) => ({
        id: `invite:${i.id}`,
        title: "Convite de partida",
        body: `${i.fromName || "Um duelista"} chamou você para jogar.`,
        url: "/HTML/friends.html#invites",
        kind: "invite",
      })),
  ];
}

export function createSocialNotifications({
  user,
  api,
  doc = document,
  win = window,
  storage = localStorage,
  navigate = (url) => location.assign(url),
}) {
  const key = `zacornia:notifications:${user.id}`;
  let saved;
  try {
    saved = JSON.parse(storage.getItem(key) || "{}");
  } catch {
    saved = {};
  }
  saved ||= {};
  const announced = new Set(
      Array.isArray(saved.announced) ? saved.announced : [],
    ),
    read = new Set(Array.isArray(saved.read) ? saved.read : []),
    checkedMatches = new Set(Array.isArray(saved.matches) ? saved.matches : []);
  let notices = [],
    closed = false,
    busy = false,
    timer,
    audio,
    registration;
  const make = (tag, text = "", cls = "") => {
    const el = doc.createElement(tag);
    el.textContent = text;
    el.className = cls;
    return el;
  };
  const bell = make("button", "♧", "social-notification-toggle quiet"),
    count = make("span", "", "social-notification-count");
  bell.type = "button";
  bell.setAttribute("aria-label", "Notificações");
  bell.setAttribute("aria-controls", "social-notifications");
  bell.setAttribute("aria-expanded", "false");
  bell.append(count);
  const panel = make("section", "", "social-notifications");
  panel.id = "social-notifications";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Notificações");
  const heading = make("div", "", "social-notification-heading"),
    close = make("button", "×", "quiet");
  close.type = "button";
  close.setAttribute("aria-label", "Fechar notificações");
  heading.append(make("h2", "Notificações"), close);
  const list = make("div"),
    permission = make("button", "Ativar avisos no dispositivo", "primary"),
    help = make("p", "", "hint"),
    toastHost = make("div", "", "social-notification-toasts");
  permission.type = "button";
  toastHost.setAttribute("aria-live", "polite");
  panel.append(heading, list, permission, help);
  doc.body.append(bell, panel, toastHost);
  const supported =
    !!win.Notification && !!win.navigator.serviceWorker && win.isSecureContext;
  function persist() {
    try {
      storage.setItem(
        key,
        JSON.stringify({
          announced: [...announced].slice(-200),
          read: [...read].slice(-200),
          matches: [...checkedMatches].slice(-100),
        }),
      );
    } catch {}
  }
  function render() {
    list.replaceChildren();
    const unread = notices.filter((n) => !read.has(n.id)).length;
    count.textContent = unread ? String(unread) : "";
    count.hidden = !unread;
    bell.setAttribute(
      "aria-label",
      unread ? `Notificações (${unread} novas)` : "Notificações",
    );
    if (!notices.length)
      list.append(make("p", "Nenhum pedido ou convite pendente.", "muted"));
    for (const n of notices) {
      const link = make("a", "", "social-notification-item");
      link.href = n.url;
      link.dataset.read = String(read.has(n.id));
      link.append(make("strong", n.title), make("span", n.body));
      link.onclick = () => {
        read.add(n.id);
        persist();
      };
      list.append(link);
    }
    permission.hidden = !supported;
    permission.disabled = win.Notification?.permission === "denied";
    permission.textContent =
      win.Notification?.permission === "granted"
        ? saved.enabled
          ? "Desativar avisos no dispositivo"
          : "Ativar avisos no dispositivo"
        : "Ativar avisos no dispositivo";
    help.textContent = !supported
      ? "Este navegador não oferece avisos no dispositivo. Os avisos no site continuam disponíveis."
      : win.Notification.permission === "denied"
        ? "Para ativar, permita notificações nas configurações do navegador."
        : saved.enabled
          ? "Avisos ativos enquanto o site estiver aberto. O som depende das permissões e configurações do dispositivo."
          : "Ative para receber convites com o site em segundo plano.";
  }
  // Store the explicit opt-in separately from the deduplication state.
  const preferenceKey = `${key}:enabled`;
  try {
    saved.enabled = storage.getItem(preferenceKey) === "true";
  } catch {}
  function unlockAudio() {
    try {
      const Audio = win.AudioContext || win.webkitAudioContext;
      if (Audio) {
        audio ||= new Audio();
        void audio.resume().catch(() => {});
      }
    } catch {}
  }
  function chime() {
    if (!audio || audio.state !== "running") return;
    try {
      for (const [offset, frequency] of [
        [0, 660],
        [0.18, 880],
      ]) {
        const oscillator = audio.createOscillator(),
          gain = audio.createGain(),
          start = audio.currentTime + offset;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.27);
      }
    } catch {}
  }
  async function worker() {
    registration ||= await win.navigator.serviceWorker.register(
      "/notification-worker.js",
    );
    return win.navigator.serviceWorker.ready;
  }
  permission.onclick = async () => {
    if (saved.enabled) {
      saved.enabled = false;
      try {
        storage.setItem(preferenceKey, "false");
      } catch {}
      render();
      return;
    }
    unlockAudio();
    try {
      const granted = await win.Notification.requestPermission();
      if (granted === "granted") {
        await worker();
        saved.enabled = true;
        try {
          storage.setItem(preferenceKey, "true");
        } catch {}
        chime();
      }
    } catch {
      help.textContent = "Não foi possível ativar os avisos. Tente novamente.";
      return;
    }
    render();
  };
  function hide() {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
  }
  bell.onclick = () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      for (const n of notices) read.add(n.id);
      persist();
      render();
    }
  };
  close.onclick = () => {
    hide();
    bell.focus();
  };
  function outside(event) {
    if (!panel.contains(event.target) && !bell.contains(event.target)) hide();
  }
  function keyboard(event) {
    if (event.key === "Escape" && !panel.hidden) {
      hide();
      bell.focus();
    }
  }
  doc.addEventListener("click", outside);
  doc.addEventListener("keydown", keyboard);
  async function alert(n) {
    const link = make("a", "", "social-notification-toast");
    link.href = n.url;
    link.append(make("strong", n.title), make("span", n.body));
    toastHost.append(link);
    while (toastHost.children.length > 3) toastHost.firstElementChild.remove();
    win.setTimeout(() => link.remove(), 7000);
    if (n.kind !== "invite" || !saved.enabled) return;
    chime();
    if (
      (doc.hidden || !doc.hasFocus()) &&
      supported &&
      win.Notification.permission === "granted"
    ) {
      try {
        const sw = await worker();
        if (!closed)
          await sw.showNotification(n.title, {
            body: n.body,
            icon: "/assets/avatar.png",
            tag: n.id,
            silent: false,
            data: { url: n.url, userId: user.id },
          });
      } catch {
        /* Site alerts remain available when the OS declines. */
      }
    }
  }
  let presenceAt = 0;
  async function poll() {
    if (busy || closed) return;
    busy = true;
    if (Date.now() - presenceAt >= 30000) {
      presenceAt = Date.now();
      void api("/rooms/presence", { method: "POST", body: "{}" }).catch(
        () => {},
      );
    }
    try {
      const [friends, invitations] = await Promise.all([
        api("/friends"),
        api("/friends/invites"),
      ]);
      if (closed) return;
      // Another open tab may already have announced this same invitation.
      try {
        const shared = JSON.parse(storage.getItem(key) || "{}");
        for (const id of Array.isArray(shared.announced)
          ? shared.announced
          : [])
          announced.add(id);
        for (const id of Array.isArray(shared.read) ? shared.read : [])
          read.add(id);
        for (const id of Array.isArray(shared.matches) ? shared.matches : [])
          checkedMatches.add(id);
      } catch {}
      notices = socialNotices(user.id, friends.relations, invitations.invites);
      render();
      for (const n of notices)
        if (!announced.has(n.id)) {
          announced.add(n.id);
          persist();
          void alert(n);
        }
      const accepted = invitations.invites.filter(
        (i) =>
          i.status === "accepted" &&
          i.matchId &&
          !checkedMatches.has(i.matchId),
      );
      if (win.location.pathname === "/HTML/index.html") {
        for (const i of accepted) checkedMatches.add(i.matchId);
        if (accepted.length) persist();
      }
      if (accepted.length && win.location.pathname !== "/HTML/index.html") {
        const state = await api("/game/state");
        if (closed) return;
        for (const i of accepted) {
          checkedMatches.add(i.matchId);
          persist();
          if (
            state.match?.id === i.matchId &&
            state.match.status === "ACTIVE"
          ) {
            navigate("/HTML/index.html");
            break;
          }
        }
      }
    } catch (e) {
      if (e.status === 401) closeAll();
    } finally {
      busy = false;
    }
  }
  function wake() {
    void poll();
  }
  function closeAll() {
    closed = true;
    win.clearInterval(timer);
    doc.removeEventListener("visibilitychange", wake);
    doc.removeEventListener("click", outside);
    doc.removeEventListener("keydown", keyboard);
    win.removeEventListener("focus", wake);
    doc.removeEventListener("pointerdown", unlockAudio);
    bell.remove();
    panel.remove();
    toastHost.remove();
    void audio?.close().catch(() => {});
  }
  doc.addEventListener("visibilitychange", wake);
  win.addEventListener("focus", wake);
  if (saved.enabled) doc.addEventListener("pointerdown", unlockAudio);
  win.addEventListener("pagehide", closeAll, { once: true });
  render();
  void poll();
  timer = win.setInterval(poll, 5000);
  return { poll, close: closeAll };
}
