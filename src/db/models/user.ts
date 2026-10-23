import mongoose, { Schema, Document, Model } from "mongoose";

// Interface que descreve os campos do documento no banco
export interface IUser extends Document {
  nome: string;
  nomeKey?: string;
  email: string;
  senha: string;
  avatarURL: string;
  ranking?: {
    partidas: number;
    vitorias: number;
    rate: number;
    stats: Record<string, any>;
    updatedAt: Date;
  };
  nivel: number;
  vitorias: number;
  partidas: number;
  admin: boolean;
  sessionVersion: number;
  managementVersion?: number;
  managementLastActionId?: string;
  moderation?: {
    banned?: boolean;
    suspendedUntil?: Date | null;
    reason?: string;
    by?: string;
    at?: Date;
  };
  resetTokenHash?: string;
  resetExpires?: Date;
}

const userSchema = new Schema<IUser>({
  nome: { type: String, required: true },
  nomeKey: { type: String, select: false },
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true, select: false },
  avatarURL: { type: String, default: "/assets/avatar.png" },
  ranking: { type: Schema.Types.Mixed, select: false },
  nivel: { type: Number, default: 1 },
  vitorias: { type: Number, default: 0 },
  partidas: { type: Number, default: 0 },
  admin: { type: Boolean, default: false },
  sessionVersion: { type: Number, default: 0 },
  managementVersion: { type: Number, default: 0 },
  managementLastActionId: { type: String, select: false },
  moderation: {
    type: new Schema(
      {
        banned: Boolean,
        suspendedUntil: Date,
        reason: String,
        by: String,
        at: Date,
      },
      { _id: false },
    ),
    default: undefined,
  },
  resetTokenHash: { type: String, select: false },
  resetExpires: { type: Date, select: false },
});
userSchema.index(
  { nomeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { nomeKey: { $type: "string" } },
    name: "unique_player_name",
  },
);

userSchema.index(
  { "ranking.vitorias": -1, "ranking.rate": -1, _id: 1 },
  {
    name: "ranking_wins",
    partialFilterExpression: { "ranking.partidas": { $gte: 1 } },
  },
);
userSchema.index(
  { "ranking.rate": -1, "ranking.vitorias": -1, _id: 1 },
  {
    name: "ranking_rate",
    partialFilterExpression: { "ranking.partidas": { $gte: 10 } },
  },
);
userSchema.index({ "ranking.partidas": 1 }, { name: "ranking_count" });
const User: Model<IUser> = mongoose.model<IUser>("UserTCG", userSchema);

export default User;
