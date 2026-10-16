import { Router } from "express";
import { avatarBytes } from "../services/avatars";
import { AppError } from "../lib/errors";
export const avatarRoutes = Router();
avatarRoutes.get("/:hash.webp", async (req, res) => {
  const hash = String(req.params.hash);
  if (!/^[a-f\d]{64}$/.test(hash))
    throw new AppError(404, "Imagem não encontrada.");
  res.setHeader(
    "Cache-Control",
    "public, max-age=31536000, s-maxage=31536000, immutable",
  );
  res.setHeader("ETag", `"${hash}"`);
  if (req.fresh) {
    res.status(304).end();
    return;
  }
  const bytes = await avatarBytes(hash);
  if (!bytes) {
    res.setHeader("Cache-Control", "no-store");
    throw new AppError(404, "Imagem não encontrada.");
  }
  res.type("image/webp").send(bytes);
});
