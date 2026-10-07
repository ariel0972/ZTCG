import "dotenv/config";
export function config() {
  const secret = process.env.SECRET;
  if (!secret || secret.length < 32)
    throw new Error("SECRET precisa ter pelo menos 32 caracteres.");
  if (!process.env.MONGO_URL) throw new Error("Defina MONGO_URL no .env.");
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT inválida.");
  return {
    secret,
    mongoUrl: process.env.MONGO_URL,
    port,
    origins: (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  };
}
