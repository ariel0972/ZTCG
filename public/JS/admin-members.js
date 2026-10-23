import { api, navbar, profilePath } from "./auth.js";
import { initializeAdminShell, setAdminAccess } from "./admin-shell.js";
import { createAdminActions, memberStatus } from "./admin-actions.js";
export function createAdminMembers(doc, request = api, actorId = null) {
  const $ = (id) => doc.getElementById(id);
  const el = (tag, text = "") => {
    const n = doc.createElement(tag);
    n.textContent = text;
    return n;
  };
  let page = 0,
    query = "",
    hasMore = false,
    listRequest = 0,
    historyRequest = 0,
    currentId = null,
    currentUser = null,
    historyPage = 0,
    historyHasMore = false,
    pageIds = [];
  const selected = new Set();
  const actions = createAdminActions({
    doc,
    request,
    actorId,
    getUser: () => currentUser,
    getSelection: () => selected,
    clearSelection: () => selected.clear(),
    onChanged: async () => {
      const id = currentId,
        next = historyPage;
      selected.clear();
      await loadMembers();
      if (id && currentId === id) await openMember(id, next);
    },
  });
  $("select-page").onclick = () => {
    const remove = pageIds.every((id) => selected.has(id));
    if (!remove && new Set([...selected, ...pageIds]).size > 200) {
      $("member-action-status").textContent =
        "Selecione no máximo 200 batalhas ou use Apagar histórico completo.";
      return;
    }
    for (const id of pageIds) remove ? selected.delete(id) : selected.add(id);
    for (const input of $("member-matches").querySelectorAll(
      'input[type="checkbox"]',
    ))
      input.checked = selected.has(input.value);
    actions.refreshSelection();
  };
  function listControls(busy = false) {
    $("member-search-button").disabled = busy;
    $("members-previous").disabled = busy || page === 0;
    $("members-next").disabled = busy || !hasMore;
    $("members-page").textContent = "Página " + (page + 1);
  }
  function historyControls(busy = false) {
    $("select-page").disabled = busy || !pageIds.length;
    $("matches-previous").disabled = busy || historyPage === 0;
    $("matches-next").disabled = busy || !historyHasMore;
    $("matches-page").textContent = "Página " + (historyPage + 1);
  }
  async function openMember(id, nextPage = 0) {
    const generation = ++historyRequest;
    if (id !== currentId) selected.clear();
    actions.close();
    currentId = id;
    currentUser = null;
    pageIds = [];
    actions.renderUser();
    $("member-stats").textContent = "";
    $("member-action-status").textContent = "";
    historyPage = nextPage;
    $("member-details").hidden = false;
    $("member-summary").textContent = "Carregando conta…";
    $("member-matches").replaceChildren();
    $("member-history-status").textContent = "Carregando histórico…";
    historyControls(true);
    try {
      const data = await request(
        "/admin/users/" + encodeURIComponent(id) + "/matches?page=" + nextPage,
      );
      if (generation !== historyRequest) return;
      currentUser = data.user;
      actions.renderUser();
      pageIds = data.matches.map((m) => m.matchId);
      const s = data.stats;
      $("member-stats").textContent = s
        ? s.xp +
          " XP · " +
          s.partidas +
          " partidas · " +
          s.vitorias +
          " vitórias · " +
          s.derrotas +
          " derrotas · " +
          s.partidasSemClassificacao +
          " sem resultado"
        : "";
      const user = data.user,
        summary = $("member-summary"),
        heading = el("h2", user.nome),
        profile = el("a", "Abrir perfil ↗");
      profile.href = profilePath(user.id);
      profile.target = "_blank";
      profile.rel = "noopener";
      summary.replaceChildren(heading, el("span", user.email), profile);
      $("member-matches").replaceChildren(
        ...data.matches.map((m) => {
          const row = el("tr"),
            date = new Date(m.finishedAt),
            opponent = m.players.find((p) => p.id !== id),
            cell = el("td"),
            check = el("input");
          check.type = "checkbox";
          check.value = m.matchId;
          check.checked = selected.has(m.matchId);
          check.setAttribute("aria-label", "Selecionar batalha " + m.matchId);
          check.onchange = () => {
            if (check.checked && selected.size >= 200) {
              check.checked = false;
              $("member-action-status").textContent =
                "Selecione no máximo 200 batalhas.";
              return;
            }
            check.checked
              ? selected.add(m.matchId)
              : selected.delete(m.matchId);
            actions.refreshSelection();
          };
          cell.append(check);
          row.append(cell);
          for (const text of [
            Number.isFinite(date.getTime())
              ? date.toLocaleString("pt-BR")
              : "Não informada",
            opponent?.nome ?? "Não informado",
            m.ranked === false
              ? "Sem classificação"
              : !m.winner
                ? "Empate"
                : m.winner === id
                  ? "Vitória"
                  : "Derrota",
            String(m.turns ?? "—"),
            (m.reason ?? "—") +
              (m.historyVisible === false
                ? " · Oculta do histórico público"
                : "") +
              (m.xpGanho !== undefined ? " · " + m.xpGanho + " XP" : ""),
          ])
            row.append(el("td", text));
          return row;
        }),
      );
      historyHasMore = data.hasMore;
      $("member-history-status").textContent = data.matches.length
        ? ""
        : "Nenhuma batalha registrada para esta conta.";
    } catch (error) {
      if (generation === historyRequest) {
        historyHasMore = false;
        $("member-history-status").textContent = error.message;
      }
    } finally {
      if (generation === historyRequest) historyControls();
    }
  }
  async function loadMembers() {
    const generation = ++listRequest;
    listControls(true);
    $("member-list-status").textContent = "Carregando membros…";
    try {
      const params = new URLSearchParams({ q: query, page: String(page) }),
        data = await request("/admin/users?" + params);
      if (generation !== listRequest) return;
      hasMore = data.hasMore;
      $("member-list").replaceChildren(
        ...data.users.map((user) => {
          const row = el("tr"),
            identity = el("td", user.nome),
            action = el("td"),
            open = el("button", "Gerenciar conta"),
            role = el("td", user.admin ? "Administrador" : "Membro");
          identity.append(el("small", user.id));
          role.append(el("small", memberStatus(user)));
          open.type = "button";
          open.setAttribute("aria-label", "Gerenciar conta de " + user.nome);
          open.onclick = () => void openMember(user.id);
          action.append(open);
          row.append(identity, el("td", user.email), role, action);
          return row;
        }),
      );
      $("member-list-status").textContent = data.users.length
        ? data.users.length + " membro(s) nesta página."
        : "Nenhum membro encontrado.";
    } catch (error) {
      if (generation === listRequest) {
        $("member-list-status").textContent = error.message;
        hasMore = false;
      }
    } finally {
      if (generation === listRequest) listControls();
    }
  }
  $("member-search").onsubmit = (event) => {
    event.preventDefault();
    query = $("member-query").value.trim();
    page = 0;
    currentId = null;
    currentUser = null;
    selected.clear();
    actions.close();
    actions.renderUser();
    ++historyRequest;
    $("member-details").hidden = true;
    void loadMembers();
  };
  $("members-previous").onclick = () => {
    if (page > 0) {
      page--;
      void loadMembers();
    }
  };
  $("members-next").onclick = () => {
    if (hasMore) {
      page++;
      void loadMembers();
    }
  };
  $("matches-previous").onclick = () => {
    if (currentId && historyPage > 0)
      void openMember(currentId, historyPage - 1);
  };
  $("matches-next").onclick = () => {
    if (currentId && historyHasMore)
      void openMember(currentId, historyPage + 1);
  };
  return { loadMembers, openMember };
}
if (
  typeof document !== "undefined" &&
  document.getElementById("member-search")
) {
  initializeAdminShell("members");
  void (async () => {
    const user = await navbar();
    if (setAdminAccess(user))
      await createAdminMembers(document, api, user.id).loadMembers();
  })();
}
