import { api, token, navbar, message, node } from "./auth.js";
import { cardTile, describe } from "./card-view.js";
import { createCardInspector } from "./card-inspection.js";
const inspector = createCardInspector();
import { createDeckNavigation } from "./deck-navigation.js";
import {
  renderDeckAppearance,
  normalizeAppearance,
} from "./deck-appearance.js";
let catalog = [],
  byId = new Map(),
  decks = [],
  current = null,
  dirty = false;
const rules = { Tropa: 3, Feitico: 3, Estrutura: 2, Armamento: 2, Mago: 1 };
const $ = (id) => document.getElementById(id);
const navigation = createDeckNavigation(
  document.querySelector(".workspace"),
  $("deck-mobile-nav"),
);
$("browse-cards").onclick = () => navigation.show("cards");
function fresh() {
  return {
    localId: crypto.randomUUID(),
    nome: "Meu baralho",
    cartas: [],
    mago: null,
    icone: "/assets/icons/neutro.svg",
    verso: "common",
    revisao: 0,
  };
}
function persistLocal() {
  // Rascunhos ficam separados da conta e nunca são enviados automaticamente.
  localStorage.setItem(
    "ztcg:drafts",
    JSON.stringify(decks.filter((d) => !d._id)),
  );
  if (current)
    sessionStorage.setItem("ztcg:editor-draft", JSON.stringify(current));
}
function edited() {
  dirty = true;
  persistLocal();
  renderDeck();
  renderList();
}
function select(deck) {
  Object.assign(deck, normalizeAppearance(deck));
  current = deck;
  dirty = false;
  $("deck-name").value = current.nome;
  renderDeck();
  renderList();
}
function renderList() {
  $("deck-list").replaceChildren(
    ...decks.map((d) => {
      const button = node(
        "button",
        "",
        d === current ? "deck-choice selected" : "deck-choice",
      );
      button.append(
        node("strong", d.nome),
        node(
          "span",
          `${d.cartas.length}/40 · ${d._id ? "Na conta" : "Local"}`,
          "muted",
        ),
      );
      const icon = document.createElement("img");
      icon.src = normalizeAppearance(d).icone;
      icon.alt = "";
      icon.className = "deck-list-icon";
      button.prepend(icon);
      button.onclick = () => {
        if (
          dirty &&
          !confirm(
            "Trocar de baralho? As alterações ficam guardadas nesta aba, mas ainda não foram salvas na conta.",
          )
        )
          return;
        select(d);
        navigation.show("editor");
      };
      return button;
    }),
  );
}
function validity() {
  const errors = [];
  if (current.cartas.length !== 40)
    errors.push(`Faltam ${40 - current.cartas.length} cartas.`);
  if (!current.mago || byId.get(current.mago)?.tipo !== "Mago")
    errors.push("Escolha um mago.");
  if (current.mago && !byId.get(current.mago)?.publicado)
    errors.push("O mago está em rascunho.");
  const counts = new Map();
  for (const id of current.cartas) {
    const c = byId.get(id);
    if (!c) {
      errors.push(`Carta ${id} não encontrada.`);
      continue;
    }
    if (!c.publicado) errors.push("Há cartas em rascunho.");
    if (c.tipo === "Mago") errors.push("Retire magos das 40 cartas.");
    const n = (counts.get(id) || 0) + 1;
    counts.set(id, n);
    if (n > rules[c.tipo]) errors.push(`${c.nome}: cópias acima do limite.`);
  }
  return [...new Set(errors)];
}
function renderDeck() {
  if (!current) return;
  renderDeckAppearance($("deck-appearance"), current, () => {
    edited();
  });
  $("deck-count").textContent = `${current.cartas.length} / 40`;
  $("mobile-deck-count").textContent = `${current.cartas.length}/40`;
  $("mobile-deck-context").textContent =
    `${current.nome} · ${current.cartas.length}/40 cartas · ${current.mago ? "Mago escolhido" : "Escolha um mago"}`;
  $("progress").value = current.cartas.length;
  $("save-status").textContent = dirty
    ? "Alterações não salvas"
    : current._id
      ? "Salvo na conta"
      : "Rascunho local";
  const mage = byId.get(current.mago);
  $("mage-slot").replaceChildren(node("span", "MAGO PRINCIPAL", "eyebrow"));
  if (mage) {
    const tile = cardTile(mage, details);
    $("mage-slot").append(tile);
    const clear = node("button", "Remover mago", "quiet");
    clear.onclick = () => {
      current.mago = null;
      edited();
    };
    $("mage-slot").append(clear);
  } else
    $("mage-slot").append(node("p", "Selecione um mago no catálogo.", "muted"));
  const counts = new Map();
  for (const id of current.cartas) counts.set(id, (counts.get(id) || 0) + 1);
  const rows = [...counts]
    .sort(([a], [b]) =>
      (byId.get(a)?.nome || a).localeCompare(byId.get(b)?.nome || b),
    )
    .map(([id, count]) => {
      const card = byId.get(id),
        row = node("div", "", "deck-row"),
        open = node(
          "button",
          card?.nome || `Carta desconhecida ${id}`,
          "quiet",
        );
      open.onclick = () => card && details(card);
      const minus = node("button", "−", "quantity");
      minus.setAttribute("aria-label", `Remover ${card?.nome || id}`);
      minus.onclick = () => {
        const i = current.cartas.indexOf(id);
        if (i >= 0) current.cartas.splice(i, 1);
        edited();
      };
      const plus = node("button", "+", "quantity");
      plus.setAttribute("aria-label", `Adicionar ${card?.nome || id}`);
      plus.onclick = () => card && add(card);
      row.append(open, minus, node("span", String(count)), plus);
      return row;
    });
  $("deck-cards").replaceChildren(...rows);
  const summaries = ["Tropa", "Feitico", "Estrutura", "Armamento"].map(
    (type) =>
      `${type === "Feitico" ? "Feitiços" : type}: ${current.cartas.filter((id) => byId.get(id)?.tipo === type).length}`,
  );
  $("deck-summary").textContent = summaries.join(" · ");
  const errors = validity();
  $("deck-validity").textContent = errors.length
    ? errors.join(" ")
    : "Pronto para jogar. Salve e entre na fila.";
  $("play").disabled = !!errors.length;
  renderList();
}
function add(card) {
  if (!current) return;
  if (card.tipo === "Mago") current.mago = card.numeroCatalogo;
  else {
    if (current.cartas.length >= 40) {
      message("O baralho já tem 40 cartas.", true);
      return;
    }
    if (
      current.cartas.filter((id) => id === card.numeroCatalogo).length >=
      rules[card.tipo]
    ) {
      message(`Máximo de ${rules[card.tipo]} cópias de ${card.nome}.`, true);
      return;
    }
    current.cartas.push(card.numeroCatalogo);
  }
  message("");
  edited();
}
function details(card) {
  $("detail-name").textContent = card.nome;
  $("detail-text").textContent =
    describe(card) +
    (!card.publicado
      ? "\n\nEsta carta pode ser usada em rascunhos, mas ainda não está liberada para partidas."
      : "");
  $("detail-image").src = card.imgURL || "/assets/avatar.png";
  $("detail-image").alt = card.nome;
  $("detail-image").tabIndex = 0;
  $("detail-image").setAttribute("role", "button");
  $("detail-image").setAttribute(
    "aria-label",
    `Ver somente a imagem de ${card.nome}`,
  );
  $("detail-image").style.cursor = "zoom-in";
  $("detail-image").onclick = () => inspector.art(card, $("card-detail"));
  $("detail-image").onkeydown = (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      inspector.art(card, $("card-detail"));
    }
  };
  $("detail-image").onerror = () => {
    $("detail-image").onerror = null;
    $("detail-image").src = "/assets/avatar.png";
  };
  $("detail-add").onclick = () => add(card);
  $("card-detail").showModal();
}
function renderCatalog() {
  const text = $("search").value.toLocaleLowerCase("pt-BR"),
    type = $("type").value,
    element = $("element").value,
    status = $("published").value;
  const filtered = catalog.filter(
    (c) =>
      (!type || c.tipo === type) &&
      (!element || c.elemento === element) &&
      (!status || c.publicado === (status === "yes")) &&
      (
        c.nome +
        " " +
        c.descricao +
        " " +
        c.habilidadesAtivas.map((h) => h.nome).join(" ")
      )
        .toLocaleLowerCase("pt-BR")
        .includes(text),
  );
  $("catalog-count").textContent = `${filtered.length} cartas`;
  $("card-list").replaceChildren(...filtered.map((c) => cardTile(c, details)));
}
async function save() {
  if (!current) return;
  current.nome = $("deck-name").value.trim();
  if (!current.nome) throw new Error("Dê um nome ao baralho.");
  if (!token()) {
    persistLocal();
    dirty = false;
    renderDeck();
    message(
      "Rascunho salvo neste navegador. Entre para salvar na conta e jogar.",
    );
    return;
  }
  const { deck } = await api(
    current._id ? `/decks/${current._id}` : "/decks/user",
    {
      method: current._id ? "PUT" : "POST",
      body: JSON.stringify({
        nome: current.nome,
        cartas: current.cartas,
        mago: current.mago,
        icone: current.icone,
        verso: current.verso,
        publico: current.publico === true,
        revisao: current.revisao || 0,
      }),
    },
  );
  Object.assign(current, deck);
  dirty = false;
  persistLocal();
  renderDeck();
  message("Baralho salvo na sua conta.");
}
async function busy(id, callback) {
  const button = $(id);
  button.disabled = true;
  try {
    await callback();
  } catch (e) {
    message(e.message, true);
  } finally {
    button.disabled = false;
    renderDeck();
  }
}
$("save-deck").onclick = () => busy("save-deck", save);
$("play").onclick = () =>
  busy("play", async () => {
    if (!token()) throw new Error("Entre na conta para jogar.");
    await save();
    location.href = `/HTML/index.html?deck=${encodeURIComponent(current._id)}`;
  });
$("deck-name").oninput = () => {
  current.nome = $("deck-name").value;
  edited();
};
$("new-deck").onclick = () => {
  const deck = fresh();
  decks.push(deck);
  select(deck);
  persistLocal();
  navigation.show("cards");
};
$("delete-deck").onclick = () =>
  busy("delete-deck", async () => {
    if (!confirm(`Excluir ${current.nome}?`)) return;
    if (current._id) await api(`/decks/${current._id}`, { method: "DELETE" });
    decks = decks.filter((d) => d !== current);
    if (!decks.length) decks.push(fresh());
    select(decks[0]);
    persistLocal();
  });
$("starter").onclick = () => {
  const mage = catalog.find((c) => c.publicado && c.tipo === "Mago"),
    troops = catalog.filter((c) => c.publicado && c.tipo === "Tropa"),
    spells = catalog.filter((c) => c.publicado && c.tipo === "Feitico");
  if (!mage || troops.length < 14) {
    message(
      "Ainda não há cartas publicadas suficientes para montar o exemplo.",
      true,
    );
    return;
  }
  const deck = fresh();
  deck.nome = "Primeira expedição";
  deck.mago = mage.numeroCatalogo;
  for (const c of spells)
    for (let i = 0; i < 3 && deck.cartas.length < 12; i++)
      deck.cartas.push(c.numeroCatalogo);
  for (const c of troops) {
    for (let i = 0; i < 3 && deck.cartas.length < 40; i++)
      deck.cartas.push(c.numeroCatalogo);
  }
  decks.push(deck);
  select(deck);
  edited();
  navigation.show("editor");
};
$("export-deck").onclick = () => {
  const blob = new Blob(
      [
        JSON.stringify(
          {
            nome: current.nome,
            cartas: current.cartas,
            mago: current.mago,
            icone: current.icone,
            verso: current.verso,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = "baralho-zacornia.json";
  link.click();
  URL.revokeObjectURL(url);
};
function reference(value) {
  const ref =
    typeof value === "object" && value
      ? (value.numeroCatalogo ?? value.id)
      : value;
  if (
    typeof value === "object" &&
    value &&
    Number(ref) === 98 &&
    /m[eé]dico/i.test(value.nome ?? value.name ?? "")
  )
    return "900098";
  if (!/^\d{1,6}$/.test(String(ref)))
    throw new Error("Referência de carta inválida.");
  return String(ref).padStart(3, "0");
}
$("import-deck").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100000) throw new Error("JSON muito grande.");
    const data = JSON.parse(await file.text());
    if (
      !Array.isArray(data.cartas) ||
      data.cartas.length > 40 ||
      typeof data.nome !== "string"
    )
      throw new Error("JSON de baralho inválido.");
    const deck = fresh();
    deck.nome = data.nome.slice(0, 80);
    deck.cartas = data.cartas.map(reference);
    deck.mago = data.mago ? reference(data.mago) : null;
    Object.assign(deck, normalizeAppearance(data));
    decks.push(deck);
    select(deck);
    edited();
    navigation.show("editor");
    message("Importado como rascunho. Salve para validar no servidor.");
  } catch (e) {
    message(e.message, true);
  } finally {
    e.target.value = "";
  }
};
for (const id of ["search", "type", "element", "published"])
  $(id).addEventListener("input", renderCatalog);
$("close-detail").onclick = () => $("card-detail").close();
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    persistLocal();
    e.preventDefault();
    e.returnValue = "";
  }
});
async function load() {
  await navbar();
  try {
    const { cards } = await api("/cards");
    catalog = cards;
    byId = new Map(cards.map((c) => [c.numeroCatalogo, c]));
    try {
      decks = JSON.parse(localStorage.getItem("ztcg:drafts") || "[]");
      if (!Array.isArray(decks)) decks = [];
    } catch {
      decks = [];
    }
    if (token()) {
      const data = await api("/decks");
      decks = [...data.decks, ...decks];
    }
    if (!decks.length) decks.push(fresh());
    const selected = localStorage.getItem("ztcg:selected-deck");
    let pending;
    try {
      pending = JSON.parse(
        sessionStorage.getItem("ztcg:editor-draft") || "null",
      );
    } catch {
      pending = null;
    }
    const accountDeck =
      pending?._id && decks.find((d) => d._id === pending._id);
    if (pending && (!pending._id || accountDeck)) {
      if (accountDeck && accountDeck.revisao !== pending.revisao)
        message(
          "Existe um rascunho antigo nesta aba. Confira antes de salvar; o servidor impedirá sobrescrever outra revisão.",
          true,
        );
      const i = decks.findIndex((d) =>
        pending._id ? d._id === pending._id : d.localId === pending.localId,
      );
      if (i >= 0) decks[i] = pending;
      else decks.push(pending);
      select(pending);
    } else select(decks.find((d) => d._id === selected) || decks[0]);
    renderCatalog();
  } catch (e) {
    message(e.message, true);
    $("card-list").append(
      node(
        "p",
        "Não foi possível carregar o catálogo. Confira o servidor e recarregue a página.",
        "muted",
      ),
    );
  }
}
void load();
