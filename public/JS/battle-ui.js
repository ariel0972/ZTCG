import { node } from "./auth.js";
import { labels } from "./card-view.js";

export function attackValue(card, slot, slots = []) {
  if (card.tipo === "Estrutura") return card.ataque || 0;
  const positions =
    slot?.kind === "Mago"
      ? ["back-left", "back-right"]
      : slot?.column === 0
        ? ["front-left"]
        : slot?.column === 2
          ? ["front-right"]
          : [];
  return (
    (card.ataque || 0) +
    (card.bonusAtaquePassivo || 0) +
    slots
      .filter(
        (s) =>
          s.ownerId === slot?.ownerId &&
          positions.some((p) => s.id.endsWith(`:${p}`)),
      )
      .reduce((n, s) => n + (s.card?.bonusAtaque || 0), 0)
  );
}
export function cardFace(
  card,
  { slot, slots, hand = false, previous, reactions = {} } = {},
) {
  const face = node("div", "", "live-card");
  face.dataset.element = card.elemento || "Neutro";
  if (card.id) face.dataset.liveCardId = card.id;
  const art = node("div", "", "live-art");
  const img = document.createElement("img");
  img.src = card.imgURL || "/assets/avatar.png";
  img.alt = "";
  img.draggable = false;
  img.onerror = () => {
    img.onerror = null;
    img.src = "/assets/avatar.png";
  };
  // As imagens do catálogo são cartas completas. Mostra apenas a janela da
  // ilustração, preservando sua proporção, sem repetir números impressos.
  if (/\/Cards\//i.test(card.imgURL || "")) {
    const ns = "http://www.w3.org/2000/svg";
    const crop = document.createElementNS(ns, "svg");
    crop.setAttribute("viewBox", "210 210 580 510");
    crop.setAttribute("preserveAspectRatio", "xMidYMid meet");
    crop.setAttribute("aria-hidden", "true");
    const illustration = document.createElementNS(ns, "image");
    illustration.setAttribute("width", "1000");
    illustration.setAttribute("height", "1400");
    illustration.setAttribute("preserveAspectRatio", "none");
    illustration.setAttribute("href", card.imgURL);
    illustration.addEventListener("error", () => art.replaceChildren(img));
    crop.append(illustration);
    art.append(crop);
  } else art.append(img);
  const heading = node("div", "", "live-heading");
  heading.append(
    node("span", card.nome, "live-name"),
    node("span", String(card.custoMana), "live-cost"),
  );
  const stats = node("div", "", "live-stats");
  function stat(value, type, label) {
    const badge = node("span", String(value), `live-stat ${type}`);
    badge.setAttribute("aria-label", `${label}: ${value}`);
    badge.title = `${label}: ${value}`;
    badge.dataset.value = String(value);
    if (previous?.[type] !== undefined && previous[type] !== String(value))
      badge.classList.add("changed");
    stats.append(badge);
    return badge;
  }
  if (card.hp !== undefined) {
    const attack = attackValue(card, slot, slots);
    stat(attack, "attack", "Ataque").classList.toggle(
      "buffed",
      attack > (card.ataque || 0),
    );
    stat(card.hpAtual ?? card.hp, "health", "Vida atual").classList.toggle(
      "damaged",
      (card.hpAtual ?? card.hp) < card.hp,
    );
  } else if (card.tipo === "Armamento") {
    stat(`+${card.bonusAtaque || 0}`, "attack", "Bônus de ataque");
    stat(`+${card.bonusHp || 0}`, "health", "Bônus de vida");
  } else
    stats.append(
      node("span", card.assinatura ? "Assinatura" : "Feitiço", "spell-label"),
    );
  const effects = node("div", "", "live-effects");
  if (card.fireDamageBonus) {
    const tag = node("span", `Fogo +${card.fireDamageBonus}`, "effect-token");
    tag.title = `Bônus permanente de dano dos feitiços de Fogo: +${card.fireDamageBonus}`;
    tag.setAttribute("aria-label", tag.title);
    effects.append(tag);
  }
  const symbols = {
    Envenenado: "☠",
    Queimado: "♨",
    Sangrando: "♦",
    Congelado: "❄",
    Escudo: "◈",
    Incapacitado: "⊘",
    Atordoado: "✦",
    Cego: "◉",
  };
  for (const status of card.statuses || []) {
    const tag = node(
      "span",
      `${symbols[status.nome] || "✧"} ${status.turnosRestantes}`,
      "effect-token",
    );
    tag.title = `${status.nome} · ${status.turnosRestantes} ${status.unidade === "turno" ? "turno(s)" : "rodada(s)"}`;
    const reaction =
      reactions[status.nome === "Congelado" ? "Congelar" : status.nome];
    if (reaction) tag.title += ` · ${reaction.description}`;
    tag.setAttribute("aria-label", tag.title);
    effects.append(tag);
  }
  const footer = node(
    "div",
    `${labels[card.tipo] || card.tipo}${card.elemento ? " · " + (labels[card.elemento] || card.elemento) : ""}`,
    "live-type",
  );
  const usage = node("div", "", "live-usage");
  if (card.attacked) usage.append(node("span", "Ataque usado", "usage-token"));
  if (card.usedAbility)
    usage.append(node("span", "Habilidade usada", "usage-token"));
  face.append(art, heading, effects, footer, stats, usage);
  face.classList.toggle("hand-card", hand);
  return face;
}

// Apenas sugestões visuais. O servidor continua validando cada ação.
export function dropAction(source, slot, state, userId) {
  if (
    !source ||
    state.status !== "ACTIVE" ||
    (slot.terrain?.nome === "Lama" &&
      source.type === "play" &&
      source.card.tipo === "Tropa")
  )
    return null;
  const own = slot.ownerId === userId,
    card = source.card;
  if (source.type === "play") {
    if (card.tipo === "Feitico") {
      const target = card.alvo;
      if (
        (["UnicoAliado", "CampoAliado"].includes(target) && !own) ||
        ([
          "UnicoInimigo",
          "MultiplosInimigos",
          "CampoInimigo",
          "TodosInimigos",
          "TodasTropasInimigas",
        ].includes(target) &&
          own)
      )
        return null;
      if (["Deck", "Cemiterio"].includes(target)) return null;
      if (target === "Estrutura" && !slot.structure) return null;
      if (
        ![
          "CampoAliado",
          "CampoInimigo",
          "Global",
          "TodosInimigos",
          "TodasTropasInimigas",
        ].includes(target) &&
        !slot.card &&
        !slot.structure
      )
        return null;
      return "play";
    }
    if (!own) return null;
    if (card.tipo === "Estrutura")
      return slot.kind === "Tropa" &&
        slot.card?.tipo === "Tropa" &&
        !slot.structure
        ? "play"
        : null;
    if (slot.card) return null;
    if (card.tipo === "Tropa")
      return !state.players.find((p) => p.id === userId).combatStarted &&
        (slot.kind === "Tropa" ||
          (slot.kind === "Armamento" &&
            card.palavrasChave.includes("Flanquear")))
        ? "play"
        : null;
    return card.tipo === "Armamento" && slot.kind === "Armamento"
      ? "play"
      : null;
  }
  if (source.slot?.ownerId !== userId) return null;
  if (own)
    return card.tipo === "Tropa" &&
      source.slot.kind === "Tropa" &&
      slot.kind === "Tropa" &&
      !slot.card &&
      slot.id !== source.slot.id &&
      !slot.terrain &&
      (state.phase === "PREPARATION" ||
        (card.palavrasChave.includes("Campo livre") && !card.moved))
      ? "move"
      : null;
  if (source.slot.attackTargets) {
    const kind = card.tipo === "Estrutura" ? "structure" : "card";
    return source.slot.attackTargets[kind]?.includes(slot.id) ? "attack" : null;
  }
  if (
    state.phase === "PREPARATION" ||
    card.attacked ||
    !["Tropa", "Mago", "Estrutura"].includes(card.tipo) ||
    slot.kind !== "Tropa"
  )
    return null;
  if (
    card.tipo === "Mago" &&
    state.slots.some((s) => s.ownerId === userId && s.card?.tipo === "Tropa")
  )
    return null;
  const direction =
    card.tipo === "Mago" ? "Universal" : card.direcaoAtaque || "Frente";
  const difference = Math.abs(slot.column - (2 - source.slot.column));
  return (direction === "Frente" && difference !== 0) ||
    (direction === "Diagonal" && difference !== 1) ||
    (direction === "Universal" && difference > 1)
    ? null
    : "attack";
}

export function bindCardDrag(
  element,
  { source, canStart, actionFor, onDrop, onDrag },
) {
  let start,
    ghost,
    active = false,
    suppressed = false;
  const clean = () => {
    ghost?.remove();
    ghost = null;
    active = false;
    start = null;
    document.body.classList.remove("dragging-card");
    document
      .querySelectorAll(".drop-ready, .drop-over")
      .forEach((el) => el.classList.remove("drop-ready", "drop-over"));
  };
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !canStart()) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    element.setPointerCapture?.(event.pointerId);
  });
  element.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.id) return;
    if (
      !active &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) < 9
    )
      return;
    if (!active) {
      active = true;
      onDrag?.();
      ghost = element.cloneNode(true);
      ghost.className = "drag-ghost";
      ghost.removeAttribute("id");
      ghost.setAttribute("aria-hidden", "true");
      document.body.append(ghost);
      document.body.classList.add("dragging-card");
      document.querySelectorAll("[data-slot-id]").forEach((el) => {
        if (actionFor(source, el.dataset.slotId))
          el.classList.add("drop-ready");
      });
    }
    event.preventDefault();
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    document
      .querySelectorAll(".drop-over")
      .forEach((el) => el.classList.remove("drop-over"));
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-slot-id]");
    if (target && actionFor(source, target.dataset.slotId))
      target.classList.add("drop-over");
  });
  element.addEventListener("pointerup", (event) => {
    if (!active) {
      clean();
      return;
    }
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-slot-id]");
    const id = target?.dataset.slotId,
      action = id && actionFor(source, id);
    suppressed = true;
    clean();
    if (action) onDrop(source, id, action, event);
    setTimeout(() => {
      suppressed = false;
    }, 0);
  });
  element.addEventListener("pointercancel", clean);
  element.addEventListener("lostpointercapture", clean);
  element.addEventListener(
    "click",
    (event) => {
      if (suppressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}
