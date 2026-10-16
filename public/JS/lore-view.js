import { node } from "./auth.js";
import { setImageSource } from "./image-sources.js";

export const loreLabels = {
  personagem: "Personagens",
  lugar: "Lugares",
  faccao: "Facções",
  universo: "Universo",
};
export function lorePath(slug) {
  return "/lore/" + encodeURIComponent(slug);
}
export function renderLoreArticle(host, entry) {
  host.replaceChildren();
  const header = node("header", "", "lore-article-heading");
  header.append(
    node("p", loreLabels[entry.categoria] || "Lore", "eyebrow"),
    node("h1", entry.titulo),
  );
  if (entry.subtitulo)
    header.append(node("p", entry.subtitulo, "lore-subtitle"));
  if (entry.resumo) header.append(node("p", entry.resumo, "lore-lead"));
  host.append(header);
  const text = node("div", "", "lore-prose");
  for (const paragraph of (entry.texto || "")
    .split(/\n\s*\n/)
    .filter((p) => p.trim()))
    text.append(node("p", paragraph.trim()));
  if (!text.childElementCount)
    text.append(node("p", "A história ainda não foi escrita.", "muted"));
  host.append(text);
  if (entry.cards?.length) {
    const section = node("section", "", "lore-related");
    section.append(node("h2", "Cartas desta história"));
    const cards = node("div", "", "lore-related-cards");
    for (const card of entry.cards) {
      const figure = node("figure");
      const image = node("img");
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = card.nome;
      setImageSource(image, card.imgURL || "/assets/avatar.png");
      figure.append(
        image,
        node("figcaption", `${card.nome} · #${card.numeroCatalogo}`),
      );
      cards.append(figure);
    }
    section.append(cards);
    host.append(section);
  }
  if (entry.fonteURL) {
    try {
      const url = new URL(entry.fonteURL);
      if (url.protocol === "https:" && !url.username && !url.password) {
        const source = node("a", "Texto de origem ↗", "lore-source");
        source.href = url.href;
        source.target = "_blank";
        source.rel = "noopener noreferrer";
        host.append(source);
      }
    } catch {}
  }
}
