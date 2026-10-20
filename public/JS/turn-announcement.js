export function createTurnAnnouncement(arena, banner) {
  let key, timer;
  const win = arena.ownerDocument.defaultView;
  return {
    update(state, userId) {
      const battle = state.status === "ACTIVE" && state.phase === "BATTLE";
      arena.dataset.activeSide = battle
        ? state.current === userId
          ? "me"
          : "enemy"
        : "";
      if (!battle) {
        banner.hidden = true;
        win.clearTimeout(timer);
        key = undefined;
        return;
      }
      const next = `${state.id}:${state.turn}:${state.current}`;
      if (next === key) return;
      key = next;
      win.clearTimeout(timer);
      banner.textContent =
        state.current === userId ? "Seu turno" : "Turno do oponente";
      banner.hidden = false;
      banner.getAnimations?.().forEach((a) => a.cancel());
      if (!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
        banner.animate?.(
          [
            { transform: "translateX(-90vw)", opacity: 0 },
            { transform: "translateX(0)", opacity: 1, offset: 0.22 },
            { transform: "translateX(0)", opacity: 1, offset: 0.76 },
            { transform: "translateX(90vw)", opacity: 0 },
          ],
          { duration: 2800, easing: "ease-in-out" },
        );
      timer = win.setTimeout(() => {
        banner.hidden = true;
      }, 2800);
    },
    close() {
      win.clearTimeout(timer);
      banner.hidden = true;
    },
  };
}
