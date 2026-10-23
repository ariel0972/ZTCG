export const adminSections = [
  {
    id: "lore",
    label: "Histórias e lores",
    href: "/HTML/admin-lore.html",
    description: "Rascunhos e publicações",
  },
  {
    id: "cards",
    label: "Catálogo de cartas",
    href: "/HTML/admin.html",
    description: "Cartas, regras e efeitos",
  },
  {
    id: "members",
    label: "Membros",
    href: "/HTML/admin-members.html",
    description: "Contas e histórico de batalhas",
  },
];
export function renderAdminNavigation(host, active) {
  const doc = host.ownerDocument;
  host.replaceChildren();
  const heading = doc.createElement("p");
  heading.className = "eyebrow";
  heading.textContent = "ADMINISTRAÇÃO";
  const title = doc.createElement("h2");
  title.textContent = "Painel do admin";
  const nav = doc.createElement("nav");
  nav.setAttribute("aria-label", "Seções administrativas");
  for (const section of adminSections) {
    const link = doc.createElement("a");
    link.href = section.href;
    const label = doc.createElement("strong");
    label.textContent = section.label;
    const description = doc.createElement("small");
    description.textContent = section.description;
    link.append(label, description);
    if (section.id === active) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  const back = doc.createElement("a");
  back.href = "/";
  back.className = "admin-return";
  back.textContent = "← Voltar ao jogo";
  host.append(heading, title, nav, back);
}
export function initializeAdminShell(active, doc = document) {
  const host = doc.getElementById("admin-navigation");
  if (host) renderAdminNavigation(host, active);
}
export function setAdminAccess(user, doc = document) {
  const allowed = !!user?.admin,
    content = doc.getElementById("admin-content"),
    status = doc.getElementById("admin-access-status");
  if (content) content.hidden = !allowed;
  if (status) {
    status.hidden = allowed;
    status.textContent = allowed
      ? ""
      : "Acesso restrito a administradores. Entre com uma conta autorizada.";
  }
  return allowed;
}
