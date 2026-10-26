import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    _id: { type: String, required: true },
    data: { type: Buffer, required: true },
    // Legacy originals stay readable; new uploads keep only the optimized WebP.
    original: { type: Buffer, select: false },
    originalType: { type: String, select: false },
    kind: { type: String, enum: ["avatar", "banner"] },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
export default model("AvatarImage", schema);
