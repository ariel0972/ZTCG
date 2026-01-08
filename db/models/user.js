const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const db = new Database('TCG.db')

const createTable = `
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        senha TEXT NOT NULL,
        avatarURL TEXT DEFAULT NULL,
        nivel INTEGER DEFAULT 1,
        vitorias INTEGER DEFAULT 0,
        partidas INTEGER DEFAULT 0
    )
`

db.exec(createTable)

function findOne(userId) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
    let user = stmt.get(userId)

    if (!user) {
        const newUser = { 
            id: userId, 
            nome: "usuário", 
            email: "123@example.com", 
            senha: "123456", 
            avatarURL: 'assets/avatar.png', 
        }

        const inserStmT = db.prepare(`
            INSERT INTO users (id, nome, email, senha, avatarURL)
            VALUES (?, ?, ?, ?, ?)
        `)

        inserStmT.run(
            newUser.id,
            newUser.nome,
            newUser.email,
            newUser.senha,
            newUser.avatarURL,
        )
        
        user = {
            ...newUser,
            nivel: 1,
            vitorias: 0,
            partidas: 0
        }
    }
     
    return user
}

function findByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email) // Retorna o usuário ou undefined
}

function createUser(id, nome, email, senha) {
    const stmt = db.prepare(`
        INSERT INTO users (id, nome, email, senha) 
        VALUES (?, ?, ?, ?)
    `)

    stmt.run(id, nome, email, senha)
}

module.exports = {
    findOne,
    findByEmail,
    createUser
}