export function createDeckNavigation(root, nav) {
  const win = root.ownerDocument.defaultView;
  const media = win.matchMedia?.("(max-width: 700px)");
  const screens = [...root.querySelectorAll("[data-deck-screen]")];
  const buttons = [...nav.querySelectorAll("[data-deck-view]")];
  let view = "decks";
  const scrollPositions = new Map();
  function render() {
    const mobile = !!media?.matches;
    nav.hidden = !mobile;
    for (const screen of screens)
      screen.hidden = mobile && screen.dataset.deckScreen !== view;
    for (const button of buttons) {
      if (button.dataset.deckView === view)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }
  function show(next) {
    if (!screens.some((screen) => screen.dataset.deckScreen === next)) return;
    if (media?.matches) scrollPositions.set(view, win.scrollY);
    view = next;
    render();
    if (media?.matches)
      win.scrollTo({
        top: scrollPositions.get(view) || 0,
        behavior: "instant",
      });
  }
  for (const button of buttons)
    button.onclick = () => show(button.dataset.deckView);
  media?.addEventListener("change", render);
  render();
  return { show };
}
