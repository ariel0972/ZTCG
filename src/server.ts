import { createServer } from "node:http";
import express from "express";
import mongoose from "mongoose";
import { config } from "./lib/config";
import { createApp } from "./application";
import dbConnect from "./lib/mongodb";
const settings = config(),
  app = express();
// Vercel's framework detector requires a runtime Express import in its entrypoint.
// Keep the platform adapter here and the application factory independently testable.
app.disable("x-powered-by");
if (process.env.VERCEL) app.set("trust proxy", 1);
app.use(createApp(settings.origins));
if (require.main === module) {
  const server = createServer(app);
  server.listen(settings.port, () =>
    console.log(`ZTCG: http://localhost:${settings.port}`),
  );
  void dbConnect().catch(() =>
    console.error(
      "MongoDB indisponível. APIs retornarão 503 até a conexão ser recuperada.",
    ),
  );
  const shutdown = () => {
    server.close(() => {
      void mongoose.disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
export default app;
