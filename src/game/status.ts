export interface Status {
  nome: string;
  valor?: number;
  turnosRestantes: number;
  unidade?: "rodada" | "turno";
  expiraNoTurno?: number;
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
}

export function tickRound(statuses: Status[]) {
  let damage = 0;
  for (const status of statuses) {
    if (status.unidade === "turno") continue;
    const name = canonicalStatus(status.nome);
    if (["Sangrando", "Queimado", "Envenenado"].includes(name))
      damage += status.valor ?? 1;
    else if (["Peste Negra", "Leptospirose"].includes(name)) damage += 2;
    status.turnosRestantes--;
  }
  return damage;
}
