import { Request } from 'express'

// Extende o Request do Express para incluir o userId
// que o checkToken injeta. Sem isso, req.userId daria erro em todo lugar.
export interface AuthRequest extends Request {
  userId?: string
}

export type CardType = 'Tropa' | 'Feitiço' | 'Mago' | 'Estrutura' | 'Armamento'