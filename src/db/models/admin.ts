import { Schema, model } from "mongoose";
export const AdminControl = model(
  "AdminControl",
  new Schema(
    { _id: String, token: String, until: Date },
    { versionKey: false },
  ),
);
export const AdminAudit = model(
  "AdminAudit",
  new Schema(
    {
      _id: String,
      actorId: String,
      targetId: String,
      action: String,
      reason: String,
      count: Number,
      createdAt: Date,
      status: String,
      matchIds: { type: [String], default: undefined },
      selectionHash: String,
    },
    { versionKey: false },
  ),
);
