// Prévia isolada com fixtures; sem MongoDB ou dados reais.
import { createServer } from "node:http";
import mongoose from "mongoose";
import { createApp } from "../src/application";
import { DurableGame } from "../src/game/durable";
import { MemoryDurableStore } from "./support/durable-store";
import { fakeDatabase } from "./support/database";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { randomUUID } from "node:crypto";
process.env.SECRET = "preview-only-012345678901234567890123456789";
void fakeDatabase().then(async (db) => {
  if (process.env.PREVIEW_SOCIAL === "1") {
    db.friendships.push(
      {
        key: `${"1".repeat(24)}:${"2".repeat(24)}`,
        members: ["1".repeat(24), "2".repeat(24)],
        requestedBy: "1".repeat(24),
        status: "pending",
      },
      {
        key: `${"1".repeat(24)}:${"3".repeat(24)}`,
        members: ["1".repeat(24), "3".repeat(24)],
        requestedBy: "3".repeat(24),
        status: "accepted",
      },
    );
    db.invitations.push({
      invitationId: randomUUID(),
      from: "3".repeat(24),
      to: "1".repeat(24),
      deckId: "6".repeat(24),
      status: "pending",
      expires: new Date(Date.now() + 300000),
      createdAt: new Date(),
    });
  }
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
  const store = new MemoryDurableStore(),
    service = new DurableGame(store);
  if (process.env.PREVIEW_MECHANICS === "1") {
    const pair = await service.startPrivate(
      randomUUID(),
      [1, 2].map((n) => ({
        id: String(n).repeat(24),
        nome: `Duelista ${n}`,
        deckId: String(n + 3).repeat(24),
      })),
    );
    if (typeof pair.matchId !== "string") throw Error("Fixture sem partida");
    const room = store.rooms.get(pair.matchId)!;
    const game = Game.restore(room.game);
    const instance = (id: string, ownerId: string): Instance => {
      const card = structuredClone(
        db.catalog.find((c) => c.numeroCatalogo === id)!,
      );
      return {
        ...card,
        id: randomUUID(),
        ownerId,
        hpAtual: card.hp ?? 0,
        attacked: false,
        usedAbility: false,
        statuses: [],
      };
    };
    game.state.phase = "BATTLE";
    game.state.turn = 3;
    game.state.current = "1".repeat(24);
    for (const player of game.state.players) {
      player.mage = instance("028", player.id);
      game.state.slots.find(
        (s) => s.ownerId === player.id && s.kind === "Mago",
      )!.card = player.mage;
      player.mana = 20;
    }
    const owner = "1".repeat(24);
    game.state.slots.find((s) => s.id === `${owner}:front:0`)!.card = instance(
      "095",
      owner,
    );
    game.state.slots.find((s) => s.id === `${owner}:front:1`)!.card = instance(
      "098",
      owner,
    );
    const enemy = instance("020", "2".repeat(24));
    enemy.hpAtual = 3;
    game.state.slots.find((s) => s.id === `${enemy.ownerId}:front:2`)!.card =
      enemy;
    if (process.env.PREVIEW_NAVIGATION === "1") {
      game.player(owner).hand = [
        "001",
        "004",
        "003",
        "011",
        "008",
        "009",
        "002",
        "020",
        "027",
        "021",
        "022",
        "023",
        "024",
        "025",
        "026",
      ].map((id) => instance(id, owner));
      game.player(owner).hand.find((c) => c.numeroCatalogo === "011")!.alvo =
        "CampoInimigo";
      game.player(owner).hand.find((c) => c.numeroCatalogo === "011")!.efeitos =
        [{ id: "field" }];
      game
        .player(owner)
        .hand.find((c) => c.numeroCatalogo === "011")!.elemento = "Agua";
    }
    game.player(owner).graveyard = [instance("001", owner)];
    room.game = game.exportState();
    room.deadline = Date.now() + 120000;
    // Keep the fictitious opponent connected for this isolated visual fixture.
    await store.touch(enemy.ownerId, Date.now() + 3600000);
  }
  const server = createServer(createApp([], async () => mongoose, service));
  server.listen(3187, "127.0.0.1", () =>
    console.log(
      "PREVIA_ISOLADA http://127.0.0.1:3187 (p1@test.local / teste-ztcg-123)",
    ),
  );
});
