const express = require('express')
const router = express.Router()
const Deck = require('../db/models/decks')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')


router.post('/user', async (req, res) => {
    try {
        const { nome, cartas, mago } = req.body

        const deck = new Deck({
            nome,
            cartas,
            mago,
            userId: req.userId
        })

        const save = await deck.save()
        if (!save) {
            return res.status(500).json({ success: false, content: "Falha ao criar um novo Deck " })
        }

        res.status(200).json({ success: true, content: "O deck Foi criado com Suceso!", deck: deck })
    } catch (error) {
        console.error(error)
        res.status(500).json({ success: false, content: "Falha interna do servidor." })
    }
})

router.put("/:id", async (req, res) => {
    try {
        const { nome, cartas, mago } = req.body

        const deck = await Deck.findOneAndUpdate(
            { _id: req.params.id, userId: req.userId },
            {
                nome,
                cartas,
                mago
            },
            { new: true }
        )

        if (!deck) {
            return res.status(403).json({ success: false, content: "Deck não encontrado" });
        }

        res.status(200).json({ success: true, content: "Deck Atualizado", deck: deck });
    } catch (error) {
        console.error(error)
        res.status(500).json({ success: false, content: "Erro ao carregar usuários" });
    }
})

router.delete("/:id", async (req, res) => {
    try {
        const deck = await Deck.findOneAndDelete({
            _id: req.params.id,
            userId: req.userId
        })

        if (!deck) {
            return res.status(404).json({ success: false, content: "Deck não encontrado" })
        }

        res.status(200).json({ success: true, content: "Deck deletado com sucesso!", id: req.params.id })

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, content: "Erro ao excluir o deck." });
    }
})

router.get('/user/:id', async (req, res) => {
    const userId = req.params.id

    const decks = await Deck.find({ userId: userId })

    if (!decks) {
        return res.status(404).json({ success: false, content: "Deck não encontrado não encontrado!" })
    }

    res.status(200).json({ success: true, decks })
})

module.exports = router