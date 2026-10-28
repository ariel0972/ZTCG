import { api, message } from "./auth.js";
import { cardFace } from "./battle-ui.js";
import { describe } from "./card-view.js";
import { setImageSource } from "./image-sources.js";
export function createTutorialController(
  doc,
  user,
  { request = api, onError = (e) => message(e.message, true) } = {},
) {
  const $ = (id) => doc.getElementById(id),
    make = (tag, text = "", className = "") => {
      const n = doc.createElement(tag);
      n.textContent = text;
      n.className = className;
      return n;
    };
  let data,
    pending = false,
    selection = null,
    coinTimer,
    shownCoinVersion;
  function reveal(node) {
    if (doc.defaultView?.matchMedia?.("(max-width: 1000px)").matches)
      node?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
  function focusLesson() {
    $("lesson-title").focus({ preventScroll: true });
    reveal($("lesson-title"));
  }
  function button(text, run, className = "primary") {
    const b = make("button", text, className);
    b.type = "button";
    b.disabled = pending;
    b.onclick = run;
    return b;
  }
  async function send(type, extra = {}) {
    if (pending || !data) return;
    pending = true;
    selection = null;
    setBusy();
    try {
      data = await request("/tutorial/action", {
        method: "POST",
        body: JSON.stringify({
          type,
          ...extra,
          actionId: crypto.randomUUID(),
          version: data.version,
        }),
      });
      paint(true);
    } catch (e) {
      onError(e);
      try {
        data = await request("/tutorial/state");
        paint();
      } catch {
        $("tutorial-instruction").textContent =
          "Não foi possível salvar. Confira a conexão e use Recarregar treino.";
        $("lesson-controls").append(button("Recarregar treino", load, "quiet"));
      }
    } finally {
      pending = false;
      setBusy();
    }
  }
  function setBusy() {
    $("tutorial-root").setAttribute("aria-busy", String(pending));
    for (const b of doc.querySelectorAll("#tutorial-root button"))
      b.disabled = pending || b.dataset.coinWaiting === "true";
  }
  function showCard(card, advance = false) {
    $("tutorial-card-title").textContent = card.nome;
    const content = $("tutorial-card-content");
    content.replaceChildren();
    const art = make("img");
    art.alt = "Carta " + card.nome;
    setImageSource(art, card.imgURL, true);
    const text = make("pre", describe(card));
    content.append(art, text);
    const close = $("tutorial-card-close");
    close.textContent = advance ? "Entendi; continuar" : "Fechar carta";
    close.onclick = () => {
      $("tutorial-card-dialog").close();
      if (advance) void send("inspect", { cardId: card.id });
    };
    $("tutorial-card-dialog").showModal();
  }
  function chooseCard(card, slot) {
    if (pending) return;
    if (data.lesson.id === "hand" && card.id === data.expected.cardId) {
      showCard(card, true);
      return;
    }
    const panel = $("tutorial-action");
    panel.replaceChildren(
      make("strong", card.nome),
      button("Ver carta", () => showCard(card), "quiet"),
    );
    const canPlay =
      card.id === data.expected.cardId && data.lesson.action === "play";
    if (canPlay)
      panel.append(
        button(
          card.tipo === "Tropa"
            ? "Mobilizar · " +
                (data.match.phase === "PREPARATION"
                  ? "grátis"
                  : card.custoMana + " mana")
            : "Conjurar · " + card.custoMana + " mana",
          () => {
            selection = {
              type: card.tipo === "Tropa" ? "play" : "spell",
              cardId: card.id,
            };
            paintBoard();
          },
        ),
      );
    if (
      slot?.id === data.expected.sourceSlotId &&
      data.lesson.action === "ability"
    )
      panel.append(
        button("Modo Ofensivo · 2 mana", () =>
          send("ability", {
            slotId: slot.id,
            abilityId: data.expected.abilityId,
          }),
        ),
      );
    if (
      slot?.id === data.expected.sourceSlotId &&
      data.lesson.action === "attack"
    )
      panel.append(
        button("Atacar", () => {
          selection = { type: "attack", slotId: slot.id };
          paintBoard();
        }),
      );
    if (!canPlay && slot?.id !== data.expected.sourceSlotId)
      panel.append(
        make(
          "p",
          "Você pode ler esta carta. Para avançar, siga a indicação da etapa.",
        ),
      );
    reveal(panel);
  }
  function fieldClick(slot) {
    if (pending) return;
    if (
      selection?.type === "play" &&
      slot.ownerId === user.id &&
      slot.kind === "Tropa" &&
      !slot.card &&
      !slot.terrain &&
      data.expected.destinations.includes(slot.id)
    ) {
      void send("play", { cardId: selection.cardId, slotId: slot.id });
      return;
    }
    if (selection?.type === "spell" && slot.id === data.expected.targetSlotId) {
      void send("play", { cardId: selection.cardId, targets: [slot.card.id] });
      return;
    }
    if (
      selection?.type === "attack" &&
      slot.id === data.expected.targetSlotId
    ) {
      void send("attack", { slotId: selection.slotId, targetId: slot.id });
      return;
    }
    if (slot.card) chooseCard(slot.card, slot);
  }
  function paintBoard() {
    if (!data?.match) return;
    const match = data.match,
      lesson = data.lesson;
    for (const [host, owner] of [
      ["tutorial-player", user.id],
      ["tutorial-enemy", data.expected.coachId],
    ]) {
      const container = $(host),
        p = match.players.find((p) => p.id === owner);
      container.replaceChildren();
      const mageSlot = match.slots.find(
          (s) => s.ownerId === owner && s.kind === "Mago",
        ),
        mage = button("", () => fieldClick(mageSlot), "tutorial-mage");
      mage.append(
        cardFace(mageSlot.card, { slot: mageSlot, slots: match.slots }),
        make(
          "span",
          owner === user.id ? "Seu mago" : "Mago de treino · 5 PV iniciais",
          "tutorial-mage-label",
        ),
      );
      mage.dataset.slotId = mageSlot.id;
      const slots = make("div", "", "tutorial-slots");
      for (const slot of match.slots
        .filter((s) => s.ownerId === owner && s.kind === "Tropa")
        .sort((a, b) =>
          owner === user.id ? a.column - b.column : b.column - a.column,
        )) {
        const tile = button("", () => fieldClick(slot), "tutorial-slot");
        tile.dataset.slotId = slot.id;
        tile.setAttribute(
          "aria-label",
          (owner === user.id ? "Seu campo" : "Campo inimigo") +
            " " +
            (slot.column + 1) +
            (slot.card ? ": " + slot.card.nome : ": vazio"),
        );
        if (slot.card) {
          tile.append(cardFace(slot.card, { slot, slots: match.slots }));
          tile.dataset.catalog = slot.card.numeroCatalogo;
        } else tile.append(make("span", "Espaço " + (slot.column + 1)));
        const destination =
          selection?.type === "play" &&
          owner === user.id &&
          !slot.card &&
          !slot.terrain &&
          data.expected.destinations.includes(slot.id);
        const target =
          ["spell", "attack"].includes(selection?.type) &&
          slot.id === data.expected.targetSlotId;
        const source =
          ["ability", "attack"].includes(lesson.action) &&
          slot.id === data.expected.sourceSlotId &&
          !selection;
        tile.classList.toggle(
          "tutorial-highlight",
          destination ||
            target ||
            source ||
            (lesson.focus === "effect" &&
              slot.id === data.expected.targetSlotId),
        );
        slots.append(tile);
      }
      if (selection?.type === "attack" && lesson.id === "finish")
        mage.classList.add("tutorial-highlight");
      const pile = make("div", "", "tutorial-pile");
      pile.append(
        make("span", "Baralho · " + (p.deck?.length ?? p.deckCount ?? 0)),
      );
      const grave = button(
        "Cemitério · " + p.graveyard.length,
        () => {
          const content = $("tutorial-card-content");
          $("tutorial-card-title").textContent =
            owner === user.id ? "Seu cemitério" : "Cemitério do adversário";
          content.replaceChildren(
            ...p.graveyard.map((c) => make("p", c.nome + " · " + c.tipo)),
          );
          $("tutorial-card-close").textContent =
            lesson.id === "graveyard" && owner !== user.id
              ? "Entendi; continuar"
              : "Fechar";
          $("tutorial-card-close").onclick = () => {
            $("tutorial-card-dialog").close();
            if (lesson.id === "graveyard" && owner !== user.id)
              void send("inspectGraveyard");
          };
          $("tutorial-card-dialog").showModal();
        },
        "quiet",
      );
      grave.dataset.graveyard = owner;
      if (lesson.focus === "graveyard" && owner !== user.id)
        grave.classList.add("tutorial-highlight");
      pile.append(grave);
      container.append(mage, slots, pile);
    }
    const me = match.players.find((p) => p.id === user.id);
    $("tutorial-mana").textContent = me.mana + " / 20 mana";
    $("tutorial-hand").replaceChildren(
      ...me.hand.map((card) => {
        const tile = button("", () => chooseCard(card), "tutorial-hand-card");
        tile.dataset.cardId = card.id;
        tile.dataset.catalog = card.numeroCatalogo;
        tile.append(cardFace(card, { hand: true }));
        tile.setAttribute(
          "aria-label",
          card.nome + ", " + card.custoMana + " mana",
        );
        if (card.id === data.expected.cardId && !selection)
          tile.classList.add("tutorial-highlight");
        return tile;
      }),
    );
    $("tutorial-turn").textContent =
      match.phase === "PREPARATION"
        ? "Fase de preparação · mobilização gratuita"
        : match.phase === "COIN_TOSS"
          ? "Cara ou coroa · quem começa?"
          : "Turno " +
            match.turn +
            " · " +
            (match.current === user.id ? "Sua vez" : "Vez do Guia de Zacornia");
    if (selection)
      reveal(
        doc.querySelector(
          ".tutorial-slot.tutorial-highlight, .tutorial-mage.tutorial-highlight",
        ),
      );
    $("tutorial-instruction").textContent =
      selection?.type === "play"
        ? "Agora clique em um espaço livre destacado do seu lado."
        : selection?.type === "spell"
          ? "Agora clique na tropa inimiga destacada."
          : selection?.type === "attack"
            ? "Agora clique no alvo destacado para atacar."
            : lesson.action === "play"
              ? "Clique na carta destacada na sua mão."
              : ["ability", "attack"].includes(lesson.action)
                ? "Clique no Guerreiro destacado para abrir suas ações."
                : "";
  }
  function paint(focus = false) {
    selection = null;
    $("tutorial-loading").hidden = true;
    $("tutorial-content").hidden = false;
    $("tutorial-root").setAttribute("aria-busy", "false");
    $("lesson-title").textContent = data.lesson.title;
    $("lesson-body").textContent = data.lesson.body;
    $("lesson-hint").textContent = data.lesson.hint;
    $("tutorial-progress-label").textContent = data.completed
      ? "TREINO ENCERRADO"
      : "ETAPA " + (data.step + 1) + " DE " + data.total;
    $("tutorial-progress").max = data.total;
    $("tutorial-progress").value = data.step;
    const controls = $("lesson-controls");
    controls.replaceChildren();
    $("tutorial-action").replaceChildren();
    $("tutorial-turn-controls").replaceChildren();
    $("skip-tutorial").hidden = data.completed;
    $("tutorial-board").hidden = data.completed;
    $("tutorial-complete").hidden = !data.completed;
    if (data.completed) {
      $("tutorial-complete-title").textContent = data.skipped
        ? "Tudo pronto para começar"
        : "Primeira vitória!";
      $("tutorial-complete-body").textContent = data.skipped
        ? "Você pode refazer o tutorial quando quiser. O modo contra IA é uma boa forma de praticar."
        : "Seu treino foi concluído e salvo. Agora escolha seu mago e monte um baralho.";
      $("tutorial-instruction").textContent = "";
      if (focus) focusLesson();
      return;
    }
    if (data.lesson.action === "chooseCoin")
      for (const [text, face] of [
        ["Cara", "heads"],
        ["Coroa", "tails"],
      ])
        controls.append(button(text, () => send("chooseCoin", { face })));
    if (data.lesson.button) {
      const primary = button(data.lesson.button, () =>
        send(data.lesson.action),
      );
      controls.append(primary);
      if (data.lesson.action === "endTurn") {
        const end = button(data.lesson.button, () => send("endTurn"));
        end.classList.add("tutorial-highlight");
        $("tutorial-turn-controls").append(end);
      }
    }
    if (data.lesson.id === "coinResult") {
      const face = data.match.coinToss.result === "heads" ? "Cara" : "Coroa",
        coin = make("div", face, "tutorial-coin");
      coin.setAttribute("role", "img");
      coin.setAttribute("aria-label", "Resultado da moeda: " + face);
      controls.prepend(
        coin,
        make(
          "p",
          "Você: " + face + " · Guia: " + (face === "Cara" ? "Coroa" : "Cara"),
          "tutorial-coin-choices",
        ),
      );
      if (shownCoinVersion !== data.version) {
        shownCoinVersion = data.version;
        coin.classList.add("is-flipping");
        const b = controls.querySelector("button");
        b.dataset.coinWaiting = "true";
        b.disabled = true;
        clearTimeout(coinTimer);
        coinTimer = setTimeout(() => {
          coin.classList.remove("is-flipping");
          b.dataset.coinWaiting = "false";
          b.disabled = pending;
        }, 850);
      }
    }
    paintBoard();
    if (focus) focusLesson();
  }
  async function load() {
    pending = true;
    setBusy();
    try {
      data = await request("/tutorial/state");
      paint();
      return data;
    } catch (e) {
      $("tutorial-loading").textContent =
        "Não foi possível carregar seu treino. Tente novamente.";
      $("tutorial-loading").append(button("Tentar novamente", load, "quiet"));
      throw e;
    } finally {
      pending = false;
      setBusy();
    }
  }
  $("skip-tutorial").onclick = () => send("skip");
  $("restart-tutorial").onclick = async () => {
    if (pending) return;
    pending = true;
    setBusy();
    try {
      data = await request("/tutorial/restart", {
        method: "POST",
        body: JSON.stringify({
          version: data.version,
          actionId: crypto.randomUUID(),
        }),
      });
      paint(true);
    } catch (e) {
      onError(e);
    } finally {
      pending = false;
      setBusy();
    }
  };
  return {
    load,
    send,
    get snapshot() {
      return data;
    },
    close() {
      clearTimeout(coinTimer);
    },
  };
}
