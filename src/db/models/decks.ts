import { Schema, model, Types } from "mongoose";
export interface IDeck {
  nome: string;
  cartas: string[];
  mago: string | null;
  icone: string;
  verso: string;
  userId: Types.ObjectId;
  revisao: number;
  publico: boolean;
}
const schema = new Schema<IDeck>(
  {
    nome: { type: String, required: true, trim: true, maxlength: 80 },
    cartas: { type: [String], default: [] },
    mago: { type: String, default: null },
    icone: { type: String, default: "/assets/icons/neutro.svg" },
    verso: {
      type: String,
      enum: ["common", "zarcos", "water", "air", "fire", "earth"],
      default: "common",
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "UserTCG",
      required: true,
      index: true,
    },
    publico: { type: Boolean, default: false },
    revisao: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, strict: "throw" },
);
export default model<IDeck>("Deck", schema);
