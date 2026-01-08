const User = require("../db/models/user");

async function checkAdmin(req, res, next) {
    try {
        // O checkToken já salvou o ID no req.userId
        const user = await User.findById(req.userId);

        if (user && user.admin) {
            next(); // É ADM, pode seguir
        } else {
            res.status(403).json({ success: false, content: "Acesso negado. Apenas administradores." });
        }
    } catch (error) {
        res.status(500).json({ success: false, content: "Erro ao validar permissões." });
    }
}

module.exports = {
    checkAdmin
}