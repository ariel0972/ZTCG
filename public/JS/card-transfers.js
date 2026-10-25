// Animates authoritative zone transfers; hidden draws already arrive as card backs.
export function createCardTransfers(host = document.body) {
  const doc = host.ownerDocument,
    win = doc.defaultView;
  const layer = doc.createElement("div");
  layer.className = "card-transfer-layer";
  layer.setAttribute("aria-hidden", "true");
  host.append(layer);
  let cards = new Map(),
    slots = new Map(),
    zones = new Map(),
    nextAt = 0;
  const active = new Map(),
    queued = new Set();
  const zoneKey = (owner, zone) => owner + ":" + zone;
  const rect = (node) => {
    if (!node) return undefined;
    const r = node.getBoundingClientRect();
    return r.width && r.height
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : undefined;
  };
  function capture() {
    cards = new Map(
      [...doc.querySelectorAll("[data-live-card-id]")].map((n) => [
        n.dataset.liveCardId,
        rect(n),
      ]),
    );
    slots = new Map(
      [...doc.querySelectorAll("[data-slot-id]")].map((n) => [
        n.dataset.slotId,
        rect(n),
      ]),
    );
    zones = new Map(
      [...doc.querySelectorAll("[data-card-zone][data-zone-owner]")].map(
        (n) => [zoneKey(n.dataset.zoneOwner, n.dataset.cardZone), rect(n)],
      ),
    );
  }
  function zone(owner, type) {
    return [...doc.querySelectorAll("[data-card-zone][data-zone-owner]")].find(
      (n) => n.dataset.cardZone === type && n.dataset.zoneOwner === owner,
    );
  }
  function remove(node) {
    clearTimeout(active.get(node));
    active.delete(node);
    node.remove();
  }
  function point(r) {
    const w = win?.innerWidth || 1024,
      h = win?.innerHeight || 768;
    return {
      x: Math.max(8, Math.min(w - 80, r.left + r.width / 2 - 35)),
      y: Math.max(8, Math.min(h - 110, r.top + r.height / 2 - 49)),
    };
  }
  function play(event, start) {
    const move = event.movement;
    if (!move || doc.hidden) return;
    const destination = zone(move.toOwnerId, move.to);
    const face =
      move.to === "hand"
        ? [...doc.querySelectorAll("[data-live-card-id]")].find(
            (n) => n.dataset.liveCardId === event.card.id,
          )
        : undefined;
    const endRect = rect(face) || rect(destination);
    if (!start || !endRect) return;
    while (active.size >= 12) remove(active.keys().next().value);
    const card = doc.createElement("div");
    card.className = "card-transfer";
    card.dataset.transfer = move.to === "hand" ? "draw" : "graveyard";
    const image = doc.createElement("img");
    image.alt = "";
    image.src = event.card.imgURL || "/assets/card-backs/common.png";
    const label = doc.createElement("span");
    label.textContent = move.to === "hand" ? "+1 carta" : "Cemitério";
    card.append(image, label);
    const a = point(start),
      b = point(endRect);
    for (const [key, value] of Object.entries({
      fromX: a.x,
      fromY: a.y,
      toX: b.x,
      toY: b.y,
      midX: (a.x + b.x) / 2,
      midY: Math.max(8, (a.y + b.y) / 2 - 45),
    }))
      card.style.setProperty("--" + key, value + "px");
    if (win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      card.classList.add("card-transfer--still");
    layer.append(card);
    active.set(
      card,
      setTimeout(() => remove(card), 1100),
    );
    card.addEventListener("animationend", () => remove(card), { once: true });
  }
  function reset() {
    for (const t of queued) clearTimeout(t);
    queued.clear();
    for (const n of [...active.keys()]) remove(n);
    cards.clear();
    slots.clear();
    zones.clear();
    nextAt = 0;
  }
  return {
    capture,
    show(event) {
      const m = event.movement;
      if (!m || doc.hidden) return;
      const start =
        cards.get(event.card.id) ||
        slots.get(m.fromSlotId) ||
        zones.get(zoneKey(m.fromOwnerId, m.from)) ||
        rect(zone(m.fromOwnerId, m.from));
      const now = Date.now(),
        at = Math.min(now + 1200, Math.max(now, nextAt));
      nextAt = at + 110;
      if (at === now) play(event, start);
      else {
        const t = setTimeout(() => {
          queued.delete(t);
          play(event, start);
        }, at - now);
        queued.add(t);
      }
    },
    reset,
    close() {
      reset();
      layer.remove();
    },
  };
}
