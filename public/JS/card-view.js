import { node } from "./auth.js";
export const labels = {
  Feitico: "Feitiço",
  Tropa: "Tropa",
  Mago: "Mago",
  Estrutura: "Estrutura",
  Armamento: "Armamento",
  Agua: "Água",
};
export function abilityNeedsTarget(ability) {
  if (
    [
      "ataqueFurtivo",
      "ordemDaEspada",
      "armaduraPoderosa",
      "enganarAMorte",
    ].includes(ability.id)
  )
    return false;
  return !["Global", "TodosInimigos", "TodasTropasInimigas"].includes(
    ability.alvo,
  );
}
export function abilityDescription(ability) {
  if (ability.descricao) return ability.descricao;
  const known = {
    recuperarEnergia:
      "Escolha um feitiço da mão para sacrificar e recuperar 3 mana (máximo 20).",
    ataqueFurtivo:
      "Causa 2 de dano diretamente ao mago inimigo. Alvo automático.",
    ordemDaEspada:
      "Causa 3 de dano a todas as tropas inimigas. Estruturas absorvem o golpe. Alvos automáticos.",
    armaduraPoderosa:
      "Esta carta recebe Guardar e reduz em 2 o dano recebido por 2 rodadas. Consome seu ataque. Alvo automático: a própria carta.",
    enganarAMorte:
      "Devolve até 3 tropas mais recentes do seu cemitério ao baralho e o embaralha. Alvos automáticos.",
    ressurreicaoSombria:
      "Escolha uma tropa do seu cemitério. Ela retorna à mão restaurada e com custo de mobilização 0.",
    protecaoAquatica:
      "Escolha um aliado e um modo: curar 3 de vida ou conceder Escudo 3 por 2 rodadas.",
  };
  return (
    known[ability.id] ||
    (ability.efeitos || []).map(effectDescription).join(" ") ||
    "Efeito ainda não definido no catálogo."
  );
}
function effectDescription(effect) {
  return (
    {
      damage: `Causa ${effect.valor || 0} de dano.`,
      heal: `Cura ${effect.valor || 0} de vida.`,
      draw: `Compra ${effect.valor || 0} carta(s).`,
      mana: `Recupera ${effect.valor || 0} de mana.`,
      status: `Aplica ${effect.status || "um status"}${effect.valor === undefined ? "" : ` com intensidade ${effect.valor}`}${effect.duracao === undefined ? "" : ` por ${effect.duracao} rodada(s)`}.`,
      banish: "Bane o alvo.",
      forget: "Esquece o alvo.",
      field: `Aplica ${effect.elemento || "um elemento"} ao campo.`,
      searchElemental:
        "Escolha um feitiço elemental do seu baralho para adicionar à mão.",
    }[effect.id] || "Efeito ainda não definido no catálogo."
  );
}
export function passiveDescription(h) {
  if (h.descricao) return h.descricao;
  if (h.efeito === "aplicarStatusAtacante")
    return `Ao receber ataque básico, aplica ${h.status} ao atacante, mesmo se não receber dano ou morrer.`;
  if (h.efeito === "bonusAtaqueAdjacente")
    return `Ganha +${h.valor} de ataque básico com tropas ${h.elemento || "de qualquer elemento"} vizinhas e concede +${h.valor} a elas. Bônus se acumulam.`;
  if (h.efeito === "restringirAtaqueBasico")
    return `Não pode receber ataques básicos de ${h.tipoAtacante || "cartas"} com ${[h.elemento, h.direcao].filter(Boolean).join(" ou ")}.`;
  return `${{ onDeath: "Quando um aliado morre", onSpellCast: "Ao conjurar um feitiço", onTurnStart: "No início do turno", onRevive: "Ao reviver uma tropa", onSacrifice: "Ao sacrificar uma tropa", onStatusApplied: "Ao aplicar um efeito", onAttack: "Ao atacar", onKill: "Ao eliminar uma tropa", onTurnEnd: "No fim do turno" }[h.gatilho] || "Passiva"}: ${{ ganharVida: "ganha vida", curarMago: "cura o mago", recuperarMana: "recupera mana", comprarCarta: "compra carta", comprarCartaCemiterio: "recupera carta do cemitério", ganharVidaEManaSacrificio: "recupera 2 de vida e 2 de mana", manaCampoVazio: "recupera mana se o campo estiver vazio", causarDanoExtra: "causa dano adicional" }[h.efeito] || "efeito especial"}${h.valor === undefined ? "" : " (" + h.valor + ")"}${h.condicao ? " · Condição: " + h.condicao : ""}.`;
}
export function cardTile(card, callback, count = 0) {
  const button = node("button", "", "card-tile");
  button.type = "button";
  button.setAttribute(
    "aria-label",
    `${card.nome}, ${labels[card.tipo]}, ${card.custoMana} mana. ${count ? count + " cópias." : ""}`,
  );
  const image = document.createElement("img");
  image.src = card.imgURL || "/assets/avatar.png";
  image.alt = "";
  image.loading = "lazy";
  image.onerror = () => {
    image.onerror = null;
    image.src = "/assets/avatar.png";
    button.classList.add("missing-art");
  };
  button.append(
    image,
    node("span", card.nome, "card-name"),
    node("span", `${labels[card.tipo]} · ${card.custoMana} mana`, "card-meta"),
  );
  if (!card.publicado) button.append(node("span", "Rascunho", "badge draft"));
  if (count) button.append(node("span", `${count}×`, "badge copies"));
  button.onclick = () => callback(card);
  return button;
}
export function describe(card) {
  const parts = [
    `${labels[card.tipo]}${card.elemento ? " · " + (labels[card.elemento] || card.elemento) : ""}`,
    `Custo: ${card.custoMana} mana`,
  ];
  if (card.assinatura)
    parts.push("Feitiço de assinatura · usa o limite separado do mago");
  if (card.hp !== undefined)
    parts.push(`Vida: ${card.hp} · Ataque: ${card.ataque || 0}`);
  if (card.direcaoAtaque)
    parts.push(`Alcance: ${card.direcaoAtaque} · Gera ${card.manaGerada} mana`);
  if (card.recuperacaoMana !== undefined)
    parts.push(`Recupera ${card.recuperacaoMana} mana por turno`);
  if (card.bonusAtaque !== undefined)
    parts.push(`Bônus: ${card.bonusAtaque} ataque / ${card.bonusHp || 0} vida`);
  if (card.fireDamageBonus !== undefined)
    parts.push(
      `Bônus permanente de Fogo: +${card.fireDamageBonus} dano · ${card.fireSpellsCast || 0} feitiços de Fogo conjurados`,
    );
  if (card.palavrasChave?.length) parts.push(card.palavrasChave.join(", "));
  if (card.descricao) parts.push(card.descricao);
  for (const h of card.habilidadesAtivas || [])
    parts.push(`${h.nome} · ${h.custoMana} mana: ${abilityDescription(h)}`);
  for (const h of card.habilidadesPassivas || [])
    parts.push(passiveDescription(h));
  return parts.join("\n");
}
