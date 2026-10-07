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
    const payload = jwt.decode(token) as jwt.JwtPayload;
    const user = await User.findById(req.userId);
    if (!user || (payload.sv ?? 0) !== (user.sessionVersion ?? 0))
      throw new Error();
    next();
  } catch {
    next(new AppError(401, "Entre na sua conta novamente.", "UNAUTHORIZED"));
  }
}
