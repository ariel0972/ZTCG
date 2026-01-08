const express = require('express')
const dotenv = require('dotenv').config()
const path = require('path')
const User = require('./db/models/user')
const Deck = require('./db/models/decks')
const bcrypt = require("bcrypt")
const jwt = require('jsonwebtoken')

const { checkAdmin } = require('./middlewares/checkAdmin')
const { checkToken } = require('./middlewares/checktoken')

const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const deckRoutes = require('./routes/deckRoutes');


const app = express()
app.use(express.json())
app.use(require('cors')())

app.use(express.static(path.join(__dirname, 'public')));

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

// Rotas de Autenticação
app.use('/auth', userRoutes)

// Rotas de Admin
app.use('/admin', adminRoutes)

app.use('/decks', checkToken, deckRoutes)

app.listen(process.env.PORT, () => {
    console.log(`Ligado na porta ${process.env.PORT}`)
})

const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log('Conectado ao MongoDB!'))
    .catch(err => console.error('Erro ao conectar:', err));