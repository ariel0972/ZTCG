import express, { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import path from 'path'
import cors from 'cors'

import dbConnect from './lib/mongodb'
import User from './db/models/user'

import userRoutes from './routes/userRoutes'
import adminRoutes from './routes/adminRoutes'
import deckRoutes from './routes/deckRoutes'

import { checkAdmin } from './middlewares/checkAdmin'
import { checkToken } from './middlewares/checkToken'

dotenv.config()

const app = express()

app.use(express.json())
app.use(cors())
app.use(express.static(path.join(__dirname, '..', 'public')))

// Middleware de conexão com o banco
app.use(async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await dbConnect()
    next()
  } catch {
    res.status(500).json({ success: false, content: 'Erro ao conectar ao banco' })
  }
})

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'HTML', 'deckbuilder.html'))
})

app.get('/user/:id', checkToken, async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id, '-senha')
  if (!user) return void res.status(404).json({ success: false, content: 'Usuário não encontrado!' })
  return void res.status(200).json({ success: true, user })
})

app.use('/auth', userRoutes)
app.use('/admin', checkToken, checkAdmin, adminRoutes)
app.use('/decks', checkToken, deckRoutes)

app.listen(process.env.PORT ?? 3000, () => {
  console.log(`Ligado na porta ${process.env.PORT ?? 3000}`)
})

export default app