import { createHash } from "node:crypto";
import sharp from "sharp";
import Avatar from "../db/models/avatar";
import { AppError } from "../lib/errors";
import { ReadCache } from "../lib/read-cache";
const images = new ReadCache<Buffer | null>(60000, 100);
export const profileImageUploadLimit = 2 * 1024 * 1024;
export type ProfileImageKind = "avatar" | "banner" | "card";
export async function prepareAvatar(
  original: Buffer,
  kind: ProfileImageKind = "avatar",
) {
  if (!original.length || original.length > profileImageUploadLimit)
    throw new AppError(
      422,
      "A imagem otimizada deve ter até 2 MB. Escolha a imagem pelo editor do perfil.",
    );
  let data: Buffer, format: string;
  try {
    const image = sharp(original, {
      limitInputPixels: 16000000,
      animated: false,
      failOn: "error",
    });
    const info = await image.metadata();
    if (!info.format || !["png", "jpeg", "webp"].includes(info.format))
      throw Error();
    format = info.format;
    const width = kind === "card" ? 1200 : kind === "banner" ? 1600 : 384;
    const height = kind === "card" ? 1680 : kind === "banner" ? 500 : 384;
    data = await image
      .rotate()
      .resize(width, height, {
        fit: kind === "card" ? "inside" : "cover",
        withoutEnlargement: true,
      })
      .webp({ quality: kind === "card" ? 90 : 80, effort: 4 })
      .toBuffer();
  } catch {
    throw new AppError(422, "Imagem inválida. Use PNG, JPG ou WebP.");
  }
  return { data, format };
}
export async function storeAvatar(
  original: Buffer,
  kind: ProfileImageKind = "avatar",
  name?: string,
) {
  const { data } = await prepareAvatar(original, kind);
  const hash = createHash("sha256").update(data).digest("hex");
  try {
    await Avatar.updateOne(
      { _id: hash },
      {
        $setOnInsert: {
          data,
          kind,
          ...(kind === "card" ? { name: name ?? "Imagem de carta" } : {}),
          createdAt: new Date(),
        },
      },
      { upsert: true, writeConcern: { w: "majority", wtimeout: 5000 } },
    );
  } catch (error: any) {
    if (error.code !== 11000) throw error;
  }
  images.clear(hash);
  return `/avatars/${hash}.webp`;
}
export async function storeLegacyAvatar(url: string) {
  const match = url.match(
    /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) throw new AppError(422, "Imagem inválida.");
  return storeAvatar(Buffer.from(match[1], "base64"));
}
export async function avatarBytes(hash: string) {
  return images.get(hash, async () => {
    const image = await Avatar.findById(hash).select("data");
    return image?.data ? Buffer.from(image.data) : null;
  });
}
