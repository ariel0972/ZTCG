const mongoose = require('mongoose')

const userSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    avatarURL: { type: String, default: '../assets/avatar.png' },
    nivel: { type: Number, default: 1 },
    vitorias: { type: Number, default: 0 },
    partidas: { type: Number, default: 0 }
})

module.exports = mongoose.model('UserTCG', userSchema)