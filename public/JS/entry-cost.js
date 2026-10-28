import { node } from "./auth.js";
import { cardTile, labels } from "./card-view.js";
export function entryCostRule(card) {
  return (
    card.custoEntrada ??
    (card.subtipo === "Invocação"
      ? {
          quantidade: 1,
          tiposCarta: ["Tropa", "Feitico"],
          origens: ["mao", "campo"],
          mesmoElemento: true,
        }
      : undefined)
  );
}
export function describeEntryCost(card) {
  const cost = entryCostRule(card);
  if (!cost) return "";
  const kinds = cost.tiposCarta.map((t) => labels[t] || t).join(" ou ");
  const element = cost.mesmoElemento
    ? "do mesmo elemento original (" +
      (labels[card.elemento] || card.elemento || "Neutro") +
      ")"
    : cost.elementos
      ? "de " + cost.elementos.map((e) => labels[e] || e).join(" ou ")
      : "de qualquer elemento";
  return (
    "Além da mana, escolha " +
    cost.quantidade +
    " carta(s) de " +
    kinds +
    ", " +
    element +
    ": " +
    cost.origens
      .map((o) => (o === "mao" ? "descartar da mão" : "sacrificar do campo"))
      .join(" ou ") +
    "."
  );
}
export function createMaterialChoice(host = document.body) {
  const doc = host.ownerDocument,
    dialog = node("dialog", "", "material-choice");
  dialog.setAttribute("aria-label", "Pagar custo de entrada");
  host.append(dialog);
  let active;
  const finish = (value) => {
    const request = active;
    active = undefined;
    if (dialog.open) dialog.close();
    request?.resolve(value);
  };
  dialog.addEventListener("cancel", () => finish(null));
  dialog.addEventListener("close", () => {
    if (active) finish(null);
  });
  return {
    choose(card, state) {
      if (active) return Promise.resolve(null);
      const cost = entryCostRule(card),
        picked = new Set();
      return new Promise((resolve) => {
        active = { resolve, matchId: state.id, version: state.version };
        dialog.classList.toggle(
          "material-choice--few",
          (card.materiaisEntrada?.length ?? 0) <= 2,
        );
        const title = node("h2", "Materiais para " + card.nome),
          help = node("p", describeEntryCost(card));
        const count = node("p", "", "material-count"),
          list = node("div", "", "material-options");
        count.setAttribute("role", "status");
        const confirm = node("button", "Confirmar e jogar", "primary"),
          cancel = node("button", "Cancelar", "quiet");
        confirm.type = cancel.type = "button";
        const update = () => {
          count.textContent =
            picked.size + " / " + cost.quantidade + " selecionadas";
          confirm.disabled = picked.size !== cost.quantidade;
        };
        for (const material of card.materiaisEntrada ?? []) {
          const wrapper = node("div", "", "material-option"),
            button = cardTile(material, () => {
              if (picked.has(material.id)) picked.delete(material.id);
              else if (picked.size < cost.quantidade) picked.add(material.id);
              button.setAttribute(
                "aria-pressed",
                String(picked.has(material.id)),
              );
              update();
            });
          button.setAttribute("aria-pressed", "false");
          wrapper.dataset.origin = material.origemMaterial;
          const check = node("span", "✓", "material-check");
          check.setAttribute("aria-hidden", "true");
          button.append(check);
          wrapper.append(
            button,
            node(
              "small",
              material.origemMaterial === "mao"
                ? "Descartar da mão"
                : "Sacrificar do campo",
            ),
          );
          list.append(wrapper);
        }
        confirm.onclick = () => finish([...picked]);
        cancel.onclick = () => finish(null);
        const heading = node("div", "", "material-heading"),
          actions = node("div", "", "material-actions");
        heading.append(title, help, count);
        actions.append(cancel, confirm);
        dialog.replaceChildren(heading, list, actions);
        update();
        dialog.showModal();
      });
    },
    update(state) {
      if (
        active &&
        (active.matchId !== state?.id ||
          active.version !== state.version ||
          state.status !== "ACTIVE" ||
          state.paused)
      )
        finish(null);
    },
    close() {
      finish(null);
      dialog.remove();
    },
  };
}
