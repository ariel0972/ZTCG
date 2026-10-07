import {
  DurableRoom,
  DurableStore,
  emptyLobby,
  Lobby,
} from "../../src/game/store";
function serializedClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
// Shared by independent coordinators; deliberately no production import.
export class MemoryDurableStore implements DurableStore {
  private data = emptyLobby();
  private revision = 0;
  readonly rooms = new Map<string, DurableRoom>();
  private seen: Record<string, number> = {};
  failRoomWrite = false;
  loseResponse = false;
  async roomRevision(id: string) {
    return this.rooms.get(id)?.revision ?? null;
  }
  async lobby() {
    return serializedClone({ revision: this.revision, data: this.data });
  }
  async saveLobby(revision: number, data: Lobby) {
    if (revision !== this.revision) return false;
    this.data = serializedClone(data);
    this.revision++;
    return true;
  }
  async insertRoom(room: DurableRoom) {
    this.rooms.set(room.id, serializedClone(room));
  }
  async room(id: string) {
    return serializedClone(this.rooms.get(id) ?? null);
  }
  async saveRoom(revision: number, room: DurableRoom) {
    if (this.failRoomWrite) throw new Error("database offline");
    const old = this.rooms.get(room.id);
    if (!old || old.revision !== revision) return false;
    this.rooms.set(
      room.id,
      serializedClone({ ...room, revision: revision + 1 }),
    );
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("ack lost after commit");
    }
    return true;
  }
  async touch(user: string, now: number) {
    this.seen[user] = Math.max(now, this.seen[user] ?? 0);
  }
  async presence(users: string[]) {
    return Object.fromEntries(users.map((u) => [u, this.seen[u]]));
  }
  async pending(limit: number) {
    return [...this.rooms.values()]
      .filter((r) => r.game.state.status === "ACTIVE" || !r.resultSaved)
      .slice(0, limit)
      .map((r) => serializedClone(r));
  }
}
