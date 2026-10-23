export function memberStatus(user, now = Date.now()) {
  if (user?.moderation?.banned) return "Banida";
  const until = user?.moderation?.suspendedUntil;
  return until && new Date(until).getTime() > now
    ? "Suspensa até " + new Date(until).toLocaleString("pt-BR")
    : "Ativa";
}
export function createAdminActions({
  doc,
  request,
  getUser,
  actorId,
  onChanged,
  getSelection,
  clearSelection,
}) {
  const $ = (id) => doc.getElementById(id),
    dialog = $("admin-confirm"),
    title = $("admin-confirm-title"),
    text = $("admin-confirm-text"),
    status = $("admin-confirm-status"),
    confirm = $("admin-confirm-apply"),
    cancel = $("admin-confirm-cancel");
  let operation = null,
    busy = false,
    previewing = false;
  const el = (tag, label = "") => {
    const n = doc.createElement(tag);
    n.textContent = label;
    return n;
  };
  function button(label, fn, disabled = false) {
    const b = el("button", label);
    b.type = "button";
    b.disabled = disabled;
    b.onclick = fn;
    return b;
  }
  function close() {
    if (busy) return;
    operation = null;
    if (dialog.open) dialog.close();
  }
  cancel.onclick = close;
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
    else operation = null;
  });
  function show(label, description, run) {
    title.textContent = label;
    text.textContent = description;
    status.textContent = "";
    operation = run;
    confirm.disabled = false;
    cancel.disabled = false;
    dialog.showModal();
    confirm.focus();
  }
  confirm.onclick = async () => {
    if (!operation || busy) return;
    busy = true;
    confirm.disabled = cancel.disabled = true;
    status.textContent = "Aplicando…";
    try {
      const result = await operation();
      status.textContent = result.content ?? "Operação concluída.";
      busy = false;
      operation = null;
      dialog.close();
      await onChanged();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      confirm.disabled = cancel.disabled = false;
    }
  };
  function moderate(action, hours) {
    const user = getUser();
    if (!user || user.id === actorId) return;
    const reason = $("moderation-reason").value.trim(),
      actionId = crypto.randomUUID();
    const labels = {
      ban: "Banir permanentemente",
      unban: "Remover banimento",
      suspend:
        "Suspender por " +
        { 2: "2 horas", 12: "12 horas", 24: "1 dia", 72: "3 dias" }[hours],
      unsuspend: "Remover suspensão",
      promote: "Tornar administrador",
      demote: "Remover permissão de admin",
    };
    const description =
      labels[action] +
      " a conta " +
      user.nome +
      " (" +
      user.id +
      "). " +
      (["promote", "demote"].includes(action)
        ? "A permissão vale para todo o painel administrativo. "
        : "As sessões atuais serão encerradas. ") +
      (reason ? "Motivo: " + reason : "");
    const body = {
      actionId,
      expectedVersion: user.managementVersion ?? 0,
      action,
      reason,
      ...(hours ? { hours } : {}),
    };
    show(labels[action], description, () =>
      request("/admin/users/" + encodeURIComponent(user.id) + "/moderation", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }
  async function deleteHistory(all) {
    const user = getUser();
    if (!user || previewing) return;
    const selected = [...getSelection()];
    if (!all && !selected.length) return;
    previewing = true;
    $("member-action-status").textContent = "Preparando a prévia da exclusão…";
    refreshSelection();
    try {
      const preview = await request(
        "/admin/users/" + encodeURIComponent(user.id) + "/history-preview",
        {
          method: "POST",
          body: JSON.stringify({ all, matchIds: all ? [] : selected }),
        },
      );
      if (getUser()?.id !== user.id) return;
      const names = preview.players
        .slice(0, 6)
        .map((p) => p.nome)
        .join(", ");
      show(
        "Excluir " + preview.count + " batalha(s)",
        "Conta selecionada: " +
          user.nome +
          ". Esta ação remove as batalhas do histórico de todos os participantes e recalcula XP, vitórias, derrotas e rankings. Afetará " +
          preview.players.length +
          " conta(s): " +
          names +
          (preview.players.length > 6 ? " e outras." : ".") +
          " Confirme somente se deseja excluir essas partidas.",
        async () => {
          const result = await request(
            "/admin/users/" + encodeURIComponent(user.id) + "/history-delete",
            { method: "POST", body: JSON.stringify({ token: preview.token }) },
          );
          clearSelection();
          return result;
        },
      );
      $("member-action-status").textContent = "";
    } catch (error) {
      $("member-action-status").textContent = error.message;
    } finally {
      previewing = false;
      refreshSelection();
    }
  }
  function refreshSelection() {
    $("delete-selected").disabled =
      !getUser() || !getSelection().size || previewing || busy;
    $("delete-all").disabled = !getUser() || previewing || busy;
    $("selected-battles-count").textContent =
      getSelection().size + " batalha(s) selecionada(s)";
  }
  function renderUser() {
    const user = getUser(),
      host = $("member-moderation");
    host.replaceChildren();
    if (!user) {
      refreshSelection();
      return;
    }
    host.append(el("p", "Situação: " + memberStatus(user)));
    const reason = el("label", "Motivo, opcional"),
      input = el("textarea");
    input.id = "moderation-reason";
    input.maxLength = 500;
    input.rows = 2;
    reason.append(input);
    host.append(reason);
    const controls = el("div");
    controls.className = "admin-member-actions";
    const self = user.id === actorId;
    controls.append(
      button(
        user.moderation?.banned ? "Remover banimento" : "Banir conta",
        () => moderate(user.moderation?.banned ? "unban" : "ban"),
        self,
      ),
    );
    const label = el("label", "Prazo do castigo"),
      duration = el("select");
    duration.id = "suspension-hours";
    for (const [hours, name] of [
      [2, "2 horas"],
      [12, "12 horas"],
      [24, "1 dia"],
      [72, "3 dias"],
    ]) {
      const o = el("option", name);
      o.value = String(hours);
      duration.append(o);
    }
    label.append(duration);
    controls.append(
      label,
      button(
        "Aplicar suspensão",
        () => moderate("suspend", Number(duration.value)),
        self || user.moderation?.banned,
      ),
    );
    if (
      user.moderation?.suspendedUntil &&
      new Date(user.moderation.suspendedUntil) > new Date()
    )
      controls.append(
        button("Remover suspensão", () => moderate("unsuspend"), self),
      );
    controls.append(
      button(
        user.admin ? "Remover admin" : "Tornar admin",
        () => moderate(user.admin ? "demote" : "promote"),
        self,
      ),
    );
    host.append(controls);
    if (self)
      host.append(el("small", "A moderação da própria conta está bloqueada."));
    if (user.moderation?.reason)
      host.append(el("p", "Último motivo: " + user.moderation.reason));
    refreshSelection();
  }
  $("delete-selected").onclick = () => void deleteHistory(false);
  $("delete-all").onclick = () => void deleteHistory(true);
  return { renderUser, refreshSelection, close, deleteHistory };
}
