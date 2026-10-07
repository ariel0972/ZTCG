import type { Card, Effect, TipoAlvoFeitico } from "../types/card";
import { legacyPassiveTriggers } from "./legacy-passives";
import { passiveEventTriggers, passiveActionIds } from "./passives";

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
export const passiveIds = passiveActionIds;
export const legacyPassiveIds = [
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
    if ("efeitos" in h) {
      const ongoing = h.gatilho === "continuous" || h.gatilho === "onTargeted";
      if (
        !ongoing &&
        !(passiveEventTriggers as readonly string[]).includes(h.gatilho)
      )
        errors.push("Gatilho de passiva não implementado.");
      if (ongoing && h.escopo !== "proprio")
        errors.push("Aura e restrição exigem escopo proprio.");
      if (h.filtroAlvo && !["onKill", "onAttack", "onHeal"].includes(h.gatilho))
        errors.push("Filtro de alvo exige evento de abate, ataque ou cura.");
      for (const filter of [
        h.filtroEvento,
        ...h.efeitos.flatMap((a) =>
          "filtro" in a
            ? [a.filtro, ...("qualquerDe" in a ? (a.qualquerDe ?? []) : [])]
            : [],
        ),
      ])
        if (filter?.status && !statusIds.includes(filter.status))
          errors.push("Filtro de passiva usa status não implementado.");
      for (const effect of h.efeitos) {
        const allowed =
          h.gatilho === "continuous"
            ? ["attackAura", "attackBonus"]
            : h.gatilho === "onTargeted"
              ? ["blockAttack"]
              : (passiveIds as readonly string[]).filter(
                  (id) =>
                    !["attackAura", "attackBonus", "blockAttack"].includes(id),
                );
        if (!allowed.includes(effect.id))
          errors.push(
            "Efeito " +
              effect.id +
              " incompatível com gatilho " +
              h.gatilho +
              ".",
          );
        if (effect.id === "status" && !statusIds.includes(effect.status))
          errors.push("Status de passiva não implementado.");
        if (
          ["attackAura", "attackBonus"].includes(effect.id) &&
          card.tipo !== "Tropa"
        )
          errors.push("Bônus de ataque contínuo exige tropa.");
        if (effect.id === "spellDamageBonus" && card.tipo !== "Mago")
          errors.push("Bônus de feitiços exige mago.");
        if (
          effect.id === "spellDamageBonus" &&
          ["__proto__", "prototype", "constructor"].includes(effect.contador)
        )
          errors.push("Identificador de contador reservado.");
        if (effect.id === "blockAttack" && !effect.filtro && !effect.qualquerDe)
          errors.push("Restrição exige filtro do atacante.");
        if (
          (effect.id === "move" || effect.id === "summonFromDeck") &&
          (h.gatilho !== "onDeath" ||
            h.filtroEvento?.tipo !== "Tropa" ||
            h.escopo !== "aliado")
        )
          errors.push("Ocupar espaço de morte exige onDeath de tropa aliada.");
        if (
          (effect.id === "move" || effect.id === "summonFromDeck") &&
          card.tipo !== "Tropa"
        )
          errors.push("Movimento e mobilização passivos exigem tropa.");
        if ("alvo" in effect) {
          if (
            effect.alvo === "atacante" &&
            !["onAttacked", "onDamageTaken"].includes(h.gatilho)
          )
            errors.push("Alvo atacante exige evento de ataque ou dano.");
          if (
            effect.alvo === "alvoAtaque" &&
            !["onAttack", "onKill", "onHeal"].includes(h.gatilho)
          )
            errors.push("Alvo do evento exige ataque, abate ou cura.");
          if (
            effect.alvo === "cartaEvento" &&
            ["onTurnStart", "onTurnEnd"].includes(h.gatilho)
          )
            errors.push("Eventos de turno não fornecem carta alvo.");
          if (
            ["heal", "growMaxHp"].includes(effect.id) &&
            effect.alvo === "fonte" &&
            !["Tropa", "Mago", "Estrutura"].includes(card.tipo)
          )
            errors.push("Cura/vida exigem uma fonte com vida.");
        }
      }
      continue;
    }

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
      !legacyPassiveIds.includes(h.efeito) ||
      !legacyPassiveTriggers[h.efeito]?.includes(h.gatilho)
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
