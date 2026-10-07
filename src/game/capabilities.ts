import type { Card, Effect, TipoAlvoFeitico } from "../types/card";

export const effectIds = [
  "damage",
  "heal",
  "status",
  "draw",
  "mana",
  "searchElemental",
  "banish",
  "forget",
  "field",
  "stoneVolley",
  "tornado",
  "arrowRain",
  "protectionShield",
  "tremor",
  "lightOrb",
  "sandstorm",
  "meteors",
  "zarcosTear",
  "strongFlow",
] as const;
export const abilityIds = [
  "protecaoAquatica",
  "enganarAMorte",
  "ressurreicaoSombria",
  "ataqueFurtivo",
  "ordemDaEspada",
  "armaduraPoderosa",
  "recuperarEnergia",
] as const;
export const passiveIds = [
  "aplicarStatusAtacante",
  "bonusAtaqueAdjacente",
  "restringirAtaqueBasico",
  "ganharVida",
  "curarMago",
  "recuperarMana",
  "comprarCarta",
  "comprarCartaCemiterio",
  "ganharVidaEManaSacrificio",
  "manaCampoVazio",
  "causarDanoExtra",
  "acumularDanoFogo",
  "curarMagoAgua",
];
const passiveTriggers: Record<string, string[]> = {
  aplicarStatusAtacante: ["onAttacked"],
  bonusAtaqueAdjacente: ["continuous"],
  restringirAtaqueBasico: ["onTargeted"],
  ganharVida: ["onDeath"],
  curarMago: ["onSpellCast"],
  recuperarMana: ["onDeath"],
  comprarCarta: ["onSpellCast"],
  comprarCartaCemiterio: ["onRevive"],
  ganharVidaEManaSacrificio: ["onSacrifice"],
  manaCampoVazio: ["onTurnStart"],
  causarDanoExtra: ["onStatusApplied"],
  acumularDanoFogo: ["onSpellCast"],
  curarMagoAgua: ["onSpellCast"],
};
const keywordIds = [
  "Guardar",
  "Esconder",
  "Sobrepujar",
  "Campo livre",
  "Herança",
  "Flanquear",
];
const statusIds = [
  "Abalo",
  "EscudoProtecao",
  "Incapacitado",
  "Atordoamento",
  "Atordoado",
  "Congelado",
  "Congelamento",
  "Cegueira",
  "Cego",
  "Escudo",
  "Guardar",
  "armaduraPoderosa",
  "Peste Negra",
  "Leptospirose",
  "Sangramento",
  "Sangrando",
  "Envenenamento",
  "Envenenado",
  "Queimacao",
  "Queimando",
  "Queimado",
  "Esconder",
];
export function playableErrors(card: Card): string[] {
  const errors: string[] = [];
  const specialTargets: Record<string, TipoAlvoFeitico> = {
    stoneVolley: "TodasTropasInimigas",
    tornado: "UnicoInimigo",
    arrowRain: "TodosInimigos",
    protectionShield: "UnicoAliado",
    tremor: "TodasTropasInimigas",
    lightOrb: "TodosInimigos",
    sandstorm: "TodosInimigos",
    meteors: "MultiplosInimigos",
    zarcosTear: "Global",
    strongFlow: "Global",
  };
  for (const effect of card.efeitos)
    if (specialTargets[effect.id]) {
      if (card.alvo !== specialTargets[effect.id])
        errors.push(`Alvo incompatível com ${effect.id}.`);
      if (card.efeitos.length !== 1)
        errors.push(
          "Efeito especial representa uma regra completa: use somente um efeito.",
        );
    }
  const checkEffects = (effects: Effect[], target?: TipoAlvoFeitico) => {
    for (const e of effects) {
      if (!(effectIds as readonly string[]).includes(e.id))
        errors.push(`Efeito ${e.id} não implementado.`);
      if (
        e.id === "status" &&
        (!e.status || !statusIds.includes(e.status) || !e.duracao)
      )
        errors.push("Status/duração inválidos.");
      if (
        e.id !== "searchElemental" &&
        e.id !== "status" &&
        e.id !== "banish" &&
        e.id !== "forget" &&
        e.id !== "field" &&
        e.valor === undefined
      )
        errors.push(`Defina valor para ${e.id}.`);
      if (
        ["damage", "heal", "status"].includes(e.id) &&
        ![
          "UnicoInimigo",
          "UnicoAliado",
          "TodosInimigos",
          "TodasTropasInimigas",
          "Estrutura",
          "MultiplosInimigos",
          "CampoAliado",
          "CampoInimigo",
        ].includes(target ?? "")
      )
        errors.push(`Alvo incompatível com ${e.id}.`);
      if (e.id === "searchElemental" && target !== "Deck")
        errors.push("Busca elemental exige alvo Deck.");
      if (
        ["banish", "forget"].includes(e.id) &&
        ![
          "UnicoInimigo",
          "UnicoAliado",
          "TodosInimigos",
          "TodasTropasInimigas",
          "Estrutura",
          "MultiplosInimigos",
          "Cemiterio",
        ].includes(target ?? "")
      )
        errors.push("Remoção definitiva exige carta em campo ou no cemitério.");
      if (
        e.id === "field" &&
        !["CampoAliado", "CampoInimigo"].includes(target ?? "")
      )
        errors.push("Efeito de campo exige alvo CampoAliado ou CampoInimigo.");
      if (["mana", "draw"].includes(e.id) && target !== "Global")
        errors.push(`${e.id} exige alvo Global.`);
    }
  };
  checkEffects(card.efeitos, card.alvo);
  if (
    card.efeitos.some((e) => e.id === "field") &&
    (!card.elemento || card.elemento === "Neutro")
  )
    errors.push("Feitiço de campo exige um elemento.");
  if (card.tipo !== "Feitico" && card.efeitos.length)
    errors.push(
      "Efeitos diretos são exclusivos de feitiços; use habilidades nas demais cartas.",
    );
  if (card.tipo === "Feitico" && !card.efeitos.length)
    errors.push("Feitiço sem efeitos.");
  for (const h of card.habilidadesAtivas) {
    if (h.efeitos?.length) {
      checkEffects(h.efeitos, h.alvo);
      if (h.efeitos.some((e) => specialTargets[e.id]))
        errors.push(
          "Efeitos especiais de feitiços não são executáveis em habilidades.",
        );
      if (h.efeitos.some((e) => e.id === "field"))
        errors.push(
          "Aplicação elemental de campo está disponível apenas em feitiços.",
        );
      if (!h.alvo) errors.push(`Defina alvo da habilidade ${h.id}.`);
    } else if (!(abilityIds as readonly string[]).includes(h.id))
      errors.push(`Habilidade ${h.id} não implementada.`);
  }
  for (const h of card.habilidadesPassivas) {
    if (
      h.efeito === "aplicarStatusAtacante" &&
      (!h.status || !statusIds.includes(h.status) || !h.duracao)
    )
      errors.push("Retaliação exige status suportado e duração positiva.");
    if (
      h.efeito === "bonusAtaqueAdjacente" &&
      (card.tipo !== "Tropa" || !h.valor)
    )
      errors.push("Aura de ataque exige tropa e bônus positivo.");
    if (h.efeito === "restringirAtaqueBasico" && !h.elemento && !h.direcao)
      errors.push("Restrição exige elemento ou direção do atacante.");
    if (
      !passiveIds.includes(h.efeito) ||
      !passiveTriggers[h.efeito]?.includes(h.gatilho)
    )
      errors.push(`Passiva ${h.efeito}/${h.gatilho} não implementada.`);
    if (
      h.condicao &&
      ![
        "aliadoMorre",
        "aliadoMorreTerra",
        "aliadoMorreAr",
        "Fogo",
        "Agua",
        "Terra",
        "Ar",
        "Zarcos",
        "Neutro",
        "Incapacitado",
      ].includes(h.condicao)
    )
      errors.push(`Condição ${h.condicao} não implementada.`);
  }
  for (const word of card.palavrasChave)
    if (!keywordIds.includes(word))
      errors.push(`Palavra-chave ${word} não implementada.`);
  return errors;
}
