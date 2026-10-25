// Sequence numbers survive persistence and prevent replay on reconnect.
import { createBattleEffects } from "./battle-effects.js";
import { createCardTransfers } from "./card-transfers.js";
export function createBattleEvents(
  host = document.body,
  { getViewerId = () => undefined, noticeDurationMs = 3200 } = {},
) {
  const effects = createBattleEffects(host);
  const transfers = createCardTransfers(host);
  const panel = document.createElement("section");
  panel.className = "battle-events";
  panel.setAttribute("aria-label", "Últimas jogadas");
  panel.setAttribute("aria-live", "polite");
  host.append(panel);
  let matchId,
    sequence = 0;
  const timers = new Map();
  const pending = [];
  let lastFadeAt = 0;
  let nextVisualAt = 0;
  const visualTimers = new Set();
  function showFieldEffect(event) {
    if (
      !["damage", "block", "mana", "heal", "elementalReaction"].includes(
        event.kind,
      )
    )
      return;
    if (host.ownerDocument.hidden) return;
    const now = Date.now();
    const at = Math.max(now, nextVisualAt);
    nextVisualAt = at + 60;
    if (at === now) effects.show(event);
    else {
      const timer = setTimeout(() => {
        visualTimers.delete(timer);
        effects.show(event);
      }, at - now);
      visualTimers.add(timer);
    }
  }
  function remove(item) {
    for (const timer of timers.get(item) ?? []) clearTimeout(timer);
    timers.delete(item);
    item.remove();
    if (pending.length && panel.children.length < 6) show(pending.shift());
  }
  function clear() {
    for (const timer of visualTimers) clearTimeout(timer);
    visualTimers.clear();
    nextVisualAt = 0;
    pending.length = 0;
    for (const item of timers.keys()) remove(item);
    lastFadeAt = 0;
  }
  const labels = {
    draw: "Comprou uma carta",
    summon: "Entrou em campo",
    spell: "Feitiço usado",
    attack: "Atacou",
    death: "Foi para o cemitério",
    passive: "Passiva ativada",
    ability: "Habilidade usada",
    block: "Ataque impedido",
    reaction: "Ataque devolvido",
    damage: "Dano recebido",
    notice: "Aviso",
    mount: "Montaria",
    mana: "Mana recuperada",
    heal: "Vida recuperada",
    elementalReaction: "Reação elemental",
  };
  function show(event) {
    if (event.kind === "zoneTransfer") return;
    if (panel.children.length >= 6) {
      pending.push(event);
      // The full history remains available even during a long burst.
      if (pending.length > 40) pending.shift();
      return;
    }
    const card = event.card;
    const item = document.createElement("div");
    item.className = `battle-event battle-event--${event.kind}`;
    const owner = event.originOwnerId ?? card.ownerId,
      viewer = getViewerId();
    item.dataset.side =
      !viewer || !owner ? "neutral" : owner === viewer ? "me" : "enemy";
    const image = document.createElement("img");
    if (card.imgURL) image.src = card.imgURL;
    image.alt = "";
    image.decoding = "async";
    const text = document.createElement("span");
    text.textContent =
      (event.kind === "draw"
        ? card.nome === "Carta comprada"
          ? "Comprou uma carta."
          : "Comprou: " + card.nome
        : "") ||
      event.summary ||
      (["attack", "block"].includes(event.kind) && event.message
        ? event.message
        : `${labels[event.kind] || "Carta usada"} · ${card.nome}${event.message ? " · " + event.message : ""}`);
    if (card.imgURL) item.append(image);
    item.append(text);
    panel.append(item);
    const now = Date.now();
    lastFadeAt = Math.min(
      now + noticeDurationMs + 2750,
      Math.max(now + noticeDurationMs, lastFadeAt + 550),
    );
    const fade = setTimeout(
      () => item.classList.add("battle-event--leaving"),
      lastFadeAt - now,
    );
    const end = setTimeout(() => remove(item), lastFadeAt - now + 650);
    timers.set(item, [fade, end]);
    // Locate by exact ID without interpolating user-controlled CSS selectors.
    const face = [...document.querySelectorAll("[data-live-card-id]")].find(
      (el) => el.dataset.liveCardId === card.id,
    );
    if (
      face &&
      event.kind !== "damage" &&
      event.kind !== "elementalReaction" &&
      event.kind !== "block" &&
      event.kind !== "mana" &&
      event.kind !== "heal" &&
      !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      face.animate?.(
        [
          { filter: "brightness(1.7)", transform: "translateY(-5px)" },
          { filter: "brightness(1)", transform: "translateY(0)" },
        ],
        { duration: 750 },
      );
    }
  }
  return {
    capture() {
      transfers.capture();
    },
    notify(event) {
      show(event);
      showFieldEffect(event);
    },
    update(snapshot) {
      const events = snapshot.events || [];
      if (snapshot.id !== matchId) {
        matchId = snapshot.id;
        sequence = events.at(-1)?.sequence || 0;
        clear();
        effects.reset();
        transfers.reset();
        transfers.capture();
        return;
      }
      const fresh = events.filter((e) => e.sequence > sequence);
      if (!fresh.length) return;
      sequence = fresh.at(-1).sequence;
      // Keep field feedback for every hit, even when the toast list is capped.
      for (const event of fresh) {
        showFieldEffect(event);
        transfers.show(event);
      }
      for (const event of fresh) {
        show(event);
      }
    },
    close() {
      clear();
      effects.close();
      transfers.close();
      panel.remove();
    },
  };
}
