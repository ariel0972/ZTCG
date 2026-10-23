import { Schema, model } from "mongoose";
import { ReadCache } from "../lib/read-cache";
import { EventEmitter } from "node:events";
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
  resultRulesVersion?: number;
  seenResultBy?: string[];
  rematchVotes: string[];
  rematchClosed: boolean;
  rematchId?: string;
}
export type LobbyState = Pick<Lobby, "active"> & {
  waiting: Pick<Waiting, "id" | "joinedAt">[];
};
export interface DurableStore {
  roomContext?(
    id: string,
    withClaims: boolean,
  ): Promise<{
    room: DurableRoom;
    active: Record<string, string>;
    seen: Record<string, number>;
  } | null>;
  subscribeRoom?(id: string, changed: (revision: number) => void): () => void;
  lobbyState?(): Promise<LobbyState>;
  roomInfo(id: string): Promise<RoomInfo | null>;
  activeRooms(users: string[]): Promise<RoomInfo[]>;
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
export interface RoomInfo {
  id: string;
  players: { id: string; nome: string }[];
  status: string;
  finishedAt?: number;
}
export function roomInfo(room: DurableRoom): RoomInfo {
  return {
    id: room.id,
    players: room.entries.map(({ id, nome }) => ({ id, nome })),
    status: room.game.state.status,
    finishedAt: room.finishedAt,
  };
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
// Keep the CAS on the entire document, but transmit only changed fields. Arrays
// whose length changes are replaced atomically; equal-length arrays use indexes.
export function roomChanges(
  before: unknown,
  after: unknown,
  path: string,
  set: Record<string, unknown>,
  unset: Record<string, 1>,
) {
  if (after === undefined) {
    if (before !== undefined) unset[path] = 1;
    return;
  }
  if (Object.is(before, after)) return;
  const record = (value: any) =>
    value !== null &&
    typeof value === "object" &&
    (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
  if (
    record(before) &&
    record(after) &&
    Array.isArray(before) === Array.isArray(after) &&
    (!Array.isArray(after) || (before as any[]).length === after.length)
  ) {
    const keys = new Set([
      ...Object.keys(before as object),
      ...Object.keys(after as object),
    ]);
    if ([...keys].every((key) => !key.includes(".") && !key.startsWith("$"))) {
      for (const key of keys)
        roomChanges(
          (before as any)[key],
          (after as any)[key],
          `${path}.${key}`,
          set,
          unset,
        );
      return;
    }
  }
  set[path] = after;
}
export class MongoGameStore implements DurableStore {
  private revisions = new ReadCache<number | null>(500, 1000);
  private changes = new EventEmitter().setMaxListeners(0);
  private originals = new WeakMap<DurableRoom, DurableRoom>();
  private entrySnapshots = new Map<
    string,
    { expires: number; value: Waiting[] }
  >();
  private remember(room: DurableRoom) {
    this.originals.set(room, structuredClone(room));
    return room;
  }
  subscribeRoom(id: string, changed: (revision: number) => void) {
    this.changes.on(id, changed);
    return () => {
      this.changes.off(id, changed);
    };
  }
  async roomContext(id: string, withClaims: boolean) {
    const cached = this.entrySnapshots.get(id);
    const entries =
      cached && cached.expires > Date.now() ? cached.value : undefined;
    // All lookups use _id indexes. Keep authoritative reads fresh while removing
    // sequential network round trips between room, claims and combat presence.
    const pipeline: any[] = [
      { $match: { _id: id } },
      {
        $lookup: {
          from: presenceModel.collection.name,
          localField: "data.entries.id",
          foreignField: "_id",
          as: "seen",
        },
      },
    ];
    if (withClaims)
      pipeline.push({
        $lookup: {
          from: lobbyModel.collection.name,
          pipeline: [
            { $match: { _id: "main" } },
            { $project: { "data.active": 1 } },
          ],
          as: "claims",
        },
      });
    // Only immutable deck/catalog snapshots are cached. Current game, claims,
    // revision and combat presence are still read from MongoDB on every action.
    if (entries) pipeline.push({ $project: { "data.entries": 0 } });
    const [doc] = await roomModel.aggregate(pipeline);
    if (doc) {
      if (entries) doc.data.entries = structuredClone(entries);
      else {
        this.entrySnapshots.delete(id);
        while (this.entrySnapshots.size >= 100)
          this.entrySnapshots.delete(this.entrySnapshots.keys().next().value!);
        this.entrySnapshots.set(id, {
          expires: Date.now() + 60000,
          value: structuredClone(doc.data.entries),
        });
      }
    }
    return doc
      ? {
          room: this.remember({
            ...doc.data,
            revision: doc.revision,
          } as DurableRoom),
          active: doc.claims?.[0]?.data?.active ?? {},
          seen: Object.fromEntries(
            doc.seen.map((entry: any) => [entry._id, entry.lastSeen]),
          ),
        }
      : null;
  }
  async lobbyState(): Promise<LobbyState> {
    const doc = await lobbyModel
      .findById("main")
      .select({
        "data.active": 1,
        "data.waiting.id": 1,
        "data.waiting.joinedAt": 1,
      })
      .lean();
    return (doc?.data as LobbyState | undefined) ?? { active: {}, waiting: [] };
  }
  async roomInfo(id: string) {
    const doc = await roomModel
      .findById(id)
      .select({
        "data.id": 1,
        "data.entries.id": 1,
        "data.entries.nome": 1,
        "data.game.state.status": 1,
        "data.finishedAt": 1,
      })
      .lean();
    return doc ? roomInfo(doc.data as DurableRoom) : null;
  }
  async activeRooms(users: string[]) {
    if (!users.length) return [];
    const lobby = await lobbyModel
      .findById("main")
      .select({ "data.active": 1 })
      .lean();
    const active =
      (lobby?.data as { active?: Record<string, string> } | undefined)
        ?.active ?? {};
    const ids = [...new Set(users.map((u) => active[u]).filter(Boolean))];
    const docs = await roomModel
      .find({ _id: { $in: ids }, "data.game.state.status": "ACTIVE" })
      .select({
        "data.id": 1,
        "data.entries.id": 1,
        "data.entries.nome": 1,
        "data.game.state.status": 1,
      })
      .lean();
    return docs.map((d) => roomInfo(d.data as DurableRoom));
  }
  async roomRevision(id: string) {
    return this.revisions.get(id, async () => {
      const doc = await roomModel.findById(id).select({ revision: 1 }).lean();
      return doc?.revision ?? null;
    });
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
    this.revisions.clear(room.id);
  }
  async room(id: string) {
    const doc = await roomModel.findById(id).lean();
    return doc
      ? this.remember({ ...doc.data, revision: doc.revision } as DurableRoom)
      : null;
  }
  async saveRoom(revision: number, room: DurableRoom) {
    // Entries (deck definitions and catalogs) are immutable after insertRoom.
    // Optional clock fields must be explicitly unset when a pause/response ends.
    const { entries: _entries, ...mutable } = room;
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const original = this.originals.get(room);
    for (const [key, value] of Object.entries({
      ...mutable,
      revision: revision + 1,
    })) {
      roomChanges(
        original?.[key as keyof DurableRoom],
        value,
        `data.${key}`,
        set,
        unset,
      );
    }
    // Large rewrites (e.g. mass effects) use one bounded update for game data.
    if (Object.keys(set).length + Object.keys(unset).length > 100) {
      for (const key of [...Object.keys(set), ...Object.keys(unset)])
        if (key.startsWith("data.game.")) {
          delete set[key];
          delete unset[key];
        }
      set["data.game"] = room.game;
    }
    for (const key of [
      "responseDeadline",
      "remainingTurnMs",
      "pausedAt",
      "recoveryUntil",
      "finishedAt",
      "rematchId",
      "seenResultBy",
    ])
      if ((room as any)[key] === undefined) unset[`data.${key}`] = 1;
    const result = await roomModel.updateOne(
      { _id: room.id, revision },
      {
        $set: set,
        $unset: unset,
        $inc: { revision: 1 },
      },
      durableWrite,
    );
    this.revisions.clear(room.id);
    if (result.modifiedCount === 1) {
      this.originals.set(
        room,
        structuredClone({ ...room, revision: revision + 1 }),
      );
      void this.revisions.get(room.id, async () => revision + 1);
      this.changes.emit(room.id, revision + 1);
    }
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
