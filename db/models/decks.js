const Database = require('better-sqlite3');

const createTable = `
    CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        cartas TEXT,
        mago TEXT NOT NULL,
        userId INTERGER,
        FOREIGN KEY (userId) REFERENCES users(id)
    )
`

db.exec(createTable)