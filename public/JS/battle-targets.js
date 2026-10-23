export const automaticTargets = [
  "Global",
  "TodosInimigos",
  "TodasTropasInimigas",
  "TodosAliados",
];
export const hasAutomaticTarget = (action) =>
  !action?.opcoes?.length &&
  (!!action?.alvoAutomatico || automaticTargets.includes(action?.alvo));
export const zoneTargets = ["Deck", "DeckOponente", "Cemiterio", "Mao"];
export function actionTarget(selection) {
  const action =
    selection?.type === "ability" ? selection.ability : selection?.card;
  if (!action?.opcoes?.length) return action;
  const option = action.opcoes.find((o) => o.id === selection.mode);
  if (!option)
    return { ...action, alvo: undefined, efeitos: [], tiposAlvo: undefined };
  const { id: _id, nome: _nome, ...definition } = option;
  return {
    ...action,
    alvoAutomatico: undefined,
    tiposAlvo: undefined,
    maxAlvos: 1,
    ...definition,
    opcoes: undefined,
  };
}
export function spellSlotTarget(action, slot, userId) {
  if (!action || zoneTargets.includes(action.alvo)) return false;
  const own = slot.ownerId === userId,
    type = action.alvo;
  if (type === "Global") return false;
  if (["CampoAliado", "CampoInimigo"].includes(type))
    return (
      slot.kind === "Tropa" &&
      (type === "CampoAliado" ? own : !own) &&
      (!action.efeitos?.some((e) => e.id === "trap") ||
        (!slot.card && !slot.rider && !slot.terrain))
    );
  if (
    (["UnicoAliado", "TodosAliados"].includes(type) && !own) ||
    ([
      "UnicoInimigo",
      "MultiplosInimigos",
      "TodosInimigos",
      "TodasTropasInimigas",
    ].includes(type) &&
      own)
  )
    return false;
  const target =
    type === "Estrutura" ? slot.structure : slot.card || slot.structure;
  if (
    !target ||
    target.oculta ||
    target.concealedTrap ||
    (!own &&
      target.statuses?.some(
        (s) => s.nome === "Esconder" && s.turnosRestantes > 0,
      ) &&
      !automaticTargets.includes(type) &&
      !action.ignoraEsconder)
  )
    return false;
  const earthTremorMage =
    !own &&
    slot.kind === "Mago" &&
    action.casterElement === "Terra" &&
    action.efeitos?.some((e) => e.id === "tremor");
  if (
    type === "TodasTropasInimigas" &&
    slot.card?.tipo !== "Tropa" &&
    !earthTremorMage
  )
    return false;
  if (type === "TodosInimigos" && !["Tropa", "Mago"].includes(slot.card?.tipo))
    return false;
  const effects = action.efeitos || [];
  const displacement = effects.find((e) => e.id === "displace");
  if (
    displacement &&
    (target.tipo !== "Tropa" ||
      (slot.structure && displacement.estrutura !== "manter"))
  )
    return false;
  if (action.alvoAutomatico && target.id !== action.automaticTargetId)
    return false;
  if (action.tiposAlvo && !action.tiposAlvo.includes(target.tipo)) return false;
  if (
    action.filtroAlvo &&
    Object.entries(action.filtroAlvo).some(
      ([key, value]) => target[key] !== value,
    )
  )
    return false;
  if (
    effects.some((e) => ["tornado", "meteors"].includes(e.id)) &&
    target.tipo !== "Tropa"
  )
    return false;
  if (
    effects.some((e) => ["banish", "forget"].includes(e.id)) &&
    target.tipo === "Mago"
  )
    return false;
  if (
    effects.some((e) =>
      ["heal", "status", "damage", "protectionShield"].includes(e.id),
    ) &&
    target.hp === undefined
  )
    return false;
  return !!type;
}
export function slotTargetId(action, slot) {
  return ["CampoAliado", "CampoInimigo"].includes(action.alvo)
    ? slot.id
    : action.alvo === "Estrutura"
      ? slot.structure?.id
      : slot.card?.id || slot.structure?.id;
}
export function zoneCardAllowed(action, card) {
  if (action.efeitos?.some((e) => e.id === "searchElemental"))
    return (
      card.tipo === "Feitico" &&
      !!card.elemento &&
      !["Neutro", "Zarcos"].includes(card.elemento)
    );
  if (action.id === "refazerCaminhos" || action.id === "recuperarEnergia")
    return card.tipo === "Feitico";
  const graveEffect = action.efeitos?.find((e) =>
    ["revive", "shuffleGraveyard"].includes(e.id),
  );
  if (graveEffect)
    return (graveEffect.tiposCarta ?? ["Tropa"]).includes(card.tipo);
  return true;
}
export function targetDescription(action) {
  if (action?.efeitos?.some((e) => e.id === "displace"))
    return "Escolha uma tropa inimiga destacada. Se o efeito pedir deslocamento, escolha depois um espaço vizinho vazio. Estruturas seguem a regra descrita na carta.";
  if (action?.filtroAlvo?.numeroCatalogo)
    return `Escolha a tropa aliada de catálogo ${action.filtroAlvo.numeroCatalogo} destacada, inclusive montada.`;
  if (action?.alvoAutomatico === "UltimoAtacanteTropa")
    return "Atinge automaticamente a última tropa que atacou uma tropa sua no turno anterior, mesmo com Esconder.";
  if (action?.efeitos?.some((e) => ["tornado", "meteors"].includes(e.id)))
    return "Escolha as tropas inimigas destacadas e confirme.";
  const descriptions = {
    UnicoAliado: "Escolha uma carta aliada destacada, incluindo seu mago.",
    UnicoInimigo: "Escolha uma carta inimiga destacada, incluindo o mago.",
    MultiplosInimigos: "Escolha os inimigos destacados e confirme.",
    TodosAliados:
      "Atinge todos os aliados destacados, incluindo a própria carta, o mago e estruturas.",
    TodosInimigos:
      "Atinge os inimigos destacados; não exige seleção individual.",
    TodasTropasInimigas:
      "Atinge as tropas inimigas destacadas; não exige seleção individual.",
    CampoAliado: "Escolha um slot frontal aliado, ocupado ou vazio.",
    CampoInimigo: "Escolha um slot frontal inimigo, ocupado ou vazio.",
    Estrutura: "Escolha uma estrutura destacada.",
    Deck: "Abra seu baralho destacado e escolha uma carta.",
    DeckOponente:
      "O efeito usa o baralho do oponente; sua ordem e cartas continuam ocultas.",
    Cemiterio: "Abra seu cemitério destacado e escolha uma carta.",
    Mao: "Escolha uma carta destacada da sua mão.",
    Global:
      "Efeito automático: confirme para aplicar ao campo ou às zonas destacadas.",
  };
  return (
    descriptions[action?.alvo] || "Escolha os alvos destacados e confirme."
  );
}

// Destinos possíveis para o deslocamento escolhido; o servidor valida novamente.
export function displacementChoice(action, targetIds, slots) {
  const effect = action?.efeitos?.find(
    (e) => e.id === "displace" && e.direcao === "vizinho",
  );
  const source = slots.find((s) =>
    targetIds?.some((id) => [s.id, s.card?.id, s.rider?.id].includes(id)),
  );
  if (!effect || !source || (source.structure && effect.estrutura === "manter"))
    return { required: false, destinations: [] };
  return {
    required: true,
    destinations: slots
      .filter(
        (s) =>
          s.ownerId === source.ownerId &&
          s.kind === "Tropa" &&
          Math.abs(s.column - source.column) === 1 &&
          !s.card &&
          !s.rider &&
          !s.terrain,
      )
      .map((s) => s.id),
  };
}

export function destinationChoice(action, targetIds, slots, ownerId) {
  if (action?.efeitos?.some((e) => e.id === "control")) {
    const front = slots.filter(
      (s) => s.ownerId === ownerId && s.kind === "Tropa",
    );
    return {
      required: !!targetIds?.length && front.some((s) => !s.card),
      destinations: targetIds?.length
        ? front
            .filter((s) => !s.card && !s.rider && !s.terrain)
            .map((s) => s.id)
        : [],
    };
  }
  if (action?.efeitos?.some((e) => e.id === "revive"))
    return {
      required: true,
      destinations:
        targetIds?.length === 1
          ? slots
              .filter(
                (s) =>
                  s.ownerId === ownerId &&
                  s.kind === "Tropa" &&
                  !s.card &&
                  !s.rider &&
                  !s.terrain,
              )
              .map((s) => s.id)
          : [],
    };
  return displacementChoice(action, targetIds, slots);
}
