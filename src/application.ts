import { profileRoutes } from "./routes/profileRoutes";
import express, { ErrorRequestHandler } from "express";
import path from "node:path";
import mongoose from "mongoose";
import cors from "cors";
import { z } from "zod";
import dbConnect from "./lib/mongodb";
import { AppError } from "./lib/errors";
import userRoutes, { publicUser } from "./routes/userRoutes";
import deckRoutes from "./routes/deckRoutes";
import adminRoutes from "./routes/adminRoutes";
import { cardRoutes } from "./routes/cardRoutes";
import { checkToken } from "./middlewares/checkToken";
import { checkAdmin } from "./middlewares/checkAdmin";
import { AuthRequest } from "./types";
import User from "./db/models/user";
import Match from "./db/models/match";
import { rateLimit } from "./middlewares/rateLimit";
import { DurableGame } from "./game/durable";
import { gameRoutes } from "./routes/gameRoutes";
import { friendRoutes } from "./routes/friendRoutes";
import { requestLog, log } from "./lib/observability";
export function createApp(
  origins: string[] = [],
  connect = dbConnect,
  game = new DurableGame(),
) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.VERCEL) app.set("trust proxy", 1);
  app.use(requestLog);
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use(express.json({ limit: "400kb" }));
  app.use(rateLimit(300));
  app.use((_req, res, next) => {
    if (_req.headers.authorization || _req.path.startsWith("/auth"))
      res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    next();
  });
  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      database:
        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      gameServer: true,
      transport: "http-durable",
    });
  });
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.get("/", (_req, res) =>
    res.sendFile(path.join(__dirname, "..", "public/HTML/deckbuilder.html"), {
      dotfiles: "allow",
    }),
  );
  // HTML e healthcheck continuam disponíveis se o banco estiver fora do ar.
  app.use(async (_req, _res, next) => {
    try {
      await connect();
      next();
    } catch {
      next(
        new AppError(
          503,
          "Banco indisponível. Tente novamente em instantes.",
          "DATABASE_UNAVAILABLE",
        ),
      );
    }
  });
  app.use("/auth", userRoutes);
  app.use("/game", gameRoutes(game));
  app.use("/friends", friendRoutes(game));
  app.use("/profiles", checkToken, profileRoutes);
  app.get("/ops/maintenance", async (req, res) => {
    if (
      !process.env.CRON_SECRET ||
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
    )
      throw new AppError(401, "Acesso negado.");
    const result = await game.maintain();
    const pending = (await game.store.pending(100)).filter(
      (r) =>
        r.finishedAt && !r.resultSaved && Date.now() - r.finishedAt > 300000,
    );
    if (pending.length) {
      log("alert_pending_results", { count: pending.length }, "error");
      if (process.env.ALERT_WEBHOOK_URL) {
        try {
          const response = await fetch(process.env.ALERT_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `ZTCG: ${pending.length} resultados aguardam gravação há mais de 5 minutos.`,
              event: "pending_results",
              count: pending.length,
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error();
        } catch {
          log("alert_delivery_failed", {}, "error");
        }
      }
    }
    res.json({ success: true, ...result, pendingAlerts: pending.length });
  });
  app.get("/ops/metrics", async (req, res) => {
    if (
      !process.env.CRON_SECRET ||
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
    )
      throw new AppError(401, "Acesso negado.");
    const { data } = await game.store.lobby(),
      rooms = await game.store.pending(100);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      queued: data.waiting.filter((e) => Date.now() - e.joinedAt < 300000)
        .length,
      sampledRooms: rooms.length,
      activeSample: rooms.filter((r) => r.game.state.status === "ACTIVE")
        .length,
      pendingResultsSample: rooms.filter(
        (r) => r.game.state.status === "FINISHED" && !r.resultSaved,
      ).length,
      oldestPendingSeconds: Math.max(
        0,
        ...rooms
          .filter((r) => r.finishedAt && !r.resultSaved)
          .map((r) => (Date.now() - r.finishedAt!) / 1000),
      ),
    });
  });
  app.get("/ready", async (_req, res) => {
    try {
      if (!mongoose.connection.db) throw new Error();
      await mongoose.connection.db.admin().ping();
    } catch {
      throw new AppError(503, "Banco indisponível.", "DATABASE_UNAVAILABLE");
    }
    res.json({ success: true, database: "connected" });
  });
  app.use("/cards", cardRoutes);
  app.use("/decks", checkToken, deckRoutes);
  app.use("/admin", checkToken, checkAdmin, adminRoutes);
  app.get("/user/:id", checkToken, async (req: AuthRequest, res) => {
    if (req.params.id !== req.userId) throw new AppError(403, "Acesso negado.");
    const user = await User.findById(req.userId);
    if (!user) throw new AppError(404, "Conta não encontrada.");
    res.json({ success: true, user: publicUser(user) });
  });
  app.get("/matches", checkToken, async (req: AuthRequest, res) => {
    const matches = await Match.find({ "players.userId": req.userId })
      .sort({ finishedAt: -1 })
      .limit(30)
      .lean();
    res.json({ success: true, matches });
  });
  app.use((_req, _res, next) =>
    next(new AppError(404, "Rota não encontrada.", "NOT_FOUND")),
  );
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    let e: AppError;
    if (error instanceof AppError) e = error;
    else if (error instanceof z.ZodError)
      e = new AppError(
        422,
        "Revise os campos enviados.",
        "VALIDATION",
        error.issues,
      );
    else if (error?.code === 11000)
      e = new AppError(409, "Este registro já existe.", "DUPLICATE");
    else if (error?.type === "entity.too.large")
      e = new AppError(413, "Dados excedem o tamanho permitido.");
    else if (
      error instanceof SyntaxError ||
      error?.name === "ValidationError" ||
      error?.name === "CastError"
    )
      e = new AppError(422, "Dados inválidos.");
    else {
      log(
        "request_failed",
        {
          requestId: res.getHeader("X-Request-Id"),
          errorType: error?.name ?? "Unknown",
        },
        "error",
      );
      e = new AppError(500, "Erro interno. Tente novamente.");
    }
    res.status(e.status).json({
      success: false,
      content: e.message,
      code: e.code,
      details: e.details,
    });
  };
  app.use(errorHandler);
  return app;
}
