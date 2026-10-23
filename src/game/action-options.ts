import type { Card } from "../types/card";
type Action = Pick<
  Card,
  "alvo" | "efeitos" | "maxAlvos" | "tiposAlvo" | "opcoes"
>;
/** Resolve uma escolha antes de validar alvos, custos e efeitos. */
export function chooseAction<T extends Partial<Action>>(
  action: T,
  mode?: string,
): T & Partial<Action> {
  if (!action.opcoes?.length) {
    if (mode) throw new Error("Esta ação não aceita escolha de efeito.");
    return action;
  }
  const option = action.opcoes.find((o) => o.id === mode);
  if (!option) throw new Error("Escolha uma das opções desta ação.");
  const { id: _id, nome: _nome, ...definition } = option;
  return {
    ...action,
    alvoAutomatico: undefined,
    tiposAlvo: undefined,
    maxAlvos: 1,
    ...definition,
    opcoes: undefined,
  };
}
