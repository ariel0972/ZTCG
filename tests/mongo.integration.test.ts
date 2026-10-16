import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { DurableGame } from "../src/game/durable";
import { MongoGameStore } from "../src/game/store";
import { Game } from "../src/game/engine";
import User from "../src/db/models/user";
import Deck from "../src/db/models/decks";
import Match from "../src/db/models/match";
import {
  rebuildRankings,
  createRankingIndexes,
  projectMatchRankings,
} from "../src/services/ranking-projections";
import { storeAvatar, avatarBytes } from "../src/services/avatars";
import sharp from "sharp";
test(
  "MongoDB real isolado: CAS, reinício, idempotência e projeção recuperável",
  {
    skip: !process.env.MONGO_TEST_URL,
  },
  async () => {
    const database = process.env.MONGO_TEST_DATABASE;
    assert.ok(
      database?.startsWith("ztcg_test_"),
      "Use um banco exclusivo ztcg_test_*",
    );
    try {
      await mongoose.connect(process.env.MONGO_TEST_URL!, {
        dbName: database,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        autoCreate: false,
        autoIndex: false,
      });
    } catch (error) {
      await mongoose.disconnect();
      throw new Error(
        `Banco de teste indisponível (${(error as Error).name}).`,
      );
    }
    // Never run against an existing database, even when it has the expected prefix.
    let safeToDrop = false;
    const catalog = initial.map((c) => cardSchema.parse(c));
    const deck = {
      nome: "Integracao",
      mago: "108",
      cartas: catalog
        .filter((c) => c.publicado && c.tipo === "Tropa")
        .flatMap((c) => Array(3).fill(c.numeroCatalogo))
        .slice(0, 40),
    };
    const load = async () => ({ deck, catalog }) as any;
    let offline = true;
    const record = async (room: any) => {
      if (offline) throw new Error("projection unavailable");
      await mongoose.connection
        .db!.collection("testresults")
        .updateOne(
          { _id: room.id },
          { $setOnInsert: { winner: room.game.state.winner } },
          { upsert: true },
        );
    };
    const service = () =>
      new DurableGame(new MongoGameStore(), Date.now, load, record);
    try {
      assert.equal(
        (await mongoose.connection.db!.listCollections().toArray()).length,
        0,
        "Banco de teste deve ser novo",
      );
      safeToDrop = true;
      await service().join("one", "One", "deck", randomUUID());
      assert.equal((await service().state("one")).queued, true);
      const claims = await service().store.lobbyState!();
      assert.deepEqual(Object.keys(claims).sort(), ["active", "waiting"]);
      assert.deepEqual(Object.keys(claims.waiting[0]).sort(), [
        "id",
        "joinedAt",
      ]);
      assert.equal(claims.waiting[0].id, "one");
      await service().join("two", "Two", "deck", randomUUID());
      const match = (await service().state("one")).match!;
      const patchStore = new MongoGameStore();
      const contextual = (await patchStore.roomContext(match.id, true))!;
      assert.equal(contextual.active.one, match.id);
      assert.equal(contextual.active.two, match.id);
      assert.ok(contextual.seen.one);
      assert.deepEqual(contextual.room, await patchStore.room(match.id));
      const patchRoom = contextual.room;
      const entries = structuredClone(patchRoom.entries);
      let notifications = 0;
      const unsubscribe = patchStore.subscribeRoom(match.id, () => {
        notifications++;
      });
      patchRoom.pausedAt = 123;
      patchRoom.responseDeadline = 456;
      assert.equal(await patchStore.saveRoom(-1, patchRoom), false);
      assert.equal(notifications, 0, "CAS recusado não emite atualização");
      assert.equal(
        await patchStore.saveRoom(patchRoom.revision, patchRoom),
        true,
      );
      patchRoom.revision++;
      assert.equal(notifications, 1);
      delete patchRoom.pausedAt;
      delete patchRoom.responseDeadline;
      // Reusing the same object must diff against the last committed value.
      patchRoom.game.state.players[0].hand.reverse();
      assert.equal(
        await patchStore.saveRoom(patchRoom.revision, patchRoom),
        true,
      );
      patchRoom.revision++;
      const persistedPatch = (await patchStore.room(match.id))!;
      assert.deepEqual(persistedPatch.entries, entries);
      assert.equal(persistedPatch.pausedAt, undefined);
      assert.equal(persistedPatch.responseDeadline, undefined);
      assert.deepEqual(persistedPatch.game, patchRoom.game);
      assert.equal(notifications, 2);
      unsubscribe();
      // Exercise array growth/shrinkage, removed fields and the large-update
      // fallback against MongoDB itself, including repeated saves of one object.
      const copy = structuredClone(patchRoom);
      copy.id = randomUUID();
      copy.game.id = copy.id;
      copy.revision = 0;
      await patchStore.insertRoom(copy);
      const edited = (await patchStore.room(copy.id))!;
      for (let iteration = 0; iteration < 6; iteration++) {
        edited.game = structuredClone(copy.game);
        edited.game.state.players[0].deck.splice(0, iteration);
        edited.game.state.players[0].mage.passiveCounters = Object.fromEntries(
          Array.from({ length: iteration % 2 ? 130 : 2 }, (_, index) => [
            `test${index}`,
            iteration,
          ]),
        );
        if (iteration % 2) edited.responseDeadline = iteration;
        else delete edited.responseDeadline;
        assert.equal(await patchStore.saveRoom(edited.revision, edited), true);
        edited.revision++;
        assert.deepEqual(await patchStore.room(copy.id), edited);
      }
      const command = { type: "endTurn", version: 0, actionId: randomUUID() };
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () =>
          service().command(match.id, "one", command),
        ),
      );
      assert.equal(outcomes.filter((r: any) => r.duplicate).length, 7);
      await mongoose.disconnect();
      await mongoose.connect(process.env.MONGO_TEST_URL!, { dbName: database });
      const restored = (await service().state("one")).match!;
      assert.equal(restored.version, 1);
      const room = (await service().store.room(match.id))!,
        engine = Game.restore(room.game);
      engine.state.phase = "BATTLE";
      engine.state.turn = 3;
      engine.state.round = 3;
      engine.state.current = "one";
      engine.state.players.find((p) => p.id === "two")!.mage.hpAtual = 1;
      room.game = engine.exportState();
      assert.equal(await service().store.saveRoom(room.revision, room), true);
      await service().command(match.id, "one", {
        type: "attack",
        slotId: "one:mage",
        targetId: "two:mage",
        version: 1,
        actionId: randomUUID(),
      });
      assert.equal(
        (await service().store.room(match.id))!.game.state.winner,
        "one",
      );
      assert.equal((await service().store.room(match.id))!.resultSaved, false);
      offline = false;
      await service().maintain();
      await service().maintain();
      assert.equal(
        await mongoose.connection
          .db!.collection("testresults")
          .countDocuments(),
        1,
      );
      const userId = "1".repeat(24),
        deckId = "4".repeat(24);
      await User.create({
        _id: userId,
        nome: "Projection test",
        email: "projection@test.local",
        senha: "test",
      });
      await Deck.create({
        _id: deckId,
        userId,
        nome: "Public test",
        publico: true,
      });
      for (let i = 0; i < 12; i++)
        await Match.create({
          matchId: `projection-${i}`,
          players: [{ userId, deckId }],
          winner: userId,
          reason: "Mago derrotado.",
          finishedAt: new Date(2026, 0, 1, 0, i),
        });
      await rebuildRankings();
      const projected = await User.findById(userId).select("+ranking").lean();
      assert.equal(projected!.ranking!.partidas, 12);
      const xp = projected!.ranking!.stats.xp;
      await Promise.all([
        projectMatchRankings([{ userId, deckId }]),
        projectMatchRankings([{ userId, deckId }]),
      ]);
      assert.equal(
        (await User.findById(userId).select("+ranking").lean())!.ranking!.stats
          .xp,
        xp,
      );
      assert.equal(
        (await Deck.findById(deckId).select("+ranking").lean())!.ranking!
          .partidas,
        12,
      );
      await createRankingIndexes();
      const plan: any = await User.find({ "ranking.partidas": { $gte: 1 } })
        .sort({ "ranking.vitorias": -1, "ranking.rate": -1, _id: 1 })
        .limit(3)
        .hint("ranking_wins")
        .explain("executionStats");
      assert.equal(plan.executionStats.nReturned, 1);
      assert.ok(
        JSON.stringify(plan.queryPlanner.winningPlan).includes("ranking_wins"),
      );
      const png = await sharp({
        create: { width: 400, height: 400, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const url = await storeAvatar(png);
      const bytes = await avatarBytes(url.split("/").pop()!.split(".")[0]);
      assert.equal((await sharp(bytes!).metadata()).width, 192);
    } finally {
      // The name was checked and the database was empty before this test created it.
      if (safeToDrop) await mongoose.connection.db!.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
