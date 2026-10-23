export function responseMenuKey(state) {
  if (!state) return "";
  const choice = state.paused
    ? "paused"
    : state.pendingImpact
      ? "dodge:" + (state.pendingImpact.key ?? state.pendingImpact.cardId)
      : state.pendingRevive
        ? "revive:" + state.pendingRevive.id
        : state.pendingHandChoice
          ? "hand:" + state.pendingHandChoice.ownerId
          : state.pendingAttack
            ? "attack:" + state.pendingAttack.attackerId
            : state.pendingSpell
              ? "spell:" + state.pendingSpell.card.id
              : "reconnect";
  return (
    state.id + ":" + (state.responseDeadline ?? "reconnect") + ":" + choice
  );
}
export function dodgeChoiceTitle(state) {
  const id = state.pendingImpact?.cardId;
  const slot = state.slots?.find((s) =>
    [s.card, s.rider, s.structure].some((c) => c?.id === id),
  );
  const card = [slot?.card, slot?.rider, slot?.structure].find(
    (c) => c?.id === id,
  );
  const position =
    slot?.kind === "Tropa" ? " · espaço " + (slot.column + 1) : "";
  return (card?.nome ?? "Carta") + position + ": desviar?";
}
// Non-modal menus stay inside the field and can be folded to inspect the cards.
export function createFieldMenu(
  host,
  { label, content, revealOnOpen = false },
) {
  const doc = host.ownerDocument,
    menu = doc.createElement("details"),
    summary = doc.createElement("summary"),
    body = doc.createElement("div");
  menu.className = "field-menu";
  menu.hidden = true;
  summary.textContent = label;
  body.className = "field-menu-content";
  body.append(content);
  menu.append(summary, body);
  host.append(menu);
  let previousKey;
  return {
    update({ visible, key, label: title = label }) {
      menu.hidden = !visible;
      summary.textContent = title;
      menu.setAttribute("aria-label", title);
      if (!visible) {
        menu.open = false;
        previousKey = undefined;
        return;
      }
      if (key !== previousKey) {
        menu.open = true;
        if (revealOnOpen)
          menu.scrollIntoView?.({
            block: "nearest",
            inline: "nearest",
            behavior: doc.defaultView?.matchMedia?.(
              "(prefers-reduced-motion: reduce)",
            ).matches
              ? "auto"
              : "smooth",
          });
      }
      previousKey = key;
    },
    close() {
      menu.remove();
    },
  };
}

export function publicFieldNotice(state) {
  if (state.status !== "ACTIVE") return null;
  const player = (id) =>
    state.players.find((p) => p.id === id)?.nome || "Um jogador";
  let message;
  if (state.paused) message = "Aguardando a reconexão dos jogadores.";
  else if (state.pendingImpact)
    message = `${player(state.pendingImpact.ownerId)} está decidindo se desvia do golpe.`;
  else if (state.pendingHandChoice)
    message = `${player(state.pendingHandChoice.ownerId)} está escolhendo uma carta.`;
  else if (state.pendingRevive)
    message = `${player(state.pendingRevive.ownerId)} está escolhendo uma tropa e um espaço para reviver.`;
  else if (state.pendingAttack)
    message = "Aguardando a decisão de devolver ou receber o ataque.";
  else if (state.pendingSpell)
    message = `Aguardando resposta a ${state.pendingSpell.card.nome}.`;
  else if (state.phase === "PREPARATION")
    return {
      label: "Preparação dos jogadores",
      message:
        "Os jogadores estão preparando o campo. As mãos permanecem ocultas.",
      key: `${state.id}:preparation`,
    };
  else return null;
  return {
    label: "Turno pausado",
    message,
    key: responseMenuKey(state),
  };
}
