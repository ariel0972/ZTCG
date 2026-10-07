import "dotenv/config";
import dbConnect from "../src/lib/mongodb";
import User from "../src/db/models/user";
import mongoose from "mongoose";
const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("Uso: npm run admin -- email@exemplo.com");
async function main() {
  await dbConnect();
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { admin: true } },
    { new: true },
  );
  if (!user) throw new Error("Conta não encontrada. Cadastre-a primeiro.");
  console.log(`Administrador configurado: ${user.nome}`);
}
void main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
