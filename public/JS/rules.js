import { api, navbar, node } from "./auth.js";
void navbar();
const container = document.getElementById("rules-reactions");
async function load() {
  try {
    const { reactions } = await api("/rules-data");
    container.replaceChildren();
    for (const [name, info] of Object.entries(reactions)) {
      const card = node("div", "", "reaction-rule");
      card.append(
        node("h3", name),
        node("span", info.elements, "muted"),
        node("p", info.description),
      );
      container.append(card);
    }
  } catch (e) {
    const retry = node("button", "Tentar novamente");
    retry.onclick = () => void load();
    container.replaceChildren(node("p", e.message), retry);
  }
}
void load();
