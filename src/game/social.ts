import { Schema, model } from "mongoose";
import { AppError } from "../lib/errors";
import { Friendship } from "../db/models/social";
import { DurableGame } from "./durable";
import type { RoomInfo } from "./store";
import { ReadCache } from "../lib/read-cache";

export const CHAT_TTL = 86_400_000,
  VIEWER_TTL = 45_000,
  ONLINE_TTL = 90_000;
export interface ChatMessage {
  id: string;
  matchId: string;
  userId: string;
  nome: string;
  text: string;
  role: "player" | "spectator";
  createdAt: number;
  expiresAt: number;
}
export interface Viewer {
  userId: string;
  nome: string;
}
export interface SocialStore {
  messages(match: string, now: number): Promise<ChatMessage[]>;
  send(message: ChatMessage): Promise<ChatMessage>;
  viewers(match: string, now: number): Promise<Viewer[]>;
  watch(
    match: string,
    user: string,
    nome: string,
    session: string,
    now: number,
  ): Promise<void>;
  leave(match: string, user: string, session: string): Promise<void>;
  touch(user: string, now: number): Promise<void>;
  online(users: string[], now: number): Promise<string[]>;
}
const chatSchema = new Schema(
  {
    _id: String,
    matchId: String,
    userId: String,
    nome: String,
    text: String,
    role: String,
    createdAt: Number,
    expiresAt: Date,
  },
  { versionKey: false },
);
chatSchema.index({ matchId: 1, createdAt: -1, _id: -1 });
chatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Chat = model("MatchChat", chatSchema);
const leaseSchema = new Schema(
  {
    _id: String,
    matchId: String,
    userId: String,
    nome: String,
    expiresAt: Date,
  },
  { versionKey: false },
);
leaseSchema.index({ matchId: 1, expiresAt: 1 });
leaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Lease = model("MatchViewer", leaseSchema);
const presenceSchema = new Schema(
  { _id: String, expiresAt: Date },
  { versionKey: false },
);
presenceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Presence = model("SitePresence", presenceSchema);
const gateSchema = new Schema(
  { _id: String, sentAt: Number, expiresAt: Date },
  { versionKey: false },
);
gateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Gate = model("MatchChatGate", gateSchema);
export const socialModels = { Chat, Lease, Presence, Gate };
const messageView = (d: any): ChatMessage => ({
  id: d._id,
  matchId: d.matchId,
  userId: d.userId,
  nome: d.nome,
  text: d.text,
  role: d.role,
  createdAt: d.createdAt,
  expiresAt: +d.expiresAt,
});
export class MongoSocialStore implements SocialStore {
  private messageReads = new ReadCache<ChatMessage[]>(1000);
  private viewerReads = new ReadCache<Viewer[]>(1000);
  async messages(matchId: string, now: number) {
    return this.messageReads.get(
      `${matchId}:${Math.floor(now / 1000)}`,
      async () => {
        const docs = await Chat.find({
          matchId,
          expiresAt: { $gt: new Date(now) },
        })
          .sort({ createdAt: -1, _id: -1 })
          .limit(50)
          .lean();
        return docs.reverse().map(messageView);
      },
    );
  }
  async send(message: ChatMessage) {
    try {
      return await this.persistMessage(message);
    } finally {
      this.messageReads.clear();
    }
  }
  private async persistMessage(message: ChatMessage) {
    const previous = await Chat.findById(message.id).lean();
    if (previous) {
      if (
        previous.matchId !== message.matchId ||
        previous.userId !== message.userId
      )
        throw new AppError(409, "Identificador de mensagem já utilizado.");
      return messageView(previous);
    }
    try {
      // Atomic per-account gate works across serverless instances as well.
      await Gate.updateOne(
        {
          _id: message.userId,
          $or: [
            { sentAt: { $lte: message.createdAt - 1500 } },
            { sentAt: { $exists: false } },
          ],
        },
        {
          $set: {
            sentAt: message.createdAt,
            expiresAt: new Date(message.expiresAt),
          },
        },
        { upsert: true },
      );
    } catch (e: any) {
      if (e.code !== 11000) throw e;
      const retry = await Chat.findById(message.id).lean();
      if (retry?.userId === message.userId && retry.matchId === message.matchId)
        return messageView(retry);
      throw new AppError(
        429,
        "Aguarde um instante antes de enviar outra mensagem.",
      );
    }
    try {
      await Chat.create({
        ...message,
        _id: message.id,
        expiresAt: new Date(message.expiresAt),
      });
      return message;
    } catch (e: any) {
      if (e.code !== 11000) throw e;
      const retry = await Chat.findById(message.id).lean();
      if (retry?.userId === message.userId && retry.matchId === message.matchId)
        return messageView(retry);
      throw e;
    }
  }
  async viewers(matchId: string, now: number) {
    return this.viewerReads.get(
      `${matchId}:${Math.floor(now / 1000)}`,
      async () => {
        const docs = await Lease.find({
          matchId,
          expiresAt: { $gt: new Date(now) },
        })
          .select({ userId: 1, nome: 1 })
          .lean();
        return [
          ...new Map(
            docs.map((d) => [d.userId!, { userId: d.userId!, nome: d.nome! }]),
          ).values(),
        ].sort((a, b) => a.userId.localeCompare(b.userId));
      },
    );
  }
  async watch(
    matchId: string,
    userId: string,
    nome: string,
    session: string,
    now: number,
  ) {
    await Lease.updateOne(
      { _id: `${matchId}:${userId}:${session}` },
      {
        $set: { matchId, userId, nome, expiresAt: new Date(now + VIEWER_TTL) },
      },
      { upsert: true },
    );
    this.viewerReads.clear();
  }
  async leave(match: string, user: string, session: string) {
    await Lease.deleteOne({ _id: `${match}:${user}:${session}` });
    this.viewerReads.clear();
  }
  async touch(user: string, now: number) {
    await Presence.updateOne(
      { _id: user },
      { $max: { expiresAt: new Date(now + ONLINE_TTL) } },
      { upsert: true },
    );
  }
  async online(users: string[], now: number) {
    const docs = await Presence.find({
      _id: { $in: users },
      expiresAt: { $gt: new Date(now) },
    })
      .select({ _id: 1 })
      .lean();
    return docs.map((d) => d._id!);
  }
}
type FriendshipCheck = (user: string, players: string[]) => Promise<boolean>;
export class MatchSocial {
  constructor(
    readonly game: DurableGame,
    readonly store: SocialStore = new MongoSocialStore(),
    private now = Date.now,
    private friends: FriendshipCheck = async (user, players) =>
      !!(await Friendship.exists({
        key: { $in: players.map((p) => [user, p].sort().join(":")) },
        status: "accepted",
      })),
  ) {}
  async authorize(id: string, user: string): Promise<RoomInfo> {
    const room = await this.game.store.roomInfo(id);
    if (
      !room ||
      (room.status !== "ACTIVE" &&
        (!room.finishedAt || this.now() - room.finishedAt >= CHAT_TTL))
    )
      throw new AppError(404, "Esta sala não está disponível.");
    if (
      !room.players.some((p) => p.id === user) &&
      !(await this.friends(
        user,
        room.players.map((p) => p.id),
      ))
    )
      throw new AppError(
        403,
        "Você precisa ser amigo de um dos jogadores para assistir.",
      );
    return room;
  }
  async snapshot(id: string) {
    const [messages, viewers] = await Promise.all([
      this.store.messages(id, this.now()),
      this.store.viewers(id, this.now()),
    ]);
    return { matchId: id, messages, viewers, serverNow: this.now() };
  }
  async send(
    id: string,
    user: string,
    nome: string,
    requestId: string,
    raw: string,
  ) {
    const room = await this.authorize(id, user);
    const text = raw
      .normalize("NFC")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .trim();
    if (!text || Array.from(text).length > 300)
      throw new AppError(422, "Envie de 1 a 300 caracteres.");
    return this.store.send({
      id: requestId,
      matchId: id,
      userId: user,
      nome,
      text,
      role: room.players.some((p) => p.id === user) ? "player" : "spectator",
      createdAt: this.now(),
      expiresAt: this.now() + CHAT_TTL,
    });
  }
  async watch(id: string, user: string, nome: string, session: string) {
    const room = await this.authorize(id, user);
    if (room.status === "ACTIVE" && !room.players.some((p) => p.id === user))
      await this.store.watch(id, user, nome, session, this.now());
    else await this.store.leave(id, user, session);
  }
  async activities(user: string) {
    const relations = await Friendship.find({
      members: user,
      status: "accepted",
    })
      .select({ members: 1 })
      .lean();
    const ids = relations
      .map((r) => r.members.find((p) => p !== user)!)
      .filter(Boolean);
    const [rooms, online, playingSeen] = await Promise.all([
      this.game.store.activeRooms(ids),
      this.store.online(ids, this.now()),
      this.game.store.presence(ids),
    ]);
    return ids.map((id) => {
      const room = rooms.find((r) => r.players.some((p) => p.id === id));
      return {
        id,
        activity: room
          ? "playing"
          : online.includes(id) ||
              this.now() - (playingSeen[id] ?? 0) < ONLINE_TTL
            ? "online"
            : "offline",
        ...(room ? { matchId: room.id } : {}),
      };
    });
  }
}
