import express, { Router } from "express";
import { storeAvatar, storeLegacyAvatar } from "../services/avatars";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../db/models/user";
import { checkToken } from "../middlewares/checkToken";
import { AuthRequest } from "../types";
import { AppError } from "../lib/errors";
import { rateLimit } from "../middlewares/rateLimit";
import { passwordRoutes } from "./passwordRoutes";
import { playerName, playerNameKey } from "../services/player-name";
import { profileStats } from "../services/profiles";
import { invalidateRankings } from "../services/ranking-cache";
const router = Router();
router.use(passwordRoutes());
const refreshCookie = "ztcg_refresh";
function cookieOptions() {
  return {
    httpOnly: true,
    secure: !!process.env.VERCEL,
    sameSite: "lax" as const,
    path: "/auth",
    maxAge: 7 * 86400000,
  };
}
function issueSession(user: any, res: any) {
  const id = String(user._id);
  const token = jwt.sign(
    { id, sv: user.sessionVersion ?? 0 },
    process.env.SECRET!,
    {
      expiresIn: "12h",
      algorithm: "HS256",
    },
  );
  const refresh = jwt.sign(
    { id, sv: user.sessionVersion ?? 0, purpose: "refresh" },
    process.env.SECRET!,
    {
      expiresIn: "7d",
      algorithm: "HS256",
    },
  );
  res.cookie(refreshCookie, refresh, cookieOptions());
  return token;
}
function sameOrigin(req: any) {
  if (!req.is("application/json"))
    throw new AppError(403, "Formato de requisição inválido.");
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) throw new Error();
    } catch {
      throw new AppError(403, "Origem inválida.");
    }
  }
}
router.post("/refresh", rateLimit(30), async (req, res) => {
  sameOrigin(req);
  try {
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(refreshCookie + "="))
      ?.slice(refreshCookie.length + 1);
    if (!raw) throw new Error();
    const payload = jwt.verify(decodeURIComponent(raw), process.env.SECRET!, {
      algorithms: ["HS256"],
    });
    if (
      typeof payload === "string" ||
      payload.purpose !== "refresh" ||
      typeof payload.id !== "string" ||
      !/^[a-f\d]{24}$/i.test(payload.id)
    )
      throw new Error();
    const user = await User.findById(payload.id).select("+ranking");
    if (!user || (payload.sv ?? 0) !== (user.sessionVersion ?? 0))
      throw new Error();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      token: issueSession(user, res),
      user: await publicUser(user),
    });
  } catch {
    throw new AppError(401, "Entre na sua conta novamente.", "UNAUTHORIZED");
  }
});
router.post("/logout", (req, res) => {
  sameOrigin(req);
  res.clearCookie(refreshCookie, { ...cookieOptions(), maxAge: undefined });
  res.json({ success: true });
});
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  senha: z
    .string()
    .min(1)
    .max(72)
    .refine((v) => Buffer.byteLength(v) <= 72, "Senha muito longa."),
});
const register = credentials
  .extend({
    nome: playerName,
    senha: credentials.shape.senha.refine(
      (v) => v.length >= 8,
      "Use pelo menos 8 caracteres.",
    ),
    confirmPassword: z.string(),
  })
  .strict()
  .refine((v) => v.senha === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas são diferentes.",
  });
export async function publicUser(user: any) {
  const stats = user.ranking?.stats ?? (await profileStats(String(user._id)));
  return {
    id: String(user._id),
    _id: String(user._id),
    nome: user.nome,
    avatarURL: user.avatarURL,
    nivel: stats.nivel,
    titulo: stats.titulo,
    xp: stats.xp,
    vitorias: stats.vitorias,
    partidas: stats.partidas,
    admin: user.admin,
  };
}
router.post("/registrar", rateLimit(10), async (req, res) => {
  const input = register.parse(req.body);
  if (await User.exists({ email: input.email }))
    throw new AppError(409, "Email já cadastrado.");
  const nomeKey = playerNameKey(input.nome);
  if (await User.exists({ nomeKey }))
    throw new AppError(
      409,
      "Este nome de jogador já está em uso.",
      "NAME_TAKEN",
    );
  await User.create({
    nome: input.nome,
    nomeKey,
    email: input.email,
    senha: await bcrypt.hash(input.senha, 12),
  });
  // O editor cria um rascunho local quando a conta ainda não tem decks.
  // Cadastro não depende de uma segunda gravação para ficar consistente.
  res.status(201).json({
    success: true,
    content: "Conta criada. Entre para montar seu deck.",
  });
});
router.post("/logar", rateLimit(20), async (req, res) => {
  const input = credentials.strict().parse(req.body),
    user = await User.findOne({ email: input.email }).select("+senha +ranking");
  if (!user || !(await bcrypt.compare(input.senha, user.senha)))
    throw new AppError(401, "Email ou senha incorretos.", "UNAUTHORIZED");
  const token = issueSession(user, res);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    token,
    user: await publicUser(user),
    content: "Login realizado.",
  });
});
router.get("/me", checkToken, async (req: AuthRequest, res) => {
  const user = await User.findById(req.userId).select("+ranking");
  if (!user) throw new AppError(401, "Conta não encontrada.");
  res.json({ success: true, user: await publicUser(user) });
});
router.post(
  "/avatar",
  checkToken,
  rateLimit(12),
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: "200kb",
  }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body))
      throw new AppError(422, "Envie uma imagem PNG, JPG ou WebP.");
    res.json({ success: true, avatarURL: await storeAvatar(req.body) });
  },
);
router.put("/user/edit", checkToken, async (req: AuthRequest, res) => {
  const input = z
    .object({
      nome: playerName,
      avatarURL: z
        .string()
        .max(280000)
        .refine(
          (v) =>
            /^\/assets\/(?!.*\.\.)[^\\]+$/.test(v) ||
            /^\/avatars\/[a-f\d]{64}\.webp$/.test(v) ||
            /^https:\/\//.test(v) ||
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
          "Imagem inválida.",
        ),
    })
    .strict()
    .parse(req.body);
  if (input.avatarURL.startsWith("data:"))
    input.avatarURL = await storeLegacyAvatar(input.avatarURL);
  const nomeKey = playerNameKey(input.nome);
  if (await User.exists({ nomeKey, _id: { $ne: req.userId } }))
    throw new AppError(
      409,
      "Este nome de jogador já está em uso.",
      "NAME_TAKEN",
    );
  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: { ...input, nomeKey } },
    { new: true, runValidators: true },
  );
  if (!user) throw new AppError(404, "Conta não encontrada.");
  invalidateRankings();
  res.json({
    success: true,
    user: await publicUser(user),
    content: "Perfil atualizado.",
  });
});
export default router;
