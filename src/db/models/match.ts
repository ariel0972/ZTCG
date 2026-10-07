import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    matchId: { type: String, unique: true, required: true },
    players: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "UserTCG" },
        nome: String,
        deckId: String,
      },
    ],
    winner: { type: String, default: null },
    reason: String,
    turns: Number,
    finishedAt: Date,
  },
  { timestamps: true },
);
schema.index({ "players.userId": 1, finishedAt: -1 });
export default model("Match", schema);
