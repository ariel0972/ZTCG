const express = require('express')
const dotenv = require('dotenv').config()
const path = require('path')
const cors = require('cors')

// Modesl
const User = require('./db/models/user')
const Deck = require('./db/models/decks')

// Rotas
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const deckRoutes = require('./routes/deckRoutes');

//Middlewares
const { checkAdmin } = require('./middlewares/checkAdmin.js')
const { checkToken } = require('./middlewares/checkToken.js')

// Conex'ao com o Banco de Dados
const dbConnect = require('./lib/mongodb') 

const app = express()

app.use(express.json())
app.use(cors())
app.use(express.static(path.join(__dirname, 'public')));

const conectarBancoMiddleware = async (req, res, next) => {
    try {
        await dbConnect();
        next(); // Se conectou, segue para a rota
    } catch (error) {
        res.status(500).json({ success: false, content: "Erro ao conectar ao banco" });
    }
}

app.use(conectarBancoMiddleware)

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'HTML', 'deckbuilder.html'));
})

app.get('/user/:id', checkToken, async (req, res) => {
    const id = req.params.id

    const user = await User.findById(id, '-senha')

    if (!user) {
        return res.status(404).json({ success: false, content: "Usuário não encontrado!" })
    }

    res.status(200).json({ success: true, user })
})


app.use('/auth', userRoutes)
app.use('/admin', checkToken, checkAdmin, adminRoutes)
app.use('/decks', checkToken, deckRoutes)

app.listen(process.env.PORT, () => {
    console.log(`Ligado na porta ${process.env.PORT}`)
})

module.exports = app