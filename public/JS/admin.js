import { api, navbar, message, node } from "./auth.js";
const $ = (id) => document.getElementById(id);
let cards = [],
  version = 1,
  passiveTemplates = [];
function edit(card) {
  version = card.versao || 1;
  $("card-json").value = JSON.stringify(card, null, 2);
  $("validation").textContent = "";
}
async function load() {
  const user = await navbar();
  if (!user?.admin) {
    message("Acesso restrito a administradores.", true);
    return;
  }
  try {
    const [catalog, capabilities] = await Promise.all([
      api("/admin/cards"),
      api("/cards/schema"),
    ]);
    cards = catalog.cards;
    passiveTemplates = capabilities.modelosPassivos || [];
    $("passive-template").replaceChildren(
      ...passiveTemplates.map((t, i) => {
        const option = node("option", t.nome);
        option.value = i;
        return option;
      }),
    );
    if (catalog.issues?.length)
      message(
        "Registros antigos precisam de revisão:\n" +
          catalog.issues.map((i) => `${i.nome}: ${i.motivo}`).join("\n"),
        true,
      );
    $("catalog-select").replaceChildren(
      ...cards.map((c) => {
        const option = node(
          "option",
          `${c.numeroCatalogo} · ${c.nome}${c.publicado ? "" : " (rascunho)"}`,
        );
        option.value = c.numeroCatalogo;
        return option;
      }),
    );
    $("capabilities").textContent =
      `Tipos: ${capabilities.tipos.join(", ")}\n\nAlvos: ${capabilities.alvos.join(", ")}\n\nGatilhos: ${capabilities.gatilhos.join(", ")}\n\nEfeitos: ${capabilities.efeitos.join(", ")}\n\nHabilidades especiais: ${capabilities.habilidades.join(", ")}`;
    if (cards.length) edit(cards[0]);
  } catch (e) {
    message(e.message, true);
  }
}
$("catalog-select").onchange = (e) =>
  edit(cards.find((c) => c.numeroCatalogo === e.target.value));
$("new-card").onclick = () => {
  const tipo = $("new-type").value,
    next = Math.max(0, ...cards.map((c) => Number(c.numeroCatalogo))) + 1;
  const card = {
    numeroCatalogo: String(next).padStart(3, "0"),
    nome: "Nova carta",
    tipo,
    custoMana: 0,
    descricao: "",
    publicado: false,
    versao: 1,
    efeitos: [],
    habilidadesAtivas: [],
    habilidadesPassivas: [],
  };
  if (["Mago", "Tropa", "Estrutura"].includes(tipo))
    Object.assign(card, { hp: 1, ataque: 0 });
  if (tipo === "Tropa")
    Object.assign(card, { manaGerada: 0, direcaoAtaque: "Frente" });
  if (tipo === "Mago")
    Object.assign(card, {
      recuperacaoMana: 0,
      limites: [
        {
          tropasMobilizadas: 0,
          tropaAtacam: 0,
          feiticosUsados: 0,
          feiticosUnicos: 0,
        },
      ],
    });
  if (tipo === "Armamento") Object.assign(card, { bonusAtaque: 0, bonusHp: 0 });
  if (tipo === "Feitico") card.alvo = "UnicoInimigo";
  edit(card);
};
$("import-card").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100000) throw new Error("Arquivo muito grande.");
    const card = JSON.parse(await file.text());
    const result = await api("/cards/validate", {
      method: "POST",
      body: JSON.stringify(card),
    });
    edit(result.card);
    message("Carta importada para revisão. Ainda não foi salva.");
  } catch (e) {
    message(e.message, true);
  } finally {
    e.target.value = "";
  }
};
$("validate-card").onclick = async () => {
  try {
    const result = await api("/cards/validate", {
      method: "POST",
      body: $("card-json").value,
    });
    $("validation").textContent = result.publicationErrors.length
      ? "Estrutura válida. Para publicar:\n" +
        result.publicationErrors.join("\n")
      : "Definição válida e efeitos suportados.";
  } catch (e) {
    message(e.message, true);
  }
};
$("save-card").onclick = async () => {
  $("save-card").disabled = true;
  try {
    const card = JSON.parse($("card-json").value);
    const result = await api(
      `/admin/cards/${encodeURIComponent(card.numeroCatalogo)}`,
      {
        method: "PUT",
        body: JSON.stringify({ card, expectedVersion: version }),
      },
    );
    const index = cards.findIndex(
      (c) => c.numeroCatalogo === card.numeroCatalogo,
    );
    if (index < 0) cards.push(result.card);
    else cards[index] = result.card;
    edit(result.card);
    const options = cards.map((c) => {
      const option = node("option", `${c.numeroCatalogo} · ${c.nome}`);
      option.value = c.numeroCatalogo;
      return option;
    });
    $("catalog-select").replaceChildren(...options);
    $("catalog-select").value = card.numeroCatalogo;
    message("Entrada salva.");
  } catch (e) {
    message(e.message, true);
  } finally {
    $("save-card").disabled = false;
  }
};
void load();

$("add-passive").onclick = () => {
  try {
    const template = passiveTemplates[Number($("passive-template").value)];
    if (!template) return;
    const card = JSON.parse($("card-json").value);
    card.habilidadesPassivas ??= [];
    if (
      card.habilidadesPassivas.some(
        (p) => JSON.stringify(p) === JSON.stringify(template.passiva),
      )
    )
      throw Error("Esse modelo já está na carta.");
    card.habilidadesPassivas.push(structuredClone(template.passiva));
    $("card-json").value = JSON.stringify(card, null, 2);
    $("validation").textContent =
      "Passiva adicionada ao rascunho. Ajuste os parâmetros, valide e salve.";
  } catch (e) {
    message(e.message, true);
  }
};
