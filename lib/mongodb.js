const mongoose = require('mongoose');

const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
    throw new Error('Por favor, defina a variável MONGODB_URI no seu .env');
}

let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function dbConnect() {
    console.time('db-timer')
    if (cached.conn) {
        console.log('🚀 [MongoDB] Reutilizando conexão via Cache com o Mongo.')
        console.timeEnd('db-timer')
        return cached.conn;
    }

    if (!cached.promise) {
        const opts = { bufferCommands: false }

        console.log('🔗 [MongoDB] Criando nova conxão...')
        cached.promise = mongoose.connect(MONGO_URL, opts).then((mongoose) => {
            console.log('✅ Conectado com sucesso!')
            return mongoose;
        });
    }

    try {
        cached.conn = await cached.promise;
        console.timeEnd('db-timer')
    } catch (e) {
        console.timeEnd('db-timer')
        console.log('❌ [MongoDB] Erro ao conectar: ', e.message)
        cached.promise = null;
        throw e;
    }

    return cached.conn;
}

module.exports = dbConnect;