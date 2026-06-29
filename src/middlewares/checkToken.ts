import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AuthRequest } from '../types'

interface JwtPayload {
  id: string
}

export async function checkToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // formato: "Bearer <token>"

  if (!token) {
    res.status(401).json({ success: false, content: 'Token não fornecido' })
    return
  }

  try {
    const secret = process.env.SECRET!
    const decoded = jwt.verify(token, secret) as JwtPayload
    req.userId = decoded.id
    next()
  } catch {
    res.status(401).json({ success: false, content: 'Token inválido' })
  }
}