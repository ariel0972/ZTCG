import { node } from "./auth.js";
// Presentation only: choices and the outcome always come from the server.
export function createCoinToss(
  host = document.body,
  { onChoose = () => {}, getViewerId = () => undefined } = {},
) {
  const doc = host.ownerDocument;
  const overlay = node("section", "", "coin-toss");
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Quem começa a partida");
  const panel = node("div", "", "coin-toss__panel");
  panel.tabIndex = -1;
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const available = [...buttons.children].filter(
      (b) => !buttons.hidden && !b.disabled,
    );
    event.preventDefault();
    if (!available.length) panel.focus();
    else {
      const at = available.indexOf(doc.activeElement);
      available[
        (at + (event.shiftKey ? -1 : 1) + available.length) % available.length
      ].focus();
    }
  });
  const heading = node("h2", "Cara ou coroa");
  const message = node("p");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  const choices = node("div", "", "coin-toss__choices");
  const coin = node("div", "", "coin-toss__coin");
  coin.setAttribute("aria-hidden", "true");
  const disc = node("div", "", "coin-toss__disc");
  disc.append(
    node("span", "CARA", "coin-toss__face coin-toss__face--heads"),
    node("span", "COROA", "coin-toss__face coin-toss__face--tails"),
  );
  coin.append(disc);
  const buttons = node("div", "", "coin-toss__buttons");
  let pending = false,
    lastKey,
    lastActive,
    revealTimer,
    revealed = false,
    resultText = "",
    canChooseNow = false;
  for (const [face, label] of [
    ["heads", "Cara"],
    ["tails", "Coroa"],
  ]) {
    const button = node("button", label);
    button.type = "button";
    button.dataset.face = face;
    button.onclick = async () => {
      if (pending || button.disabled) return;
      pending = true;
      for (const b of buttons.children) b.disabled = true;
      try {
        await onChoose(face);
      } finally {
        pending = false;
        for (const b of buttons.children) b.disabled = !canChooseNow;
      }
    };
    buttons.append(button);
  }
  panel.append(heading, message, choices, coin, buttons);
  overlay.append(panel);
  host.append(overlay);
  return {
    update(state) {
      const toss = state?.coinToss;
      const visible =
        !!toss && state.status === "ACTIVE" && state.phase === "COIN_TOSS";
      if (!visible) {
        if (!overlay.hidden) {
          overlay.hidden = true;
          lastKey = undefined;
          clearTimeout(revealTimer);
          revealed = false;
          delete overlay.dataset.focusKey;
          lastActive?.isConnected && lastActive.focus?.();
        }
        return;
      }
      if (overlay.hidden) {
        lastActive = doc.activeElement;
        overlay.hidden = false;
        panel.focus();
      }
      const name = (id) =>
        state.players.find((p) => p.id === id)?.nome || "Jogador";
      choices.replaceChildren();
      for (const p of state.players) {
        const face = toss.choices?.[p.id];
        choices.append(
          node(
            "p",
            name(p.id) +
              ": " +
              (face === "heads"
                ? "Cara"
                : face === "tails"
                  ? "Coroa"
                  : "Aguardando escolha"),
          ),
        );
      }
      const key = state.id + ":" + (toss.result || "choosing");
      coin.dataset.result = toss.result || "heads";
      coin.hidden = !toss.result;
      if (key !== lastKey) {
        clearTimeout(revealTimer);
        revealed = !!doc.defaultView?.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        if (toss.result && !revealed)
          revealTimer = setTimeout(() => {
            revealed = true;
            message.textContent = resultText;
          }, 1800);
        coin.classList.toggle("coin-toss__coin--spinning", !!toss.result);
        lastKey = key;
      }
      const canChoose = !toss.result && toss.chooserId === getViewerId();
      canChooseNow = canChoose;
      buttons.hidden = !canChoose;
      for (const button of buttons.children)
        button.disabled = pending || !canChoose;
      resultText =
        (toss.result === "heads" ? "Cara" : "Coroa") +
        " · " +
        name(toss.winnerId) +
        " começa a partida.";
      message.textContent = toss.result
        ? revealed
          ? resultText
          : "A moeda está girando…"
        : canChoose
          ? "Escolha sua face. O oponente fica com a outra."
          : "Aguardando " + name(toss.chooserId) + " escolher.";
      if (canChoose && key !== overlay.dataset.focusKey) {
        buttons.firstElementChild?.focus();
        overlay.dataset.focusKey = key;
      }
    },
    close() {
      clearTimeout(revealTimer);
      overlay.remove();
    },
  };
}
