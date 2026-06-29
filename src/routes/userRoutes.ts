import { Router, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import User from '../db/models/user'
import Deck from '../db/models/decks'
import { checkToken } from '../middlewares/checkToken'
import { AuthRequest } from '../types'

const router = Router()

router.post('/registrar', async (req: AuthRequest, res: Response) => {
  const { nome, email, senha, confirmPassword } = req.body

  if (!nome)   return void res.status(422).json({ success: false, content: 'Nome é obrigatório' })
  if (!email)  return void res.status(422).json({ success: false, content: 'Email é obrigatório' })
  if (!senha)  return void res.status(422).json({ success: false, content: 'A senha é obrigatória' })

  if (senha !== confirmPassword) {
    return void res.status(422).json({ success: false, content: 'As senhas são diferentes' })
  }

  const userExiste = await User.findOne({ email })
  if (userExiste) {
    return void res.status(400).json({ success: false, content: 'Email já existe' })
  }

  const salt = await bcrypt.genSalt(12)
  const senhaHash = await bcrypt.hash(senha, salt)

  const user = new User({ nome, email, senha: senhaHash })

  try {
    const userSave = await user.save()

    const deck = new Deck({
      nome: 'Deck Inicial',
      cartas: [],
      mago: 'null',
      userId: userSave._id
    })
    await deck.save()

    return void res.status(201).json({ success: true, content: 'Usuário criado com sucesso!' })
  } catch (error) {
    console.error(error)
    return void res.status(500).json({ success: false, content: 'Erro ao salvar no banco' })
  }
})

router.post('/logar', async (req: AuthRequest, res: Response) => {
  const { email, senha } = req.body

  if (!email) return void res.status(422).json({ success: false, content: 'Email é obrigatório' })
  if (!senha) return void res.status(422).json({ success: false, content: 'A senha é obrigatória' })

  const user = await User.findOne({ email })
  if (!user) {
    return void res.status(422).json({ success: false, content: 'Conta inexistente' })
  }

  const senhaValida = await bcrypt.compare(senha, user.senha)
  if (!senhaValida) {
    return void res.status(400).json({ success: false, content: 'Senha inválida' })
  }

  try {
    const userDecks = await Deck.find({ userId: user._id })
    const secret = process.env.SECRET!
    const token = jwt.sign({ id: user.id }, secret)

    return void res.status(200).json({
      success: true,
      content: 'Usuário Logado com Sucesso!',
      token,
      user: {
        id: user._id,
        nome: user.nome,
        avatarURL: user.avatarURL,
        nivel: user.nivel,
        vitorias: user.vitorias,
        partidas: user.partidas,
        decks: userDecks
      }
    })
  } catch (error) {
    console.error(error)
    return void res.status(500).json({ success: false, content: 'Erro interno' })
  }
})

router.put('/user/edit', checkToken, async (req: AuthRequest, res: Response) => {
  const { nome, avatarURL } = req.body

  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { nome, avatarURL },
      { new: true, select: '-senha' }
    )

    if (!user) {
      return void res.status(404).json({ success: false, content: 'Usuário não encontrado' })
    }

    return void res.status(200).json({ success: true, content: 'Perfil atualizado!', user })
  } catch (error) {
    console.error(error)
    return void res.status(500).json({ success: false, content: 'Erro ao salvar dados' })
  }
})

export default router