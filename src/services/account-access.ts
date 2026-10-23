import { AppError } from "../lib/errors";
export type AccountModeration = {
  banned?: boolean;
  suspendedUntil?: Date | string | null;
  reason?: string;
  by?: string;
  at?: Date;
};
export function accountRestriction(
  user: { moderation?: AccountModeration } | null | undefined,
  now = Date.now(),
) {
  if (user?.moderation?.banned)
    return {
      code: "ACCOUNT_BANNED",
      message: "Conta banida. Entre em contato com a administração.",
    };
  const until = user?.moderation?.suspendedUntil;
  if (until && new Date(until).getTime() > now)
    return {
      code: "ACCOUNT_SUSPENDED",
      message:
        "Conta suspensa até " +
        new Date(until).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        }) +
        ".",
    };
  return null;
}
export function assertAccountAccess(
  user: { moderation?: AccountModeration },
  now = Date.now(),
) {
  const restriction = accountRestriction(user, now);
  if (restriction)
    throw new AppError(403, restriction.message, restriction.code);
}
