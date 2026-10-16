import { setImageSource } from "./image-sources.js";
import { api, navbar, node, profilePath } from "./auth.js";
import { cardTile } from "./card-view.js";
import { createCardInspector } from "./card-inspection.js";
void navbar();
const $ = (id) => document.getElementById(id);
const tabs = [$("wins-tab"), $("rate-tab"), $("decks-tab")];
let inspector,
  catalogPromise,
  inspectionRequest = 0;
const deckDialog = $("ranking-deck-dialog");
$("ranking-deck-close").onclick = () => deckDialog.close();
deckDialog.addEventListener("close", () => {
  inspectionRequest++;
  inspector?.hide();
});
async function showDeck(entry) {
  const current = ++inspectionRequest;
  $("ranking-deck-title").textContent = entry.nome;
  $("ranking-deck-status").textContent = "Carregando cartas…";
  $("ranking-deck-cards").replaceChildren();
  $("ranking-deck-owner").href = profilePath(entry.dono.id);
  $("ranking-deck-owner").textContent = `Ver perfil de ${entry.dono.nome} →`;
  deckDialog.showModal();
  try {
    if (!catalogPromise)
      catalogPromise = api("/cards").catch((error) => {
        catalogPromise = null;
        throw error;
      });
    const [profile, catalog] = await Promise.all([
      api(`/profiles/${entry.dono.id}`),
      catalogPromise,
    ]);
    if (current !== inspectionRequest) return;
    const deck = profile.decks.find(
      (deck) =>
        deck._id === entry.id && (!profile.owner || deck.publico === true),
    );
    if (!deck)
      throw new Error("Este baralho não está mais público ou foi removido.");
    inspector ||= createCardInspector();
    const counts = new Map();
    for (const id of [deck.mago, ...deck.cartas].filter(Boolean))
      counts.set(id, (counts.get(id) || 0) + 1);
    const byId = new Map(
      catalog.cards.map((card) => [card.numeroCatalogo, card]),
    );
    $("ranking-deck-title").textContent = deck.nome;
    $("ranking-deck-status").textContent =
      `${deck.cartas.length}/40 cartas · ${deck.mago ? "1 mago" : "sem mago"}`;
    $("ranking-deck-cards").replaceChildren(
      ...[...counts].map(([id, count]) => {
        const card = byId.get(id);
        return card
          ? cardTile(card, (card) => inspector.inspect(card), count)
          : node("p", `Carta ${id} indisponível`);
      }),
    );
  } catch (error) {
    if (current === inspectionRequest)
      $("ranking-deck-status").textContent = error.message;
  }
}
let mode = "wins",
  page = 0,
  request = 0;
const number = (value) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
function entry(player, podium = false) {
  const deck = mode === "decks";
  const link = node(
    deck ? "button" : "a",
    "",
    `${podium ? "podium-player" : "rank-player"}${deck ? " rank-deck" : ""}`,
  );
  if (deck) {
    link.type = "button";
    link.setAttribute(
      "aria-label",
      `Ver baralho ${player.nome}, de ${player.dono.nome}`,
    );
    link.onclick = () => void showDeck(player);
  } else link.href = profilePath(player.id);
  link.dataset.position = player.position;
  const position = node(
    "span",
    String(player.position).padStart(2, "0"),
    "rank-position",
  );
  const avatar = node("img", "", "rank-avatar");
  setImageSource(
    avatar,
    deck ? player.icone : player.avatarURL || "/assets/avatar.png",
  );
  avatar.alt = "";
  avatar.loading = "lazy";
  avatar.onerror = () => {
    avatar.onerror = null;
    setImageSource(
      avatar,
      deck ? "/assets/icons/neutro.svg" : "/assets/avatar.png",
    );
  };
  const identity = node("div", "", "rank-identity");
  identity.append(
    node("strong", player.nome),
    node(
      "span",
      deck ? `Por ${player.dono.nome}` : `Nível ${player.nivel}`,
      "muted",
    ),
  );
  if (!deck) identity.append(node("span", player.titulo, "muted"));
  const metric = node(
    "strong",
    mode === "wins"
      ? `${number(player.vitorias)} vitórias`
      : `${number(player.taxaVitorias)}%`,
    "rank-metric",
  );
  const detail = node(
    "span",
    `${number(player.partidas)} partidas · ${mode === "wins" ? `${number(player.taxaVitorias)}% de vitórias` : `${number(player.vitorias)} vitórias`}`,
    "rank-detail muted",
  );
  link.append(position, avatar, identity, metric, detail);
  if (podium && player.position === 1) {
    const crown = node("span", "♔", "rank-crown");
    crown.setAttribute("aria-hidden", "true");
    link.prepend(crown);
  }
  return link;
}
async function load() {
  const current = ++request;
  $("ranking-panel").setAttribute("aria-busy", "true");
  $("ranking-status").hidden = false;
  $("ranking-status").textContent = "Carregando classificação…";
  $("ranking-podium").replaceChildren();
  $("ranking-list").replaceChildren();
  for (const id of ["ranking-prev", "ranking-next", "ranking-retry"])
    $(id).hidden = true;
  $("ranking-page").textContent = "";
  $("ranking-total").textContent = "";
  try {
    const data = await api(`/rankings?mode=${mode}&page=${page}`);
    if (current !== request) return;
    $("ranking-total").textContent =
      `${number(data.total)} ${mode === "decks" ? "baralhos" : "jogadores"}`;
    $("ranking-podium").append(...data.podium.map((p) => entry(p, true)));
    $("ranking-list").start = 4 + page * 20;
    for (const player of mode === "decks" ? data.decks : data.players) {
      const item = node("li");
      item.append(entry(player));
      $("ranking-list").append(item);
    }
    $("ranking-status").hidden = data.total > 0;
    $("ranking-status").textContent =
      mode === "decks"
        ? "Ainda não há baralhos públicos com 10 partidas concluídas."
        : mode === "rate"
          ? "Ainda não há jogadores com 10 partidas concluídas."
          : "Ainda não há jogadores com partidas concluídas.";
    $("ranking-prev").hidden = page === 0;
    $("ranking-next").hidden = !data.hasMore;
    $("ranking-page").textContent =
      data.total > 3
        ? `Página ${page + 1} de ${Math.ceil((data.total - 3) / 20)}`
        : "";
  } catch (e) {
    if (current !== request) return;
    $("ranking-status").textContent = e.message;
    $("ranking-retry").hidden = false;
  } finally {
    if (current === request)
      $("ranking-panel").setAttribute("aria-busy", "false");
  }
}
function select(index) {
  mode = ["wins", "rate", "decks"][index];
  page = 0;
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  });
  $("ranking-panel").setAttribute("aria-labelledby", tabs[index].id);
  $("ranking-kicker").textContent = [
    "VITÓRIAS TOTAIS",
    "TAXA DE VITÓRIA",
    "BARALHOS PÚBLICOS",
  ][index];
  $("ranking-title").textContent =
    index === 2 ? "Os baralhos que mais vencem" : "Os melhores duelistas";
  $("ranking-criteria").textContent =
    index === 2
      ? "Baralhos públicos com pelo menos 10 partidas. Empates: mais vitórias e, depois, ordem de criação. A taxa usa o histórico do baralho, incluindo partidas anteriores a edições. Clique para ver as cartas."
      : index === 0
        ? "Vitórias de toda a conta. Empates: maior taxa de vitória e, depois, ordem de cadastro."
        : "Mínimo de 10 partidas concluídas. Empates: mais vitórias e, depois, ordem de cadastro. A classificação usa a taxa exata; o percentual exibido é arredondado.";
  void load();
}
tabs.forEach((tab, i) => {
  tab.onclick = () => select(i);
  tab.onkeydown = (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      tabs[index].focus();
      select(index);
    }
  };
});
$("ranking-prev").onclick = () => {
  page--;
  void load();
};
$("ranking-next").onclick = () => {
  page++;
  void load();
};
$("ranking-retry").onclick = () => void load();
void load();
