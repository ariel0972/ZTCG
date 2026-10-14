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
  if (process.env.PREVIEW_DECK_SELECTOR === "1") {
    const owner = "1".repeat(24),
      base = db.decks.find((d) => d.userId === owner);
    if (base) {
      base.nome = "Chamas de Ignir";
      base.mago = "016";
      db.decks.push({
        ...structuredClone(base),
        _id: "9".repeat(24),
        nome: "Maré de Farfun",
        mago: "017",
      });
    }
  }
  if (process.env.PREVIEW_RANKING === "1") {
    for (let n = 0; n < 8; n++) {
      const id = (n + 100).toString(16).padStart(24, "0");
      db.users.push({
        _id: id,
        nome: [
          "Ariel",
          "Luiz",
          "Flamel",
          "Morgana",
          "Soren",
          "Luna",
          "Kael",
          "Íris",
        ][n],
        avatarURL: "/assets/avatar.png",
      });
      const deckId = (n + 200).toString(16).padStart(24, "0");
      db.decks.push({
        ...db.decks[0],
        _id: deckId,
        userId: id,
        publico: true,
        nome: [
          "Maré de Zarcos",
          "Chamas do Alto Mago",
          "Guarda da Terra",
          "Legião Arcana",
          "Ventos do Norte",
          "Noite Profana",
          "Força da Mana",
          "Caminhos do Aprendiz",
        ][n],
        createdAt: new Date(2026, 0, n + 1),
      });
      for (let i = 0; i < 20 + n; i++)
        db.matches.push({
          matchId: `ranking-preview-${n}-${i}`,
          players: [{ userId: id, deckId }],
          winner: i < 15 - n ? id : null,
          finishedAt: new Date(),
        });
    }
  }
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
  if (process.env.PREVIEW_TITLES === "1") {
    const id = "a".repeat(24);
    db.users.push({
      _id: id,
      nome: "Guardião dos Thumos",
      avatarURL: "/assets/avatar.png",
    });
    for (let i = 0; i < 50; i++)
      db.matches.push({
        matchId: `title-preview-${i}`,
        players: [
          { userId: id, nome: "Guardião dos Thumos" },
          { userId: "1".repeat(24), nome: "Duelista 1" },
        ],
        winner: id,
        turns: 18,
        reason: "Mago derrotado.",
        finishedAt: new Date(2026, 9, 1, 0, i),
      });
  }
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
    if (process.env.PREVIEW_EFFECTS === "1") {
      game.state.slots.find((s) => s.id === `${owner}:front:0`)!.card =
        instance("025", owner);
      game.state.slots.find((s) => s.id === `${owner}:front:0`)!.card!.hpAtual =
        11;
      game.state.slots.find((s) => s.id === `${owner}:front:1`)!.card =
        instance("110", owner);
      game.state.slots.find((s) => s.id === `${owner}:front:2`)!.card =
        instance("117", owner);
      enemy.hpAtual = 25;
      enemy.hp = 30;
      game.player(owner).lastTroopAttacker = {
        cardId: enemy.id,
        turn: game.state.turn - 1,
      };
      game.player(owner).hand = ["053", "054", "005", "023"].map((id) =>
        instance(id, owner),
      );
      game.player(owner).deck = game
        .player(owner)
        .deck.filter((c) => !["053", "054"].includes(c.numeroCatalogo));
    }
    if (process.env.PREVIEW_MOUNTS === "1") {
      const own = (column: number) =>
        game.state.slots.find((s) => s.id === `${owner}:front:${column}`)!;
      own(0).card = instance("074", owner);
      own(1).card = null;
      own(2).card = instance("021", owner);
      enemy.hpAtual = 30;
      enemy.hp = 30;
      game.player(owner).hand = ["063", "075", "025", "001"].map((id) =>
        instance(id, owner),
      );
    }
    if (process.env.PREVIEW_FIELD_EFFECTS === "1") {
      ["111", "075", "021"].forEach((id, column) => {
        game.state.slots.find(
          (s) => s.id === `${owner}:front:${column}`,
        )!.card = instance(id, owner);
      });
      ["023", "021", "025"].forEach((id, column) => {
        game.state.slots.find(
          (s) => s.id === `${enemy.ownerId}:front:${column}`,
        )!.card = instance(id, enemy.ownerId);
      });
      game.state.ongoingSpells = [];
      for (const player of game.state.players) {
        const rain = instance("005", player.id);
        player.graveyard.push(rain);
        game.state.ongoingSpells.push({
          id: rain.id,
          ownerId: player.id,
          kind: "arrowRain",
          rounds: 2,
          damage: 3,
          card: {
            numeroCatalogo: rain.numeroCatalogo,
            nome: rain.nome,
            imgURL: rain.imgURL,
          },
        });
      }
      game.player(owner).hand = ["005", "004", "009"].map((id) =>
        instance(id, owner),
      );
    }
    if (process.env.PREVIEW_REACTIONS === "1") {
      for (let column = 0; column < 3; column++) {
        const target = instance("021", enemy.ownerId);
        target.nome = ["Alvo de Lava", "Alvo resistente", "Alvo vulnerável"][
          column
        ];
        target.hp = target.hpAtual = 30;
        target.elemento = column === 0 ? "Terra" : "Fogo";
        target.resistencia = column === 1 ? ["Fogo"] : [];
        target.fraqueza = column === 2 ? ["Fogo"] : [];
        game.state.slots.find(
          (s) => s.id === `${enemy.ownerId}:front:${column}`,
        )!.card = target;
      }
      game.player(owner).hand = ["Fogo", "Agua"].map((element) => {
        const spell = instance("001", owner);
        spell.nome =
          element === "Fogo" ? "Chamas da prévia" : "Águas da prévia";
        spell.elemento = element as Instance["elemento"];
        spell.custoMana = 1;
        spell.alvo = "TodasTropasInimigas";
        spell.maxAlvos = 3;
        spell.efeitos = [{ id: "damage", valor: 4 }];
        return spell;
      });
    }
    room.game = game.exportState();
    room.deadline =
      Date.now() + (process.env.PREVIEW_REACTIONS === "1" ? 1200000 : 120000);
    // Keep the fictitious opponent connected for this isolated visual fixture.
    await store.touch(enemy.ownerId, Date.now() + 3600000);
    await store.touch(owner, Date.now() + 3600000);
  }
  const server = createServer(createApp([], async () => mongoose, service));
  server.listen(3187, "127.0.0.1", () =>
    console.log(
      "PREVIA_ISOLADA http://127.0.0.1:3187 (p1@test.local / teste-ztcg-123)",
    ),
  );
});
