import { setImageSource } from "./image-sources.js";
import { api, token, navbar, message, node, profilePath } from "./auth.js";
import { cardTile } from "./card-view.js";
import { createCardInspector } from "./card-inspection.js";
import { friendshipButtons } from "./social-view.js";

const $ = (id) => document.getElementById(id);
const inspector = createCardInspector();
async function loadFriendship() {
  const controls = $("profile-friendship");
  controls.hidden = !user || profileId === user.id;
  if (controls.hidden) return;
  const currentRelation = async () =>
    (await api("/friends")).relations.find((r) => r.id === profileId);
  try {
    friendshipButtons(
      controls,
      await currentRelation(),
      async (action) => {
        const result = await api(
          action === "send"
            ? "/friends/requests"
            : action === "accept"
              ? `/friends/requests/${profileId}/accept`
              : `/friends/${profileId}`,
          {
            method: action === "remove" ? "DELETE" : "POST",
            ...(action !== "remove"
              ? {
                  body: JSON.stringify(
                    action === "send" ? { userId: profileId } : {},
                  ),
                }
              : {}),
          },
        );
        message(result.content);
        return currentRelation();
      },
      (e) => message(e.message, true),
    );
  } catch (e) {
    message(e.message, true);
    const retry = node("button", "Recarregar amizade", "quiet");
    retry.onclick = () => void loadFriendship();
    controls.replaceChildren(retry);
  }
}
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
      setImageSource(img, deck.icone);
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
    if (opponent) link.href = profilePath(opponent.id);
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
    if (match.xpGanho !== undefined) {
      const earned = node("span", `+${match.xpGanho} XP`, "match-xp");
      earned.title = `Multiplicador desta partida: ×${Number(match.multiplicadorXp || 1).toLocaleString("pt-BR")}`;
      row.append(earned);
    }
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
    const pathId = /^\/thumosplayer\/([a-f\d]{24})\/?$/i.exec(
      location.pathname,
    )?.[1];
    profileId =
      pathId || new URLSearchParams(location.search).get("id") || user?.id;
    if (!profileId) {
      location.href = "/HTML/login.html";
      return;
    }
    if (!/^[a-f\d]{24}$/i.test(profileId)) throw Error("Perfil inválido.");
    const [data, cards] = await Promise.all([
      api(`/profiles/${profileId}`),
      api("/cards"),
    ]);
    profile = data;
    history.replaceState(null, "", profilePath(profileId));
    $("share-profile").disabled = false;
    catalog = cards.cards;
    $("player-name").textContent = data.user.nome;
    document.title = `${data.user.nome} · Zacornia`;
    setImageSource($("avatar"), data.user.avatarURL || "/assets/avatar.png");
    $("profile-subtitle").textContent = data.owner
      ? "Seu perfil de duelista"
      : "Perfil do duelista";
    $("edit-section").hidden = !data.owner;
    $("name").value = data.user.nome;
    const stats = data.stats;
    $("level").textContent = stats.nivel;
    $("player-title").textContent = stats.titulo;
    const badge = $("player-title-badge");
    badge.hidden = false;
    badge.dataset.tier = [1, 3, 6, 10, 15, 20, 25, 30, Infinity].findIndex(
      (limit) => stats.nivel <= limit,
    );
    badge.dataset.animated = String(stats.nivel >= 7);
    if (stats.nivel >= 7) badge.tabIndex = 0;
    $("stats").replaceChildren(
      ...[
        [stats.partidas, "Partidas concluídas"],
        ...(stats.partidasSemClassificacao
          ? [[stats.partidasSemClassificacao, "Sem classificação"]]
          : []),
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
      `${stats.progresso.toLocaleString("pt-BR")}/${stats.proximoNivel.toLocaleString("pt-BR")} XP`;
    $("level-progress").value = stats.progresso;
    $("level-progress").max = stats.proximoNivel;
    $("experience-caption").textContent =
      `${stats.xp.toLocaleString("pt-BR")} XP acumulados · Faltam ${stats.xpParaProximoNivel.toLocaleString("pt-BR")} XP para o nível ${stats.nivel + 1}.`;
    $("experience-streaks").replaceChildren(
      node(
        "span",
        `Vitórias seguidas: ${stats.sequenciaVitorias}`,
        "experience-streak",
      ),
      node(
        "span",
        `Recorde: ${stats.maiorSequenciaVitorias}`,
        "experience-streak",
      ),
      node(
        "span",
        `Próxima vitória: ×${stats.multiplicadorProximaVitoria.toLocaleString("pt-BR")}`,
        "experience-multiplier",
      ),
      node(
        "span",
        `Próxima derrota: ×${stats.multiplicadorProximaDerrota.toLocaleString("pt-BR")}`,
        "experience-multiplier",
      ),
    );
    $("history-total").textContent =
      `${stats.historicoCount ?? stats.partidas} partidas no histórico`;
    renderDecks();
    renderHistory(data.matches);
    $("more-history").hidden = !data.hasMore;
    void loadFriendship();
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
      const upload = await api("/auth/avatar", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      avatarURL = upload.avatarURL;
    }
    const result = await api("/auth/user/edit", {
      method: "PUT",
      body: JSON.stringify({ nome: $("name").value, avatarURL }),
    });
    user = result.user;
    setImageSource($("avatar"), user.avatarURL);
    $("player-name").textContent = user.nome;
    message("Perfil atualizado.");
    await navbar();
  } catch (e) {
    message(e.message, true);
  } finally {
    button.disabled = false;
  }
};
$("share-profile").onclick = async () => {
  const url = new URL(profilePath(profileId), location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    message("Link do perfil copiado.");
  } catch {
    message(`Link do perfil: ${url}`);
  }
};
void load();
