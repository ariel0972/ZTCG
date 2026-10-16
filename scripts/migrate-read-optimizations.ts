import "dotenv/config";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import User from "../src/db/models/user";
import Deck from "../src/db/models/decks";
import { prepareAvatar, storeLegacyAvatar } from "../src/services/avatars";
import {
  rebuildRankings,
  createRankingIndexes,
} from "../src/services/ranking-projections";

async function main() {
  if (!process.env.MONGO_URL) throw Error("MONGO_URL ausente");
  await mongoose.connect(process.env.MONGO_URL, {
    autoIndex: false,
    autoCreate: false,
    maxPoolSize: 2,
  });
  const apply = process.argv.includes("--apply");
  const avatars = process.argv.includes("--avatars");
  const rankings = process.argv.includes("--rankings");
  if (!avatars && !rankings) throw Error("Selecione --avatars ou --rankings");
  const users = await User.find(rankings ? {} : { avatarURL: /^data:/ })
    .select("avatarURL +ranking")
    .lean();
  // Validate every original before the first write. No player names/images in logs.
  const avatarUsers = users.filter((u) => u.avatarURL.startsWith("data:"));
  let oldBytes = 0,
    imageBytes = 0;
  if (avatars)
    for (const user of avatarUsers) {
      const original = Buffer.from(
        user.avatarURL.split(",")[1] ?? "",
        "base64",
      );
      const prepared = await prepareAvatar(original);
      oldBytes += Buffer.byteLength(user.avatarURL);
      imageBytes += prepared.data.length;
    }
  console.log(
    JSON.stringify({
      apply,
      avatars,
      rankings,
      users: users.length,
      avatarCandidates: avatarUsers.length,
      oldBytes,
      imageBytes,
    }),
  );
  if (!apply) return;
  await mkdir("backups", { recursive: true });
  const backup = `backups/read-optimization-${Date.now()}.json`;
  const decks = rankings ? await Deck.find().select("+ranking").lean() : [];
  // Backup only fields being changed, plus IDs; raw originals remain in AvatarImage too.
  await writeFile(
    backup,
    JSON.stringify(
      {
        at: new Date(),
        database: mongoose.connection.name,
        users: users.map((u) => ({
          id: String(u._id),
          avatarURL: u.avatarURL,
          ranking: u.ranking,
        })),
        decks: decks.map((d) => ({ id: String(d._id), ranking: d.ranking })),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  if (rankings) {
    await createRankingIndexes();
    console.log(JSON.stringify({ projected: await rebuildRankings() }));
  }
  if (avatars) {
    let migrated = 0,
      changedConcurrently = 0;
    const base = process.env.PUBLIC_APP_URL || "https://ztcg.vercel.app";
    for (const user of avatarUsers) {
      const url = await storeLegacyAvatar(user.avatarURL);
      // Confirm that the published route can read this exact image before replacing a user's URL.
      const response = await fetch(new URL(url, base), {
        signal: AbortSignal.timeout(20000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        !response.ok ||
        createHash("sha256").update(bytes).digest("hex") !==
          url.split("/").pop()!.split(".")[0]
      )
        throw Error(
          "A rota publicada não confirmou a imagem. URLs de contas não são substituídas sem validação.",
        );
      const result = await User.updateOne(
        { _id: user._id, avatarURL: user.avatarURL },
        { $set: { avatarURL: url } },
      );
      if (result.matchedCount) migrated++;
      else changedConcurrently++;
    }
    console.log(JSON.stringify({ migrated, changedConcurrently }));
  }
  console.log(JSON.stringify({ backup, completed: true }));
}
if (require.main === module)
  void main()
    .catch((error) => {
      console.error(
        "Migração não concluída: " +
          (error?.code ? `código ${error.code}` : error?.message || "erro"),
      );
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
