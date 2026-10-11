// Move the existing navigation, so account actions and invite counts stay live.
export function createSiteNavigation(header) {
  if (!header || header.dataset.navigationReady) return;
  const doc = header.ownerDocument,
    win = doc.defaultView,
    nav = header.querySelector('nav[aria-label="Principal"]'),
    account = header.querySelector("#account");
  if (!nav) return;
  header.dataset.navigationReady = "true";
  header.classList.add("site-navigation");
  const make = (tag, text, className) => {
    const el = doc.createElement(tag);
    el.textContent = text;
    el.className = className;
    return el;
  };
  const trigger = make("button", "", "site-menu-toggle quiet");
  trigger.type = "button";
  trigger.setAttribute("aria-label", "Abrir menu de navegação");
  trigger.setAttribute("aria-controls", "site-menu");
  trigger.setAttribute("aria-expanded", "false");
  const bars = make("span", "☰", "");
  bars.setAttribute("aria-hidden", "true");
  trigger.append(bars);
  header.prepend(trigger);
  const navPosition = doc.createComment("principal-navigation"),
    accountPosition = doc.createComment("account-navigation");
  nav.before(navPosition);
  account?.before(accountPosition);
  const menu = make("dialog", "", "site-menu");
  menu.id = "site-menu";
  menu.setAttribute("aria-label", "Menu de navegação");
  const heading = make("div", "", "site-menu-heading"),
    close = make("button", "×", "quiet site-menu-close");
  close.type = "button";
  close.setAttribute("aria-label", "Fechar menu de navegação");
  const brand = header.querySelector(".brand");
  if (brand) heading.append(brand.cloneNode(true));
  heading.append(close);
  menu.append(heading);
  doc.body.append(menu);
  nav.classList.add("site-links");
  const destinations = [
    ["/HTML/perfil.html", "Perfil", "profile", "♙"],
    ["/", "Decks", "decks", "▤"],
    ["/HTML/friends.html", "Amigos", "friends", "♧"],
    ["/ranking", "Ranking", "ranking", "♔"],
    ["/regras", "Regras", "rules", "≡"],
    ["/HTML/index.html", "Jogar", "play", "▷"],
  ];
  for (const [href, label, kind, icon] of destinations) {
    let link = [...nav.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === href,
    );
    if (!link) {
      link = make("a", label, "");
      link.href = href;
      nav.append(link);
    }
    link.dataset.destination = kind;
    link.dataset.icon = icon;
    if (
      win.location.pathname === href ||
      (kind === "profile" &&
        win.location.pathname.startsWith("/thumosplayer/")) ||
      (kind === "decks" && win.location.pathname === "/HTML/deckbuilder.html")
    )
      link.setAttribute("aria-current", "page");
  }
  account?.classList.add("site-account");
  const desktopOrder = [...nav.children];
  const finishClose = () => {
    trigger.setAttribute("aria-expanded", "false");
    doc.body.classList.remove("site-menu-open");
  };
  close.onclick = () => menu.close();
  menu.addEventListener("close", finishClose);
  menu.addEventListener("click", (event) => {
    if (event.target !== menu) return;
    const rect = menu.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      menu.close();
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a") && menu.open) menu.close();
  });
  trigger.onclick = () => {
    menu.showModal();
    trigger.setAttribute("aria-expanded", "true");
    doc.body.classList.add("site-menu-open");
  };
  const media = win.matchMedia?.("(max-width: 700px)");
  function render() {
    const mobile = !!media?.matches;
    trigger.hidden = !mobile;
    doc.body.classList.toggle("mobile-site-navigation", mobile);
    if (mobile) {
      for (const [href] of destinations) {
        const link = [...nav.querySelectorAll("a")].find(
          (a) => a.getAttribute("href") === href,
        );
        if (link) nav.append(link);
      }
      menu.append(nav, ...(account ? [account] : []));
    } else {
      if (menu.open) menu.close();
      finishClose();
      nav.append(...desktopOrder);
      navPosition.after(nav);
      if (account) accountPosition.after(account);
    }
  }
  media?.addEventListener("change", render);
  render();
}
