import { api, token, node } from "./auth.js";
export function deckCopyButton(deck) {
  const button = node(
    "button",
    token() ? "Copiar baralho" : "Entre para copiar",
    "quiet",
  );
  button.type = "button";
  button.onclick = async () => {
    if (!token()) {
      location.href = "/HTML/login.html";
      return;
    }
    button.disabled = true;
    try {
      const result = await api("/decks/" + deck._id + "/copy", {
        method: "POST",
        body: "{}",
      });
      localStorage.setItem("ztcg:selected-deck", result.deck._id);
      const link = node("a", "Abrir minha cópia →");
      link.href = "/";
      button.replaceWith(link);
    } catch (error) {
      button.textContent = error.message + " · tentar novamente";
      button.disabled = false;
    }
  };
  return button;
}
