import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest } from "../types";
import { AppError } from "../lib/errors";
import User from "../db/models/user";
export function verifyToken(token: string): string {
  const decoded = jwt.verify(token, process.env.SECRET!, {
    algorithms: ["HS256"],
  });
  if (
    typeof decoded === "string" ||
    decoded.purpose !== undefined ||
    typeof decoded.id !== "string" ||
    !/^[a-f\d]{24}$/i.test(decoded.id)
  )
    throw new AppError(401, "Sessão inválida.", "UNAUTHORIZED");
  return decoded.id;
}
export async function checkToken(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  try {
    if (!token) throw new Error();
    req.userId = verifyToken(token);
  } catch {
    next(new AppError(401, "Entre na sua conta novamente.", "UNAUTHORIZED"));
    return;
  }
  const payload = jwt.decode(token!) as jwt.JwtPayload;
  try {
    const user = await User.findById(req.userId)
      .select("sessionVersion")
      .lean();
    if (!user || (payload.sv ?? 0) !== (user.sessionVersion ?? 0)) {
      next(new AppError(401, "Entre na sua conta novamente.", "UNAUTHORIZED"));
      return;
    }
    next();
  } catch {
    // A database failure is not a revoked session; avoid refresh/login storms.
    next(
      new AppError(
        503,
        "Banco indisponível. Tente novamente em instantes.",
        "DATABASE_UNAVAILABLE",
      ),
    );
  }
}
