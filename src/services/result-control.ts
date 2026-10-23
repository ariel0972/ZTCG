import { randomUUID } from "node:crypto";
import { AdminControl } from "../db/models/admin";
import { AppError } from "../lib/errors";
/** Serializa gravação de resultados e intervenções administrativas, nunca jogadas. */
export async function withResultControl<T>(
  operation: (checkpoint: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const token = randomUUID(),
    now = new Date(Date.now());
  try {
    const row = await AdminControl.findOneAndUpdate(
      {
        _id: "results-admin",
        $or: [{ until: { $lte: now } }, { until: { $exists: false } }],
      },
      { $set: { token, until: new Date(+now + 120000) } },
      { upsert: true, new: true },
    );
    if (!row || row.token !== token)
      throw new AppError(
        409,
        "Uma atualização está em andamento. Tente novamente.",
        "ADMIN_BUSY",
      );
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new AppError(
        409,
        "Uma atualização está em andamento. Tente novamente.",
        "ADMIN_BUSY",
      );
    throw error;
  }
  let renewedAt = Date.now();
  const checkpoint = async () => {
    if (Date.now() - renewedAt < 30000) return;
    const now = new Date(Date.now());
    const row = await AdminControl.findOneAndUpdate(
      { _id: "results-admin", token, until: { $gt: now } },
      { $set: { until: new Date(+now + 120000) } },
      { new: true },
    );
    if (!row || row.token !== token)
      throw new AppError(
        409,
        "A trava do recálculo expirou. Tente novamente.",
        "ADMIN_BUSY",
      );
    renewedAt = Date.now();
  };
  try {
    return await operation(checkpoint);
  } finally {
    await AdminControl.updateOne(
      { _id: "results-admin", token },
      { $unset: { token: 1, until: 1 } },
    );
  }
}
