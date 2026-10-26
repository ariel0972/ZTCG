const selections = new WeakMap();
export function renderReviveChoice(
  host,
  state,
  viewerId,
  { disabled = false, onChoose } = {},
) {
  const choice = state?.pendingRevive;
  if (!choice) return;
  let saved = selections.get(host);
  if (!saved || saved.id !== choice.id) {
    saved = { id: choice.id, cardId: "", destinationId: "" };
    selections.set(host, saved);
  }
  const doc = host.ownerDocument;
  const make = (tag, text = "") => {
    const n = doc.createElement(tag);
    n.textContent = text;
    return n;
  };
  host.append(
    make(
      "h2",
      choice.source +
        (choice.deployment ? ": colocar em campo" : ": reviver uma tropa"),
    ),
  );
  if (choice.ownerId !== viewerId) {
    host.append(make("p", "O oponente está escolhendo uma tropa e um espaço."));
    return;
  }
  host.append(
    make(
      "p",
      choice.deployment
        ? "Escolha a carta oferecida e um espaço destacado. Entrada sem mana ou mobilização. Resposta em 20 segundos; turno pausado."
        : "Escolha uma tropa do seu cemitério e um espaço livre. Sem custo de mana ou mobilização. Resposta em 20 segundos; turno pausado.",
    ),
  );
  const controls = make("div");
  controls.className = "revive-choice-controls";
  const select = (label, placeholder, options) => {
    const holder = make("label", label),
      field = make("select");
    field.append(new doc.defaultView.Option(placeholder, ""));
    for (const [value, text] of options)
      field.append(new doc.defaultView.Option(text, value));
    field.disabled = disabled;
    holder.append(field);
    controls.append(holder);
    return field;
  };
  const player = state.players.find((p) => p.id === viewerId);
  const cards = (
    choice.deployment
      ? [...(player?.deck ?? []), ...(player?.graveyard ?? [])]
      : (player?.graveyard ?? [])
  ).filter((c) => choice.cards.includes(c.id));
  const card = select(
    choice.deployment ? "Carta para colocar em campo" : "Tropa do cemitério",
    "Escolha uma carta",
    cards.map((c) => [c.id, c.nome]),
  );
  const destination = select(
    "Espaço de destino",
    "Escolha um espaço",
    state.slots
      .filter((s) => state.reviveDestinations?.includes(s.id))
      .map((s) => [s.id, "Campo " + (s.column + 1)]),
  );
  card.value = saved.cardId;
  destination.value = saved.destinationId;
  if (cards.length === 1) card.value = saved.cardId || cards[0].id;
  const confirm = make(
    "button",
    choice.deployment ? "Colocar em campo" : "Reviver tropa",
  );
  confirm.type = "button";
  const refresh = () => {
    saved.cardId = card.value;
    saved.destinationId = destination.value;
    confirm.disabled = disabled || !card.value || !destination.value;
  };
  card.onchange = destination.onchange = refresh;
  refresh();
  confirm.onclick = () =>
    onChoose?.({
      type: "chooseRevive",
      cardId: card.value,
      destinationId: destination.value,
    });
  host.append(controls, confirm);
}
