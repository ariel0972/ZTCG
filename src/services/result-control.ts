import { randomUUID } from "node:crypto";
import { AdminControl } from "../db/models/admin";
import { AppError } from "../lib/errors";
/** Serializa gravação de resultados e intervenções administrativas, nunca jogadas. */
export async function withResultControl<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const token = randomUUID(),
    now = new Date();
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
  try {
    return await operation();
  } finally {
    await AdminControl.updateOne(
      { _id: "results-admin", token },
      { $unset: { token: 1, until: 1 } },
    );
  }
}
