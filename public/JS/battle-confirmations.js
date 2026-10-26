import { node } from "./auth.js";
export function availableAttackCount(state, userId) {
  if (
    !state ||
    state.phase !== "BATTLE" ||
    state.status !== "ACTIVE" ||
    state.current !== userId ||
    state.paused ||
    state.pendingSpell ||
    state.pendingAttack ||
    state.pendingImpact ||
    state.pendingRevive ||
    state.pendingHandChoice
  )
    return 0;
  return state.slots
    .filter((s) => s.ownerId === userId)
    .reduce(
      (count, s) =>
        count +
        Object.values(s.attackTargets ?? {}).filter(
          (targets) => targets?.length,
        ).length,
      0,
    );
}
export function dismissCardMenu(target, selection) {
  return (
    !!selection &&
    !target.closest(
      "#card-menu, .board-slot, .battle-hand-card, .structure-action, .rider-action, dialog, .zone-pile, #graveyard-footer, #deck-zone-footer, #enemy-graveyard-footer, #enemy-deck-zone-footer",
    )
  );
}
export function createEndTurnConfirmation({ onConfirm }) {
  const dialog = node("dialog", "", "end-turn-confirmation");
  dialog.setAttribute("aria-labelledby", "end-turn-confirm-title");
  const title = node("h2", "Passar o turno sem usar os ataques restantes?");
  title.id = "end-turn-confirm-title";
  const text = node("p"),
    actions = node("div", "", "result-actions"),
    cancel = node("button", "Continuar jogando", "quiet"),
    confirm = node("button", "Sim, passar turno", "primary");
  cancel.type = confirm.type = "button";
  cancel.autofocus = true;
  actions.append(cancel, confirm);
  dialog.append(title, text, actions);
  document.body.append(dialog);
  let activeKey;
  const key = (state) =>
    state ? state.id + ":" + state.turn + ":" + state.version : undefined;
  cancel.onclick = () => dialog.close();
  confirm.onclick = () => {
    const expected = activeKey;
    dialog.close();
    onConfirm(expected);
  };
  dialog.addEventListener("close", () => {
    activeKey = undefined;
  });
  return {
    ask(state, count) {
      activeKey = key(state);
      text.textContent =
        count === 1
          ? "Uma carta sua ainda pode atacar. Você pode voltar ao campo ou encerrar o turno."
          : count +
            " cartas suas ainda podem atacar. Você pode voltar ao campo ou encerrar o turno.";
      if (!dialog.open) dialog.showModal();
    },
    update(state) {
      if (
        dialog.open &&
        (activeKey !== key(state) ||
          state.phase !== "BATTLE" ||
          state.status !== "ACTIVE" ||
          state.paused)
      )
        dialog.close();
    },
    matches(state, expected) {
      return key(state) === expected;
    },
  };
}
