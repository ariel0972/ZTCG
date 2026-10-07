export function token() {
  return sessionStorage.getItem("token") || localStorage.getItem("token");
}
let refreshing;
export async function api(path, options = {}, renewed = false) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = { "Content-Type": "application/json", ...options.headers };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(path, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const data = await response.json();
    if (
      response.status === 401 &&
      !renewed &&
      !path.startsWith("/auth/log") &&
      !path.startsWith("/auth/refresh")
    ) {
      clearTimeout(timeout);
      if (!refreshing)
        refreshing = api("/auth/refresh", { method: "POST", body: "{}" }, true)
          .then((session) => {
            const profile = JSON.parse(
              sessionStorage.getItem("playerProfile") ||
                localStorage.getItem("playerProfile") ||
                "null",
            );
            if (profile?.id && profile.id !== session.user.id) {
              const error = new Error(
                "Outra conta entrou neste navegador. Entre novamente nesta aba.",
              );
              error.status = 401;
              throw error;
            }
            rememberSession(session, !!localStorage.getItem("token"));
          })
          .finally(() => {
            refreshing = null;
          });
      await refreshing;
      return api(path, options, true);
    }
    if (!response.ok || !data.success) {
      const details = (data.details || [])
        .map((d) =>
          typeof d === "string"
            ? d
            : `${d.path?.join(".") || "Campo"}: ${d.message}`,
        )
        .join("\n");
      const error = new Error(data.content + (details ? "\n" + details : ""));
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("O servidor demorou para responder. Tente novamente.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export function rememberSession(data, remember) {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem("token");
    storage.removeItem("playerProfile");
  }
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem("token", data.token);
  storage.setItem("playerProfile", JSON.stringify(data.user));
}
export async function logout() {
  try {
    await api("/auth/logout", { method: "POST", body: "{}" });
  } catch {}
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem("token");
    storage.removeItem("playerProfile");
  }
  location.href = "/HTML/login.html";
}
let messageTimer;
export function message(text, bad = false) {
  clearTimeout(messageTimer);
  const node = document.getElementById("message");
  if (!node) return;
  node.textContent = text;
  node.dataset.error = String(bad);
  node.hidden = !text;
  if (text)
    messageTimer = setTimeout(
      () => {
        node.hidden = true;
        node.textContent = "";
      },
      bad ? 8000 : 4500,
    );
}
export function node(tag, text = "", className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
}
export async function navbar() {
  const nav = document.querySelector('nav[aria-label="Principal"]');
  if (nav && !nav.querySelector('a[href="/HTML/friends.html"]')) {
    const friends = node("a", "Amigos");
    friends.href = "/HTML/friends.html";
    nav.append(friends);
  }
  const host = document.getElementById("account");
  if (!host) return null;
  host.replaceChildren();
  if (!token()) {
    const link = node("a", "Entrar");
    link.href = "/HTML/login.html";
    host.append(link);
    return null;
  }
  try {
    const { user } = await api("/auth/me");
    const link = node("a", user.nome);
    link.href = "/HTML/perfil.html";
    host.append(link);
    if (user.admin) {
      const admin = node("a", "Catálogo");
      admin.href = "/HTML/admin.html";
      host.append(admin);
    }
    const button = node("button", "Sair", "quiet");
    button.onclick = logout;
    host.append(button);
    const friendsLink = nav?.querySelector('a[href="/HTML/friends.html"]');
    if (friendsLink) {
      const updateInvites = async () => {
        if (document.hidden || !token()) return;
        try {
          const result = await api("/friends/invites");
          const count = result.invites.filter(
            (i) => i.to === user.id && i.status === "pending",
          ).length;
          friendsLink.textContent = count ? `Amigos (${count})` : "Amigos";
          friendsLink.title = count
            ? `${count} convite(s) de partida recebido(s)`
            : "Amizades e convites";
        } catch {
          /* A página atual continua disponível se a consulta falhar. */
        }
      };
      void updateInvites();
      window.setInterval(updateInvites, 10000);
    }
    return user;
  } catch (e) {
    const link = node("a", "Entrar novamente");
    link.href = "/HTML/login.html";
    host.append(link);
    message(e.message, true);
    return null;
  }
}
