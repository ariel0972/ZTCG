import { createBattleEvents } from "./battle-events.js";
import { api, token, navbar, message, node } from "./auth.js";
import { gameTransport } from "./game-transport.js";
import {
  cardTile,
  describe,
  abilityNeedsTarget,
  abilityDescription,
  passiveDescription,
} from "./card-view.js";
import { createCardInspector } from "./card-inspection.js";
import { cardFace, bindCardDrag, dropAction } from "./battle-ui.js";
import { createMatchResult } from "./match-result.js";
import { createCardBacks } from "./card-backs.js";
const battleEvents = createBattleEvents();
const $ = (id) => document.getElementById(id);
const inspector = createCardInspector({
  reactions: () => state?.reactions || {},
});
const acknowledgedResults = new Set();
const matchConnection = node("p", "Conectando…", "match-connection");
$("match-title").after(matchConnection);
const responsePanel = node("section", "", "spell-response");
const ongoingPanel = node("section", "", "ongoing-spells");
responsePanel.setAttribute("aria-live", "polite");
$("match-title").after(responsePanel);
responsePanel.after(ongoingPanel);
const reactionsDialog = node("dialog", "", "reaction-guide");
reactionsDialog.setAttribute("aria-label", "Reações elementais");
const reactionsClose = node("button", "Fechar", "quiet");
reactionsClose.onclick = () => reactionsDialog.close();
const reactionsContent = node("div");
reactionsDialog.append(reactionsClose, reactionsContent);
document.body.append(reactionsDialog);
const reactionsButton = node("button", "Reações", "quiet");
$("card-back-settings").after(reactionsButton);
reactionsButton.onclick = () => {
  inspector.hide();
  reactionsContent.replaceChildren(
    node("h2", "Reações elementais"),
    node(
      "p",
      "Neutro não aplica token. Uma reação consome o elemento recebido; o elemento base da carta permanece.",
    ),
  );
  for (const [name, info] of Object.entries(state?.reactions || {}))
    reactionsContent.append(
      node("h3", `${name} · ${info.elements}`),
      node("p", info.description),
    );
  reactionsDialog.showModal();
};
const cardBackDisplay = createCardBacks({
  dialog: $("card-back-dialog"),
  picker: $("card-back-picker"),
  field: $("field-zones"),
  footer: $("footer-zones"),
});
$("card-back-settings").onclick = () => {
  inspector.hide();
  $("card-back-dialog").showModal();
};
$("card-back-close").onclick = () => $("card-back-dialog").close();
$("graveyard-footer").onclick = () => $("graveyard").click();
$("deck-zone-footer").onclick = () => $("deck-zone").click();
const matchResult = createMatchResult($("result-dialog"));
$("result-close").onclick = () => matchResult.close();
$("view-result").onclick = () => {
  inspector.hide();
  if ($("zone-dialog").open) $("zone-dialog").close();
  $("result-dialog").showModal();
};
let transport,
  user,
  state,
  pending = false,
  selected = null,
  targets = [],
  decks = [],
  catalog = [];
let connected = false,
  queued = false;
let clockOffset = 0;
const rematch = node("button", "Revanche");
rematch.id = "rematch";
rematch.hidden = true;
$("new-match").before(rematch);
rematch.onclick = async () => {
  rematch.disabled = true;
  try {
    const result = await send("match:rematch", { matchId: state.id });
    if (result.waiting) message("Revanche solicitada. Aguardando o oponente.");
  } catch (e) {
    message(e.message, true);
    rematch.disabled = false;
  }
};
function resetSelection() {
  selected = null;
  targets = [];
  if (state) render();
}
function myPlayer() {
  return state.players.find((p) => p.id === user.id);
}
function myTurn() {
  return (
    connected &&
    !state?.paused &&
    !state?.pendingSpell &&
    state?.status === "ACTIVE" &&
    (state.phase === "PREPARATION"
      ? !myPlayer().preparation.ready
      : state.current === user.id)
  );
}
function send(event, data) {
  return new Promise((resolve, reject) => {
    if (!transport?.connected) {
      reject(new Error("Sem conexão. Aguarde a reconexão."));
      return;
    }
    transport.emit(event, data, (error, result) => {
      if (error) {
        reject(
          new Error(
            "Resposta não recebida. Confira o estado antes de repetir.",
          ),
        );
        return;
      }
      if (!result?.success) {
        const failure = new Error(
          result?.content || "Não foi possível executar a ação.",
        );
        failure.code = result?.code;
        reject(failure);
        return;
      }
      resolve(result);
    });
  });
}
async function command(command) {
  if (pending || !state) return;
  pending = true;
  inspector.hide();
  matchConnection.textContent = "Enviando jogada…";
  $("connection").textContent = "Enviando jogada…";
  render();
  try {
    const actionId = crypto.randomUUID();
    const issue = () =>
      send("match:command", {
        matchId: state.id,
        command: {
          ...command,
          actionId,
          version: state.version,
        },
      });
    try {
      await issue();
    } catch (error) {
      // As duas preparações podem enviar comandos juntos. Reutiliza o ID da ação.
      if (error.code !== "STALE_STATE" || state.phase !== "PREPARATION")
        throw error;
      await send("match:resume", {});
      await issue();
    }
    selected = null;
    targets = [];
    message("");
  } catch (e) {
    matchConnection.textContent = "Jogada não confirmada. Confira o aviso.";
    message(e.message, true);
  } finally {
    pending = false;
    render();
  }
}
let menuAnchor = { x: 20, y: 120 };
function anchorAt(event, element) {
  const rect = element.getBoundingClientRect();
  menuAnchor = { x: event.clientX || rect.right, y: event.clientY || rect.top };
}
function dragBinding(element, source) {
  bindCardDrag(element, {
    source,
    canStart: () =>
      myTurn() &&
      !pending &&
      (source.type !== "play" || !handBlock(source.card)),
    actionFor: (from, id) =>
      dropAction(
        from,
        state.slots.find((s) => s.id === id),
        state,
        user.id,
      ),
    onDrag: () => {
      inspector.hide();
      $("card-menu").hidden = true;
    },
    onDrop: (from, id, action, event) => {
      menuAnchor = { x: event.clientX, y: event.clientY };
      selected = {
        ...from,
        type: action,
        source: from.card.tipo === "Estrutura" ? "structure" : "card",
      };
      targets = [];
      selectSlot(state.slots.find((s) => s.id === id));
      if (
        action === "play" &&
        from.card.tipo === "Feitico" &&
        !["MultiplosInimigos", "Deck", "Cemiterio"].includes(from.card.alvo)
      ) {
        const spellTargets = [
          "Global",
          "TodosInimigos",
          "TodasTropasInimigas",
        ].includes(from.card.alvo)
          ? []
          : targets;
        void command({
          type: "play",
          cardId: from.card.id,
          targets: spellTargets,
        });
      }
    },
  });
}
function selectHand(card) {
  selected = { type: "hand", card };
  targets = [];
  render();
}
function prepareHand(card) {
  selected = { type: "play", card };
  targets = [];
  if (card.alvo === "Deck")
    zone(
      "Escolha um feitiço elemental",
      myPlayer().deck.filter(
        (c) =>
          c.tipo === "Feitico" &&
          c.elemento &&
          !["Neutro", "Zarcos"].includes(c.elemento),
      ),
      (c) => {
        targets = [c.id];
        $("zone-dialog").close();
        render();
      },
    );
  render();
}
function selectSlot(slot) {
  if (!myTurn() || pending) return;
  if (selected) {
    if (selected.type === "play" && selected.card.tipo !== "Feitico") {
      void command({
        type: "play",
        cardId: selected.card.id,
        slotId: slot.id,
        targets: [],
      });
      return;
    }
    if (selected.type === "move") {
      void command({
        type: "move",
        slotId: selected.slot.id,
        destinationId: slot.id,
      });
      return;
    }
    if (selected.type === "attack") {
      if (!selected.slot.attackTargets?.[selected.source]?.includes(slot.id))
        return;
      void command({
        type: "attack",
        slotId: selected.slot.id,
        targetId: slot.id,
        source: selected.source,
      });
      return;
    }
    if (selected.type === "play" || selected.type === "ability") {
      const targetType =
        selected.type === "ability"
          ? selected.ability.alvo
          : selected.card.alvo;
      const id = ["CampoAliado", "CampoInimigo"].includes(targetType)
        ? slot.id
        : targetType === "Estrutura"
          ? slot.structure?.id || slot.id
          : slot.card?.id || slot.structure?.id || slot.id;
      if (targets.includes(id)) targets = targets.filter((t) => t !== id);
      else if (targets.length < (selected.card?.maxAlvos || 1))
        targets.push(id);
      render();
      return;
    }
  }
  if (slot.card) {
    selected = { type: "field", slot, card: slot.card };
    targets = [];
    render();
  }
}
function actionButton(text, fn, blockedReason = "") {
  const button = node("button", text);
  button.disabled = pending || !myTurn() || !!blockedReason;
  button.setAttribute("role", "menuitem");
  const reason = blockedReason || (!myTurn() ? "Aguarde sua vez." : "");
  if (reason) {
    button.title = reason;
    button.append(node("small", reason, "action-reason"));
  }
  button.onclick = fn;
  return button;
}
function damageAction(effects = [], id = "") {
  return (
    ["ataqueFurtivo", "ordemDaEspada"].includes(id) ||
    effects.some(
      (e) =>
        [
          "damage",
          "stoneVolley",
          "tornado",
          "arrowRain",
          "tremor",
          "lightOrb",
          "sandstorm",
          "meteors",
        ].includes(e.id) ||
        (e.id === "status" &&
          [
            "Envenenado",
            "Envenenamento",
            "Queimado",
            "Queimacao",
            "Queimando",
            "Sangrando",
            "Sangramento",
            "Peste Negra",
            "Leptospirose",
          ].includes(e.status)),
    )
  );
}
function handBlock(card) {
  const p = myPlayer(),
    limits = p.mage.limites[0];
  if (card.tipo === "Tropa") {
    if (p.combatStarted) return "Você já atacou neste turno.";
    if (p.counters.summons >= limits.tropasMobilizadas)
      return "Limite de mobilização atingido.";
  }
  if (card.tipo === "Feitico") {
    if (meHasStatus("Cego"))
      return "Seu mago está Cego e não pode usar feitiços.";
    const conditionalLight =
      card.efeitos.every((e) => e.id === "lightOrb") &&
      p.mage.elemento !== "Fogo";
    if (state.openingBlocked && damageAction(card.efeitos) && !conditionalLight)
      return "Bloqueado na preparação e no primeiro turno de cada jogador.";
    if (
      (card.assinatura ? p.counters.unique : p.counters.spells) >=
      (card.assinatura ? limits.feiticosUnicos : limits.feiticosUsados)
    )
      return "Limite de feitiços atingido.";
  }
  if (
    !(state.phase === "PREPARATION" && card.tipo === "Tropa") &&
    p.mana < card.custoMana
  )
    return "Mana insuficiente.";
  return "";
}
function meHasStatus(name) {
  return myPlayer().mage.statuses.some(
    (s) => s.nome === name && s.turnosRestantes > 0,
  );
}
function renderActions() {
  const panel = $("action-panel"),
    menu = $("card-menu");
  panel.replaceChildren();
  const needsTarget =
    selected && ["attack", "move", "play", "ability"].includes(selected.type);
  menu.hidden =
    !selected ||
    selected.type === "attack" ||
    selected.type === "move" ||
    (selected.type === "play" && selected.card.tipo !== "Feitico");
  $("selection-help").hidden = !needsTarget;
  if (selected) {
    $("menu-title").textContent = selected.card.nome;
    menu.style.left = `${Math.max(10, Math.min(menuAnchor.x + 12, window.innerWidth - 290))}px`;
    menu.style.top = `${Math.max(10, Math.min(menuAnchor.y, window.innerHeight - 380))}px`;
    inspector.hide();
  }
  $("selection-help").textContent = !connected
    ? "Conexão interrompida. As ações voltarão quando o servidor reconectar."
    : !myTurn()
      ? "Aguarde o turno do oponente."
      : !selected
        ? "Selecione uma carta da mão ou do campo."
        : selected.type === "attack"
          ? `${selected.card.tipo === "Mago" ? "Universal" : selected.card.direcaoAtaque || selected.slot.card?.direcaoAtaque || "Frente"} · ${selected.slot.attackTargets?.[selected.source]?.length || 0} alvo(s) disponível(is). Escolha um alvo destacado para atacar.`
          : selected.type === "move"
            ? "Escolha um campo aliado vazio para reposicionar."
            : selected.type === "play" && selected.card.tipo !== "Feitico"
              ? "Escolha o campo onde deseja jogar a carta."
              : "Escolha os alvos no campo e confirme no menu da carta.";
  if (!selected) return;
  const inspected = selected.card || selected.slot?.card;
  if (inspected) {
    const imageButton = node("button", "", "menu-card-image");
    imageButton.setAttribute(
      "aria-label",
      `Ver somente a imagem de ${inspected.nome}`,
    );
    const image = document.createElement("img");
    image.src = inspected.imgURL || "/assets/avatar.png";
    image.alt = inspected.nome;
    imageButton.append(image);
    imageButton.onclick = () => inspector.art(inspected);
    const expand = node("button", "Ampliar carta", "quiet");
    expand.onclick = () => inspector.inspect(inspected);
    panel.append(imageButton, expand);
  }
  if (selected.type === "hand") {
    const card = selected.card;
    panel.append(
      actionButton(
        card.tipo === "Feitico"
          ? "Preparar feitiço"
          : card.tipo === "Estrutura"
            ? "Construir"
            : card.tipo === "Armamento"
              ? "Equipar"
              : "Mobilizar",
        () => prepareHand(card),
        handBlock(card),
      ),
    );
    panel.append(
      node(
        "p",
        "Arraste para um campo destacado ou escolha a ação e o destino.",
        "hint",
      ),
    );
  } else if (selected.type === "field" && selected.slot.ownerId === user.id) {
    const { card, slot } = selected;
    if (card.tipo === "Tropa" && myPlayer().mage.numeroCatalogo === "108")
      panel.append(
        actionButton(
          "Sacrificar com o Necromante",
          () => command({ type: "sacrifice", slotId: slot.id }),
          state.openingBlocked
            ? "Sacrifício bloqueado nesta fase."
            : myPlayer().mage.usedAbility
              ? "O mago já usou sua habilidade nesta rodada."
              : "",
        ),
      );
    if (["Tropa", "Mago", "Estrutura"].includes(card.tipo)) {
      panel.append(
        actionButton(
          "Atacar",
          () => {
            selected = {
              type: "attack",
              card,
              slot,
              source: card.tipo === "Estrutura" ? "structure" : "card",
            };
            targets = [];
            render();
          },
          state.openingBlocked
            ? "Ataques bloqueados na preparação e no primeiro turno de cada jogador."
            : card.attacked
              ? "Esta carta já atacou."
              : card.tipo === "Mago" &&
                  state.slots.some(
                    (s) => s.ownerId === user.id && s.card?.tipo === "Tropa",
                  )
                ? "Seu mago só ataca sem tropas em campo."
                : card.tipo !== "Mago" &&
                    myPlayer().counters.attacks >=
                      myPlayer().mage.limites[0].tropaAtacam
                  ? "Limite de ataques do mago atingido."
                  : card.statuses?.some((s) =>
                        [
                          "Incapacitado",
                          "Atordoado",
                          "Atordoamento",
                          "Congelado",
                          "Congelamento",
                        ].includes(s.nome),
                      )
                    ? "Um status impede o ataque."
                    : !slot.attackTargets?.[
                          card.tipo === "Estrutura" ? "structure" : "card"
                        ]?.length
                      ? "Nenhum alvo disponível para esta carta."
                      : "",
        ),
      );
      if (
        card.tipo === "Tropa" &&
        (state.phase === "PREPARATION" ||
          card.palavrasChave.includes("Campo livre"))
      )
        panel.append(
          actionButton("Reposicionar", () => {
            selected = { type: "move", card, slot };
            render();
          }),
        );
    }
    for (const ability of card.habilidadesAtivas)
      panel.append(
        actionButton(
          `${ability.nome} · ${ability.custoMana} mana`,
          () => {
            if (!abilityNeedsTarget(ability)) {
              void command({
                type: "ability",
                slotId: slot.id,
                abilityId: ability.id,
                source: card.tipo === "Estrutura" ? "structure" : "card",
                targets: [],
              });
              return;
            }
            selected = { type: "ability", slot, card, ability };
            targets = [];
            if (ability.id === "ressurreicaoSombria")
              zone(
                "Escolha uma tropa do cemitério",
                myPlayer().graveyard.filter((c) => c.tipo === "Tropa"),
                (c) => {
                  targets = [c.id];
                  $("zone-dialog").close();
                  render();
                },
              );
            if (ability.id === "recuperarEnergia")
              zone(
                "Escolha um feitiço da mão para sacrificar",
                myPlayer().hand.filter((c) => c.tipo === "Feitico"),
                (c) => {
                  targets = [c.id];
                  $("zone-dialog").close();
                  render();
                },
              );
            render();
          },
          state.openingBlocked
            ? "Bloqueado na preparação e no primeiro turno de cada jogador."
            : myPlayer().mana < ability.custoMana
              ? "Mana insuficiente."
              : card.usedAbility
                ? "Uma habilidade por carta por rodada."
                : state.openingBlocked
                  ? "Habilidades bloqueadas para o primeiro jogador neste turno."
                  : card.statuses?.some((s) =>
                        [
                          "Congelado",
                          "Congelamento",
                          "Atordoado",
                          "Atordoamento",
                          "Cego",
                          "Cegueira",
                        ].includes(s.nome),
                      )
                    ? "Um efeito ativo impede habilidades."
                    : "",
        ),
      );
  } else if (selected.type === "field") {
    panel.append(
      node(
        "p",
        "Carta do adversário. Use o botão direito para ampliar.",
        "hint",
      ),
    );
  } else if (selected.type === "play") {
    const card = selected.card;
    if (card.tipo !== "Feitico")
      panel.append(
        node(
          "p",
          "Clique no slot do seu lado para posicionar a carta.",
          "hint",
        ),
      );
    else {
      panel.append(
        node(
          "p",
          ["Global", "TodosInimigos", "TodasTropasInimigas"].includes(card.alvo)
            ? "Efeito sem seleção individual."
            : `Selecione os alvos e confirme (${targets.length}/${card.maxAlvos}).`,
          "hint",
        ),
      );
      panel.append(
        actionButton(
          "Conjurar feitiço",
          () => command({ type: "play", cardId: card.id, targets }),
          handBlock(card),
        ),
      );
    }
  } else if (selected.type === "ability") {
    const ability = selected.ability;
    if (ability.id === "protecaoAquatica") {
      for (const mode of ["cura", "escudo"])
        panel.append(
          actionButton(
            mode === "cura" ? "Confirmar cura" : "Confirmar escudo",
            () =>
              command({
                type: "ability",
                slotId: selected.slot.id,
                abilityId: ability.id,
                source:
                  selected.card.tipo === "Estrutura" ? "structure" : "card",
                targets,
                mode,
              }),
          ),
        );
    } else
      panel.append(
        actionButton("Usar habilidade", () =>
          command({
            type: "ability",
            slotId: selected.slot.id,
            abilityId: ability.id,
            source: selected.card.tipo === "Estrutura" ? "structure" : "card",
            targets,
          }),
        ),
      );
    panel.append(node("p", `Alvos selecionados: ${targets.length}`, "hint"));
  } else
    panel.append(
      node(
        "p",
        selected.type === "attack"
          ? "Clique no slot inimigo ao alcance. Slot vazio direciona o dano ao mago."
          : "Clique em outro slot de tropa do seu lado.",
        "hint",
      ),
    );
  if (inspected) {
    const notes = node("details", "", "card-rules-notes");
    notes.open = true;
    notes.append(node("summary", "Habilidades e passivas"));
    for (const ability of inspected.habilidadesAtivas || []) {
      notes.append(
        node("strong", `${ability.nome} · ${ability.custoMana} mana`),
        node("p", abilityDescription(ability)),
      );
    }
    for (const passive of inspected.habilidadesPassivas || [])
      notes.append(
        node("p", passiveDescription(passive), "passive-description"),
      );
    if (
      !inspected.habilidadesAtivas?.length &&
      !inspected.habilidadesPassivas?.length
    )
      notes.append(node("p", "Esta carta não possui habilidades ou passivas."));
    panel.append(notes);
  }
  if (!menu.hidden)
    menu.style.top = `${Math.max(12, Math.min(menuAnchor.y, window.innerHeight - menu.offsetHeight - 12))}px`;
}
function slotView(slot) {
  const button = node("button", "", "board-slot");
  button.type = "button";
  const card = slot.card;
  button.dataset.kind = slot.kind;
  button.dataset.slotId = slot.id;
  if (card) {
    button.classList.add("occupied");
    if (card.attacked) button.classList.add("exhausted");
    inspector.bind(button, card);
    const img = document.createElement("img");
    img.src = card.imgURL || "/assets/avatar.png";
    img.alt = "";
    img.onerror = () => {
      img.onerror = null;
      img.src = "/assets/avatar.png";
    };
    const oldFace = document.querySelector(`[data-live-card-id="${card.id}"]`);
    const previous = oldFace
      ? {
          attack: oldFace.querySelector(".attack")?.dataset.value,
          health: oldFace.querySelector(".health")?.dataset.value,
        }
      : undefined;
    button.append(
      cardFace(card, {
        slot,
        slots: state.slots,
        previous,
        reactions: state.reactions,
      }),
    );
  } else
    button.append(
      node(
        "span",
        slot.kind === "Tropa" ? `Tropa · ${slot.column + 1}` : slot.kind,
      ),
    );
  if (slot.structure)
    button.append(
      node("strong", `${slot.structure.nome} · ${slot.structure.hpAtual} vida`),
    );
  if (slot.terrain)
    button.append(
      node(
        "span",
        `Pântano · ${slot.terrain.rodadasRestantes} rodadas`,
        "terrain-label",
      ),
    );
  else if (slot.appliedElement && slot.appliedElement !== "Neutro")
    button.append(
      node(
        "span",
        `Elemento aplicado: ${slot.appliedElement === "Agua" ? "Água" : slot.appliedElement}`,
        "terrain-label",
      ),
    );
  if (slot.terrain)
    button.querySelector(".terrain-label").title =
      state.reactions?.Lama?.description || "";
  button.setAttribute(
    "aria-label",
    `${slot.ownerId === user.id ? "Seu campo" : "Oponente"}: ${card?.nome || "slot vazio"}, ${slot.kind}, coluna ${slot.column + 1}`,
  );
  if (
    selected?.slot?.id === slot.id ||
    targets.includes(card?.id) ||
    targets.includes(slot.structure?.id) ||
    targets.includes(slot.id)
  )
    button.classList.add("selected");
  button.dataset.actionsBlocked = String(!myTurn() || pending);
  if (selected?.type === "attack" && slot.ownerId !== user.id) {
    const valid =
      selected.slot.attackTargets?.[selected.source]?.includes(slot.id) &&
      myTurn() &&
      !pending;
    button.classList.add(valid ? "attack-target" : "attack-unavailable");
    button.setAttribute("aria-disabled", String(!valid));
    if (valid) {
      const mageTarget =
        slot.kind === "Mago" ||
        !slot.card ||
        slot.card.statuses?.some((s) => s.nome === "Congelado");
      const label = mageTarget ? "Atacar mago" : "Atacar";
      button.append(node("span", label, "attack-target-label"));
      button.setAttribute(
        "aria-label",
        `${label}: ${card?.nome || "coluna " + (slot.column + 1)}`,
      );
    }
  }
  button.onclick = (event) => {
    anchorAt(event, button);
    if (selected && !["field", "hand"].includes(selected.type)) {
      if (myTurn() && !pending) selectSlot(slot);
      return;
    }
    if (card) {
      selected = { type: "field", slot, card };
      targets = [];
      render();
    } else if (myTurn() && !pending) selectSlot(slot);
  };
  if (card && slot.ownerId === user.id)
    dragBinding(button, { type: "field", card, slot });
  if (!slot.structure) return button;
  const wrapper = node("div", "", "board-slot-wrap");
  const structureButton = node(
    "button",
    `Estrutura: ${slot.structure.nome}`,
    "structure-action",
  );
  structureButton.type = "button";
  inspector.bind(structureButton, slot.structure);
  structureButton.onclick = (event) => {
    anchorAt(event, structureButton);
    selected = { type: "field", slot, card: slot.structure };
    targets = [];
    render();
  };
  dragBinding(structureButton, { type: "field", card: slot.structure, slot });
  wrapper.append(button, structureButton);
  return wrapper;
}
const boardKeys = new Map();
let handKey = "";
function renderBoard(owner, frontId, backId, reverse = false) {
  const key = JSON.stringify([
    state.id,
    state.slots,
    selected,
    targets,
    pending,
    myTurn(),
    myPlayer().mana,
    myPlayer().counters,
  ]);
  if (boardKeys.get(frontId) === key) return;
  boardKeys.set(frontId, key);
  const own = state.slots.filter((s) => s.ownerId === owner),
    get = (suffix) => own.find((s) => s.id.endsWith(suffix));
  const front = [
    get(":arm:front-left"),
    ...own
      .filter((s) => s.kind === "Tropa")
      .sort((a, b) => a.column - b.column),
    get(":arm:front-right"),
  ];
  const back = [get(":arm:back-left"), get(":mage"), get(":arm:back-right")];
  $(frontId).replaceChildren(
    ...(reverse ? front.reverse() : front).map(slotView),
  );
  $(backId).replaceChildren(...(reverse ? back.reverse() : back).map(slotView));
}
function hud(id, player) {
  const limits = player.mage.limites[0];
  const identity = node("div", "", "duelist-identity");
  identity.append(
    node("span", player.nome.slice(0, 1), "duelist-avatar"),
    (() => {
      const link = node("a", player.nome);
      link.href = `/HTML/perfil.html?id=${encodeURIComponent(player.id)}`;
      link.target = "_blank";
      link.rel = "noopener";
      return link;
    })(),
  );
  if (player.deckAppearance) {
    const icon = document.createElement("img");
    icon.src = player.deckAppearance.icone;
    icon.alt = "";
    icon.className = "duelist-avatar deck-icon";
    identity.firstChild.replaceWith(icon);
    const name = node("span", player.deckAppearance.nome, "duelist-deck-name");
    identity.append(name);
  }
  const resources = node("div", "", "duelist-resources");
  for (const [label, value, kind] of [
    ["Vida", player.mage.hpAtual, "health"],
    ["Mana", player.mana + "/20", "mana"],
    ["Baralho", player.deckCount, "deck"],
    ["Mão", player.handCount, "cards"],
  ]) {
    const item = node("div", "", `resource ${kind}`);
    item.append(node("b", String(value)), node("small", label));
    resources.append(item);
  }
  const actions = node("div", "", "duelist-limits");
  if (player.inactivityStreak)
    actions.append(
      node(
        "span",
        `Inatividade ${player.inactivityStreak}/3`,
        "limit-token inactivity-token",
      ),
    );
  for (const [label, used, max] of [
    ["Mobilizar", player.counters.summons, limits.tropasMobilizadas],
    ["Atacar", player.counters.attacks, limits.tropaAtacam],
    ["Feitiços", player.counters.spells, limits.feiticosUsados],
    ["Assinatura", player.counters.unique, limits.feiticosUnicos],
  ]) {
    const item = node("span", `${label} ${used}/${max}`, "limit-token");
    item.classList.toggle("spent", used >= max);
    actions.append(item);
  }
  $(id).replaceChildren(identity, resources, actions);
}
function render() {
  responsePanel.replaceChildren();
  responsePanel.hidden = !state?.pendingSpell;
  if (state?.pendingSpell && user) {
    selected = null;
    targets = [];
    responsePanel.append(
      node("h2", `${state.pendingSpell.card.nome} aguardando resposta`),
      node(
        "p",
        "O cronômetro do turno está pausado durante a janela de resposta.",
      ),
    );
    if (state.pendingSpell.casterId !== user.id) {
      const card = myPlayer().hand.find((c) => c.numeroCatalogo === "002");
      const cancel = node(
        "button",
        "Cancelar com Jato d'água · 3 mana",
        "primary",
      );
      cancel.disabled =
        pending || !state.canRespond || state.paused || !connected;
      cancel.onclick = () => command({ type: "respondSpell", cardId: card.id });
      const pass = node("button", "Não responder", "quiet");
      pass.disabled = pending || state.paused || !connected;
      pass.onclick = () => command({ type: "respondSpell" });
      responsePanel.append(cancel, pass);
    }
  }
  if (!state || !user) return;
  $("lobby").hidden = true;
  $("match").hidden = false;
  const me = myPlayer(),
    enemy = state.players.find((p) => p.id !== user.id);
  ongoingPanel.replaceChildren();
  ongoingPanel.hidden = !state.ongoingSpells?.length;
  for (const spell of state.ongoingSpells ?? []) {
    const name = {
      tornado: "Furacão",
      arrowRain: "Chuva de Flechas",
      sandstorm: "Furacão de Areia",
    }[spell.kind];
    ongoingPanel.append(
      node(
        "p",
        `${name} · ${spell.ownerId === user.id ? "Seu efeito" : "Efeito do oponente"} · ${spell.damage} de dano no fim da rodada · ${spell.rounds} rodada(s) restante(s)`,
      ),
    );
  }
  if (state.status === "FINISHED") {
    selected = null;
    targets = [];
  }
  if (
    selected?.card &&
    ![
      ...me.hand,
      ...state.slots.flatMap((s) => [s.card, s.structure].filter(Boolean)),
    ].some((c) => c.id === selected.card.id)
  ) {
    selected = null;
    targets = [];
  }
  if (selected?.card) {
    selected.card =
      [
        ...me.hand,
        ...state.slots.flatMap((s) => [s.card, s.structure].filter(Boolean)),
      ].find((c) => c.id === selected.card.id) || selected.card;
    if (selected.slot)
      selected.slot = state.slots.find((s) => s.id === selected.slot.id);
  }
  $("match-title").textContent =
    state.status === "FINISHED"
      ? state.winner === user.id
        ? "Você venceu"
        : state.winner
          ? "Você foi derrotado"
          : "Empate"
      : state.phase === "PREPARATION"
        ? "Rodada 1 · Preparação simultânea"
        : `Rodada ${state.round} · Turno ${state.turn} · ${state.current === user.id ? "Sua vez" : "Vez do oponente"}`;
  $("end-turn").textContent =
    state.phase === "PREPARATION" ? "Confirmar preparação" : "Passar turno";
  $("end-turn").disabled = !myTurn() || pending;
  $("surrender").disabled = !connected || pending || state.status !== "ACTIVE";
  $("new-match").hidden = state.status !== "FINISHED";
  $("view-result").hidden = state.status !== "FINISHED";
  rematch.hidden = state.status !== "FINISHED";
  hud("my-hud", me);
  hud("enemy-hud", enemy);
  cardBackDisplay.update(
    me.deckCount,
    me.graveyard.length,
    me.deckAppearance?.verso,
  );
  $("preparation-controls").hidden =
    state.phase !== "PREPARATION" || state.status !== "ACTIVE";
  $("preparation-status").textContent =
    `${me.preparation.ready ? "Sua preparação foi confirmada." : "Escolha as tropas da sua mão e seus slots."} ${enemy.preparation.ready ? "O oponente está pronto." : "O oponente está preparando o campo."}`;
  $("mulligan").disabled =
    !myTurn() ||
    pending ||
    me.preparation.started ||
    me.preparation.redraws >= 3 ||
    me.hand.some((c) => c.tipo === "Tropa");
  $("mulligan").textContent = `Reembaralhar mão (${me.preparation.redraws}/3)`;
  $("bonus-draw-controls").hidden = !me.preparation.bonusDraws;
  $("bonus-draw-label").textContent =
    `O oponente reembaralhou. Você tem ${me.preparation.bonusDraws} compra(s) extra(s) opcional(is), uma por reembaralhamento.`;
  for (const id of ["accept-bonus", "decline-bonus"])
    $(id).disabled = pending || !connected;
  renderBoard(me.id, "my-front", "my-back");
  renderBoard(enemy.id, "enemy-front", "enemy-back", true);
  const nextHandKey = JSON.stringify([
    state.id,
    me.hand,
    selected?.card?.id,
    myTurn(),
    pending,
  ]);
  if (nextHandKey !== handKey) {
    handKey = nextHandKey;
    $("hand").replaceChildren(
      ...me.hand.map((card) => {
        const tile = node("button", "", "battle-hand-card");
        tile.type = "button";
        tile.setAttribute(
          "aria-label",
          `${card.nome}, ${card.tipo}, ${card.custoMana} mana`,
        );
        tile.append(cardFace(card, { hand: true }));
        tile.onclick = (event) => {
          anchorAt(event, tile);
          selectHand(card);
        };
        dragBinding(tile, { type: "play", card });
        inspector.bind(tile, card);
        tile.dataset.actionsBlocked = String(!myTurn() || pending);
        if (selected?.card?.id === card.id) tile.classList.add("selected");
        return tile;
      }),
    );
  }
  $("hand-count").textContent = `${me.hand.length} cartas`;
  $("battle-arena").classList.toggle("your-turn", myTurn());
  $("log").replaceChildren(...state.log.map((text) => node("p", text)));
  renderActions();
  matchResult.update(state, user.id, () => {
    inspector.hide();
    if ($("zone-dialog").open) $("zone-dialog").close();
  });
}
function zone(title, cards, select) {
  inspector.hide();
  $("zone-title").textContent = title;
  $("zone-cards").replaceChildren(
    ...cards.map((c) =>
      (() => {
        const tile = cardTile(c, (card) => {
          if (select) select(card);
          else inspector.inspect(card);
        });
        inspector.bind(tile, c);
        return tile;
      })(),
    ),
  );
  if (!cards.length)
    $("zone-cards").append(node("p", "Não há cartas nesta zona.", "muted"));
  $("zone-dialog").showModal();
}
$("zone-close").onclick = () => $("zone-dialog").close();
$("clear-selection").onclick = resetSelection;
$("menu-close").onclick = resetSelection;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") resetSelection();
});
document.addEventListener("pointerdown", (event) => {
  if (
    selected &&
    ["hand", "field"].includes(selected.type) &&
    !event.target.closest(
      "#card-menu, .board-slot, .battle-hand-card, .structure-action",
    )
  )
    resetSelection();
});
window.addEventListener("resize", () => {
  if (state) renderActions();
});
$("graveyard").onclick = () =>
  state && zone("Seu cemitério", myPlayer().graveyard);
$("deck-zone").onclick = () =>
  state && zone("Seu baralho (sem ordem de compra)", myPlayer().deck);
$("end-turn").onclick = () => command({ type: "endTurn" });
$("mulligan").onclick = () => command({ type: "mulligan" });
$("accept-bonus").onclick = () =>
  command({ type: "preparationBonus", accept: true });
$("decline-bonus").onclick = () =>
  command({ type: "preparationBonus", accept: false });
$("surrender").onclick = () => {
  if (confirm("Desistir desta partida?")) void command({ type: "surrender" });
};
$("new-match").onclick = async () => {
  if (state) {
    try {
      await send("match:refuseRematch", { matchId: state.id });
      await send("match:ackResult", { matchId: state.id });
    } catch (e) {
      message(e.message, true);
      return;
    }
  }
  state = null;
  matchResult.close();
  inspector.hide();
  selected = null;
  targets = [];
  rematch.disabled = false;
  $("match").hidden = true;
  $("lobby").hidden = false;
  queued = false;
  updateLobby();
};
function updateLobby() {
  const id = $("lobby-deck").value,
    deck = decks.find((d) => d._id === id),
    map = new Map(catalog.map((c) => [c.numeroCatalogo, c]));
  const ready =
    deck &&
    deck.cartas.length === 40 &&
    map.get(deck.mago)?.publicado &&
    deck.cartas.every((id) => map.get(id)?.publicado);
  $("join").disabled = !connected || queued || !ready;
  $("cancel").hidden = !queued;
  $("lobby-deck").disabled = queued;
  $("lobby-validation").textContent = queued
    ? "Buscando outro duelista… Você pode cancelar a qualquer momento."
    : ready
      ? "Deck pronto. A validação final será feita pelo servidor."
      : "Escolha um baralho com 40 cartas publicadas e um mago publicado.";
}
$("lobby-deck").onchange = updateLobby;
$("join").onclick = async () => {
  $("join").disabled = true;
  try {
    await send("queue:join", { deckId: $("lobby-deck").value });
  } catch (e) {
    message(e.message, true);
  } finally {
    updateLobby();
  }
};
$("cancel").onclick = async () => {
  try {
    await send("queue:cancel", {});
  } catch (e) {
    message(e.message, true);
  }
};
setInterval(() => {
  if (state?.status === "ACTIVE")
    $("turn-clock").textContent = connected
      ? state.paused
        ? "Pausado · aguardando reconexão"
        : state.pendingSpell
          ? `Resposta: ${Math.max(0, Math.ceil((state.responseDeadline - Date.now() - clockOffset) / 1000))}s · turno pausado`
          : `${Math.max(0, Math.ceil((state.deadline - Date.now() - clockOffset) / 1000))}s restantes`
      : "Reconectando…";
  else $("turn-clock").textContent = state ? "Encerrado" : "";
}, 500);
async function load() {
  if (!token()) {
    location.href = "/HTML/login.html";
    return;
  }
  user = await navbar();
  if (!user) return;
  try {
    const [data, cardData] = await Promise.all([api("/decks"), api("/cards")]);
    decks = data.decks;
    catalog = cardData.cards;
    $("lobby-deck").replaceChildren(
      ...decks.map((d) => {
        const option = node("option", `${d.nome} · ${d.cartas.length}/40`);
        option.value = d._id;
        return option;
      }),
    );
    const requested = new URLSearchParams(location.search).get("deck");
    if (decks.some((d) => d._id === requested))
      $("lobby-deck").value = requested;
    transport = gameTransport();
    transport.on("connect", () => {
      connected = true;
      $("connection").textContent = "Conectado ao servidor.";
      matchConnection.textContent = "Conectado";
      updateLobby();
      if (state) render();
    });
    transport.on("latency", (ms) => {
      $("connection").textContent = `Conectado · última jogada: ${ms} ms`;
      matchConnection.textContent = `Última jogada confirmada em ${ms} ms`;
    });
    transport.on("connect_error", (e) => {
      connected = false;
      $("connection").textContent = e.message;
      matchConnection.textContent = e.message;
      message(e.message, true);
      updateLobby();
    });
    transport.on("disconnect", () => {
      connected = false;
      $("connection").textContent =
        "Conexão interrompida. Tentando reconectar…";
      matchConnection.textContent = "Reconectando…";
      updateLobby();
      if (state) render();
    });
    transport.on("queue:state", (data) => {
      queued = data.queued;
      if (data.content) message(data.content);
      updateLobby();
    });
    transport.on("match:state", (data) => {
      clockOffset = (data.serverNow ?? Date.now()) - Date.now();
      if (state?.id !== data.id) {
        selected = null;
        targets = [];
        rematch.disabled = false;
        message("");
      }
      state = data;
      render();
      battleEvents.update(data);
      if (data.status === "FINISHED" && !acknowledgedResults.has(data.id)) {
        acknowledgedResults.add(data.id);
        void send("match:ackResult", { matchId: data.id }).catch((e) => {
          acknowledgedResults.delete(data.id);
          message(e.message, true);
        });
      }
    });
    transport.on("match:rematchState", (data) => {
      if (data.matchId !== state?.id) return;
      if (data.canceled) {
        rematch.disabled = true;
        message(
          "O oponente encerrou a revanche. Você pode buscar uma nova partida.",
        );
      } else if (data.requestedBy !== user.id)
        message(
          "O oponente quer uma revanche. Clique em Revanche para aceitar.",
        );
    });
    transport.on("game:error", (data) =>
      message(
        data.content +
          (data.details
            ? "\n" +
              data.details
                .map((d) => (typeof d === "string" ? d : d.message))
                .join("\n")
            : ""),
        true,
      ),
    );
    updateLobby();
  } catch (e) {
    message(e.message, true);
    $("connection").textContent =
      "Não foi possível iniciar. Confira sua sessão e a conexão com o servidor.";
  }
}
void load();

window.addEventListener("pagehide", () => {
  transport?.close();
  battleEvents.close();
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
