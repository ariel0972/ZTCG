import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import initial from "../src/data/catalog.json";
import { cardSchema } from "../src/types/card";
import { DurableGame } from "../src/game/durable";
import { MongoGameStore } from "../src/game/store";
import { Game } from "../src/game/engine";
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
      await service().join("two", "Two", "deck", randomUUID());
      const match = (await service().state("one")).match!;
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
    } finally {
      // The name was checked and the database was empty before this test created it.
      if (safeToDrop) await mongoose.connection.db!.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
