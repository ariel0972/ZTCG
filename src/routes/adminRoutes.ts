import { Router, Response } from 'express'
import User from '../db/models/user'
import { AuthRequest } from '../types'

const router = Router()

router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find({}, '-senha')
    return void res.status(200).json({ success: true, users })
  } catch {
    return void res.status(500).json({ success: false, content: 'Erro ao carregar usuários' })
  }
})

export default router