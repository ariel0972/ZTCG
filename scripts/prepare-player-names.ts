import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import User from "../src/db/models/user";
import dbConnect from "../src/lib/mongodb";
import { playerNameKey } from "../src/services/player-name";
dotenv.config({
  path: process.env.PLAYER_NAMES_ENV_FILE ?? ".env",
  quiet: true,
});
async function main() {
  await dbConnect();
  const users = await User.collection
    .find({}, { projection: { nome: 1, nomeKey: 1 } })
    .toArray();
  const groups = new Map<string, typeof users>();
  for (const user of users) {
    const key = playerNameKey(user.nome);
    groups.set(key, [...(groups.get(key) ?? []), user]);
  }
  const conflicts = [...groups.values()].filter((g) => g.length > 1);
  const changed = users.filter((u) => u.nomeKey !== playerNameKey(u.nome));
  console.log(
    JSON.stringify({
      users: users.length,
      changes: changed.length,
      conflictingGroups: conflicts.length,
      legacyShortNames: users.filter((u) => u.nome.trim().length < 4).length,
    }),
  );
  if (conflicts.length) throw Error("Resolve name conflicts before migration");
  if (!process.argv.includes("--apply")) return;
  if (changed.length) {
    await mkdir("backups", { recursive: true });
    await writeFile(
      `backups/player-names-${Date.now()}.json`,
      JSON.stringify(changed),
    );
    for (const user of changed) {
      const result = await User.collection.updateOne(
        { _id: user._id, nome: user.nome },
        { $set: { nomeKey: playerNameKey(user.nome) } },
      );
      if (result.matchedCount !== 1)
        throw Error("A player changed during migration");
    }
  }
  await User.collection.createIndex(
    { nomeKey: 1 },
    {
      unique: true,
      partialFilterExpression: { nomeKey: { $type: "string" } },
      name: "unique_player_name",
    },
  );
  console.log(JSON.stringify({ applied: true, uniqueIndex: true }));
}
void main()
  .catch(() => {
    console.error(
      "Migração de nomes interrompida; consulte o resumo. Nenhum nome foi alterado.",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
