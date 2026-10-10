export function splitRelations(relations) {
  return {
    friends: relations.filter((r) => r.status === "accepted"),
    incoming: relations.filter((r) => r.status === "pending" && r.incoming),
    outgoing: relations.filter((r) => r.status === "pending" && !r.incoming),
  };
}
export function filterFriends(friends, query) {
  const normalize = (text) =>
    String(text)
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  const q = normalize(query);
  return friends.filter((f) => normalize(f.nome).includes(q));
}
export function friendshipButtons(container, relation, onAction, onError) {
  const doc = container.ownerDocument;
  let busy = false;
  function render() {
    container.replaceChildren();
    const add = (text, action, className = "quiet") => {
      const b = doc.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.className = className;
      b.disabled = !action;
      if (action)
        b.onclick = async () => {
          if (busy) return;
          busy = true;
          container.setAttribute("aria-busy", "true");
          container.querySelectorAll("button").forEach((button) => {
            button.disabled = true;
          });
          try {
            relation = await onAction(action);
          } catch (e) {
            onError(e);
          } finally {
            busy = false;
            container.removeAttribute("aria-busy");
            render();
          }
        };
      container.append(b);
    };
    if (relation?.status === "accepted")
      add("Desfazer amizade", "remove", "quiet friendship-remove");
    else if (relation?.incoming) {
      add("Aceitar amizade", "accept", "primary");
      add("Recusar pedido", "remove", "quiet friendship-cancel");
    } else if (relation) {
      add("Pedido Enviado", null, "friendship-pending");
      add("Cancelar envio", "remove", "quiet friendship-cancel");
    } else add("Pedir amizade", "send", "primary");
  }
  render();
}
export function createSocialTabs(root) {
  const buttons = [...root.querySelectorAll('[role="tab"]')];
  function select(button) {
    for (const tab of buttons) {
      const active = tab === button;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      root.ownerDocument.getElementById(
        tab.getAttribute("aria-controls"),
      ).hidden = !active;
    }
  }
  for (const [index, button] of buttons.entries()) {
    button.onclick = () => select(button);
    button.onkeydown = (e) => {
      const offset =
        e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!offset && !["Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const next =
        buttons[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (index + offset + buttons.length) % buttons.length
        ];
      select(next);
      next.focus();
    };
  }
  select(buttons[0]);
}
