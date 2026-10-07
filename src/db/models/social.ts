import { Schema, model } from "mongoose";
export const Friendship = model(
  "Friendship",
  new Schema(
    {
      key: { type: String, required: true, unique: true },
      members: [{ type: String, index: true }],
      requestedBy: { type: String, required: true },
      status: {
        type: String,
        enum: ["pending", "accepted"],
        default: "pending",
      },
    },
    { timestamps: true },
  ),
);
export const Invitation = model(
  "GameInvitation",
  new Schema(
    {
      invitationId: { type: String, required: true, unique: true },
      from: { type: String, index: true, required: true },
      to: { type: String, index: true, required: true },
      deckId: { type: String, required: true },
      chosenDeckId: String,
      status: {
        type: String,
        enum: ["pending", "starting", "accepted", "declined"],
        default: "pending",
      },
      expires: { type: Date, required: true, index: true },
      matchId: String,
    },
    { timestamps: true },
  ),
);
