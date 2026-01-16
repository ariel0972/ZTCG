const mongoose = require('mongoose')

const deckSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    cartas: { type: [Object] },
    mago: { type: Object, required: true },
    icone: { type: String, default: "" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
})

module.exports = mongoose.model('Deck', deckSchema)