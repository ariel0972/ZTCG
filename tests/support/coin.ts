import { randomUUID } from "node:crypto";
import type { Game } from "../../src/game/engine";
// Explicitly complete the real selection/reveal stages in older combat fixtures.
export function completeCoin(g: Game) {
  if (g.state.phase !== "COIN_TOSS") return;
  if (!g.state.coinToss?.result)
    g.execute(g.state.coinToss!.chooserId, {
      type: "chooseCoin",
      face: "heads",
      actionId: randomUUID(),
      version: g.state.version,
    });
  g.timeout();
}
