import { Router } from "express";
import { z } from "zod";
import User from "../db/models/user";
import { checkToken } from "../middlewares/checkToken";
import { rateLimit } from "../middlewares/rateLimit";
import { AuthRequest } from "../types";
import { MatchSocial } from "../game/social";

export function matchSocialRoutes(social: MatchSocial) {
  const router = Router();
  router.use(checkToken);
  router.post("/presence", async (req: AuthRequest, res) => {
    await social.store.touch(req.userId!, Date.now());
    res.json({ success: true });
  });
  router.get("/friends", async (req: AuthRequest, res) => {
    res.json({ success: true, friends: await social.activities(req.userId!) });
  });
  router.param("id", (req, _res, next, value) => {
    z.uuid().parse(value);
    next();
  });
  router.get("/:id/social", async (req: AuthRequest, res) => {
    const id = String(req.params.id);
    await social.authorize(id, req.userId!);
    res.json({ success: true, social: await social.snapshot(id) });
  });
  router.post("/:id/chat", rateLimit(50), async (req: AuthRequest, res) => {
    const body = z
      .object({ id: z.uuid(), text: z.string().max(1200) })
      .strict()
      .parse(req.body);
    const account = await User.findById(req.userId).select("nome").lean();
    const message = await social.send(
      String(req.params.id),
      req.userId!,
      account!.nome,
      body.id,
      body.text,
    );
    res.json({ success: true, message });
  });
  router.post("/:id/watch", rateLimit(30), async (req: AuthRequest, res) => {
    const { session } = z
      .object({ session: z.uuid() })
      .strict()
      .parse(req.body);
    const account = await User.findById(req.userId).select("nome").lean();
    await social.watch(
      String(req.params.id),
      req.userId!,
      account!.nome,
      session,
    );
    res.json({ success: true });
  });
  router.post("/:id/leave", async (req: AuthRequest, res) => {
    const { session } = z
      .object({ session: z.uuid() })
      .strict()
      .parse(req.body);
    await social.store.leave(String(req.params.id), req.userId!, session);
    res.json({ success: true });
  });
  router.get("/:id/state", async (req: AuthRequest, res) => {
    const id = String(req.params.id);
    await social.authorize(id, req.userId!);
    res.json(await social.game.spectatorState(id));
  });
  router.get("/:id/stream", async (req: AuthRequest, res) => {
    const id = String(req.params.id);
    await social.authorize(id, req.userId!);
    let snapshot = await social.game.spectatorState(id);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "private, no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let closed = false,
      lastAuth = Date.now(),
      lastSocial = 0,
      lastKey = "";
    let timer: ReturnType<typeof setTimeout>;
    const close = () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
      res.end();
    };
    const lifetime = setTimeout(close, 45000);
    res.on("close", () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(lifetime);
    });
    const write = (data: unknown) => {
      if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    write(snapshot);
    const tick = async () => {
      try {
        if (closed) return;
        if (Date.now() - lastAuth >= 10000) {
          await social.authorize(id, req.userId!);
          lastAuth = Date.now();
        }
        const revision = await social.game.store.roomRevision?.(id);
        if (revision !== snapshot.match.revision) {
          snapshot = await social.game.spectatorState(id);
          write(snapshot);
        }
        if (Date.now() - lastSocial >= 3000) {
          const state = await social.snapshot(id),
            key = JSON.stringify([state.messages, state.viewers]);
          if (key !== lastKey) {
            write({ social: state });
            lastKey = key;
          } else if (!closed && req.headers["x-match-social-heartbeat"] === "1")
            write({
              social: {
                matchId: id,
                serverNow: state.serverNow,
                unchanged: true,
              },
            });
          else if (!closed) res.write(": heartbeat\n\n");
          lastSocial = Date.now();
        }
        if (closed) return;
        if (res.writableLength > 200000) {
          close();
          return;
        }
        timer = setTimeout(
          tick,
          snapshot.match.status === "ACTIVE" ? 1500 : 3000,
        );
      } catch (e: any) {
        write({
          accessDenied: e.status === 403 || e.status === 404,
          content: "A sala não está disponível. Volte à lista de amigos.",
        });
        close();
      }
    };
    timer = setTimeout(tick, 100);
  });
  return router;
}
