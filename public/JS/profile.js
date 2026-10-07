import { api, token, navbar, message, node } from "./auth.js";
import { cardTile } from "./card-view.js";
import { createCardInspector } from "./card-inspection.js";
if (!token()) location.href = "/HTML/login.html";
const $ = (id) => document.getElementById(id);
const inspector = createCardInspector();
let user,
  profileId,
  profile,
  catalog = [],
  page = 0;
function showDeck(deck) {
  const byId = new Map(catalog.map((c) => [c.numeroCatalogo, c]));
  const counts = new Map();
  for (const id of [deck.mago, ...deck.cartas].filter(Boolean))
    counts.set(id, (counts.get(id) || 0) + 1);
  $("profile-deck-title").textContent = deck.nome;
  $("profile-deck-cards").replaceChildren(
    ...[...counts].map(([id, count]) => {
      const card = byId.get(id);
      if (!card) return node("p", `Carta ${id} indisponível`);
      return cardTile(card, (c) => inspector.inspect(c), count);
    }),
  );
  $("profile-deck-dialog").showModal();
}
$("close-profile-deck").onclick = () => {
  inspector.hide();
  $("profile-deck-dialog").close();
};
$("profile-deck-dialog").addEventListener("close", () => inspector.hide());
function renderDecks() {
  $("deck-count").textContent = `${profile.decks.length} baralho(s)`;
  $("decks-title").textContent = profile.owner
    ? "Meus baralhos"
    : "Baralhos públicos";
  $("deck-privacy").textContent = profile.owner
    ? "Escolha quais baralhos outros jogadores podem ver. Clique em um baralho para conferir as cartas."
    : "Clique em um baralho para conhecer suas cartas.";
  $("decks").replaceChildren(
    ...profile.decks.map((deck) => {
      const row = node("article", "", "profile-deck"),
        open = node("button", "", "profile-deck-open"),
        img = node("img"),
        text = node("span");
      img.src = deck.icone;
      img.alt = "";
      text.append(
        node("strong", deck.nome),
        node(
          "small",
          `${deck.cartas.length}/40 cartas · ${deck.mago ? "1 mago" : "sem mago"}`,
        ),
      );
      open.append(img, text);
      open.onclick = () => showDeck(deck);
      row.append(open);
      if (profile.owner) {
        const actions = node("div", "", "deck-actions"),
          toggle = node(
            "button",
            deck.publico ? "Público · tornar privado" : "Privado · publicar",
            "quiet",
          ),
          edit = node("a", "Editar baralho");
        edit.href = "/";
        edit.onclick = () =>
          localStorage.setItem("ztcg:selected-deck", deck._id);
        toggle.onclick = async () => {
          toggle.disabled = true;
          try {
            const result = await api(`/decks/${deck._id}`, {
              method: "PUT",
              body: JSON.stringify({
                nome: deck.nome,
                cartas: deck.cartas,
                mago: deck.mago,
                icone: deck.icone,
                verso: deck.verso,
                revisao: deck.revisao,
                publico: !deck.publico,
              }),
            });
            Object.assign(deck, result.deck);
            renderDecks();
            message(
              deck.publico
                ? "Baralho visível no seu perfil."
                : "Baralho privado.",
            );
          } catch (e) {
            message(e.message, true);
          } finally {
            toggle.disabled = false;
          }
        };
        actions.append(toggle, edit);
        row.append(actions);
      }
      return row;
    }),
  );
  if (!profile.decks.length)
    $("decks").append(
      node(
        "p",
        profile.owner
          ? "Você ainda não salvou baralhos."
          : "Este jogador ainda não publicou baralhos.",
        "muted",
      ),
    );
}
function renderHistory(matches, append = false) {
  if (!append) $("history").replaceChildren();
  for (const match of matches) {
    const win = match.winner === profileId,
      draw = !match.winner,
      row = node("article", "", "profile-match"),
      detail = node("div", "", "match-detail");
    row.dataset.result = draw ? "draw" : win ? "win" : "loss";
    const opponent = match.players.find((p) => p.id !== profileId),
      link = node("a", opponent?.nome || "Oponente");
    if (opponent)
      link.href = `/HTML/perfil.html?id=${encodeURIComponent(opponent.id)}`;
    detail.append(
      link,
      node(
        "small",
        `${match.turns} turnos · ${match.reason || "Partida concluída"}`,
      ),
    );
    const date = node(
      "time",
      new Date(match.finishedAt).toLocaleString("pt-BR"),
    );
    date.dateTime = match.finishedAt;
    row.append(
      node(
        "span",
        draw ? "Empate" : win ? "Vitória" : "Derrota",
        "result-badge",
      ),
      detail,
      date,
    );
    $("history").append(row);
  }
  if (!$("history").children.length)
    $("history").append(
      node("p", "As partidas concluídas aparecerão aqui.", "muted"),
    );
}
async function load() {
  try {
    user = await navbar();
    if (!user) return;
    profileId = new URLSearchParams(location.search).get("id") || user.id;
    if (!/^[a-f\d]{24}$/i.test(profileId)) throw Error("Perfil inválido.");
    const [data, cards] = await Promise.all([
      api(`/profiles/${profileId}`),
      api("/cards"),
    ]);
    profile = data;
    catalog = cards.cards;
    $("player-name").textContent = data.user.nome;
    document.title = `${data.user.nome} · Zacornia`;
    $("avatar").src = data.user.avatarURL || "/assets/avatar.png";
    $("profile-subtitle").textContent = data.owner
      ? "Seu perfil de duelista"
      : "Perfil do duelista";
    $("edit-section").hidden = !data.owner;
    $("name").value = data.user.nome;
    const stats = data.stats;
    $("level").textContent = stats.nivel;
    $("stats").replaceChildren(
      ...[
        [stats.partidas, "Partidas concluídas"],
        [stats.vitorias, "Vitórias"],
        [`${stats.taxaVitorias}%`, "Taxa de vitórias"],
        [`${stats.derrotas} / ${stats.empates}`, "Derrotas / Empates"],
      ].map(([v, label]) => {
        const box = node("div", "", "profile-stat");
        box.append(node("strong", v), node("span", label));
        return box;
      }),
    );
    $("level-label").textContent = `Rumo ao nível ${stats.nivel + 1}`;
    $("level-caption").textContent =
      `${stats.progresso}/${stats.proximoNivel} partidas`;
    $("level-progress").value = stats.progresso;
    $("level-progress").max = stats.proximoNivel;
    $("history-total").textContent = `${stats.partidas} partidas no total`;
    renderDecks();
    renderHistory(data.matches);
    $("more-history").hidden = !data.hasMore;
  } catch (e) {
    message(e.message, true);
    $("player-name").textContent = "Perfil indisponível";
  }
}
$("more-history").onclick = async () => {
  const b = $("more-history");
  b.disabled = true;
  try {
    const data = await api(`/profiles/${profileId}?page=${page + 1}`);
    page++;
    renderHistory(data.matches, true);
    b.hidden = !data.hasMore;
  } catch (e) {
    message(e.message, true);
  } finally {
    b.disabled = false;
  }
};
$("profile-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  try {
    let avatarURL = user.avatarURL;
    const file = $("photo").files[0];
    if (file) {
      if (
        file.size > 200 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new Error("Use PNG, JPG ou WebP de até 200 KB.");
      avatarURL = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    const result = await api("/auth/user/edit", {
      method: "PUT",
      body: JSON.stringify({ nome: $("name").value, avatarURL }),
    });
    user = result.user;
    $("avatar").src = user.avatarURL;
    $("player-name").textContent = user.nome;
    message("Perfil atualizado.");
    await navbar();
  } catch (e) {
    message(e.message, true);
  } finally {
    button.disabled = false;
  }
};
void load();
