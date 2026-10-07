import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import mongoose from "mongoose";
import "dotenv/config";
// Logical backup to an authenticated encrypted archive. No URI enters process arguments.
const secret = process.env.BACKUP_ENCRYPTION_KEY;
if (!secret || secret.length < 32)
  throw new Error(
    "Configure BACKUP_ENCRYPTION_KEY com ao menos 32 caracteres.",
  );
const key = createHash("sha256").update(secret).digest();
if (process.argv[2] === "restore") {
  if (
    !process.env.RESTORE_MONGO_URL ||
    !process.env.RESTORE_DATABASE?.startsWith("ztcg_restore_")
  )
    throw new Error("Restaure somente em um banco separado ztcg_restore_*.");
  const file = await readFile(process.argv[3]),
    iv = file.subarray(4, 16),
    tag = file.subarray(16, 32);
  if (file.subarray(0, 4).toString() !== "ZTC1")
    throw new Error("Arquivo incompatível.");
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(tag);
  const data = JSON.parse(
    Buffer.concat([
      cipher.update(file.subarray(32)),
      cipher.final(),
    ]).toString(),
  );
  await mongoose.connect(process.env.RESTORE_MONGO_URL, {
    dbName: process.env.RESTORE_DATABASE,
  });
  for (const item of data.collections) {
    const rows = item.documents.map((text) =>
      mongoose.mongo.BSON.EJSON.parse(text),
    );
    const collection = mongoose.connection.db.collection(item.name);
    if (await collection.countDocuments({}))
      throw new Error("Banco de destino deve estar vazio.");
    if (rows.length) await collection.insertMany(rows);
    for (const index of item.indexes) {
      if (index.name === "_id_") continue;
      const {
        key,
        name,
        unique,
        sparse,
        expireAfterSeconds,
        partialFilterExpression,
      } = index;
      await collection.createIndex(key, {
        name,
        ...(unique ? { unique } : {}),
        ...(sparse ? { sparse } : {}),
        ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
      });
    }
  }
  console.log(
    JSON.stringify({
      event: "restore_complete",
      collections: data.collections.length,
      database: process.env.RESTORE_DATABASE,
    }),
  );
} else {
  if (!process.env.MONGO_URL) throw new Error("Configure MONGO_URL.");
  await mongoose.connect(process.env.MONGO_URL);
  const collections = [];
  for (const { name } of await mongoose.connection.db
    .listCollections()
    .toArray()) {
    if (name.startsWith("system.")) continue;
    const collection = mongoose.connection.db.collection(name);
    const documents = (await collection.find({}).toArray()).map((row) =>
      mongoose.mongo.BSON.EJSON.stringify(row, { relaxed: false }),
    );
    collections.push({
      name,
      documents,
      indexes: await collection.listIndexes().toArray(),
    });
  }
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({ createdAt: new Date().toISOString(), collections }),
    ),
    cipher.final(),
  ]);
  const folder = process.env.BACKUP_DIR || "backups";
  await mkdir(folder, { recursive: true });
  const file = join(
    folder,
    `ztcg-${new Date().toISOString().replaceAll(":", "-")}.enc`,
  );
  await writeFile(
    file,
    Buffer.concat([Buffer.from("ZTC1"), iv, cipher.getAuthTag(), encrypted]),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      event: "backup_complete",
      file,
      collections: collections.length,
    }),
  );
}
await mongoose.disconnect();
