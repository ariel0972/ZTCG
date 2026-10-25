import { createCoinToss } from "./coin-toss.js";
import { navbar, node, profilePath } from "./auth.js";
import { gameTransport } from "./game-transport.js";
import { createCardInspector } from "./card-inspection.js";
import { cardFace, structureFace, renderSpellAura } from "./battle-ui.js";
import { createMatchChat } from "./match-chat.js";
import { createBattleEvents } from "./battle-events.js";
import { createFieldMenu, publicFieldNotice } from "./field-overlays.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("match");
let transport,
  chat,
  state,
  stopped = false;
const inspector = createCardInspector({
  reactions: () => state?.reactions || {},
});
const battleEvents = createBattleEvents(document.body, {
  getViewerId: () => state?.players[0]?.id,
  noticeDurationMs: 8000,
});
const coinToss = createCoinToss(document.body);
const noticeContent = node("section");
const fieldNotice = createFieldMenu(document.querySelector(".battle-board"), {
  label: "Turno pausado",
  content: noticeContent,
});
function deny(text) {
  stopped = true;
  $("watch-status").textContent = text || "Esta sala não está disponível.";
  $("watch-field").hidden = true;
  $("match-social").hidden = true;
  transport?.close();
  chat?.close();
  battleEvents.close();
  coinToss.close();
  fieldNotice.close();
  document.body.classList.remove("in-match");
}
function slotView(slot) {
  const wrapper = node("div", "", "board-slot spectator-slot");
  wrapper.dataset.kind = slot.kind;
  wrapper.dataset.slotId = slot.id;
  if (slot.terrain) wrapper.dataset.terrain = slot.terrain.nome;
  wrapper.classList.toggle("structured-slot", !!slot.structure);
  for (const [card, cls] of [
    [slot.card, ""],
    [slot.rider, "spectator-rider"],
    [slot.structure, "spectator-structure"],
  ]) {
    if (!card) continue;
    const button = node("button", "", `spectator-card ${cls}`);
    button.type = "button";
    button.setAttribute("aria-label", `Ver ${card.nome}`);
    button.append(
      card.tipo === "Estrutura"
        ? structureFace(card)
        : cardFace(card, {
            slot,
            slots: state.slots,
            reactions: state.reactions,
          }),
    );
    if (!card.oculta) {
      button.onclick = () => inspector.inspect(card);
      inspector.bind(button, card);
    }
    wrapper.append(button);
  }
  if (slot.card || slot.structure) wrapper.classList.add("occupied");
  if (!wrapper.childElementCount)
    wrapper.append(node("span", slot.kind === "Tropa" ? "Tropa" : slot.kind));
  if (slot.terrain)
    wrapper.append(
      node(
        "span",
        `${slot.terrain.nome} · ${slot.terrain.rodadasRestantes}`,
        "terrain-label",
      ),
    );
  return wrapper;
}
function board(player, frontId, backId, reverse = false) {
  const slots = state.slots.filter((s) => s.ownerId === player.id),
    get = (suffix) => slots.find((s) => s.id.endsWith(suffix));
  const front = [
    get(":arm:front-left"),
    ...slots
      .filter((s) => s.kind === "Tropa")
      .sort((a, b) => a.column - b.column),
    get(":arm:front-right"),
  ];
  const back = [get(":arm:back-left"), get(":mage"), get(":arm:back-right")];
  $(frontId).replaceChildren(
    ...(reverse ? front.reverse() : front).filter(Boolean).map(slotView),
  );
  $(backId).replaceChildren(
    ...(reverse ? back.reverse() : back).filter(Boolean).map(slotView),
  );
  renderSpellAura(player, $(frontId), $(backId));
}
function hud(player, host) {
  const identity = node("div", "", "duelist-identity"),
    name = node("a", player.nome),
    resources = node("div", "", "duelist-resources");
  name.href = profilePath(player.id);
  name.target = "_blank";
  name.rel = "noopener";
  identity.append(
    node("span", player.nome.slice(0, 1), "duelist-avatar"),
    name,
  );
  for (const [label, value, cls] of [
    ["Vida", player.mage.hpAtual, "health"],
    ["Mana", `${player.mana}/20`, "mana"],
    ["Baralho", player.deckCount, "deck"],
    ["Mão oculta", player.handCount, "cards"],
  ]) {
    const item = node("div", "", `resource ${cls}`);
    item.append(node("b", String(value)), node("small", label));
    resources.append(item);
  }
  $(host).replaceChildren(identity, resources);
}
function render(data) {
  if (stopped) return;
  battleEvents.capture();
  state = data;
  coinToss.update(state);
  document.body.classList.add("in-match");
  $("watch-field").hidden = false;
  const [first, second] = state.players,
    current = state.players.find((p) => p.id === state.current);
  $("watch-title").textContent =
    state.status === "FINISHED"
      ? state.winner
        ? `${state.players.find((p) => p.id === state.winner)?.nome} venceu`
        : "Partida encerrada · empate"
      : `Rodada ${state.round} · ${state.phase === "PREPARATION" ? "Preparação" : state.phase === "COIN_TOSS" ? "Cara ou coroa" : `Vez de ${current?.nome || "jogar"}`}`;
  $("watch-status").textContent =
    state.status === "FINISHED"
      ? "Partida encerrada. O chat permanece disponível por até 24 horas."
      : state.paused
        ? "Partida pausada · aguardando reconexão"
        : `Ao vivo · Azul: ${first.nome} · Vermelho: ${second.nome}`;
  board(second, "enemy-front", "enemy-back", true);
  board(first, "my-front", "my-back");
  hud(second, "enemy-hud");
  hud(first, "my-hud");
  const notice = publicFieldNotice(state);
  noticeContent.replaceChildren(...(notice ? [node("p", notice.message)] : []));
  fieldNotice.update({
    visible: !!notice,
    key: notice?.key,
    label: notice?.label,
  });
  $("watch-log").replaceChildren(
    ...state.log
      .slice(-50)
      .map((line) =>
        node(
          "p",
          typeof line === "string" ? line : line.text || line.message || "",
        ),
      ),
  );
  $("watch-effects").replaceChildren(
    ...(state.ongoingSpells || []).map((effect) => {
      const owner =
        state.players.find((p) => p.id === effect.ownerId)?.nome || "";
      const b = node(
        "button",
        `${effect.card?.nome || "Feitiço ativo"} · ${owner} · ${effect.damage} de dano · ${effect.rounds} rodadas`,
        "quiet",
      );
      b.type = "button";
      if (effect.card)
        b.onclick = () =>
          inspector.inspect({
            ...effect.card,
            tipo: "Feitico",
            descricao: `${effect.damage} de dano no fim da rodada. ${effect.rounds} rodadas restantes.`,
            efeitos: [{ id: "damage", valor: effect.damage }],
          });
      return b;
    }),
  );
  battleEvents.update(data);
}
async function load() {
  if (!id || !/^[a-f\d-]{36}$/i.test(id)) {
    deny("Escolha uma partida na lista de amigos.");
    return;
  }
  const user = await navbar();
  if (!user) return;
  chat = createMatchChat({
    host: $("match-social"),
    user,
    spectator: true,
    onDenied: deny,
  });
  chat.setMatch(id);
  $("match-social").hidden = false;
  transport = gameTransport({
    statePath: `/rooms/${id}/state`,
    streamPath: `/rooms/${id}/stream`,
    readOnly: true,
  });
  transport.on("match:state", render);
  transport.on("match:social", (data) => chat.update(data));
  transport.on("access_denied", (data) => deny(data.content));
  transport.on("connect_error", (error) => {
    if (!stopped) $("watch-status").textContent = error.message;
  });
  transport.on("disconnect", () => {
    if (!stopped) $("watch-status").textContent = "Reconectando à sala…";
  });
}
void load().catch((error) => deny(error.message));
window.addEventListener("pagehide", () => {
  transport?.close();
  chat?.close();
  battleEvents.close();
  fieldNotice.close();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
