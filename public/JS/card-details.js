import {
  labels,
  abilityDescription,
  abilityCost,
  passiveDescription,
} from "./card-view.js";

const paths = {
  mana: ["M9 3h6M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3", "M8 15h8"],
  life: [
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  ],
  attack: ["m14 3 7 0 0 7-11 11-7-7L14 3Z", "m3 21 5-5M3 14l7 7"],
  defense: ["M12 3 21 7v5c0 5-4 8-9 10-5-2-9-5-9-10V7l9-4Z"],
  weakness: [
    "M12 3 21 7v5c0 5-4 8-9 10-5-2-9-5-9-10V7l9-4Z",
    "m13 6-3 5 4 2-3 5",
  ],
  range: ["M4 12h16m-5-5 5 5-5 5"],
  recovery: ["M20 8a8 8 0 1 0 0 8", "M20 3v5h-5"],
};

// Shared by deck building and match/profile inspection; never renders catalog HTML.
export function renderCardDetails(host, card, { reactions = {} } = {}) {
  const doc = host.ownerDocument;
  const make = (tag, text = "", cls = "") => {
    const el = doc.createElement(tag);
    el.textContent = text;
    el.className = cls;
    return el;
  };
  function icon(kind) {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", `card-stat-icon card-stat-icon--${kind}`);
    for (const d of paths[kind]) {
      const path = doc.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }
  const root = make("div", "", "card-information"),
    intro = make("div", "", "card-information-type");
  intro.append(make("span", labels[card.tipo] || card.tipo, "card-info-pill"));
  if (card.elemento)
    intro.append(
      make("span", labels[card.elemento] || card.elemento, "card-info-pill"),
    );
  if (card.subtipo) intro.append(make("span", card.subtipo, "card-info-pill"));
  if (card.assinatura)
    intro.append(make("span", "Assinatura", "card-info-pill"));
  const toggle = make(
    "button",
    "Recolher informações",
    "quiet card-information-toggle",
  );
  toggle.type = "button";
  root.append(intro, toggle);
  const sections = [];
  function section(title, open = false, cls = "") {
    const details = make("details", "", `card-info-section ${cls}`),
      summary = make("summary", title),
      body = make("div", "", "card-info-section-body");
    details.open = open;
    details.append(summary, body);
    root.append(details);
    sections.push(details);
    details.addEventListener("toggle", updateToggle);
    return body;
  }
  function updateToggle() {
    const open = sections.some((s) => s.open);
    toggle.textContent = open ? "Recolher informações" : "Mostrar informações";
    toggle.setAttribute("aria-expanded", String(open));
  }
  toggle.onclick = () => {
    const open = !sections.some((s) => s.open);
    for (const s of sections) s.open = open;
    updateToggle();
  };
  const stats = section("Atributos", true),
    list = make("dl", "", "card-stat-list");
  function stat(kind, label, value) {
    const row = make("div", "", "card-stat-row"),
      term = make("dt", label, "card-stat-label"),
      description = make("dd", value);
    row.title = `${label}: ${value}`;
    row.append(icon(kind), term, description);
    list.append(row);
  }
  stat("mana", "Custo", `${card.custoMana ?? 0} mana`);
  if (card.hp !== undefined) {
    stat(
      "life",
      "Vida",
      card.hpAtual === undefined
        ? `${card.hp} PV`
        : `${card.hpAtual} / ${card.hp} PV`,
    );
    stat("attack", "Ataque", `${card.ataque ?? 0} de ataque`);
  }
  if (card.bonusAtaque !== undefined)
    stat("attack", "Bônus de ataque", `+${card.bonusAtaque} de ataque`);
  if (card.bonusHp !== undefined)
    stat("life", "Bônus de vida", `+${card.bonusHp} PV`);
  const elements = (values) => values.map((v) => labels[v] || v).join(", ");
  if (
    card.hp !== undefined ||
    card.resistencia?.length ||
    card.fraqueza?.length
  ) {
    stat(
      "defense",
      "Defesa / resistência",
      card.resistencia?.length
        ? `${elements(card.resistencia)} · dano ÷2`
        : "Sem resistência elemental",
    );
    stat(
      "weakness",
      "Fraqueza",
      card.fraqueza?.length
        ? `${elements(card.fraqueza)} · dano ×2`
        : "Sem fraqueza elemental",
    );
  }
  if (card.direcaoAtaque) stat("range", "Alcance", card.direcaoAtaque);
  if (card.manaGerada !== undefined)
    stat("recovery", "Mana gerada", `${card.manaGerada} mana por turno`);
  if (card.recuperacaoMana !== undefined)
    stat(
      "recovery",
      "Recuperação de mana",
      `${card.recuperacaoMana} mana por turno`,
    );
  stats.append(list);
  if (card.assinatura)
    stats.append(
      make("p", "Feitiço de assinatura: usa o limite separado do mago."),
    );
  if (card.fireDamageBonus !== undefined)
    stats.append(
      make(
        "p",
        `Bônus permanente de Fogo: +${card.fireDamageBonus} dano · ${card.fireSpellsCast || 0} feitiços de Fogo conjurados.`,
      ),
    );
  const indicators = (card.habilidadesPassivas || []).filter(
    (p) => p.gatilho === "onElementalReaction",
  );
  if (indicators.length) {
    const reactionSection = section(
      "Indicadores de reação",
      true,
      "card-info-section--reactions",
    );
    for (const indicator of indicators)
      reactionSection.append(
        make("h3", indicator.reacao?.nome || "Reação"),
        make("p", passiveDescription(indicator)),
      );
  }
  if (card.habilidadesAtivas?.length) {
    const active = section(
      "Habilidades ativas",
      true,
      "card-info-section--active",
    );
    active.append(
      make(
        "p",
        card.usedAbility
          ? "Habilidade já utilizada nesta rodada."
          : "Uma habilidade por carta a cada rodada.",
        "card-ability-hint",
      ),
    );
    for (const ability of card.habilidadesAtivas) {
      const entry = make("article", "", "card-active-ability"),
        heading = make("div", "", "card-ability-heading"),
        cost = make("span", "", "card-ability-cost");
      cost.title = `Custo da habilidade: ${abilityCost(ability)}`;
      cost.append(
        icon(ability.custoVida ? "life" : "mana"),
        make("span", abilityCost(ability)),
      );
      heading.append(make("h3", ability.nome), cost);
      entry.append(heading, make("p", abilityDescription(ability)));
      active.append(entry);
    }
  }
  if (
    card.descricao ||
    card.habilidadesPassivas?.length ||
    card.palavrasChave?.length ||
    card.publicado === false
  ) {
    const text = section("Descrição e passivas");
    if (card.descricao)
      text.append(make("p", card.descricao, "card-rules-text"));
    for (const passive of card.habilidadesPassivas || [])
      text.append(
        make("p", passiveDescription(passive), "card-passive-description"),
      );
    if (card.palavrasChave?.length)
      text.append(
        make("p", `Palavras-chave: ${card.palavrasChave.join(", ")}`),
      );
    if (card.publicado === false)
      text.append(
        make(
          "p",
          "Rascunho: esta carta ainda não está liberada para partidas.",
          "card-draft-note",
        ),
      );
  }
  if (card.attacked || card.statuses?.length || card.appliedElement) {
    const current = section("Estado em campo", true);
    if (card.attacked)
      current.append(make("p", "Ataque já utilizado neste turno."));
    for (const status of card.statuses || []) {
      current.append(
        make(
          "p",
          `${status.nome}${status.valor === undefined ? "" : ` · intensidade ${status.valor}`} · ${status.turnosRestantes} ${status.unidade === "turno" ? "turno(s)" : "rodada(s)"}`,
        ),
      );
    }
    for (const name of new Set(
      [...(card.statuses || []).map((s) => s.nome), card.appliedElement].filter(
        Boolean,
      ),
    )) {
      const info = reactions[name === "Congelado" ? "Congelar" : name];
      if (info) current.append(make("p", `${name}: ${info.description}`));
      else if (name === card.appliedElement)
        current.append(make("p", `Elemento aplicado: ${labels[name] || name}`));
    }
  }
  updateToggle();
  host.replaceChildren(root);
}
