import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../db/models/user";
import { checkToken } from "../middlewares/checkToken";
import { AuthRequest } from "../types";
import { AppError } from "../lib/errors";
import { rateLimit } from "../middlewares/rateLimit";
import { passwordRoutes } from "./passwordRoutes";
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
    const user = await User.findById(payload.id);
    if (!user || (payload.sv ?? 0) !== (user.sessionVersion ?? 0))
      throw new Error();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      token: issueSession(user, res),
      user: publicUser(user),
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
    nome: z.string().trim().min(2).max(80),
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
export function publicUser(user: any) {
  return {
    id: String(user._id),
    _id: String(user._id),
    nome: user.nome,
    avatarURL: user.avatarURL,
    nivel: user.nivel,
    vitorias: user.vitorias,
    partidas: user.partidas,
    admin: user.admin,
  };
}
router.post("/registrar", rateLimit(10), async (req, res) => {
  const input = register.parse(req.body);
  if (await User.exists({ email: input.email }))
    throw new AppError(409, "Email já cadastrado.");
  const user = await User.create({
    nome: input.nome,
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
    user = await User.findOne({ email: input.email }).select("+senha");
  if (!user || !(await bcrypt.compare(input.senha, user.senha)))
    throw new AppError(401, "Email ou senha incorretos.", "UNAUTHORIZED");
  const token = issueSession(user, res);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    token,
    user: publicUser(user),
    content: "Login realizado.",
  });
});
router.get("/me", checkToken, async (req: AuthRequest, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw new AppError(401, "Conta não encontrada.");
  res.json({ success: true, user: publicUser(user) });
});
router.put("/user/edit", checkToken, async (req: AuthRequest, res) => {
  const input = z
    .object({
      nome: z.string().trim().min(2).max(80),
      avatarURL: z
        .string()
        .max(280000)
        .refine(
          (v) =>
            /^\/assets\/(?!.*\.\.)[^\\]+$/.test(v) ||
            /^https:\/\//.test(v) ||
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
          "Imagem inválida.",
        ),
    })
    .strict()
    .parse(req.body);
  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!user) throw new AppError(404, "Conta não encontrada.");
  res.json({
    success: true,
    user: publicUser(user),
    content: "Perfil atualizado.",
  });
});
export default router;
