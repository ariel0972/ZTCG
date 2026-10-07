import { api, navbar, message, node } from "./auth.js";
let user,
  loading = false;
const $ = (id) => document.getElementById(id);
function profileLink(id, nome) {
  const link = node("a", nome);
  link.href = `/HTML/perfil.html?id=${encodeURIComponent(id)}`;
  return link;
}
function button(text, action) {
  const b = node("button", text, "quiet");
  b.onclick = async () => {
    b.disabled = true;
    try {
      await action();
      await refresh();
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
async function refresh() {
  if (!user || loading) return;
  loading = true;
  try {
    const [friends, invites] = await Promise.all([
      api("/friends"),
      api("/friends/invites"),
    ]);
    $("friend-list").replaceChildren();
    if (!friends.relations.length)
      $("friend-list").append(
        node("p", "Você ainda não tem amizades ou pedidos."),
      );
    for (const f of friends.relations) {
      const row = node("article", "", "social-row");
      row.append(profileLink(f.id, f.nome));
      if (f.status === "accepted")
        row.append(
          button("Convidar para jogar", () =>
            post("/friends/invites", { userId: f.id, deckId: deck() }),
          ),
        );
      else if (f.incoming)
        row.append(
          node("span", "Pedido recebido"),
          button("Aceitar amizade", () =>
            post(`/friends/requests/${f.id}/accept`),
          ),
        );
      else row.append(node("span", "Pedido enviado"));
      row.append(
        button(
          f.status === "accepted" ? "Remover amizade" : "Cancelar/recusar",
          () => api(`/friends/${f.id}`, { method: "DELETE" }),
        ),
      );
      $("friend-list").append(row);
    }
    $("invite-list").replaceChildren();
    if (!invites.invites.length)
      $("invite-list").append(node("p", "Sem convites ativos."));
    for (const i of invites.invites) {
      const incoming = i.to === user.id,
        row = node("article", "", "social-row");
      row.append(
        node("strong", incoming ? i.fromName : i.toName),
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
        row.append(link);
      } else {
        if (incoming)
          row.append(
            button(
              i.status === "starting"
                ? "Retomar criação da partida"
                : "Aceitar convite",
              async () => {
                await post(`/friends/invites/${i.id}/accept`, {
                  deckId: deck(),
                });
                location.href = "/HTML/index.html";
              },
            ),
          );
        if (i.status === "pending")
          row.append(
            button(incoming ? "Recusar" : "Cancelar", () =>
              post(`/friends/invites/${i.id}/decline`),
            ),
          );
        row.append(
          node(
            "small",
            `Expira ${new Date(i.expires).toLocaleTimeString("pt-BR")}`,
          ),
        );
      }
      $("invite-list").append(row);
    }
  } catch (e) {
    message(e.message, true);
  } finally {
    loading = false;
  }
}
$("friend-search").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const q = new FormData(event.currentTarget).get("q"),
      data = await api(`/friends/search?q=${encodeURIComponent(q)}`);
    $("search-results").replaceChildren();
    if (!data.users.length)
      $("search-results").append(node("p", "Nenhum jogador encontrado."));
    for (const p of data.users) {
      const row = node("article", "", "social-row");
      row.append(
        profileLink(p.id, p.nome),
        node("small", `ID: ${p.id}`),
        button("Adicionar amigo", () =>
          post("/friends/requests", { userId: p.id }),
        ),
      );
      $("search-results").append(row);
    }
  } catch (e) {
    message(e.message, true);
  }
};
async function init() {
  user = await navbar();
  if (!user) return;
  $("social-intro").textContent =
    "Adicione um amigo e convide para uma partida com os baralhos escolhidos.";
  $("social-controls").hidden = false;
  try {
    const data = await api("/decks");
    for (const d of data.decks) {
      const option = node("option", d.nome);
      option.value = d._id;
      $("social-deck").append(option);
    }
    await refresh();
    setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
  } catch (e) {
    message(e.message, true);
  }
}
void init();
