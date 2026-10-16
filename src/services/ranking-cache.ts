import { ReadCache } from "../lib/read-cache";
export const rankingCache = new ReadCache<Record<string, unknown>>(30000, 100);
export const invalidateRankings = () => rankingCache.clear();
