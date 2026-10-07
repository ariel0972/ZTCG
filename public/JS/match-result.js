export function createMatchResult(dialog) {
  let shownMatch;
  return {
    update(state, userId, beforeOpen) {
      if (state.status !== "FINISHED") {
        shownMatch = undefined;
        if (dialog.open) dialog.close();
        return;
      }
      const outcome = !state.winner
        ? "draw"
        : state.winner === userId
          ? "win"
          : "loss";
      dialog.dataset.outcome = outcome;
      dialog.querySelector("#result-title").textContent = {
        win: "Vitória!",
        loss: "Derrota",
        draw: "Empate",
      }[outcome];
      dialog.querySelector("#result-symbol").textContent = {
        win: "✦",
        loss: "◇",
        draw: "⚖",
      }[outcome];
      dialog.querySelector("#result-reason").textContent =
        state.reason || "A partida terminou.";
      if (shownMatch === state.id) return;
      shownMatch = state.id;
      beforeOpen();
      dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
