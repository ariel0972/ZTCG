import { entryCostRule, describeEntryCost } from "./entry-cost.js";
export function createEntryCostEditor(doc, { onChange, onError }) {
  const $ = (id) => doc.getElementById(id);
  const selected = (name) =>
    [...doc.querySelectorAll('input[name="' + name + '"]:checked')].map(
      (i) => i.value,
    );
  function show(card) {
    const cost = entryCostRule(card);
    $("entry-quantity").value = cost?.quantidade ?? 1;
    for (const input of doc.querySelectorAll('input[name="entry-type"]'))
      input.checked = (cost?.tiposCarta ?? ["Tropa"]).includes(input.value);
    for (const input of doc.querySelectorAll('input[name="entry-origin"]'))
      input.checked = (cost?.origens ?? ["mao", "campo"]).includes(input.value);
    $("entry-element").value = cost?.mesmoElemento
      ? "mesmo"
      : cost?.elementos?.length === 1
        ? cost.elementos[0]
        : "qualquer";
    $("entry-cost-help").textContent =
      describeEntryCost(card) ||
      "Sem custo de materiais. A configuração só será salva ao salvar a entrada.";
    if (cost?.elementos?.length > 1)
      $("entry-cost-help").textContent +=
        " O JSON contém vários elementos permitidos; aplicar este formulário substituirá a lista pelo elemento escolhido.";
  }
  $("apply-entry-cost").onclick = () => {
    try {
      const card = JSON.parse($("card-json").value),
        quantidade = Number($("entry-quantity").value),
        tiposCarta = selected("entry-type"),
        origens = selected("entry-origin"),
        element = $("entry-element").value;
      if (
        !Number.isInteger(quantidade) ||
        quantidade < 1 ||
        quantidade > 5 ||
        !tiposCarta.length ||
        !origens.length
      )
        throw Error(
          "Defina de 1 a 5 materiais, pelo menos um tipo e uma origem.",
        );
      card.custoEntrada = {
        quantidade,
        tiposCarta,
        origens,
        ...(element === "mesmo"
          ? { mesmoElemento: true }
          : element !== "qualquer"
            ? { elementos: [element] }
            : {}),
      };
      $("card-json").value = JSON.stringify(card, null, 2);
      show(card);
      onChange();
    } catch (e) {
      onError(e);
    }
  };
  $("remove-entry-cost").onclick = () => {
    try {
      const card = JSON.parse($("card-json").value);
      delete card.custoEntrada;
      $("card-json").value = JSON.stringify(card, null, 2);
      show(card);
      onChange();
    } catch (e) {
      onError(e);
    }
  };
  return { show };
}
