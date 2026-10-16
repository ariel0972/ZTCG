import { api, token } from "./auth.js";
// Commands remain durable HTTP requests; the stream delivers private snapshots.
export function gameTransport({
  request = api,
  fetchStream = fetch,
  getToken = token,
  statePath = "/game/state",
  streamPath = "/game/stream",
  readOnly = false,
} = {}) {
  const listeners = new Map();
  let connected = false,
    closed = false,
    version = "",
    rematch = "",
    active = false;
  let pendingPoll,
    controller,
    timer,
    mutation = 0,
    currentMatch,
    failures = 0;
  const retired = new Set();
  function emit(event, data) {
    if (!closed) for (const fn of listeners.get(event) || []) fn(data);
  }
  function publish(data) {
    if (closed) return;
    if (data.accessDenied) {
      emit("access_denied", data);
      closed = true;
      controller?.abort();
      return;
    }
    if (data.social) {
      emit("match:social", data.social);
      return;
    }
    const match = data.match;
    if (
      match &&
      (retired.has(match.id) ||
        (currentMatch?.id === match.id &&
          (match.version < currentMatch.version ||
            (match.version === currentMatch.version &&
              (match.revision ?? 0) < (currentMatch.revision ?? 0)))))
    )
      return;
    if (!connected) {
      connected = true;
      emit("connect");
    }
    emit("queue:state", { queued: data.queued });
    active = match?.status === "ACTIVE" || data.queued;
    if (match) {
      if (currentMatch && currentMatch.id !== match.id)
        retired.add(currentMatch.id);
      currentMatch = match;
      const key = `${match.id}:${match.version}:${match.deadline}:${match.responseDeadline}:${match.paused}`;
      if (key !== version) {
        version = key;
        emit("match:state", match);
      }
    }
    const next = JSON.stringify(data.rematch);
    if (next !== rematch) {
      rematch = next;
      if (data.rematch) emit("match:rematchState", data.rematch);
    }
  }
  function poll() {
    if (pendingPoll) return pendingPoll;
    const generation = mutation;
    pendingPoll = request(statePath)
      .then((data) => {
        if (generation === mutation) publish(data);
      })
      .finally(() => {
        pendingPoll = null;
      });
    return pendingPoll;
  }
  async function stream() {
    if (closed) return;
    controller = new AbortController();
    let watchdog = setTimeout(() => controller?.abort(), 12000);
    try {
      const response = await fetchStream(streamPath, {
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "X-Match-Social-Heartbeat": "1",
        },
        signal: controller.signal,
      });
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      )
        throw new Error("Stream indisponível");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller?.abort(), 12000);
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.startsWith("data: ")) {
            publish(JSON.parse(frame.slice(6)));
            failures = 0;
          }
        }
        if (buffer.length > 2000000)
          throw new Error("Atualização muito grande");
      }
      if (!closed) timer = setTimeout(stream, 150);
    } catch (error) {
      if (closed) return;
      failures++;
      try {
        await poll();
      } catch (failure) {
        if (connected) {
          connected = false;
          emit("disconnect");
        }
        emit("connect_error", failure);
        if (readOnly && [403, 404].includes(failure.status)) {
          emit("access_denied", { content: failure.message });
          closed = true;
          return;
        }
      }
      // HTTP fallback refreshes expired sessions; backoff avoids database storms
      // during outages. Jitter prevents clients from retrying together.
      timer = setTimeout(
        stream,
        Math.min(
          active ? 10000 : 30000,
          (active ? 1000 : 2000) * 2 ** Math.min(failures - 1, 5),
        ) + Math.floor(Math.random() * 250),
      );
    } finally {
      clearTimeout(watchdog);
    }
  }
  timer = setTimeout(stream, 0);
  return {
    get connected() {
      return connected;
    },
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) || []), fn]);
    },
    emit(event, data, ack = () => {}) {
      if (readOnly) {
        ack(null, {
          success: false,
          content: "Você está assistindo à partida.",
        });
        return;
      }
      const body = JSON.stringify({
        event,
        data,
        requestId: crypto.randomUUID(),
      });
      mutation++;
      void (async () => {
        const started = performance.now();
        for (let attempt = 0; attempt < 3 && !closed; attempt++) {
          try {
            const result = await request("/game/event", {
              method: "POST",
              body,
            });
            mutation++;
            if (result.state) publish(result.state);
            // A committed event stays successful even if a later refresh fails.
            else await poll().catch(() => {});
            emit("latency", Math.round(performance.now() - started));
            ack(null, result);
            return;
          } catch (error) {
            if (
              attempt < 2 &&
              (!error.status ||
                error.status >= 500 ||
                error.code === "STORE_BUSY")
            ) {
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
              continue;
            }
            void poll().catch(() => {});
            ack(null, {
              success: false,
              content: error.message,
              code: error.code,
            });
            return;
          }
        }
      })();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      controller?.abort();
      listeners.clear();
    },
  };
}
