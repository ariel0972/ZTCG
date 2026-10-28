import { Schema, model } from "mongoose";
const schema = new Schema(
  {
    matchId: { type: String, unique: true, required: true },
    mode: { type: String, enum: ["ai", "pvp"], default: undefined },
    players: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "UserTCG" },
        nome: String,
        isAI: Boolean,
        deckId: String,
      },
    ],
    winner: { type: String, default: null },
    reason: String,
    turns: Number,
    finishedAt: Date,
    rulesVersion: Number,
    surrenderedBy: String,
    surrenderStreak: Number,
    resultReady: Boolean,
    historyVisible: Boolean,
    ranked: Boolean,
    countGame: Boolean,
    awardXp: Boolean,
    deletedAt: Date,
    deletedBy: String,
    deletionAction: String,
  },
  { timestamps: true },
);
schema.index({ "players.userId": 1, finishedAt: -1 });
schema.index({ "players.deckId": 1, finishedAt: -1 });
schema.index({ finishedAt: 1, ranked: 1 }, { name: "ranking_month_matches" });
export default model("Match", schema);
