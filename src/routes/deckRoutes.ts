import { Router, Response } from 'express'
import Deck from '../db/models/decks'
import { AuthRequest } from '../types'

const router = Router()

router.post('/user', async (req: AuthRequest, res: Response) => {
  try {
    const { nome, cartas, mago } = req.body
    const deck = new Deck({ nome, cartas, mago, userId: req.userId })
    await deck.save()
    return void res.status(200).json({ success: true, content: 'Deck criado com sucesso!', deck })
  } catch {
    return void res.status(500).json({ success: false, content: 'Falha interna do servidor.' })
  }
})

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { nome, cartas, mago, icone } = req.body
    const deck = await Deck.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { nome, cartas, mago, icone },
      { new: true }
    )
    if (!deck) return void res.status(404).json({ success: false, content: 'Deck não encontrado' })
    return void res.status(200).json({ success: true, content: 'Deck atualizado', deck })
  } catch {
    return void res.status(500).json({ success: false, content: 'Erro ao atualizar deck.' })
  }
})

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const deck = await Deck.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!deck) return void res.status(404).json({ success: false, content: 'Deck não encontrado' })
    return void res.status(200).json({ success: true, content: 'Deck deletado!', id: req.params.id })
  } catch {
    return void res.status(500).json({ success: false, content: 'Erro ao excluir deck.' })
  }
})

router.get('/user/:id', async (req: AuthRequest, res: Response) => {
  const decks = await Deck.find({ userId: req.params.id })
  if (!decks) return void res.status(404).json({ success: false, content: 'Nenhum deck encontrado' })
  return void res.status(200).json({ success: true, decks })
})

export default router