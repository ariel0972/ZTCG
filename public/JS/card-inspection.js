import { node } from "./auth.js";
import { describe } from "./card-view.js";

// A inspeção é independente das ações: também funciona na vez do adversário.
export function createCardInspector({ reactions = () => ({}) } = {}) {
  const preview = node("aside", "", "card-preview");
  preview.hidden = true;
  preview.setAttribute("aria-hidden", "true");
  const dialog = node("dialog", "", "card-inspection");
  dialog.setAttribute("aria-label", "Detalhes da carta");
  const close = node("button", "Fechar", "quiet");
  close.type = "button";
  close.onclick = () => dialog.close();
  const content = node("div", "", "inspection-content");
  dialog.append(close, content);
  document.body.append(preview, dialog);
  const artwork = node("dialog", "", "card-artwork");
  artwork.setAttribute("aria-label", "Imagem completa da carta");
  const artworkClose = node("button", "Fechar", "quiet");
  artworkClose.type = "button";
  const artworkImage = document.createElement("img");
  artwork.append(artworkClose, artworkImage);
  document.body.append(artwork);
  let returnToDetails = null;
  artworkClose.onclick = () => artwork.close();
  artwork.addEventListener("close", () => {
    if (returnToDetails) {
      const source = returnToDetails;
      returnToDetails = null;
      source.showModal();
    }
  });
  function art(card, sourceDialog = dialog) {
    hide();
    returnToDetails = sourceDialog.open ? sourceDialog : null;
    if (sourceDialog.open) sourceDialog.close();
    artworkImage.src = card.imgURL || "/assets/avatar.png";
    artworkImage.alt = card.nome;
    artworkImage.onerror = () => {
      artworkImage.onerror = null;
      artworkImage.src = "/assets/avatar.png";
    };
    if (!artwork.open) artwork.showModal();
  }
  let timer, touchTimer, activeElement;

  function fill(host, card) {
    const image = document.createElement("img");
    image.src = card.imgURL || "/assets/avatar.png";
    image.alt = card.nome;
    image.onerror = () => {
      image.onerror = null;
      image.src = "/assets/avatar.png";
    };
    const details = node("div", "", "inspection-details");
    details.append(
      node("h2", card.nome),
      node("p", describe(card), "inspection-description"),
    );
    if (card.hpAtual !== undefined && card.hp !== undefined)
      details.append(
        node("p", `Vida atual: ${card.hpAtual}`, "inspection-live"),
      );
    if (card.attacked)
      details.append(node("p", "Ataque já utilizado neste turno."));
    if (card.usedAbility)
      details.append(node("p", "Habilidade já utilizada nesta rodada."));
    if (card.statuses?.length) {
      details.append(node("h3", "Efeitos ativos"));
      for (const status of card.statuses)
        details.append(
          node(
            "p",
            `${status.nome}${status.valor === undefined ? "" : ` · intensidade ${status.valor}`} · ${status.turnosRestantes} ${status.unidade === "turno" ? "turno(s)" : "rodada(s)"}`,
          ),
        );
    }
    host.replaceChildren(image, details);
    if (host === content) {
      const imageButton = node("button", "", "inspection-image");
      imageButton.type = "button";
      imageButton.setAttribute(
        "aria-label",
        `Ver somente a imagem de ${card.nome}`,
      );
      imageButton.onclick = () => art(card);
      image.replaceWith(imageButton);
      imageButton.append(image);
    }
    for (const name of [
      ...(card.statuses || []).map((s) => s.nome),
      card.appliedElement,
    ]) {
      const info = reactions()[name === "Congelado" ? "Congelar" : name];
      if (info) details.append(node("p", `${name}: ${info.description}`));
    }
  }
  function hide() {
    clearTimeout(timer);
    clearTimeout(touchTimer);
    preview.hidden = true;
    activeElement = null;
  }
  function inspect(card) {
    hide();
    fill(content, card);
    if (!dialog.open) dialog.showModal();
  }
  function show(element, card) {
    if (
      !element.isConnected ||
      document.querySelector("dialog[open]") ||
      document.getElementById("card-menu")?.hidden === false ||
      document.getElementById("selection-help")?.hidden === false ||
      document.body.classList.contains("dragging-card")
    )
      return;
    activeElement = element;
    fill(preview, card);
    preview.hidden = false;
    const rect = element.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    preview.style.width = `${width}px`;
    const left =
      rect.right + width + 18 <= window.innerWidth
        ? rect.right + 12
        : Math.max(12, rect.left - width - 12);
    preview.style.left = `${left}px`;
    preview.style.top = `${Math.max(12, Math.min(rect.top, window.innerHeight - preview.offsetHeight - 12))}px`;
  }
  function bind(element, card) {
    element.dataset.inspectable = "true";
    element.title =
      "Botão direito para ampliar. Pressione I ou segure no celular para ver detalhes.";
    element.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      clearTimeout(timer);
      timer = setTimeout(() => show(element, card), 160);
    });
    element.addEventListener("pointerleave", hide);
    element.addEventListener("focus", () => show(element, card));
    element.addEventListener("blur", hide);
    element.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        inspect(card);
      }
    });
    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch")
        touchTimer = setTimeout(() => {
          element.dataset.longPress = "true";
          inspect(card);
        }, 450);
    });
    for (const event of ["pointerup", "pointercancel", "pointermove"])
      element.addEventListener(event, () => clearTimeout(touchTimer));
    element.addEventListener(
      "click",
      (event) => {
        if (element.dataset.longPress) {
          delete element.dataset.longPress;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      inspect(card);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  // Renderizações substituem os nós das cartas; não deixam uma prévia antiga presa na tela.
  const observer = new MutationObserver(() => {
    if (
      preview.ownerDocument.querySelector("dialog[open]") ||
      (activeElement && !activeElement.isConnected)
    )
      hide();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  return { bind, inspect, hide, art };
}
