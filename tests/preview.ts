// Prévia isolada com fixtures; sem MongoDB ou dados reais.
import { createServer } from "node:http";
import mongoose from "mongoose";
import { createApp } from "../src/application";
import { DurableGame } from "../src/game/durable";
import { MemoryDurableStore } from "./support/durable-store";
import { fakeDatabase } from "./support/database";
process.env.SECRET = "preview-only-012345678901234567890123456789";
void fakeDatabase().then((db) => {
  // Optional, isolated fixtures for the profile UI; never touches production data.
  if (process.env.PREVIEW_PROFILES === "1") {
    db.decks[0].publico = true;
    db.decks[1].publico = true;
    for (let n = 0; n < 27; n++)
      db.matches.push({
        matchId: `preview-${n}`,
        players: [
          { userId: "1".repeat(24), nome: "Duelista 1" },
          { userId: "2".repeat(24), nome: "Duelista 2" },
        ],
        winner: n % 3 === 0 ? "2".repeat(24) : "1".repeat(24),
        turns: 12 + n,
        reason: "Mago derrotado.",
        finishedAt: new Date(Date.now() - n * 3600000),
      });
  }
  const server = createServer(
    createApp(
      [],
      async () => mongoose,
      new DurableGame(new MemoryDurableStore()),
    ),
  );
  server.listen(3187, "127.0.0.1", () =>
    console.log(
      "PREVIA_ISOLADA http://127.0.0.1:3187 (p1@test.local / teste-ztcg-123)",
    ),
  );
});
