import mongoose from "mongoose";
let pending: Promise<typeof mongoose> | undefined;
export default async function dbConnect() {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!pending)
    pending = mongoose
      .connect(process.env.MONGO_URL!, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 5,
        minPoolSize: 0,
        maxIdleTimeMS: 30000,
      })
      .finally(() => {
        // Reuse only an in-flight attempt, never an already completed connection.
        pending = undefined;
      });
  return pending;
}
