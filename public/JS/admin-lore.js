import { api, navbar, node, message } from "./auth.js";
import { initializeAdminShell, setAdminAccess } from "./admin-shell.js";
initializeAdminShell("lore");
import { renderLoreArticle, lorePath } from "./lore-view.js";

const $ = (id) => document.getElementById(id);
let entries = [],
  cards = [],
  current = null,
  dirty = false,
  busy = false,
  loadId = 0;
function markDirty() {
  dirty = true;
  $("story-state").textContent = "Há alterações não salvas.";
}
function fill(entry) {
  current = entry;
  dirty = false;
  const content = entry.draft;
  $("story-title").value = content.titulo;
  $("story-subtitle").value = content.subtitulo || "";
  $("story-category").value = content.categoria;
  $("story-summary").value = content.resumo || "";
  $("story-text").value = content.texto || "";
  $("story-source").value = content.fonteURL || "";
  $("story-slug").value = entry.slug;
  $("story-slug").readOnly = entry.version > 0;
  for (const option of $("story-cards").options)
    option.selected = content.cartas.includes(option.value);
  $("unpublish-story").hidden = !entry.published;
  $("story-public-link").hidden = !entry.published;
  $("story-public-link").href = lorePath(entry.slug);
  $("story-state").textContent = entry.published
    ? JSON.stringify(entry.draft) === JSON.stringify(entry.published)
      ? "Versão publicada. Nenhuma alteração em rascunho."
      : "Há um rascunho salvo. A versão publicada continua no ar."
    : entry.version
      ? "Rascunho salvo. Somente administradores podem vê-lo."
      : "Nova história. Ainda não foi salva.";
  $("story-select").value = entry.slug;
}
function content() {
  return {
    titulo: $("story-title").value.trim(),
    subtitulo: $("story-subtitle").value.trim(),
    resumo: $("story-summary").value.trim(),
    categoria: $("story-category").value,
    texto: $("story-text").value.trim(),
    cartas: [...$("story-cards").selectedOptions].map((o) => o.value),
    fonteURL: $("story-source").value.trim(),
  };
}
function refreshList() {
  $("story-select").replaceChildren(
    ...entries.map((entry) => {
      const option = node(
        "option",
        `${entry.titulo}${entry.publicado ? "" : " · Rascunho"}`,
      );
      option.value = entry.slug;
      return option;
    }),
  );
}
function canLeave() {
  return !dirty || confirm("Há alterações não salvas. Deseja descartá-las?");
}
function setBusy(value) {
  busy = value;
  for (const element of $("lore-form").elements) element.disabled = value;
  $("new-story").disabled = value;
  $("story-select").disabled = value;
}
async function open(slug) {
  const request = ++loadId;
  setBusy(true);
  try {
    const { entry } = await api("/admin/lore/" + encodeURIComponent(slug));
    if (request === loadId) fill(entry);
  } catch (error) {
    message(error.message, true);
    $("story-select").value = current?.slug || "";
  } finally {
    if (request === loadId) setBusy(false);
  }
}
async function save(action) {
  if (busy || !current || !$("lore-form").reportValidity()) return;
  const draft = content();
  if (action === "publish" && (!draft.resumo || !draft.texto)) {
    message("Preencha o resumo e a história antes de publicar.", true);
    return;
  }
  setBusy(true);
  try {
    const slug = $("story-slug").value.trim();
    const { entry } = await api("/admin/lore/" + encodeURIComponent(slug), {
      method: "PUT",
      body: JSON.stringify({
        content: draft,
        expectedVersion: current.version,
        action,
      }),
    });
    const summary = {
      slug: entry.slug,
      titulo: entry.draft.titulo,
      publicado: !!entry.published,
    };
    const index = entries.findIndex((e) => e.slug === entry.slug);
    if (index < 0) entries.push(summary);
    else entries[index] = summary;
    entries.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
    refreshList();
    fill(entry);
    message(
      action === "publish"
        ? "História publicada."
        : action === "unpublish"
          ? "História retirada do ar. Seu rascunho foi preservado."
          : "Rascunho salvo. A versão pública não foi alterada.",
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
}
$("lore-form").oninput = markDirty;
$("story-title").addEventListener("input", () => {
  if (!current?.version && !$("story-slug").dataset.manual)
    $("story-slug").value = $("story-title")
      .value.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
      .replace(/-$/, "");
});
$("story-slug").oninput = () => {
  $("story-slug").dataset.manual = "true";
};
$("story-select").onchange = () => {
  const slug = $("story-select").value;
  if (canLeave()) void open(slug);
  else $("story-select").value = current?.slug || "";
};
$("new-story").onclick = () => {
  if (!canLeave() || busy) return;
  ++loadId;
  delete $("story-slug").dataset.manual;
  fill({
    slug: "",
    version: 0,
    published: null,
    draft: {
      titulo: "",
      subtitulo: "",
      resumo: "",
      categoria: "personagem",
      texto: "",
      cartas: [],
      fonteURL: "",
    },
  });
  $("story-title").focus();
};
$("lore-form").onsubmit = (event) => {
  event.preventDefault();
  void save("publish");
};
$("save-draft").onclick = () => void save("draft");
$("unpublish-story").onclick = () => void save("unpublish");
$("preview-story").onclick = () => {
  const draft = content();
  renderLoreArticle($("lore-preview-article"), {
    ...draft,
    cards: cards.filter((card) => draft.cartas.includes(card.numeroCatalogo)),
  });
  $("lore-preview").showModal();
};
$("close-preview").onclick = () => $("lore-preview").close();
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
void (async () => {
  const user = await navbar();
  if (!setAdminAccess(user)) {
    $("editor-status").textContent =
      "Esta área é exclusiva de administradores.";
    return;
  }
  try {
    const result = await api("/admin/lore");
    entries = result.entries;
    cards = result.cards;
    $("story-cards").replaceChildren(
      ...cards.map((card) => {
        const option = node("option", `#${card.numeroCatalogo} · ${card.nome}`);
        option.value = card.numeroCatalogo;
        return option;
      }),
    );
    refreshList();
    $("editor-status").hidden = true;
    $("lore-editor-layout").hidden = false;
    if (entries.length) await open(entries[0].slug);
    else $("new-story").click();
  } catch (error) {
    $("editor-status").textContent = error.message;
  }
})();
