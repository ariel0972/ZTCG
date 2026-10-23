import Match from "../db/models/match";
import { experienceHistory, EXPERIENCE_FIELDS } from "./experience";
export { experienceProgress as progression } from "./experience";
export async function profileExperience(userId: string) {
  const matches = await Match.find({ "players.userId": userId })
    .select(EXPERIENCE_FIELDS)
    .sort({ finishedAt: 1, matchId: 1 })
    .lean();
  return experienceHistory(userId, matches);
}
export async function profileStats(userId: string) {
  return (await profileExperience(userId)).stats;
}
