const express = require('express')
const router = express.Router()
const User = require('../db/models/user')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const Deck = require('../db/models/decks')
const { checkToken } = require('../middlewares/checktoken')


router.post('/registrar', async (req, res) => {
    const { nome, email, senha, confirmPassword } = req.body

    if (!nome) {
        return res.status(422).json({ success: false, content: "Nome é obrigatório" })
    }
    if (!email) {
        return res.status(422).json({ success: false, content: "Email é obrigatório" })
    }
    if (!senha) {
        return res.status(422).json({ success: false, content: "A senha é obrigatória" })
    }

    if (senha !== confirmPassword) {
        return res.status(422).json({ success: false, content: "As senhas são diferentes" })
    }

    // Verifica no banco se existe um email igual
    const userExiste = await User.findOne({ email: email })
    if (userExiste) {
        return res.status(400).json({ success: false, content: "Email já existe" })
    }

    // Criar uma senha 
    const salt = await bcrypt.genSalt(12)
    const senhaHash = await bcrypt.hash(senha, salt)

    // Cria usuário
    const user = new User({
        nome,
        email,
        senha: senhaHash
    });

    try {
        const userSave = await user.save();

        const deck = new Deck({
            nome: "Deck Inicial",
            cartas: [],
            mago: "null",
            userId: userSave._id
        })

        await deck.save()

        return res.status(201).json({ success: true, content: "Usuário criado com sucesso!" });
    } catch (error) {
        console.log(error)
        return res.status(500).json({ success: false, content: "Erro ao salvar no banco" });
    }
})

// Logar usuário
router.post("/logar", async (req, res) => {
    const { email, senha } = req.body

    if (!email) {
        return res.status(422).json({ success: false, content: "Email é obrigatório" })
    }
    if (!senha) {
        return res.status(422).json({ success: false, content: "A senha é obrigatória" })
    }

    // Verifica se o usuário existe
    const user = await User.findOne({ email: email })
    if (!user) {
        return res.status(422).json({ success: false, content: "Conta inexistente" })
    }

    // Verifica se a senha funciona
    const checkSenha = await bcrypt.compare(senha, user.senha)
    if (!checkSenha) {
        return res.status(400).json({ success: false, content: "Senha inválida" })
    }

    try {
        const userDecks = await Deck.find({ userId: user._id })

        const secret = process.env.SECRET
        const token = jwt.sign({
            id: user.id
        }, secret)


        res.status(200).json({
            success: true,
            content: "Usuário Logado com Sucesso!",
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
        console.log(error)
        return res.status(500).json({
            success: false,
            content: "Erro ao salvar no banco"
        })
    }
})


router.put("/user/edit", checkToken, async (req, res) => {
    const userId = req.userId
    const { nome, avatarURL } = req.body

    try {
        // $set: garante que vamos atualizar apenas esses campos específicos
        const user = await User.findByIdAndUpdate(
            userId,
            {
                nome,
                avatarURL
            },
            { new: true, select: '-senha' } // Retorna o novo usuário, sem a senha
        );

        if (!user) {
            return res.status(404).json({ success: false, content: "Usuário não encontrado" })
        }

        res.status(200).json({ success: true, content: "Perfil atualizado!", user })

    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, content: "Erro ao salvar dados no servidor" })
    }
})

router.get("/user", checkToken, async (req, res) => {
    
})

module.exports = router