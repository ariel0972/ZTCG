import { Schema, model } from "mongoose";
import type { TutorialProgress } from "../../game/tutorial";
const schema = new Schema<TutorialProgress>(
  {
    _id: { type: String, required: true },
    courseVersion: { type: Number, required: true },
    version: { type: Number, required: true, min: 0 },
    step: { type: Number, required: true, min: 0 },
    game: { type: Schema.Types.Mixed, default: null },
    lastActionId: String,
    completedAt: Date,
    skippedAt: Date,
  },
  { timestamps: true, versionKey: false, strict: "throw" },
);
export default model<TutorialProgress>("TutorialSession", schema);
