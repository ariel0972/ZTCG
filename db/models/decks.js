const mongoose = require('mongoose')

const deckSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    cartas: { type: String }, // Você pode continuar salvando como String JSON
    mago: { type: String, required: true },
    userId: { type: String, ref: 'User' } // Referência ao ID do usuário
})

module.exports = mongoose.model('Deck', deckSchema)