import { cardBacks } from "./card-backs.js";
export const deckIcons = [
  ["neutro", "Neutro"],
  ["agua", "Água"],
  ["ar", "Ar"],
  ["fogo", "Fogo"],
  ["terra", "Terra"],
  ["zarcos", "Zarcos"],
  ["tropa", "Tropa"],
  ["feitiço", "Feitiço"],
];
export function normalizeAppearance(deck) {
  return {
    icone: deckIcons.some(([id]) => deck.icone === `/assets/icons/${id}.svg`)
      ? deck.icone
      : "/assets/icons/neutro.svg",
    verso: cardBacks.some(([id]) => deck.verso === id) ? deck.verso : "common",
  };
}
export function renderDeckAppearance(container, deck, changed) {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const appearance = normalizeAppearance(deck);
  for (const [key, title, options, url] of [
    ["icone", "Ícone do baralho", deckIcons, (id) => `/assets/icons/${id}.svg`],
    [
      "verso",
      "Verso do baralho",
      cardBacks,
      (id) => `/assets/card-backs/${id}.png`,
    ],
  ]) {
    const group = doc.createElement("fieldset");
    group.className = `appearance-options ${key}`;
    const legend = doc.createElement("legend");
    legend.textContent = title;
    group.append(legend);
    for (const [id, label] of options) {
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `${title}: ${label}`);
      const value = key === "icone" ? url(id) : id;
      button.setAttribute("aria-pressed", String(appearance[key] === value));
      const img = doc.createElement("img");
      img.src = url(id);
      img.alt = "";
      const name = doc.createElement("span");
      name.textContent = label;
      button.append(img, name);
      button.onclick = () => {
        deck[key] = value;
        changed();
      };
      group.append(button);
    }
    container.append(group);
  }
}
