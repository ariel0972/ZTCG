import type { Card, Effect, TipoAlvoFeitico } from "../types/card";
import { legacyPassiveTriggers } from "./legacy-passives";
import { passiveEventTriggers, passiveActionIds } from "./passives";
import { canonicalStatus } from "./status";
import { reactionDescriptions } from "./reactions";

export const effectIds = [
  "revealStealHand",
  "bloodScent",
  "damage",
  "revive",
  "shuffleGraveyard",
  "nextActionDamage",
  "attackField",
  "displace",
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
  "searchNamed",
  "spendAttack",
  "guardTarget",
] as const;
export const abilityIds = [
  "protecaoAquatica",
  "ataqueFurtivo",
  "ordemDaEspada",
  "armaduraPoderosa",
  "recuperarEnergia",
  "refazerCaminhos",
  "deslocar",
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
  "Montaria",
  "Reação",
];
const statusIds = [
  "BonusAtaque",
  "ReducaoDano",
  "ReducaoAtaqueTropa",
  "Interceptar",
  "Abalo",
  "EscudoProtecao",
  "Incapacitado",
  "SemAtaque",
  "Campo livre",
  "Dano da próxima ação",
  "Bônus de dano de feitiço",
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
  if (card.requerElementoMago && card.tipo !== "Feitico")
    errors.push("Restrição de elemento do mago exige Feitico.");
  if (
    card.palavrasChave.includes("Reação") &&
    (card.tipo !== "Feitico" || card.elemento !== "Agua")
  )
    errors.push("Reação exige feitiço de Água.");
  if (
    (card.montaria || card.palavrasChave.includes("Montaria")) &&
    card.tipo !== "Tropa"
  )
    errors.push("Montaria exige Tropa.");
  if (card.montaria && !card.palavrasChave.includes("Montaria"))
    errors.push("Filtro de montaria exige palavra-chave Montaria.");
  if (
    card.montaria?.filtro?.status &&
    !statusIds.includes(card.montaria.filtro.status)
  )
    errors.push("Filtro de montaria usa status não implementado.");
  if (
    (card.alvoAutomatico || card.ignoraEsconder || card.tiposAlvo) &&
    card.tipo !== "Feitico"
  )
    errors.push(
      "Seleção e filtro de alvo do cartão são exclusivos de feitiços.",
    );
  if (card.alvoAutomatico && card.alvo !== "UnicoInimigo")
    errors.push("Último atacante exige UnicoInimigo.");
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
    revealStealHand: "Global",
    bloodScent: "TodasTropasInimigas",
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
  const checkEffects = (
    effects: Effect[],
    target?: TipoAlvoFeitico,
    ability = false,
  ) => {
    for (const e of effects) {
      if (
        e.alvo &&
        (!ability ||
          !["damage", "heal", "status"].includes(e.id) ||
          !["Tropa", "Mago", "Estrutura"].includes(card.tipo))
      )
        errors.push(
          "Alvo Proprio por efeito exige damage, heal ou status em habilidade de Tropa, Mago ou Estrutura.",
        );
      const effectTarget = e.alvo === "Proprio" ? "UnicoAliado" : target;
      const configurable = ["arrowRain", "lightOrb"].includes(e.id);
      if (
        ["revive", "shuffleGraveyard"].includes(e.id) &&
        effectTarget !== "Cemiterio"
      )
        errors.push("Ressurreição e embaralhar tropas exigem alvo Cemiterio.");
      if (e.id === "revive" && effects.length !== 1)
        errors.push(
          "Ressurreição exige um único efeito para escolher um destino.",
        );
      if (e.id === "shuffleGraveyard" && (!e.valor || e.valor > 3))
        errors.push("Embaralhar cemitério exige quantidade entre 1 e 3.");
      if (
        (e.bonusHp !== undefined ||
          e.bonusAtaque !== undefined ||
          e.recompensaMorteRodada) &&
        e.id !== "revive"
      )
        errors.push("Bônus de ressurreição exigem revive.");
      if (
        ["sandstorm", "nextActionDamage"].includes(e.id) &&
        e.duracao !== undefined &&
        e.duracao < 1
      )
        errors.push("Duração do efeito precisa ser positiva.");
      if (
        e.id === "nextActionDamage" &&
        (target !== "Global" ||
          !e.valor ||
          (e.unidade && e.unidade !== "turno"))
      )
        errors.push(
          "Bônus da próxima ação exige Global, valor positivo e duração em turnos.",
        );
      if (e.variantesMago && !configurable)
        errors.push("variantesMago exige arrowRain ou lightOrb.");
      if (configurable && e.duracao !== undefined && e.duracao < 1)
        errors.push("Duração do feitiço deve ser positiva.");
      if (e.id === "arrowRain" && (e.status !== undefined || e.unidade))
        errors.push(
          "Chuva usa status/unidade dentro das variantes, não no efeito base.",
        );
      if (e.id === "lightOrb" && e.status && !statusIds.includes(e.status))
        errors.push("Status base da Bola de Luz não implementado.");
      if (e.variantesMago) {
        const seen = new Set<string>();
        for (const variant of e.variantesMago) {
          if (seen.has(variant.elemento))
            errors.push("Cada elemento pode ter apenas uma variante.");
          seen.add(variant.elemento);
          if (
            e.id !== "lightOrb" &&
            (variant.causaDano !== undefined || variant.status !== undefined)
          )
            errors.push(
              "causaDano/status da variante são exclusivos de lightOrb; use efeitos para Chuva.",
            );
          if (variant.status && !statusIds.includes(variant.status))
            errors.push("Status da variante não implementado.");
          for (const extra of variant.efeitos ?? []) {
            const statusName = canonicalStatus(extra.status);
            if (!statusIds.includes(extra.status))
              errors.push("Status adicional não implementado.");
            if (
              ["BonusAtaque", "ReducaoDano", "ReducaoAtaqueTropa"].includes(
                extra.status,
              ) &&
              !extra.valor
            )
              errors.push("Bônus/redução adicional exige valor positivo.");
            if (
              statusName === "Queimado" &&
              extra.valor !== undefined &&
              (extra.valor < 1 || extra.valor > 3)
            )
              errors.push("Queimado aceita intensidade de 1 a 3.");
            if (
              statusName === "Sangrando" &&
              extra.valor !== undefined &&
              (extra.valor < 1 || extra.valor > 5)
            )
              errors.push("Sangrando aceita intensidade de 1 a 5.");
            if (
              statusName === "Envenenado" &&
              extra.valor !== undefined &&
              extra.valor !== 1
            )
              errors.push("Envenenado mantém intensidade 1.");
          }
        }
      }
      if (!(effectIds as readonly string[]).includes(e.id))
        errors.push(`Efeito ${e.id} não implementado.`);
      if (
        e.perfurante !== undefined &&
        !["damage", "attackField"].includes(e.id)
      )
        errors.push("Perfuração exige dano ou efeito de campo.");
      if ((e.curaPosterior || e.recompensaAoEliminar) && e.id !== "damage")
        errors.push("Cura posterior e recompensa de abate exigem damage.");
      if (e.reacoesElemento && e.id !== "attackField")
        errors.push("Reações configuráveis exigem attackField.");
      if (
        e.id === "attackField" &&
        (target !== "Global" || !e.duracao || !e.valor)
      )
        errors.push("Efeito de campo exige Global, valor e duração positivos.");
      if (
        e.reacoesElemento &&
        new Set(e.reacoesElemento.map((r) => r.elemento)).size !==
          e.reacoesElemento.length
      )
        errors.push("Não repita elementos de reação do campo.");
      if (
        e.curaPosterior &&
        !["UnicoAliado", "TodosAliados"].includes(effectTarget ?? "")
      )
        errors.push("Cura posterior ao dano só pode atingir aliados.");
      if (e.valorEstrutura !== undefined && e.id !== "damage")
        errors.push("valorEstrutura exige damage.");
      if ((e.direcao || e.borda || e.estrutura) && e.id !== "displace")
        errors.push("Direção, borda e estrutura exigem displace.");
      if (
        e.id === "displace" &&
        (!e.direcao ||
          target !== "UnicoInimigo" ||
          e.alvo ||
          (e.borda && e.direcao !== "direita"))
      )
        errors.push(
          "Deslocamento exige UnicoInimigo, direção e borda compatível.",
        );
      if (
        e.inicio &&
        (e.id !== "status" ||
          e.unidade === "turno" ||
          ["Envenenado", "Queimado", "Sangrando", "Congelado"].includes(
            canonicalStatus(e.status ?? ""),
          ))
      )
        errors.push(
          "Início na próxima rodada exige status com duração em rodadas sem duração elemental fixa.",
        );
      if (
        e.id === "displace" &&
        (e.valor !== undefined || e.status || e.duracao || e.elemento)
      )
        errors.push(
          "displace não recebe valor, status, duração ou elemento próprio.",
        );
      if (e.filtroAlvo && !["damage", "heal", "status"].includes(e.id))
        errors.push("Filtro por efeito exige damage, heal ou status.");
      if (e.id === "searchNamed" && !e.carta)
        errors.push("Busca por carta exige carta (numeroCatalogo).");
      if (e.id !== "searchNamed" && (e.carta || e.seNaoUsada))
        errors.push("carta/seNaoUsada exigem searchNamed.");
      if (
        e.unidade &&
        (!["status", "guardTarget", "lightOrb", "nextActionDamage"].includes(
          e.id,
        ) ||
          (e.id !== "lightOrb" &&
            ["Envenenado", "Queimado", "Sangrando"].includes(
              canonicalStatus(e.status ?? ""),
            )))
      )
        errors.push(
          "Unidade personalizada exige status sem duração elemental fixa.",
        );
      if (
        e.id === "status" &&
        ["BonusAtaque", "ReducaoDano", "ReducaoAtaqueTropa"].includes(
          e.status ?? "",
        ) &&
        !e.valor
      )
        errors.push("Bônus/redução de dano exige valor positivo.");
      if (
        e.requerStatus &&
        (e.id !== "status" || !statusIds.includes(e.requerStatus))
      )
        errors.push("requerStatus exige efeito status e um status suportado.");
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
        e.id !== "searchNamed" &&
        e.id !== "spendAttack" &&
        e.id !== "displace" &&
        e.id !== "revive" &&
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
          "TodosAliados",
          "Estrutura",
          "MultiplosInimigos",
          "CampoAliado",
          "CampoInimigo",
        ].includes(effectTarget ?? "")
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
        !["CampoAliado", "CampoInimigo", "TodasTropasInimigas"].includes(
          target ?? "",
        )
      )
        errors.push("Efeito de campo exige alvo CampoAliado ou CampoInimigo.");
      if (
        ["mana", "draw"].includes(e.id) &&
        target !== "Global" &&
        !effects.some((other) => !["mana", "draw"].includes(other.id))
      )
        errors.push(`${e.id} exige alvo Global.`);
    }
  };
  if (card.efeitos.filter((e) => e.id === "displace").length > 1)
    errors.push("Use um único deslocamento por feitiço.");
  checkEffects(card.efeitos, card.alvo);
  if (card.efeitos.some((e) => ["spendAttack", "guardTarget"].includes(e.id)))
    errors.push(
      "Consumo de ataque e proteção vinculada são efeitos de habilidades de tropas.",
    );
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
    if (
      h.maxAlvos &&
      h.alvo !== "MultiplosInimigos" &&
      !(h.alvo === "Cemiterio" && h.maxAlvos <= 3)
    )
      errors.push("maxAlvos de habilidade exige MultiplosInimigos.");
    if (
      h.filtroAlvo &&
      (!Object.values(h.filtroAlvo).some(Boolean) ||
        !h.alvo ||
        ![
          "UnicoAliado",
          "UnicoInimigo",
          "MultiplosInimigos",
          "TodosAliados",
          "TodasTropasInimigas",
          "Cemiterio",
        ].includes(h.alvo))
    )
      errors.push("Filtro de habilidade vazio ou alvo incompatível.");
    for (const e of h.efeitos ?? []) {
      if (
        ["spendAttack", "guardTarget"].includes(e.id) &&
        card.tipo !== "Tropa"
      )
        errors.push("Consumir ataque/proteger aliado exige tropa de origem.");
      if (
        e.id === "spendAttack" &&
        (e.valor !== undefined || e.duracao || e.status || e.elemento)
      )
        errors.push(
          "spendAttack não recebe valor, duração, status ou elemento.",
        );
      if (
        e.id === "guardTarget" &&
        (h.alvo !== "UnicoAliado" ||
          h.alvoAutomatico ||
          !e.duracao ||
          e.valor === undefined)
      )
        errors.push(
          "guardTarget exige UnicoAliado selecionado, valor e duração positiva.",
        );
    }
    if (
      h.alvoAutomatico &&
      (!h.efeitos?.length ||
        h.alvo !==
          (h.alvoAutomatico === "Proprio" ? "UnicoAliado" : "UnicoInimigo"))
    )
      errors.push(`Alvo automático incompatível na habilidade ${h.id}.`);
    if (h.alvoAutomatico === "Frontal" && card.tipo !== "Tropa")
      errors.push("Alvo frontal automático exige tropa.");
    if ((h.efeitos ?? []).filter((e) => e.id === "displace").length > 1)
      errors.push("Use um único deslocamento por habilidade.");
    if (h.efeitos?.length) {
      checkEffects(h.efeitos, h.alvo, true);
      if (h.efeitos.some((e) => specialTargets[e.id]))
        errors.push(
          "Efeitos especiais de feitiços não são executáveis em habilidades.",
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
      if (
        ongoing &&
        h.escopo !== "proprio" &&
        !(
          h.gatilho === "onTargeted" &&
          h.escopo === "aliado" &&
          h.efeitos.every((e) => e.id === "interceptAttack")
        )
      )
        errors.push("Aura e restrição exigem escopo proprio.");
      if (
        h.condicoes?.some(
          (c) => c.tipo === "vidaPercentual" && c.alvo === "alvoAtaque",
        ) &&
        !(
          h.gatilho === "continuous" &&
          h.efeitos.every((e) => e.id === "attackBonus")
        )
      )
        errors.push("Vida do alvo exige bônus contínuo de ataque básico.");
      if (h.filtroAlvo && !["onKill", "onAttack", "onHeal"].includes(h.gatilho))
        errors.push("Filtro de alvo exige evento de abate, ataque ou cura.");
      for (const filter of [
        h.filtroEvento,
        ...(h.condicoes?.flatMap((c) =>
          c.tipo === "cartaEmCampo" ? [c.filtro] : [],
        ) ?? []),
        ...h.efeitos.flatMap((a) =>
          "filtro" in a
            ? [a.filtro, ...("qualquerDe" in a ? (a.qualquerDe ?? []) : [])]
            : [],
        ),
      ])
        if (filter?.status && !statusIds.includes(filter.status))
          errors.push("Filtro de passiva usa status não implementado.");
      if (
        h.gatilho === "onElementalReaction" &&
        (!h.reacao || h.escopo !== "qualquer")
      )
        errors.push(
          "Reação elemental exige filtro de reação e escopo qualquer.",
        );
      if (
        h.reacao &&
        (h.gatilho !== "onElementalReaction" ||
          !Object.prototype.hasOwnProperty.call(
            reactionDescriptions,
            h.reacao.nome,
          ))
      )
        errors.push("Filtro de reação não implementado ou em outro gatilho.");
      for (const effect of h.efeitos) {
        if (effect.id === "spellDamageTurn" && card.tipo !== "Mago")
          errors.push("Bônus temporário de feitiços exige Mago.");
        if (effect.id === "attackElement" && card.tipo === "Feitico")
          errors.push("Elemento de ataque exige carta permanente.");
        if (effect.id === "attackLimit" && card.tipo !== "Tropa")
          errors.push("Limite de ataques passivo exige Tropa.");
        if (effect.id === "attackLifesteal" && card.tipo !== "Armamento")
          errors.push("Cura por dano de ataque exige Armamento.");
        if (effect.id === "discardMana" && card.tipo !== "Feitico")
          errors.push("Recuperação ao descartar exige Feitico.");
        if (
          effect.id === "dodgeImpact" &&
          (card.tipo !== "Tropa" || h.escopo !== "proprio")
        )
          errors.push("Desvio exige Tropa e escopo proprio.");
        const allowed =
          h.gatilho === "continuous"
            ? [
                "attackAura",
                "attackBonus",
                "manaRecovery",
                "blockOwnAttack",
                "attackLimit",
                "attackElement",
                "attackLifesteal",
                "discardMana",
              ]
            : h.gatilho === "onTargeted"
              ? [
                  "blockAttack",
                  "reflectAttack",
                  "interceptAttack",
                  "dodgeImpact",
                ]
              : (passiveIds as readonly string[]).filter(
                  (id) =>
                    ![
                      "attackAura",
                      "attackBonus",
                      "blockAttack",
                      "manaRecovery",
                      "reflectAttack",
                      "blockOwnAttack",
                      "attackLimit",
                      "attackElement",
                      "interceptAttack",
                      "dodgeImpact",
                      "attackLifesteal",
                      "discardMana",
                    ].includes(id),
                );
        if (!allowed.includes(effect.id))
          errors.push(
            "Efeito " +
              effect.id +
              " incompatível com gatilho " +
              h.gatilho +
              ".",
          );
        if (
          ["counterAttack", "interceptAttack", "blockOwnAttack"].includes(
            effect.id,
          ) &&
          card.tipo !== "Tropa"
        )
          errors.push(
            "Retaliação, interceptação e restrição própria exigem Tropa.",
          );
        if (
          effect.id === "counterAttack" &&
          !["onAttack", "onAttacked"].includes(h.gatilho)
        )
          errors.push("Retaliação exige onAttack ou onAttacked.");
        if (
          effect.id === "counterAttack" &&
          h.gatilho === "onAttack" &&
          effect.alvo !== "cartaEvento"
        )
          errors.push("Retaliação em onAttack exige cartaEvento.");
        if (
          effect.id === "counterAttack" &&
          h.gatilho === "onAttacked" &&
          effect.alvo !== "atacante"
        )
          errors.push("Retaliação em onAttacked exige atacante.");
        if (effect.id === "status" && !statusIds.includes(effect.status))
          errors.push("Status de passiva não implementado.");
        if (
          ["attackAura", "attackBonus"].includes(effect.id) &&
          card.tipo !== "Tropa"
        )
          errors.push("Bônus de ataque contínuo exige tropa.");
        if (effect.id === "spellDamageBonus" && card.tipo !== "Mago")
          errors.push("Bônus de feitiços exige mago.");
        if (effect.id === "manaRecovery" && card.tipo !== "Mago")
          errors.push("Substituição de recuperação exige mago.");
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
