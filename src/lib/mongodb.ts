import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'

const MONGO_URL = process.env.MONGO_URL

if (!MONGO_URL) {
  throw new Error('Por favor, defina a variável MONGO_URL no seu .env')
}

// Tipando o cache global para o TS não reclamar de "global.mongooseCache"
interface MongooseCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

declare global {
  var mongooseCache: MongooseCache
}

// Reutiliza a conexão entre chamadas (importante no Vercel/serverless)
const cached: MongooseCache = global.mongooseCache ?? { conn: null, promise: null }
global.mongooseCache = cached

async function dbConnect(): Promise<typeof mongoose> {
  console.time('db-timer')

  if (cached.conn) {
    console.log('🚀 [MongoDB] Reutilizando conexão via Cache.')
    console.timeEnd('db-timer')
    return cached.conn
  }

  if (!cached.promise) {
    console.log('🔗 [MongoDB] Criando nova conexão...')
    cached.promise = mongoose
      .connect(MONGO_URL!, { bufferCommands: false })
      .then((m) => {
        console.log('✅ Conectado com sucesso!')
        return m
      })
  }

  try {
    cached.conn = await cached.promise
    console.timeEnd('db-timer')
  } catch (e) {
    console.timeEnd('db-timer')
    cached.promise = null
    const err = e as Error
    console.log('❌ [MongoDB] Erro ao conectar:', err.message)
    throw e
  }

  return cached.conn
}

export default dbConnect