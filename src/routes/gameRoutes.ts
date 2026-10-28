import { assertTutorialComplete } from "../services/tutorial-access";
import { Router } from "express";
import { z } from "zod";
import { DurableGame } from "../game/durable";
import { checkToken } from "../middlewares/checkToken";
import { AuthRequest } from "../types";
import User from "../db/models/user";
import { log } from "../lib/observability";
import { MatchSocial } from "../game/social";
export function gameRoutes(game: DurableGame, social: MatchSocial) {
  const router = Router();
  router.use(checkToken);
  // checkToken already checks account existence and session revocation.
  router.get("/stream", async (req: AuthRequest, res) => {
    const initial = await game.state(req.userId!);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "private, no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let closed = false,
      snapshot = initial,
      lastRead = Date.now();
    let lastPresence = lastRead;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ticking = false,
      wakePending = false,
      notifiedRevision = -1;
    let watched: string | undefined,
      unsubscribe = () => {};
    const watch = (id?: string) => {
      if (id === watched) return;
      unsubscribe();
      watched = id;
      notifiedRevision = -1;
      unsubscribe =
        id && game.store.subscribeRoom
          ? game.store.subscribeRoom(id, (revision) => {
              notifiedRevision = Math.max(notifiedRevision, revision);
              if (ticking) wakePending = true;
              else {
                clearTimeout(timer);
                timer = setTimeout(tick, 0);
              }
            })
          : () => {};
    };
    let socialAt = 0,
      socialKey = "",
      socialPending = false;
    const finish = () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
      unsubscribe();
      res.end();
    };
    const lifetime = setTimeout(finish, 45000);
    res.on("close", () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
      unsubscribe();
    });
    const write = () => res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    write();
    const tick = async () => {
      if (closed || ticking) return;
      ticking = true;
      try {
        if (closed) return;
        const match = snapshot.match;
        const changed =
          match?.status === "ACTIVE" && game.store.roomRevision
            ? notifiedRevision > match.revision ||
              (await game.store.roomRevision(match.id)) !== match.revision
            : Date.now() - lastRead >= (snapshot.queued ? 2000 : 5000);
        if (closed) return;
        const due =
          match?.status === "ACTIVE" &&
          !match.paused &&
          (Date.now() >= (match.responseDeadline ?? match.deadline) ||
            (match.aiThinking && Date.now() >= (match.aiNextAt ?? 0)));
        const fullReadInterval = match?.status === "ACTIVE" ? 10000 : 5000;
        if (changed || due || Date.now() - lastRead >= fullReadInterval) {
          const previous = JSON.stringify([
            snapshot.match?.id,
            snapshot.match?.version,
            snapshot.match?.deadline,
            snapshot.match?.responseDeadline,
            snapshot.match?.paused,
            snapshot.queued,
            snapshot.rematch,
          ]);
          snapshot = await game.state(req.userId!);
          watch(snapshot.match?.id);
          lastRead = Date.now();
          lastPresence = lastRead;
          if (closed) return;
          if (res.writableLength > 1000000) {
            finish();
            return;
          }
          const next = JSON.stringify([
            snapshot.match?.id,
            snapshot.match?.version,
            snapshot.match?.deadline,
            snapshot.match?.responseDeadline,
            snapshot.match?.paused,
            snapshot.queued,
            snapshot.rematch,
          ]);
          if (previous !== next) write();
          else res.write(": heartbeat\n\n");
        } else if (
          match?.status === "ACTIVE" &&
          Date.now() - lastPresence >= 5000
        ) {
          // Keeping a player online does not require downloading both decks.
          await game.store.touch(req.userId!, Date.now());
          lastPresence = Date.now();
          if (!closed) res.write(": heartbeat\n\n");
        }
        if (
          !closed &&
          snapshot.match &&
          snapshot.match.mode !== "ai" &&
          !socialPending &&
          Date.now() - socialAt >= 3000
        ) {
          // Social traffic never blocks or writes the combat room.
          socialAt = Date.now();
          socialPending = true;
          void social
            .snapshot(snapshot.match.id)
            .then((state) => {
              const key = JSON.stringify([state.messages, state.viewers]);
              if (
                !closed &&
                state.matchId === snapshot.match?.id &&
                key !== socialKey
              ) {
                if (res.writableLength > 200000) {
                  finish();
                  return;
                }
                res.write(`data: ${JSON.stringify({ social: state })}\n\n`);
                socialKey = key;
              } else if (
                !closed &&
                state.matchId === snapshot.match?.id &&
                req.headers["x-match-social-heartbeat"] === "1"
              ) {
                // Confirm a successful social read without resending 50 messages.
                res.write(
                  `data: ${JSON.stringify({ social: { matchId: state.matchId, serverNow: state.serverNow, unchanged: true } })}\n\n`,
                );
              }
            })
            .catch(() => {
              log("match_social_unavailable", {}, "warn");
            })
            .finally(() => {
              socialPending = false;
            });
        }
        if (closed) return;
      } catch {
        log("game_stream_interrupted", {}, "warn");
        finish();
      } finally {
        ticking = false;
        if (!closed)
          timer = setTimeout(
            tick,
            wakePending ? 0 : snapshot.match?.status === "ACTIVE" ? 750 : 2000,
          );
        wakePending = false;
      }
    };
    watch(snapshot.match?.id);
    timer = setTimeout(tick, 750);
  });
  router.get("/state", async (req: AuthRequest, res) => {
    const started = performance.now();
    const state = await game.state(req.userId!);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Server-Timing",
      `game-state;dur=${(performance.now() - started).toFixed(1)}`,
    );
    res.json(state);
  });
  router.post("/event", async (req: AuthRequest, res) => {
    const started = performance.now();
    const { event, data, requestId } = z
      .object({
        event: z.enum([
          "queue:join",
          "ai:start",
          "queue:cancel",
          "match:resume",
          "match:command",
          "match:rematch",
          "match:refuseRematch",
          "match:ackResult",
        ]),
        data: z.unknown(),
        requestId: z.uuid(),
      })
      .strict()
      .parse(req.body);
    let result: unknown = {};
    const user = req.userId!;
    if (["queue:join", "match:rematch", "ai:start"].includes(event))
      await assertTutorialComplete(user);
    if (event === "queue:join" || event === "ai:start") {
      const { deckId } = z
        .object({ deckId: z.string().regex(/^[a-f\d]{24}$/i) })
        .strict()
        .parse(data);
      const account = await User.findById(user);
      result =
        event === "ai:start"
          ? await game.startAi(user, account!.nome, deckId, requestId)
          : await game.join(user, account!.nome, deckId, requestId);
    } else if (event === "queue:cancel")
      result = await game.cancel(user, requestId);
    else if (event === "match:command") {
      const input = z
        .object({ matchId: z.uuid(), command: z.unknown() })
        .strict()
        .parse(data);
      result = await game.command(input.matchId, user, input.command);
    } else if (event !== "match:resume") {
      const { matchId } = z.object({ matchId: z.uuid() }).strict().parse(data);
      result =
        event === "match:ackResult"
          ? await game.acknowledgeResult(matchId, user)
          : await game.rematch(matchId, user, event === "match:refuseRematch");
    }
    const elapsed = Math.round(performance.now() - started);
    res.setHeader("Server-Timing", `game;dur=${elapsed}`);
    log("game_event", { event, durationMs: elapsed });
    res.json({
      success: true,
      ...(result as object),
      ...(event === "match:command" ? {} : { state: await game.state(user) }),
    });
  });
  return router;
}
