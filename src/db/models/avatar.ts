import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    _id: { type: String, required: true },
    data: { type: Buffer, required: true },
    original: { type: Buffer, required: true, select: false },
    originalType: { type: String, required: true, select: false },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
export default model("AvatarImage", schema);
