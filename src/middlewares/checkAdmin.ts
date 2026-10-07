import { Response, NextFunction } from "express";
import User from "../db/models/user";
import { AuthRequest } from "../types";

export async function checkAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await User.findById(req.userId);

    if (user?.admin) {
      next();
    } else {
      res.status(401).json({
        success: false,
        content: "Acesso negado. Apenas administradores.",
      });
    }
  } catch {
    res
      .status(500)
      .json({ success: false, content: "Erro ao validar permissões." });
  }
}
