export interface Status {
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
    if (existing) existing.valor = Math.min(5, (existing.valor ?? 1) + 1);
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
  if (
    unit &&
    !["Envenenado", "Queimado", "Sangrando", "Congelado"].includes(nome)
  ) {
    applied.unidade = unit;
    applied.turnosRestantes = duration;
    if (unit === "turno") applied.expiraNoTurno = turn + duration - 1;
    else delete applied.expiraNoTurno;
  }
  return applied;
}

export function tickRound(
  statuses: Status[],
  onDamage?: (status: Status, value: number) => void,
) {
  let damage = 0;
  for (const status of statuses) {
    if (status.unidade === "turno") continue;
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
