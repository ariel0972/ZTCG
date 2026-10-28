import User from "../db/models/user";
import { AppError } from "../lib/errors";
export function tutorialRequired(
  account: { tutorialCompletedAt?: Date | string | null } | null | undefined,
) {
  return !account?.tutorialCompletedAt;
}
export async function assertTutorialComplete(userId: string) {
  const account = await User.findById(userId)
    .select("tutorialCompletedAt")
    .lean();
  if (!account) throw new AppError(401, "Conta não encontrada.");
  if (tutorialRequired(account))
    throw new AppError(
      403,
      "Conclua seu treino guiado antes de iniciar uma partida.",
      "TUTORIAL_REQUIRED",
    );
}
