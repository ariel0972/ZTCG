import Tutorial from "../db/models/tutorial";
import User from "../db/models/user";
import { AppError } from "../lib/errors";
import {
  createTutorial,
  advanceTutorial,
  tutorialView,
  tutorialVersion,
  type TutorialInput,
  type TutorialProgress,
} from "../game/tutorial";
import { tutorialRequired } from "./tutorial-access";
async function account(userId: string) {
  const user = await User.findById(userId)
    .select("nome tutorialCompletedAt")
    .lean();
  if (!user) throw new AppError(401, "Conta não encontrada.");
  return user;
}
async function ensure(userId: string, nome: string): Promise<TutorialProgress> {
  let session = await Tutorial.findById(userId).lean();
  if (!session) {
    try {
      await Tutorial.updateOne(
        { _id: userId },
        { $setOnInsert: createTutorial(userId, nome) },
        { upsert: true, runValidators: true },
      );
    } catch (error: any) {
      if (error.code !== 11000) throw error;
    }
    session = await Tutorial.findById(userId).lean();
  }
  if (!session || session.courseVersion !== tutorialVersion)
    throw new AppError(
      409,
      "Este treino foi atualizado. Recomece para usar as regras atuais.",
      "TUTORIAL_VERSION",
    );
  return session;
}
async function response(progress: TutorialProgress, required: boolean) {
  if (progress.completedAt) {
    await User.updateOne(
      {
        _id: progress._id,
        $or: [
          { tutorialCompletedAt: { $exists: false } },
          { tutorialCompletedAt: null },
        ],
      },
      { $set: { tutorialCompletedAt: progress.completedAt } },
      { runValidators: true },
    );
    required = false;
  }
  return { success: true, required, ...tutorialView(progress) };
}
export async function tutorialState(userId: string) {
  const user = await account(userId),
    progress = await ensure(userId, user.nome);
  return response(progress, tutorialRequired(user));
}
export async function tutorialAction(userId: string, input: TutorialInput) {
  const user = await account(userId),
    progress = await ensure(userId, user.nome);
  if (progress.lastActionId === input.actionId)
    return response(progress, tutorialRequired(user));
  if (progress.version !== input.version)
    throw new AppError(
      409,
      "O treino mudou em outra aba. Atualize para continuar.",
      "STALE_TUTORIAL",
    );
  const next = advanceTutorial(progress, input);
  const { _id, ...fields } = next;
  const result = await Tutorial.updateOne(
    { _id, version: progress.version, courseVersion: tutorialVersion },
    { $set: fields },
    { runValidators: true },
  );
  if (result.matchedCount !== 1)
    throw new AppError(
      409,
      "O treino mudou. Atualize para continuar.",
      "STALE_TUTORIAL",
    );
  return response(next, tutorialRequired(user));
}
export async function restartTutorial(
  userId: string,
  version: number,
  actionId: string,
) {
  const user = await account(userId),
    old = await Tutorial.findById(userId).lean();
  if (old?.lastActionId === actionId)
    return response(old, tutorialRequired(user));
  if (!old || old.version !== version)
    throw new AppError(
      409,
      "O treino mudou. Atualize para recomeçar.",
      "STALE_TUTORIAL",
    );
  const next = {
    ...createTutorial(userId, user.nome),
    version: old.version + 1,
    lastActionId: actionId,
  };
  const { _id, ...fields } = next;
  const updated = await Tutorial.updateOne(
    { _id, version: old.version },
    { $set: fields, $unset: { completedAt: 1, skippedAt: 1 } },
    { runValidators: true },
  );
  if (updated.matchedCount !== 1)
    throw new AppError(
      409,
      "O treino mudou. Atualize para recomeçar.",
      "STALE_TUTORIAL",
    );
  return response(next, tutorialRequired(user));
}
