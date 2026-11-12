import { node } from "./auth.js";
import { attackValue } from "./battle-ui.js";
export function structureAttackOption(card, slot) {
  const weapon = slot?.structure;
  if (
    card?.tipo !== "Tropa" ||
    !weapon ||
    (slot.rider && slot.rider.id !== card.id)
  )
    return null;
  const damage = attackValue(weapon, slot);
  if (!damage && !weapon.estrutura?.carga) return null;
  const targets = [
    ...(slot.attackTargets?.structure ?? []),
    ...(slot.attackStructureTargets?.structure ?? []),
  ];
  const reason = targets.length
    ? ""
    : Object.values(slot.attackBlockReasons?.structure ?? {}).find(Boolean) ||
      "Nenhum alvo disponível para a estrutura.";
  return {
    card: weapon,
    source: "structure",
    label: "Atacar com " + weapon.nome + " · " + damage + " de dano",
    reason,
  };
}
export function createChargeControl(card, { mana, blocked, onCharge }) {
  if (!card?.estrutura?.carga) return null;
  const wrap = node("div", "", "structure-charge");
  const min = card.estrutura.carga.minimoMana;
  const info = node(
    "small",
    "Armazenado: " +
      (card.storedMana ?? 0) +
      " mana · +" +
      Math.floor((card.storedMana ?? 0) / card.estrutura.carga.manaPorDano) +
      " dano",
  );
  const label = node("label", "Mana para carregar");
  const input = node("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(mana);
  input.step = "1";
  input.value = String(min);
  input.setAttribute("aria-label", "Mana para carregar " + card.nome);
  label.append(input);
  const button = node("button", "Carregar mana", "quiet");
  button.type = "button";
  const reason =
    blocked || (mana < min ? "Mana insuficiente para a carga." : "");
  button.disabled = !!reason;
  input.disabled = !!reason;
  button.onclick = () => {
    if (!button.disabled && input.reportValidity())
      onCharge(Number(input.value));
  };
  wrap.append(info, label, button);
  if (reason) wrap.append(node("small", reason));
  return wrap;
}
