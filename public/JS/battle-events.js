// Sequence numbers survive persistence and prevent replay on reconnect.
export function createBattleEvents(host = document.body) {
  const panel = document.createElement("section");
  panel.className = "battle-events";
  panel.setAttribute("aria-label", "Últimas jogadas");
  panel.setAttribute("aria-live", "polite");
  host.append(panel);
  let matchId,
    sequence = 0;
  const timers = new Set();
  const labels = {
    summon: "Entrou em campo",
    spell: "Feitiço usado",
    attack: "Atacou",
    death: "Foi para o cemitério",
    passive: "Passiva ativada",
    ability: "Habilidade usada",
    block: "Ataque impedido",
  };
  function show(event) {
    const card = event.card;
    const item = document.createElement("div");
    item.className = `battle-event battle-event--${event.kind}`;
    const image = document.createElement("img");
    if (card.imgURL) image.src = card.imgURL;
    image.alt = "";
    image.decoding = "async";
    const text = document.createElement("span");
    text.textContent = `${labels[event.kind] || "Carta usada"} · ${card.nome}${event.message ? " · " + event.message : ""}`;
    item.append(image, text);
    panel.append(item);
    while (panel.children.length > 5) panel.firstElementChild.remove();
    const timer = setTimeout(() => {
      item.remove();
      timers.delete(timer);
    }, 6500);
    timers.add(timer);
    // Locate by exact ID without interpolating user-controlled CSS selectors.
    const face = [...document.querySelectorAll("[data-live-card-id]")].find(
      (el) => el.dataset.liveCardId === card.id,
    );
    if (
      face &&
      !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      face.animate?.(
        [
          { filter: "brightness(1.7)", transform: "translateY(-5px)" },
          { filter: "brightness(1)", transform: "translateY(0)" },
        ],
        { duration: 450 },
      );
    }
  }
  return {
    notify(event) {
      show(event);
    },
    update(snapshot) {
      const events = snapshot.events || [];
      if (snapshot.id !== matchId) {
        matchId = snapshot.id;
        sequence = events.at(-1)?.sequence || 0;
        panel.replaceChildren();
        return;
      }
      const fresh = events.filter((e) => e.sequence > sequence);
      if (!fresh.length) return;
      sequence = fresh.at(-1).sequence;
      for (const event of fresh.slice(-5)) {
        show(event);
      }
    },
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      panel.remove();
    },
  };
}
