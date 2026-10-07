import { api, token } from "./auth.js";
// Commands remain durable HTTP requests; the stream delivers private snapshots.
export function gameTransport({
  request = api,
  fetchStream = fetch,
  getToken = token,
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
    pendingPoll = request("/game/state")
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
      const response = await fetchStream("/game/stream", {
        headers: { Authorization: `Bearer ${getToken()}` },
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
      }
      // HTTP fallback also refreshes an expired session before reconnecting.
      timer = setTimeout(
        stream,
        active ? 1000 : Math.min(10000, 2000 * failures),
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
