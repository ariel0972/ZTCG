import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { fakeDatabase } from "./support/database";
import { MemoryDurableStore } from "./support/durable-store";
import { DurableGame } from "../src/game/durable";
import { createApp } from "../src/application";
test("HTTP em duas instâncias: fila, recuperação, autorização e renovação de sessão", async () => {
  process.env.SECRET = "http-integration-012345678901234567890123";
  const db = await fakeDatabase(),
    store = new MemoryDurableStore();
  const servers = [0, 1].map(() =>
    createServer(createApp([], async () => mongoose, new DurableGame(store))),
  );
  for (const server of servers)
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = servers.map(
    (s) => `http://127.0.0.1:${(s.address() as any).port}`,
  );
  const token = (n: number) =>
    jwt.sign({ id: String(n).repeat(24) }, process.env.SECRET!);
  async function call(
    instance: number,
    path: string,
    body?: unknown,
    n = 1,
    cookie?: string,
  ) {
    const response = await fetch(base[instance] + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token(n)}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { response, data: (await response.json()) as any };
  }
  try {
    const login = await call(0, "/auth/logar", {
      email: "p1@test.local",
      senha: "teste-ztcg-123",
    });
    const cookie = login.response.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.response.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal(
      (await call(1, "/auth/refresh", {}, 1, cookie)).response.status,
      200,
    );
    assert.equal((await call(1, "/auth/refresh", {})).response.status, 401);
    const refreshToken = decodeURIComponent(cookie.split("=")[1]);
    assert.equal(
      (
        await fetch(base[0] + "/auth/me", {
          headers: { Authorization: `Bearer ${refreshToken}` },
        })
      ).status,
      401,
    );
    const foreign = await fetch(base[0] + "/auth/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: "https://other.invalid",
      },
      body: "{}",
    });
    assert.equal(foreign.status, 403);
    for (const n of [1, 2]) {
      const deck =
        db.decks.find(
          (d) => String(d.ownerId ?? d.donoID) === String(n).repeat(24),
        ) ?? db.decks[n - 1];
      const result = await call(
        n - 1,
        "/game/event",
        {
          event: "queue:join",
          data: { deckId: String(deck._id) },
          requestId: randomUUID(),
        },
        n,
      );
      assert.equal(result.response.status, 200, JSON.stringify(result.data));
    }
    const first = (await call(1, "/game/state")).data.match,
      second = (await call(0, "/game/state", undefined, 2)).data.match;
    assert.equal(first.id, second.id);
    const streamAbort = new AbortController();
    const streamed = await fetch(base[0] + "/game/stream", {
      headers: { Authorization: `Bearer ${token(2)}` },
      signal: streamAbort.signal,
    });
    assert.match(streamed.headers.get("content-type")!, /text\/event-stream/);
    const reader = streamed.body!.getReader();
    let buffer = "";
    const readFrame = async () => {
      while (true) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith("data: ")) return JSON.parse(frame.slice(6));
          continue;
        }
        const part = await reader.read();
        assert.equal(part.done, false);
        buffer += new TextDecoder().decode(part.value);
      }
    };
    const initialFrame = await readFrame();
    assert.equal(
      initialFrame.match.players.find((p: any) => p.id === String(1).repeat(24))
        .hand,
      undefined,
    );
    const request = {
      event: "match:command",
      data: {
        matchId: first.id,
        command: {
          type: "endTurn",
          version: first.version,
          actionId: randomUUID(),
        },
      },
      requestId: randomUUID(),
    };
    const results = await Promise.all([
      call(0, "/game/event", request),
      call(1, "/game/event", request),
    ]);
    assert.equal(results.filter((r) => r.data.duplicate).length, 1);
    assert.equal(results[0].data.state.match.version, first.version + 1);
    assert.match(
      results[0].response.headers.get("server-timing")!,
      /game;dur=/,
    );
    const timeout = setTimeout(() => streamAbort.abort(), 5000);
    try {
      const update = await readFrame();
      assert.equal(update.match.version, first.version + 1);
    } finally {
      clearTimeout(timeout);
      streamAbort.abort();
      await reader.cancel().catch(() => {});
    }

    const third = await call(
      0,
      "/game/event",
      { ...request, requestId: randomUUID() },
      3,
    );
    assert.equal(third.response.status, 403);
    const beforeEnd = (await call(0, "/game/state")).data.match;
    assert.equal(
      (
        await call(0, "/game/event", {
          event: "match:command",
          requestId: randomUUID(),
          data: {
            matchId: beforeEnd.id,
            command: {
              type: "surrender",
              version: beforeEnd.version,
              actionId: randomUUID(),
            },
          },
        })
      ).response.status,
      200,
    );
    assert.equal(
      (
        await call(1, "/game/event", {
          event: "match:ackResult",
          requestId: randomUUID(),
          data: { matchId: beforeEnd.id },
        })
      ).response.status,
      200,
    );
    assert.equal((await call(0, "/game/state")).data.match, null);
    assert.equal(
      (await call(1, "/game/state", undefined, 2)).data.match.status,
      "FINISHED",
    );
    assert.equal((await call(0, "/ops/metrics")).response.status, 401);
    assert.equal((await call(0, "/auth/logout", {})).response.status, 200);
  } finally {
    for (const server of servers)
      await new Promise<void>((r) => server.close(() => r()));
  }
});
