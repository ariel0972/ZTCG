const express = require('express')
const dotenv = require('dotenv').config()
const path = require('path')
const User = require('./db/models/user')
const Deck = require('./db/models/decks')
const bcrypt = require("bcrypt")
const { randomUUID } = require('crypto')
const jwt = require('jsonwebtoken')


const app = express()
app.use(express.json())
app.use(require('cors')())

app.get("/", (req, res) => {
    res.status(200).send({ mag: "Conexão bem suscedida" })
})

app.get('/user/:id', checkToken, async (req, res) => {
    const id = req.params.id

    const user = await User.findById(id, '-senha')

    if(!user) {
        return res.status(404).json({ success: false, content: "Usuário não encontrado "})
    }

    res.status(200).json({ user })
})

function checkToken(req, res, next){

    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(" ")[1]

    if (!token) {
        return res.status(401).json({ success: false, content: "Acesso negado" })
    }

    try {
        const secret = process.env.SECRET

        jwt.verify(token, secret)

        next()
    } catch (error) {
        res.status(400).json({ content: "TOKEN INVÁLIDO" })
    }
}

// Registrar Usuário
app.post('/auth/registrar', async (req, res) => {
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
            cartas: "[]",
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
app.post("/auth/logar", async (req, res) => {
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
                nivel: user.nivel
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

// Editar Usuário
app.put("/editUser", (req, res) => {

})
// Deletar Usuário
app.delete("/deleterUser", (req, res) => {

})
// [ADMIN] Buscar Usuário
app.get("admin/user/id", (req, res) => {

})
// [ADMIN] Editar Usuário
app.put("admin/edit/user", (req, res) => {

})




app.listen(process.env.PORT, () => {
    console.log(`Ligado na porta ${process.env.PORT}`)
})

const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log('Conectado ao MongoDB!'))
    .catch(err => console.error('Erro ao conectar:', err));