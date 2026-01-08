const mongoose = require('mongoose')

const deckSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    cartas: { type: [Object] }, // Você pode continuar salvando como String JSON
    mago: { type: Object        , required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // Referência ao ID do usuário
})

module.exports = mongoose.model('Deck', deckSchema)