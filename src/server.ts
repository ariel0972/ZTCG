import { createServer } from "node:http";
import mongoose from "mongoose";
import { config } from "./lib/config";
import { createApp } from "./application";
import dbConnect from "./lib/mongodb";
const settings = config(),
  app = createApp(settings.origins);
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
