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
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let closed = false,
      snapshot = initial,
      lastRead = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socialAt = 0,
      socialKey = "",
      socialPending = false;
    const finish = () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
      res.end();
    };
    const lifetime = setTimeout(finish, 45000);
    res.on("close", () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
    });
    const write = () => res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    write();
    const tick = async () => {
      try {
        if (closed) return;
        const match = snapshot.match;
        const changed =
          match?.status === "ACTIVE" && game.store.roomRevision
            ? (await game.store.roomRevision(match.id)) !== match.revision
            : Date.now() - lastRead >= (snapshot.queued ? 2000 : 5000);
        if (closed) return;
        const due =
          match?.status === "ACTIVE" &&
          !match.paused &&
          Date.now() >= (match.responseDeadline ?? match.deadline);
        if (changed || due || Date.now() - lastRead >= 5000) {
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
          lastRead = Date.now();
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
        }
        if (
          !closed &&
          snapshot.match &&
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
        timer = setTimeout(
          tick,
          snapshot.match?.status === "ACTIVE" ? 750 : 2000,
        );
      } catch {
        log("game_stream_interrupted", {}, "warn");
        finish();
      }
    };
    timer = setTimeout(tick, 750);
  });
  router.get("/state", async (req: AuthRequest, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await game.state(req.userId!));
  });
  router.post("/event", async (req: AuthRequest, res) => {
    const started = performance.now();
    const { event, data, requestId } = z
      .object({
        event: z.enum([
          "queue:join",
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
    if (event === "queue:join") {
      const { deckId } = z
        .object({ deckId: z.string().regex(/^[a-f\d]{24}$/i) })
        .strict()
        .parse(data);
      const account = await User.findById(user);
      result = await game.join(user, account!.nome, deckId, requestId);
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
