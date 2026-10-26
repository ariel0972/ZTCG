import { setImageSource } from "./image-sources.js";
import { node } from "./auth.js";
import { fieldRulesDescription } from "./card-view.js";
import { renderRuleFields } from "./battle-ui.js";
const legacyCards = {
  tornado: { nome: "Furacão", imgURL: "/assets/Cards/Furacão.png" },
  arrowRain: {
    nome: "Chuva de Flechas",
    imgURL: "/assets/Cards/Chuva de Flechas.png",
  },
  sandstorm: {
    nome: "Furacão de Areia",
    imgURL: "/assets/Cards/Furacão de Areia.png",
  },
};
export function createOngoingSpells(ownHost, enemyHost) {
  const doc = ownHost.ownerDocument;
  const divider = doc.querySelector(".arena-divider");
  const fieldHost = divider ? node("div", "", "active-field-effects") : null;
  if (fieldHost) divider.append(fieldHost);
  const dialog = node("dialog", "", "ongoing-spell-dialog");
  dialog.setAttribute("aria-label", "Feitiço ativo em campo");
  const heading = node("h2"),
    close = node("button", "Fechar", "quiet"),
    image = node("img"),
    details = node("div", "", "ongoing-spell-details");
  const header = node("div", "", "ongoing-spell-heading");
  close.type = "button";
  close.autofocus = true;
  close.onclick = () => dialog.close();
  header.append(heading, close);
  dialog.append(header, image, details);
  doc.body.append(dialog);
  let active = new Map(),
    selected;
  dialog.addEventListener("close", () => {
    selected = undefined;
  });
  function describe(effect) {
    heading.textContent = effect.card.nome;
    setImageSource(
      image,
      effect.card.imgURL || "/assets/card-backs/common.png",
    );
    image.alt = effect.card.nome;
    details.replaceChildren(
      node("p", `Ativado por ${effect.ownerName}`),
      node(
        "strong",
        effect.rules
          ? fieldRulesDescription(effect.rules)
          : effect.field
            ? `${effect.damage} de dano após cada ataque no campo de ${effect.affectedName}`
            : `${effect.damage} de dano no fim de cada rodada`,
        "ongoing-spell-damage",
      ),
      node("p", `${effect.rounds} rodada(s) restante(s)`),
      node(
        "small",
        effect.rules
          ? "Efeito global; vale para os dois jogadores. Uma nova cópia renova a duração sem acumular descontos."
          : effect.ignoreResistance
            ? "Ignora resistência. Fraquezas, escudos e estruturas continuam funcionando."
            : "Dano base do efeito. Fraquezas, resistências e proteções são aplicadas a cada alvo.",
        "muted",
      ),
    );
    if (effect.field && !effect.rules)
      details.append(
        node(
          "p",
          "Reações automáticas: " +
            effect.reactions
              .map(
                (r) =>
                  `${r.elemento === "Agua" ? "Água" : r.elemento}: ${r.remover ? "remove o efeito" : "multiplica o dano por " + r.multiplicador}`,
              )
              .join("; "),
        ),
        node(
          "p",
          "O ataque muda apenas o golpe atual. Feitiços dos dois jogadores alteram o dano pelo restante da duração.",
        ),
      );
  }
  return {
    update(state, viewerId) {
      renderRuleFields(state, doc);
      active = new Map();
      ownHost.replaceChildren();
      enemyHost.replaceChildren();
      fieldHost?.replaceChildren();
      const sources = state.players.flatMap((p) => [
        ...(p.graveyard || []),
        ...(p.banished || []),
        ...(p.forgotten || []),
      ]);
      for (const spell of [
        ...(state.ongoingSpells || []),
        ...(state.fieldEffects || []).map((f) => ({ ...f, field: true })),
        ...(state.ruleFields || []).map((f) => ({ ...f, field: true })),
      ]) {
        if (spell.rounds <= 0) continue;
        const card = spell.card ||
          sources.find((c) => c.id === spell.id) ||
          legacyCards[spell.kind] || {
            nome: "Feitiço ativo",
            imgURL: "/assets/card-backs/common.png",
          };
        const effect = {
          ...spell,
          card,
          ownerName:
            state.players.find((p) => p.id === spell.ownerId)?.nome ||
            "Jogador",
          affectedName:
            state.players.find((p) => p.id === spell.affectedOwnerId)?.nome ||
            "oponente",
        };
        active.set(spell.id, effect);
        const mine = spell.ownerId === viewerId,
          button = node("button", "", "ongoing-spell-card"),
          art = node("img"),
          counter = node("span", spell.rounds, "ongoing-spell-counter");
        button.type = "button";
        if (spell.field) button.classList.add("field-effect-card");
        button.dataset.side = mine ? "me" : "enemy";
        button.setAttribute(
          "aria-label",
          `${card.nome}, ${mine ? "seu efeito" : "efeito do oponente"}: ${spell.rules ? "efeito global" : spell.damage + " de dano"}, ${spell.rounds} rodada(s) restante(s). Ver detalhes.`,
        );
        setImageSource(art, card.imgURL || "/assets/card-backs/common.png");
        art.alt = "";
        button.append(art, counter, node("small", card.nome));
        button.onclick = () => {
          selected = spell.id;
          describe(active.get(spell.id));
          dialog.showModal();
        };
        (spell.field && fieldHost
          ? fieldHost
          : mine
            ? ownHost
            : enemyHost
        ).append(button);
      }
      divider?.classList.toggle(
        "has-field-effects",
        !!fieldHost?.children.length,
      );
      if (fieldHost) fieldHost.hidden = !fieldHost.children.length;
      ownHost.hidden = !ownHost.children.length;
      enemyHost.hidden = !enemyHost.children.length;
      if (selected) {
        const effect = active.get(selected);
        if (effect) describe(effect);
        else
          details.replaceChildren(node("p", "Este efeito terminou.", "muted"));
      }
    },
  };
}
