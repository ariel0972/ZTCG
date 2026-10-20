// Short, bounded effects; the server identifies the actual reaction and damage.
const reactions = {
  Lava: { key: "lava", icon: "♨", color: "#ff8b47" },
  Vapor: { key: "vapor", icon: "☁", color: "#c1efff" },
  Lama: { key: "lama", icon: "●", color: "#c69b68" },
  Erosão: { key: "erosao", icon: "◇", color: "#e3c09b" },
  Explosão: { key: "explosao", icon: "✹", color: "#ffcf69" },
  Congelar: { key: "congelar", icon: "❄", color: "#95dcff" },
  Zarconizado: { key: "zarconizado", icon: "ϟ", color: "#d3adff" },
  Florescer: { key: "florescer", icon: "✿", color: "#a6e79c" },
};

export function createBattleEffects(host = document.body) {
  const doc = host.ownerDocument,
    win = doc.defaultView;
  const layer = doc.createElement("div");
  layer.className = "battle-effects-layer";
  // The corresponding toast announces the result to screen readers.
  layer.setAttribute("aria-hidden", "true");
  host.append(layer);
  const active = new Map(),
    animations = new Set();
  function remove(effect) {
    clearTimeout(active.get(effect)?.timer);
    active.delete(effect);
    effect.remove();
  }
  function reset() {
    for (const effect of active.keys()) remove(effect);
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
  function reduced() {
    return !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }
  function place(effect, rect) {
    const width = Math.min(180, rect.width + 24),
      height = Math.min(220, rect.height + 30);
    effect.style.left = `${Math.max(4, Math.min(rect.left - 12, (win?.innerWidth ?? rect.right) - width - 4))}px`;
    effect.style.top = `${Math.max(4, rect.top - 15)}px`;
    effect.style.width = `${width}px`;
    effect.style.height = `${height}px`;
  }
  function reposition() {
    // Only active effects are updated, on scroll/resize, without a render loop.
    const positions = [...active].map(([effect, entry]) => ({
      effect,
      anchor: entry.anchor,
      rect: entry.anchor.getBoundingClientRect(),
    }));
    for (const { effect, anchor, rect } of positions) {
      if (
        !anchor.isConnected ||
        rect.bottom < 0 ||
        rect.top > (win?.innerHeight ?? Infinity)
      )
        remove(effect);
      else place(effect, rect);
    }
  }
  win?.addEventListener("resize", reposition);
  win?.addEventListener("scroll", reposition, { capture: true, passive: true });
  function target(event) {
    return (
      [...doc.querySelectorAll("[data-live-card-id]")].find(
        (el) => el.dataset.liveCardId === event.card?.id,
      ) ??
      [...doc.querySelectorAll("[data-slot-id]")].find(
        (el) => el.dataset.slotId === event.slotId,
      )
    );
  }
  function flash(face, variant, color) {
    if (reduced() || !face?.animate) return;
    const shield = variant === "resistance" || variant === "mana";
    const animation = face.animate(
      [
        { transform: "translateX(0)", boxShadow: `0 0 0 2px ${color}` },
        {
          offset: 0.2,
          transform: shield ? "scale(.96)" : "translateX(-4px)",
          boxShadow: `0 0 22px ${color}`,
        },
        {
          offset: 0.42,
          transform: shield ? "scale(1.02)" : "translateX(4px)",
          boxShadow: `0 0 12px ${color}`,
        },
        { transform: "translateX(0)", boxShadow: "0 0 0 transparent" },
      ],
      { duration: 950, easing: "ease-out" },
    );
    while (animations.size >= 16) {
      const oldest = animations.values().next().value;
      oldest.cancel();
      animations.delete(oldest);
    }
    animations.add(animation);
    animation.finished?.then(
      () => animations.delete(animation),
      () => animations.delete(animation),
    );
  }
  return {
    show(event) {
      if (doc.hidden) return;
      const reaction =
        event.kind === "elementalReaction" && reactions[event.reaction];
      const damage = ["damage", "block"].includes(event.kind) && event.damage;
      const mana = event.kind === "mana" && event.mana;
      if (
        !reaction &&
        (!mana || !Number.isFinite(mana.amount) || mana.amount <= 0) &&
        (!damage || !Number.isFinite(damage.amount) || damage.amount < 0)
      )
        return;
      const anchor = target(event);
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.bottom < 0 || rect.top > (win?.innerHeight ?? Infinity)) return;
      const modifiers = damage?.modifiers ?? [];
      const weak = modifiers.includes("weakness"),
        resist = modifiers.includes("resistance");
      const variant = reaction
        ? reaction.key
        : mana
          ? "mana"
          : weak && resist
            ? "mixed"
            : weak
              ? "weakness"
              : resist
                ? "resistance"
                : "damage";
      const color = reaction
        ? reaction.color
        : mana
          ? "#7cd8ff"
          : weak
            ? "#ff9b85"
            : resist
              ? "#91dfed"
              : "#ffd2cd";
      const icon = reaction
        ? reaction.icon
        : mana
          ? "✦"
          : resist && !weak
            ? "⬡"
            : weak
              ? "✹"
              : "";
      const name = reaction
        ? event.reaction
        : weak && resist
          ? "Fraqueza + resistência"
          : weak
            ? "Fraqueza"
            : resist
              ? "Resistência"
              : "";
      const effect = doc.createElement("div");
      effect.className = `battle-effect battle-effect--${variant}`;
      effect.dataset.kind = reaction ? "reaction" : mana ? "mana" : "damage";
      effect.dataset.anchor = event.card?.id || event.slotId || "";
      const simultaneous = [...active.keys()].filter(
        (other) => other.dataset.anchor === effect.dataset.anchor,
      ).length;
      effect.style.setProperty(
        "--label-offset",
        `${Math.min(5, simultaneous) * 30}px`,
      );
      effect.style.setProperty("--effect-color", color);
      place(effect, rect);
      if (reduced()) effect.classList.add("battle-effect--still");
      const wash = doc.createElement("span");
      wash.className = "battle-effect__wash";
      effect.append(wash);
      if (!reduced())
        for (let i = 0; i < 6; i++) {
          const particle = doc.createElement("span");
          particle.className = "battle-effect__particle";
          const angle = (i * Math.PI) / 3;
          particle.style.setProperty(
            "--dx",
            `${Math.round(Math.cos(angle) * 38)}px`,
          );
          particle.style.setProperty(
            "--dy",
            `${Math.round(Math.sin(angle) * 34)}px`,
          );
          particle.style.setProperty("--delay", `${i * 35}ms`);
          effect.append(particle);
        }
      const symbol = doc.createElement("span");
      symbol.className = "battle-effect__symbol";
      symbol.textContent = icon;
      const label = doc.createElement("span");
      label.className = "battle-effect__label";
      label.textContent = reaction
        ? name
        : mana
          ? `+${mana.amount} mana`
          : `${name ? name + " · " : ""}${damage.amount === 0 ? "Bloqueado" : "−" + damage.amount}`;
      label.title = event.summary || event.message || (reaction ? name : "");
      if (damage?.element && name && !label.title)
        label.title = `${name} a ${damage.element === "Agua" ? "Água" : damage.element}`;
      effect.append(symbol, label);
      while (active.size >= 12) remove(active.keys().next().value);
      layer.append(effect);
      active.set(effect, {
        anchor,
        timer: setTimeout(() => remove(effect), 3450),
      });
      if (damage || mana) flash(anchor, variant, color);
    },
    reset,
    close() {
      reset();
      win?.removeEventListener("resize", reposition);
      win?.removeEventListener("scroll", reposition, true);
      layer.remove();
    },
  };
}
