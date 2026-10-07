import mongoose, { Schema, Document, Model } from "mongoose";

// Interface que descreve os campos do documento no banco
export interface IUser extends Document {
  nome: string;
  email: string;
  senha: string;
  avatarURL: string;
  nivel: number;
  vitorias: number;
  partidas: number;
  admin: boolean;
  sessionVersion: number;
  resetTokenHash?: string;
  resetExpires?: Date;
}

const userSchema = new Schema<IUser>({
  nome: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true, select: false },
  avatarURL: { type: String, default: "/assets/avatar.png" },
  nivel: { type: Number, default: 1 },
  vitorias: { type: Number, default: 0 },
  partidas: { type: Number, default: 0 },
  admin: { type: Boolean, default: false },
  sessionVersion: { type: Number, default: 0 },
  resetTokenHash: { type: String, select: false },
  resetExpires: { type: Date, select: false },
});

const User: Model<IUser> = mongoose.model<IUser>("UserTCG", userSchema);

export default User;
