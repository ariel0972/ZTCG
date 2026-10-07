import Match from "../db/models/match";
export function progression(matches: number) {
  const completed = Math.max(0, Math.floor(matches));
  return {
    nivel: 1 + Math.floor(completed / 10),
    progresso: completed % 10,
    proximoNivel: 10,
    partidas: completed,
  };
}
export async function profileStats(userId: string) {
  const filter = { "players.userId": userId };
  const [partidas, vitorias, empates] = await Promise.all([
    Match.countDocuments(filter),
    Match.countDocuments({ ...filter, winner: userId }),
    Match.countDocuments({ ...filter, winner: null }),
  ]);
  return {
    ...progression(partidas),
    vitorias,
    empates,
    derrotas: partidas - vitorias - empates,
    taxaVitorias: partidas ? Math.round((vitorias / partidas) * 100) : 0,
  };
}
