import {
  effectRoundDue,
  nextEffectRound,
  type EffectClock,
} from "./effect-clock";
export interface Status extends EffectClock {
  originOwnerId?: string;
  origin?: string;
  nome: string;
  valor?: number;
  turnosRestantes: number;
  unidade?: "rodada" | "turno";
  expiraNoTurno?: number;
  requerStatus?: string;
  protegidoId?: string;
}
const aliases: Record<string, string> = {
  Atordoamento: "Atordoado",
  Congelamento: "Congelado",
  Cegueira: "Cego",
  Sangramento: "Sangrando",
  Envenenamento: "Envenenado",
  Queimacao: "Queimado",
  Queimando: "Queimado",
};
export const canonicalStatus = (name: string) => aliases[name] ?? name;
export const hasStatus = (statuses: Status[], names: string[]) =>
  statuses.some(
    (s) => s.turnosRestantes > 0 && names.includes(canonicalStatus(s.nome)),
  );

export function applyStatus(
  statuses: Status[],
  name: string,
  duration: number,
  value?: number,
  turn = 0,
  unit?: "rodada" | "turno",
) {
  const nome = canonicalStatus(name);
  const existing = statuses.find((s) => canonicalStatus(s.nome) === nome);
  const previousFreeze =
    nome === "Congelado" && existing ? { ...existing } : undefined;
  if (nome === "Envenenado") {
    if (existing)
      existing.turnosRestantes = Math.min(5, existing.turnosRestantes + 1);
    else
      statuses.push({ nome, valor: 1, turnosRestantes: 3, unidade: "rodada" });
  } else if (nome === "Queimado") {
    if (existing) {
      existing.valor = Math.min(3, (existing.valor ?? 1) + 1);
      existing.turnosRestantes = Math.min(5, existing.turnosRestantes + 1);
    } else
      statuses.push({ nome, valor: 1, turnosRestantes: 2, unidade: "rodada" });
  } else if (nome === "Sangrando") {
    if (existing)
      existing.valor = Math.max(
        existing.valor ?? 1,
        Math.min(5, (existing.valor ?? 1) + 1),
      );
    else
      statuses.push({ nome, valor: 1, turnosRestantes: 3, unidade: "rodada" });
  } else if (nome === "Congelado") {
    const status: Status = {
      nome,
      turnosRestantes: 2,
      unidade: "turno",
      expiraNoTurno: turn + 1,
    };
    if (existing) Object.assign(existing, status);
    else statuses.push(status);
  } else if (existing && nome !== "Escudo") {
    existing.turnosRestantes = Math.max(existing.turnosRestantes, duration);
    if (value !== undefined) existing.valor = value;
  } else
    statuses.push({
      nome,
      valor: value,
      turnosRestantes: duration,
      unidade: "rodada",
    });
  const applied =
    nome === "Escudo"
      ? statuses.filter((s) => s.nome === nome).at(-1)!
      : statuses.find((s) => s.nome === nome)!;
  if (nome === "Interceptar") delete applied.protegidoId;
  if (unit && !["Envenenado", "Queimado", "Sangrando"].includes(nome)) {
    applied.unidade = unit;
    applied.turnosRestantes = duration;
    if (unit === "turno") applied.expiraNoTurno = turn + duration - 1;
    else delete applied.expiraNoTurno;
  }
  if (applied.unidade === "turno") delete applied.nextTickTurn;
  else if (
    applied.nextTickTurn === undefined ||
    !["Envenenado", "Queimado", "Sangrando"].includes(nome)
  )
    applied.nextTickTurn = nextEffectRound(turn);
  if (previousFreeze) {
    const expires = (s: Status) =>
      s.unidade === "turno"
        ? (s.expiraNoTurno ?? turn + s.turnosRestantes - 1)
        : (s.nextTickTurn ?? nextEffectRound(turn)) +
          2 * (s.turnosRestantes - 1);
    if (expires(previousFreeze) > expires(applied)) {
      Object.assign(applied, previousFreeze);
      if (previousFreeze.unidade !== "turno") delete applied.expiraNoTurno;
      else delete applied.nextTickTurn;
    }
  }
  return applied;
}

export function tickRound(
  statuses: Status[],
  onDamage?: (status: Status, value: number) => void,
  turn?: number,
) {
  let damage = 0;
  for (const status of statuses) {
    if (status.unidade === "turno" || status.turnosRestantes <= 0) continue;
    if (turn !== undefined && !effectRoundDue(status, turn)) continue;
    const name = canonicalStatus(status.nome);
    const value = ["Sangrando", "Queimado", "Envenenado"].includes(name)
      ? (status.valor ?? 1)
      : ["Peste Negra", "Leptospirose"].includes(name)
        ? 2
        : 0;
    damage += value;
    if (value) onDamage?.(status, value);
    status.turnosRestantes--;
  }
  return damage;
}
