import { api, navbar, node, profilePath } from "./auth.js";
void navbar();
const $ = (id) => document.getElementById(id);
const tabs = [$("wins-tab"), $("rate-tab")];
let mode = "wins",
  page = 0,
  request = 0;
const number = (value) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
function entry(player, podium = false) {
  const link = node("a", "", podium ? "podium-player" : "rank-player");
  link.href = profilePath(player.id);
  link.dataset.position = player.position;
  const position = node(
    "span",
    String(player.position).padStart(2, "0"),
    "rank-position",
  );
  const avatar = node("img", "", "rank-avatar");
  avatar.src = player.avatarURL || "/assets/avatar.png";
  avatar.alt = "";
  avatar.loading = "lazy";
  avatar.onerror = () => {
    avatar.onerror = null;
    avatar.src = "/assets/avatar.png";
  };
  const identity = node("div", "", "rank-identity");
  identity.append(
    node("strong", player.nome),
    node("span", `Nível ${player.nivel}`, "muted"),
    node("span", player.titulo, "muted"),
  );
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
    $("ranking-total").textContent = `${number(data.total)} jogadores`;
    $("ranking-podium").append(...data.podium.map((p) => entry(p, true)));
    $("ranking-list").start = 4 + page * 20;
    for (const player of data.players) {
      const item = node("li");
      item.append(entry(player));
      $("ranking-list").append(item);
    }
    $("ranking-status").hidden = data.total > 0;
    $("ranking-status").textContent =
      mode === "rate"
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
  mode = index === 0 ? "wins" : "rate";
  page = 0;
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  });
  $("ranking-panel").setAttribute("aria-labelledby", tabs[index].id);
  $("ranking-kicker").textContent =
    index === 0 ? "VITÓRIAS TOTAIS" : "TAXA DE VITÓRIA";
  $("ranking-criteria").textContent =
    index === 0
      ? "Vitórias de toda a conta. Empates: maior taxa de vitória e, depois, ordem de cadastro."
      : "Mínimo de 10 partidas concluídas. Empates: mais vitórias e, depois, ordem de cadastro. A classificação usa a taxa exata; o percentual exibido é arredondado.";
  void load();
}
tabs.forEach((tab, i) => {
  tab.onclick = () => select(i);
  tab.onkeydown = (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - i;
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
