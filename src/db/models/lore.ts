import { Schema, model } from "mongoose";
import { loreCategories, type LoreRecord } from "../../types/lore";

const content = new Schema(
  {
    titulo: { type: String, required: true, maxlength: 120 },
    subtitulo: { type: String, default: "", maxlength: 180 },
    resumo: { type: String, default: "", maxlength: 360 },
    categoria: { type: String, enum: loreCategories, required: true },
    texto: { type: String, default: "", maxlength: 30000 },
    cartas: { type: [String], default: [] },
    fonteURL: { type: String, default: "", maxlength: 600 },
  },
  { _id: false, strict: "throw" },
);
const schema = new Schema<LoreRecord>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    version: { type: Number, required: true, min: 1 },
    draft: { type: content, required: true },
    published: { type: content, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: "throw" },
);
export default model<LoreRecord>("LoreArticle", schema);
