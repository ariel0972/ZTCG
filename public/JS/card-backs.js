export const cardBacks = [
  ["common", "Comum"],
  ["zarcos", "Zarcos"],
  ["water", "Água"],
  ["air", "Ar"],
  ["fire", "Fogo"],
  ["earth", "Terra"],
];
export function createCardBacks({
  dialog,
  picker,
  field,
  footer,
  enemyField,
  storage = localStorage,
}) {
  let chosen = "common",
    onField = true;
  try {
    onField = storage.getItem("ztcg:zone-piles") !== "false";
  } catch {}
  const doc = picker.ownerDocument;
  const toggle = dialog.querySelector("#piles-on-field");
  function render() {
    field.hidden = !onField;
    if (enemyField) enemyField.hidden = !onField;
    footer.hidden = onField;
    toggle.checked = onField;
    for (const image of field.querySelectorAll("img"))
      image.src = `/assets/card-backs/${chosen}.png`;
    const preview = picker.querySelector("img");
    if (preview) preview.src = `/assets/card-backs/${chosen}.png`;
  }
  picker.replaceChildren();
  const preview = doc.createElement("img");
  preview.className = "current-deck-back";
  preview.alt = "Verso do baralho em jogo";
  picker.append(preview);
  toggle.onchange = () => {
    onField = toggle.checked;
    try {
      storage.setItem("ztcg:zone-piles", String(onField));
    } catch {}
    render();
  };
  render();
  return {
    update(deckCount, graveyardCount, back = "common") {
      chosen = cardBacks.some(([id]) => id === back) ? back : "common";
      render();
      field.querySelector("#deck-pile-count").textContent = String(deckCount);
      field.querySelector("#graveyard-pile-count").textContent =
        String(graveyardCount);
      field
        .querySelector("#graveyard")
        .classList.toggle("empty-pile", !graveyardCount);
    },
    updateEnemy(deckCount, graveyardCount, back = "common") {
      if (!enemyField) return;
      const chosen = cardBacks.some(([id]) => id === back) ? back : "common";
      for (const image of enemyField.querySelectorAll("img"))
        image.src = `/assets/card-backs/${chosen}.png`;
      enemyField.querySelector("#enemy-deck-pile-count").textContent =
        String(deckCount);
      enemyField.querySelector("#enemy-graveyard-pile-count").textContent =
        String(graveyardCount);
      enemyField
        .querySelector("#enemy-graveyard")
        .classList.toggle("empty-pile", !graveyardCount);
    },
  };
}
