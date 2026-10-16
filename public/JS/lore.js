import { api, navbar, node } from "./auth.js";
import { setImageSource } from "./image-sources.js";
import { loreLabels, lorePath, renderLoreArticle } from "./lore-view.js";

const $ = (id) => document.getElementById(id);
let entries = [],
  category = "",
  loadId = 0;
const cardFilter = new URLSearchParams(location.search).get("carta");
const articles = new Map();
const normalize = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function selectedSlug() {
  const match = /^\/lore\/([a-z0-9-]+)\/?$/.exec(location.pathname);
  return match?.[1] || "";
}
function route(slug = "") {
  history.pushState(
    null,
    "",
    slug
      ? lorePath(slug)
      : "/lore" +
          (cardFilter ? "?carta=" + encodeURIComponent(cardFilter) : ""),
  );
  void read();
}
function renderList() {
  const query = normalize($("lore-search").value.trim());
  const filtered = entries.filter(
    (e) =>
      (!category || e.categoria === category) &&
      (!cardFilter || e.cartas.includes(cardFilter)) &&
      normalize(
        [
          e.titulo,
          e.subtitulo,
          e.resumo,
          ...(e.cards || []).map((c) => c.nome + " " + c.numeroCatalogo),
        ].join(" "),
      ).includes(query),
  );
  $("lore-count").textContent =
    `${filtered.length} ${filtered.length === 1 ? "história" : "histórias"}${cardFilter ? " vinculadas à carta #" + cardFilter : ""}`;
  $("lore-empty").hidden = filtered.length > 0;
  $("lore-list").replaceChildren(
    ...filtered.map((entry) => {
      const link = node("a", "", "lore-tile");
      link.href = lorePath(entry.slug);
      if (entry.slug === selectedSlug())
        link.setAttribute("aria-current", "page");
      const imageHost = node("span", "✧", "lore-tile-image");
      imageHost.setAttribute("aria-hidden", "true");
      const card = entry.cards?.[0];
      if (card) {
        const image = node("img");
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        setImageSource(image, card.imgURL || "/assets/avatar.png", true);
        imageHost.replaceChildren(image);
      }
      const copy = node("span", "", "lore-tile-copy");
      copy.append(
        node("span", loreLabels[entry.categoria] || "Lore", "eyebrow"),
        node("h2", entry.titulo),
        node("span", entry.resumo, "lore-tile-summary"),
        node("span", "Ler história →", "lore-tile-open"),
      );
      link.append(imageHost, copy);
      link.onclick = (event) => {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        ) {
          event.preventDefault();
          route(entry.slug);
        }
      };
      return link;
    }),
  );
}
async function read() {
  const slug = selectedSlug(),
    request = ++loadId;
  $("lore-layout").classList.toggle("reading", !!slug);
  $("lore-reader").hidden = !slug;
  $("lore-hero").hidden = !!slug;
  renderList();
  if (!slug) {
    document.title = "Lore · Zacornia";
    return;
  }
  $("lore-article").replaceChildren(node("p", "Abrindo história…", "muted"));
  try {
    let entry = articles.get(slug);
    if (!entry) {
      entry = (await api("/lore-data/" + encodeURIComponent(slug))).entry;
      if (articles.size >= 40) articles.delete(articles.keys().next().value);
      articles.set(slug, entry);
    }
    if (request !== loadId) return;
    renderLoreArticle($("lore-article"), entry);
    document.title = entry.titulo + " · Lore de Zacornia";
    $("lore-reader").focus();
  } catch (error) {
    if (request !== loadId) return;
    $("lore-article").replaceChildren(
      node(
        "h1",
        error.status === 404
          ? "História não encontrada"
          : "Não foi possível abrir a história",
      ),
      node("p", error.message, "muted"),
    );
  }
}
$("lore-back").onclick = () => route();
$("lore-search").oninput = renderList;
for (const button of document.querySelectorAll("[data-lore-category]"))
  button.onclick = () => {
    category = button.dataset.loreCategory;
    for (const item of document.querySelectorAll("[data-lore-category]"))
      item.setAttribute("aria-pressed", String(item === button));
    renderList();
  };
window.addEventListener("popstate", () => void read());
void navbar();
void (async () => {
  try {
    entries = (await api("/lore-data")).entries;
    $("lore-status").hidden = true;
    await read();
  } catch (error) {
    $("lore-status").textContent =
      "Não foi possível carregar as histórias. " + error.message;
  }
})();
