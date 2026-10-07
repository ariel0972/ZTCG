import { Schema, model } from "mongoose";
import type { Game } from "./engine";
import type { Card } from "../types/card";
import type { DeckDefinition } from "./state";
export interface Waiting {
  id: string;
  nome: string;
  deckId: string;
  deck: DeckDefinition;
  catalog: Card[];
  joinedAt: number;
  catalogHash: string;
}
export interface Lobby {
  waiting: Waiting[];
  active: Record<string, string>;
  generations: Record<string, number>;
  receipts: Record<string, { at: number; result: Record<string, unknown> }>;
}
export interface DurableRoom {
  id: string;
  invitationId?: string;
  revision: number;
  game: ReturnType<Game["exportState"]>;
  entries: Waiting[];
  deadline: number;
  responseDeadline?: number;
  remainingTurnMs?: number;
  lastAdvancedAt: number;
  pausedAt?: number;
  recoveryUntil?: number;
  finishedAt?: number;
  resultSaved: boolean;
  seenResultBy?: string[];
  rematchVotes: string[];
  rematchClosed: boolean;
  rematchId?: string;
}
export interface DurableStore {
  roomRevision?(id: string): Promise<number | null>;
  lobby(): Promise<{ revision: number; data: Lobby }>;
  saveLobby(revision: number, data: Lobby): Promise<boolean>;
  insertRoom(room: DurableRoom): Promise<void>;
  room(id: string): Promise<DurableRoom | null>;
  saveRoom(revision: number, room: DurableRoom): Promise<boolean>;
  touch(user: string, now: number): Promise<void>;
  presence(users: string[]): Promise<Record<string, number>>;
  pending(limit: number): Promise<DurableRoom[]>;
}
const lobbyModel = model(
  "GameLobby",
  new Schema(
    { _id: String, revision: Number, data: Schema.Types.Mixed },
    { versionKey: false },
  ),
);
const roomSchema = new Schema(
  { _id: String, revision: Number, data: Schema.Types.Mixed },
  { versionKey: false },
);
roomSchema.index({ "data.game.state.status": 1, "data.deadline": 1 });
roomSchema.index({ "data.resultSaved": 1, "data.finishedAt": 1 });
const roomModel = model("GameRoom", roomSchema);
const presenceModel = model(
  "GamePresence",
  new Schema({ _id: String, lastSeen: Number }, { versionKey: false }),
);
const durableWrite = {
  writeConcern: { w: "majority" as const, wtimeout: 5000 },
};
export const emptyLobby = (): Lobby => ({
  waiting: [],
  active: {},
  generations: {},
  receipts: {},
});
export class MongoGameStore implements DurableStore {
  async roomRevision(id: string) {
    const doc = await roomModel.findById(id).select({ revision: 1 }).lean();
    return doc?.revision ?? null;
  }
  async lobby() {
    let doc = await lobbyModel.findById("main").lean();
    if (!doc) {
      try {
        await lobbyModel.updateOne(
          { _id: "main" },
          { $setOnInsert: { revision: 0, data: emptyLobby() } },
          { upsert: true, ...durableWrite },
        );
      } catch (e: any) {
        if (e.code !== 11000) throw e;
      }
      doc = await lobbyModel.findById("main").lean();
    }
    return { revision: doc!.revision!, data: doc!.data as Lobby };
  }
  async saveLobby(revision: number, data: Lobby) {
    const result = await lobbyModel.updateOne(
      { _id: "main", revision },
      { $set: { data }, $inc: { revision: 1 } },
      durableWrite,
    );
    return result.modifiedCount === 1;
  }
  async insertRoom(room: DurableRoom) {
    await roomModel.updateOne(
      { _id: room.id },
      { $setOnInsert: { revision: room.revision, data: room } },
      { upsert: true, ...durableWrite },
    );
  }
  async room(id: string) {
    const doc = await roomModel.findById(id).lean();
    return doc
      ? ({ ...doc.data, revision: doc.revision } as DurableRoom)
      : null;
  }
  async saveRoom(revision: number, room: DurableRoom) {
    const result = await roomModel.updateOne(
      { _id: room.id, revision },
      {
        $set: { data: { ...room, revision: revision + 1 } },
        $inc: { revision: 1 },
      },
      durableWrite,
    );
    return result.modifiedCount === 1;
  }
  async touch(user: string, now: number) {
    await presenceModel.updateOne(
      { _id: user },
      { $max: { lastSeen: now } },
      { upsert: true, ...durableWrite },
    );
  }
  async presence(users: string[]) {
    const docs = await presenceModel.find({ _id: { $in: users } }).lean();
    return Object.fromEntries(docs.map((d) => [d._id!, d.lastSeen!]));
  }
  async pending(limit: number) {
    const { data } = await this.lobby();
    const docs = await roomModel
      .find({
        $or: [
          {
            _id: { $in: Object.values(data.active) },
            "data.game.state.status": "ACTIVE",
          },
          { "data.game.state.status": "FINISHED", "data.resultSaved": false },
        ],
      })
      .sort({ "data.lastAdvancedAt": 1 })
      .limit(limit)
      .lean();
    return docs.map(
      (d) => ({ ...d.data, revision: d.revision }) as DurableRoom,
    );
  }
}
