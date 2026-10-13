import { api, navbar, message, node, profilePath } from "./auth.js";
import {
  splitRelations,
  filterFriends,
  friendshipButtons,
  createSocialTabs,
} from "./social-view.js";
let user,
  refreshPromise,
  relations = [],
  searchResults = [],
  lastRelations,
  lastInvites;
const $ = (id) => document.getElementById(id);
createSocialTabs($("social-tabs"));
function requestedTab() {
  if (location.hash === "#invites") $("invites-tab").click();
  else if (location.hash === "#requests") $("requests-tab").click();
}
requestedTab();
window.addEventListener("hashchange", requestedTab);
function person(player) {
  const identity = node("div", "", "social-person"),
    avatar = node("img"),
    link = node("a", player.nome);
  avatar.src = player.avatarURL || "/assets/avatar.png";
  avatar.alt = "";
  avatar.className = "social-avatar";
  link.href = profilePath(player.id);
  identity.append(avatar, link);
  return identity;
}
function button(text, action) {
  const b = node("button", text, "quiet");
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await action();
      await refresh(true);
    } catch (e) {
      message(e.message, true);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
async function post(path, data = {}) {
  const result = await api(path, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (result.content) message(result.content);
  return result;
}
function deck() {
  const id = $("social-deck").value;
  if (!id)
    throw Error("Salve um baralho completo antes de convidar ou aceitar.");
  return id;
}
function friendshipActions(player) {
  const controls = node("div", "", "friendship-actions");
  friendshipButtons(
    controls,
    relations.find((f) => f.id === player.id),
    async (action) => {
      if (action === "send")
        await post("/friends/requests", { userId: player.id });
      else if (action === "accept")
        await post(`/friends/requests/${player.id}/accept`);
      else {
        const result = await api(`/friends/${player.id}`, { method: "DELETE" });
        message(result.content);
      }
      await refresh(true);
      return relations.find((f) => f.id === player.id);
    },
    (e) => message(e.message, true),
  );
  return controls;
}
function row(player, invite = false) {
  const entry = node("article", "", "social-row"),
    actions = node("div", "", "social-actions");
  entry.append(person(player));
  if (invite)
    actions.append(
      button("Convidar para jogar", async () => {
        await post("/friends/invites", { userId: player.id, deckId: deck() });
        $("invites-tab").click();
      }),
    );
  actions.append(friendshipActions(player));
  entry.append(actions);
  return entry;
}
function fill(id, players, empty, invite = false) {
  $(id).replaceChildren(...players.map((p) => row(p, invite)));
  if (!players.length) $(id).append(node("p", empty, "empty-state"));
}
function renderFriends() {
  const friends = splitRelations(relations).friends;
  fill(
    "friend-list",
    filterFriends(friends, $("friends-filter").value),
    friends.length
      ? "Nenhum amigo encontrado com esse nome."
      : "Você ainda não tem amigos. Encontre jogadores na aba Pedidos de amizade.",
    true,
  );
}
function renderSearch() {
  fill("search-results", searchResults, "Nenhum jogador encontrado.");
}
function renderRelations() {
  const { friends, incoming, outgoing } = splitRelations(relations);
  $("friends-count").textContent = `(${friends.length})`;
  $("requests-count").textContent = `(${incoming.length + outgoing.length})`;
  renderFriends();
  fill("incoming-requests", incoming, "Nenhum pedido recebido.");
  fill("outgoing-requests", outgoing, "Nenhum pedido enviado.");
  if (searchResults.length) renderSearch();
}
function renderInvites(invites) {
  $("invites-count").textContent = `(${invites.length})`;
  $("invite-list").replaceChildren();
  if (!invites.length)
    $("invite-list").append(node("p", "Sem convites ativos.", "empty-state"));
  for (const i of invites) {
    const incoming = i.to === user.id,
      entry = node("article", "", "social-row"),
      actions = node("div", "", "social-actions");
    entry.append(
      person({
        id: incoming ? i.from : i.to,
        nome: incoming ? i.fromName : i.toName,
      }),
      node(
        "span",
        i.status === "accepted"
          ? "Partida criada"
          : incoming
            ? "Convidou você"
            : "Convite enviado",
      ),
    );
    if (i.status === "accepted") {
      const link = node("a", "Abrir partida");
      link.href = "/HTML/index.html";
      actions.append(link);
    } else {
      if (incoming)
        actions.append(
          button(
            i.status === "starting"
              ? "Retomar criação da partida"
              : "Aceitar convite",
            async () => {
              await post(`/friends/invites/${i.id}/accept`, { deckId: deck() });
              location.href = "/HTML/index.html";
            },
          ),
        );
      if (i.status === "pending")
        actions.append(
          button(incoming ? "Recusar" : "Cancelar", () =>
            post(`/friends/invites/${i.id}/decline`),
          ),
        );
      actions.append(
        node(
          "small",
          `Expira ${new Date(i.expires).toLocaleTimeString("pt-BR")}`,
        ),
      );
    }
    entry.append(actions);
    $("invite-list").append(entry);
  }
}
async function refresh(force = false) {
  if (!user) return;
  if (refreshPromise) {
    await refreshPromise;
    if (!force) return;
  }
  refreshPromise = (async () => {
    const options = force ? { cache: "reload" } : {};
    const [friends, invites] = await Promise.allSettled([
      api("/friends", options).then((data) => {
        const snapshot = JSON.stringify(data.relations);
        if (force || snapshot !== lastRelations) {
          lastRelations = snapshot;
          relations = data.relations;
          renderRelations();
        }
      }),
      api("/friends/invites", options).then((data) => {
        const snapshot = JSON.stringify(data.invites);
        if (force || snapshot !== lastInvites) {
          lastInvites = snapshot;
          renderInvites(data.invites);
        }
      }),
    ]);
    for (const result of [friends, invites])
      if (result.status === "rejected") throw result.reason;
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
$("friends-filter").oninput = renderFriends;
let searchVersion = 0;
$("friend-search").onsubmit = async (event) => {
  event.preventDefault();
  const version = ++searchVersion,
    b = event.currentTarget.querySelector("button");
  b.disabled = true;
  try {
    const q = new FormData(event.currentTarget).get("q"),
      data = await api(`/friends/search?q=${encodeURIComponent(q)}`);
    if (version !== searchVersion) return;
    searchResults = data.users;
    renderSearch();
  } catch (e) {
    message(e.message, true);
  } finally {
    if (version === searchVersion) b.disabled = false;
  }
};
async function init() {
  user = await navbar();
  if (!user) return;
  $("social-intro").textContent =
    "Encontre seus amigos, acompanhe pedidos e combine a próxima partida.";
  $("social-controls").hidden = false;
  const timer = setInterval(() => {
    if (!document.hidden) void refresh().catch((e) => message(e.message, true));
  }, 5000);
  window.addEventListener("beforeunload", () => clearInterval(timer), {
    once: true,
  });
  // Friends and invitations remain usable when deck loading is slow or fails.
  await Promise.allSettled([
    refresh().catch((e) => message(e.message, true)),
    api("/decks")
      .then((data) => {
        for (const d of data.decks) {
          const option = node("option", d.nome);
          option.value = d._id;
          $("social-deck").append(option);
        }
      })
      .catch((e) => message(e.message, true)),
  ]);
}
void init();
