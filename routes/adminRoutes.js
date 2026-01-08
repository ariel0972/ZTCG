const express = require('express')
const router = express.Router()
const User = require('../db/models/user')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

router.get("users", async (req, res) => {
    try {
        // Buscamos o usuário logado para confirmar se ele é admin
        const requester = await User.findById(req.userId);
        if (!requester || !requester.admin) {
            return res.status(403).json({ success: false, content: "Acesso negado" });
        }

        const users = await User.find({}, '-senha'); // Busca todos, removendo a senha por segurança
        res.status(200).json({ success: true, users });
    } catch (error) {
        res.status(500).json({ success: false, content: "Erro ao carregar usuários" });
    }
})

module.exports = router