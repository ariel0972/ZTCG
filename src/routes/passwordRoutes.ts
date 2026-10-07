import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import User from "../db/models/user";
import { rateLimit } from "../middlewares/rateLimit";
import { AppError } from "../lib/errors";
import { log } from "../lib/observability";
import { resetMailSettings, sendResetMail } from "../services/reset-mail";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function passwordRoutes(
  send = sendResetMail,
  configured = resetMailSettings,
  now = Date.now,
) {
  const router = Router();
  router.post("/forgot-password", rateLimit(5), async (req, res) => {
    const { email } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.trim().toLowerCase()),
      })
      .strict()
      .parse(req.body);
    configured();
    const user = await User.findOne({ email });
    if (user) {
      const token = randomBytes(32).toString("hex");
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            resetTokenHash: hash(token),
            resetExpires: new Date(now() + 1800000),
          },
        },
      );
      try {
        await send(email, token);
      } catch {
        log("reset_email_failed", {}, "error");
      }
    }
    res.json({
      success: true,
      content:
        "Se esse e-mail estiver cadastrado, você receberá um link para redefinir a senha.",
    });
  });
  router.post("/reset-password", rateLimit(10), async (req, res) => {
    const input = z
      .object({
        token: z.string().regex(/^[a-f\d]{64}$/),
        senha: z
          .string()
          .min(8)
          .max(72)
          .refine((v) => Buffer.byteLength(v) <= 72),
        confirmPassword: z.string(),
      })
      .strict()
      .refine((v) => v.senha === v.confirmPassword, {
        message: "As senhas não coincidem.",
        path: ["confirmPassword"],
      })
      .parse(req.body);
    const senha = await bcrypt.hash(input.senha, 12);
    const changed = await User.findOneAndUpdate(
      {
        resetTokenHash: hash(input.token),
        resetExpires: { $gt: new Date(now()) },
      },
      {
        $set: { senha },
        $inc: { sessionVersion: 1 },
        $unset: { resetTokenHash: "", resetExpires: "" },
      },
    );
    if (!changed)
      throw new AppError(
        422,
        "Link inválido, expirado ou já utilizado. Solicite outro link.",
      );
    res.clearCookie("ztcg_refresh", {
      httpOnly: true,
      secure: !!process.env.VERCEL,
      sameSite: "lax",
      path: "/auth",
    });
    res.json({
      success: true,
      content: "Senha alterada. Entre novamente com sua nova senha.",
    });
  });
  return router;
}
