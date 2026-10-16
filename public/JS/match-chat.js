import { api } from "./auth.js";

export function createChatFeedback(win) {
  let audio;
  return {
    unlock() {
      try {
        const Context = win.AudioContext || win.webkitAudioContext;
        if (!Context) return;
        audio ||= new Context();
        void audio.resume().catch(() => {});
      } catch {
        /* Text confirmation works when audio is unavailable. */
      }
    },
    play() {
      if (!audio || audio.state !== "running") return;
      try {
        const oscillator = audio.createOscillator(),
          gain = audio.createGain(),
          at = audio.currentTime;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(660, at);
        oscillator.frequency.exponentialRampToValueAtTime(880, at + 0.09);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.018, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.14);
      } catch {}
    },
    close() {
      if (audio) void audio.close().catch(() => {});
    },
  };
}

// Text-only UI. No history, images or emoji libraries are cached on the device.
export function createMatchChat({
  host,
  indicatorHost = host,
  user,
  request = api,
  spectator = false,
  onDenied = () => {},
  feedback,
}) {
  const doc = host.ownerDocument,
    win = doc.defaultView;
  const sounds = feedback || createChatFeedback(win),
    soundKey = `zacornia:chat-sound:${user.id}`;
  let soundEnabled = true;
  try {
    soundEnabled = win.localStorage.getItem(soundKey) !== "off";
  } catch {}
  const make = (tag, text = "", cls = "") => {
    const el = doc.createElement(tag);
    el.textContent = text;
    el.className = cls;
    return el;
  };
  const watchers = make("span", "◉ Ninguém assistindo", "match-watchers");
  watchers.setAttribute("role", "status");
  const details = make("details", "", "match-chat"),
    summary = make("summary", "Chat da partida"),
    hint = make(
      "p",
      "Jogadores e espectadores · mensagens disponíveis por 24 horas",
      "hint",
    ),
    list = make("ol", "", "match-messages"),
    form = make("form", "", "match-chat-form"),
    label = make("label", "Mensagem", "sr-only"),
    input = make("input"),
    emoji = make("button", "☺"),
    send = make("button", "Enviar"),
    status = make("p", "", "hint");
  label.append(input);
  input.type = "text";
  input.maxLength = 600;
  input.placeholder = "Converse com a sala…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Mensagem para a sala");
  // The label is visual too: avoid hiding the input together with an sr-only label.
  label.className = "match-message-input";
  emoji.type = "button";
  emoji.setAttribute("aria-label", "Adicionar emoji");
  send.type = "submit";
  list.setAttribute("aria-label", "Mensagens da partida");
  status.setAttribute("role", "status");
  const emojis = make("div", "", "match-emoji-menu");
  const options = make("div", "", "match-chat-options"),
    soundToggle = make("button", "", "quiet match-sound-toggle");
  soundToggle.type = "button";
  function renderSound() {
    soundToggle.textContent = soundEnabled
      ? "🔊 Som ligado"
      : "🔇 Som desligado";
    soundToggle.setAttribute(
      "aria-label",
      soundEnabled ? "Silenciar som do chat" : "Ativar som do chat",
    );
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  }
  soundToggle.onclick = () => {
    soundEnabled = !soundEnabled;
    try {
      win.localStorage.setItem(soundKey, soundEnabled ? "on" : "off");
    } catch {}
    if (soundEnabled) sounds.unlock();
    renderSound();
  };
  renderSound();
  options.append(hint, soundToggle);
  emojis.hidden = true;
  emojis.id = `match-emojis-${win.crypto.randomUUID()}`;
  emojis.setAttribute("role", "group");
  emojis.setAttribute("aria-label", "Escolher emoji");
  emoji.setAttribute("aria-controls", emojis.id);
  emoji.setAttribute("aria-expanded", "false");
  function setEmojiOpen(open) {
    emojis.hidden = !open;
    emoji.setAttribute("aria-expanded", String(open));
  }
  function outsideEmoji(event) {
    if (!emojis.contains(event.target) && !emoji.contains(event.target))
      setEmojiOpen(false);
  }
  function emojiKey(event) {
    if (event.key === "Escape" && !emojis.hidden) {
      setEmojiOpen(false);
      emoji.focus();
    }
  }
  doc.addEventListener("pointerdown", outsideEmoji);
  doc.addEventListener("keydown", emojiKey);
  details.addEventListener("toggle", () => {
    if (!details.open) setEmojiOpen(false);
  });
  for (const symbol of ["👋", "🔥", "👏", "😂", "❤️", "👍", "😮", "🎉"]) {
    const b = make("button", symbol);
    b.type = "button";
    b.setAttribute("aria-label", `Inserir ${symbol}`);
    b.onclick = () => {
      input.setRangeText(
        symbol,
        input.selectionStart ?? input.value.length,
        input.selectionEnd ?? input.value.length,
        "end",
      );
      setEmojiOpen(false);
      input.focus();
    };
    emojis.append(b);
  }
  emoji.onclick = () => {
    setEmojiOpen(emojis.hidden);
  };
  form.append(label, emoji, send, emojis);
  details.append(summary, options, list, form, status);
  indicatorHost.append(watchers);
  host.append(details);
  let id,
    closed = false,
    denied = false,
    busy = false,
    messages = [],
    lastPacket = 0,
    serverNow = 0,
    retry,
    renewing = false;
  let renderedKey = "",
    historyLoaded = false;
  const animate = new Set();
  const session = win.crypto.randomUUID();
  function render() {
    input.disabled = send.disabled = denied || !id || busy;
    send.textContent = busy ? "Enviando…" : "Enviar";
    form.classList.toggle("sending", busy);
    form.setAttribute("aria-busy", String(busy));
    const nextKey = JSON.stringify(messages);
    if (nextKey === renderedKey) return;
    renderedKey = nextKey;
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 45;
    const rows = messages.map((m) => {
      const row = make("li", "", m.userId === user.id ? "own-message" : "");
      if (animate.has(m.id)) row.classList.add("message-arriving");
      const head = make("div", "", "message-heading"),
        time = make(
          "time",
          new Date(m.createdAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      time.dateTime = new Date(m.createdAt).toISOString();
      head.append(
        make("strong", m.nome),
        make("small", m.role === "spectator" ? "Espectador" : "Jogador"),
        time,
      );
      row.append(head, make("p", m.text));
      return row;
    });
    list.replaceChildren(...rows);
    animate.clear();
    if (!rows.length)
      list.append(make("li", "Diga olá para a sala.", "empty-state"));
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  function deny(error) {
    denied = true;
    render();
    status.textContent =
      error?.message || "Esta sala não está mais disponível.";
    if (spectator) onDenied(status.textContent);
  }
  function update(data) {
    if (closed || data.matchId !== id || data.serverNow < serverNow) return;
    serverNow = data.serverNow;
    lastPacket = Date.now();
    if (data.unchanged) return;
    const key = JSON.stringify(data.messages);
    if (key !== JSON.stringify(messages)) {
      if (historyLoaded) {
        const known = new Set(messages.map((m) => m.id));
        for (const message of data.messages)
          if (!known.has(message.id)) animate.add(message.id);
      }
      messages = data.messages.slice(-50);
      render();
    }
    historyLoaded = true;
    const viewers = data.viewers || [];
    watchers.textContent = viewers.length
      ? `◉ ${viewers.length} ${viewers.length === 1 ? "pessoa assistindo" : "pessoas assistindo"}`
      : "◉ Ninguém assistindo";
    watchers.title = viewers.map((v) => v.nome).join(", ");
  }
  async function renew() {
    if (closed || denied || !id || !spectator || renewing) return;
    renewing = true;
    try {
      await request(`/rooms/${id}/watch`, {
        method: "POST",
        body: JSON.stringify({ session }),
      });
    } catch (e) {
      if ([403, 404].includes(e.status)) deny(e);
    } finally {
      renewing = false;
    }
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (busy || denied || !id || !text) return;
    if (Array.from(text).length > 300) {
      status.textContent = "Use até 300 caracteres.";
      return;
    }
    const room = id;
    if (retry?.text !== text) retry = { id: win.crypto.randomUUID(), text };
    busy = true;
    if (soundEnabled) sounds.unlock();
    render();
    status.textContent = "Enviando…";
    try {
      const result = await request(`/rooms/${room}/chat`, {
        method: "POST",
        body: JSON.stringify(retry),
      });
      if (closed || room !== id) return;
      animate.add(result.message.id);
      messages = [
        ...messages.filter((m) => m.id !== result.message.id),
        result.message,
      ].slice(-50);
      serverNow = Math.max(serverNow, result.message.createdAt);
      input.value = "";
      retry = null;
      status.textContent = "Mensagem enviada.";
      if (soundEnabled) sounds.play();
      render();
      list.scrollTop = list.scrollHeight;
    } catch (e) {
      status.textContent = e.message;
      if ([403, 404].includes(e.status)) deny(e);
    } finally {
      busy = false;
      render();
      if (!denied) input.focus();
    }
  };
  // Only a fallback: normal social packets share the existing match stream.
  let fetching = false;
  const fallback = win.setInterval(async () => {
    if (
      closed ||
      denied ||
      !id ||
      fetching ||
      doc.hidden ||
      Date.now() - lastPacket < 9000
    )
      return;
    fetching = true;
    try {
      const data = await request(`/rooms/${id}/social`);
      update(data.social);
    } catch (e) {
      if ([403, 404].includes(e.status)) deny(e);
    } finally {
      fetching = false;
    }
  }, 5000);
  const lease = win.setInterval(renew, 15000);
  const expiry = win.setInterval(() => {
    const now = lastPacket
        ? serverNow + Math.max(0, Date.now() - lastPacket)
        : Date.now(),
      filtered = messages.filter((m) => m.expiresAt > now);
    if (filtered.length !== messages.length) {
      messages = filtered;
      render();
    }
  }, 30000);
  const leave = (room) => {
    if (spectator && room)
      void request(`/rooms/${room}/leave`, {
        method: "POST",
        body: JSON.stringify({ session }),
        keepalive: true,
      }).catch(() => {});
  };
  return {
    setMatch(matchId) {
      if (id === matchId) return;
      leave(id);
      id = matchId;
      messages = [];
      renderedKey = "";
      historyLoaded = false;
      animate.clear();
      serverNow = 0;
      lastPacket = 0;
      retry = null;
      denied = false;
      status.textContent = "";
      input.value = "";
      render();
      void renew();
    },
    update,
    close() {
      if (closed) return;
      closed = true;
      leave(id);
      win.clearInterval(fallback);
      win.clearInterval(lease);
      win.clearInterval(expiry);
      host.replaceChildren();
      watchers.remove();
      sounds.close();
      doc.removeEventListener("pointerdown", outsideEmoji);
      doc.removeEventListener("keydown", emojiKey);
    },
  };
}
