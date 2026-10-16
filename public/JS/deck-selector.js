import { setImageSource } from "./image-sources.js";
export function createDeckSelector(
  select,
  { userId, storage, label = "Seu baralho", catalog = [] } = {},
) {
  const doc = select.ownerDocument;
  try {
    storage ??= doc.defaultView.localStorage;
  } catch {}
  const key = `zacornia:selected-deck:${userId}`;
  const make = (tag, text = "", cls = "") => {
    const el = doc.createElement(tag);
    el.textContent = text;
    el.className = cls;
    return el;
  };
  let decks = [],
    cards = new Map(catalog.map((c) => [c.numeroCatalogo, c]));
  const host = make("div", "", "deck-selection"),
    trigger = make("button", "", "deck-selection-trigger"),
    image = make("img"),
    info = make("span", "", "deck-selection-info"),
    name = make("strong"),
    detail = make("small"),
    dialog = make("dialog", "", "deck-selection-dialog"),
    heading = make("div", "", "deck-selection-heading"),
    close = make("button", "Fechar", "quiet"),
    list = make("div", "", "deck-selection-list");
  image.alt = "";
  trigger.type = close.type = "button";
  trigger.setAttribute("aria-haspopup", "dialog");
  dialog.setAttribute("aria-label", "Escolher baralho");
  info.append(make("span", label, "eyebrow"), name, detail);
  trigger.append(
    image,
    info,
    make("span", "Trocar ›", "deck-selection-change"),
  );
  heading.append(make("h2", "Escolha seu baralho"), close);
  dialog.append(
    heading,
    make(
      "p",
      "Sua escolha fica salva neste navegador para as próximas partidas.",
      "muted",
    ),
    list,
  );
  host.append(trigger);
  select.hidden = true;
  select.after(host);
  doc.body.append(dialog);
  const selected = () => decks.find((d) => String(d._id) === select.value);
  function remember() {
    if (selected())
      try {
        storage?.setItem(key, select.value);
      } catch {}
  }
  const art = (deck) =>
    cards.get(deck?.mago)?.imgURL || deck?.icone || "/assets/avatar.png";
  function setImage(img, url) {
    setImageSource(img, url);
    img.onerror = () => {
      img.onerror = null;
      setImageSource(img, "/assets/avatar.png");
    };
  }
  function sync() {
    const deck = selected(),
      mage = cards.get(deck?.mago);
    name.textContent = deck?.nome || "Nenhum baralho salvo";
    detail.textContent = deck
      ? `${deck.cartas.length}/40 cartas · ${mage?.nome || (deck.mago ? "Mago selecionado" : "Sem mago")}`
      : "Crie um baralho para começar a jogar.";
    trigger.disabled = select.disabled || !decks.length;
    setImage(image, art(deck));
    list.replaceChildren();
    for (const d of decks) {
      const button = make("button", "", "deck-selection-option"),
        portrait = make("img"),
        text = make("span");
      button.type = "button";
      button.dataset.selected = String(String(d._id) === select.value);
      button.setAttribute("aria-pressed", button.dataset.selected);
      portrait.alt = "";
      setImage(portrait, art(d));
      text.append(
        make("strong", d.nome),
        make(
          "small",
          `${d.cartas.length}/40 cartas · ${cards.get(d.mago)?.nome || (d.mago ? "Mago selecionado" : "Sem mago")}`,
        ),
      );
      button.append(
        portrait,
        text,
        make(
          "span",
          String(d._id) === select.value ? "✓" : "",
          "deck-selection-check",
        ),
      );
      button.disabled = select.disabled;
      button.onclick = () => {
        if (select.disabled) return;
        select.value = String(d._id);
        select.dispatchEvent(
          new doc.defaultView.Event("change", { bubbles: true }),
        );
        dialog.close();
      };
      list.append(button);
    }
  }
  trigger.onclick = () => {
    if (!trigger.disabled) {
      sync();
      dialog.showModal();
    }
  };
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => trigger.focus());
  select.addEventListener("change", () => {
    remember();
    sync();
  });
  return {
    sync,
    selected,
    remember,
    setCatalog(catalog) {
      cards = new Map(catalog.map((c) => [c.numeroCatalogo, c]));
      sync();
    },
    setDecks(next, requested) {
      const current = select.value;
      decks = next;
      select.replaceChildren(
        ...decks.map((d) => {
          const option = make("option", d.nome);
          option.value = String(d._id);
          return option;
        }),
      );
      let saved;
      try {
        saved = storage?.getItem(key);
      } catch {}
      const exists = (id) => decks.some((d) => String(d._id) === id);
      select.value =
        [requested, saved, current].find(exists) ||
        String(
          decks.find((d) => d.cartas.length === 40 && d.mago)?._id ||
            decks[0]?._id ||
            "",
        );
      remember();
      sync();
    },
  };
}
