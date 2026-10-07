import type {
  DeclarativePassive,
  HabilidadePassiva,
  LegacyPassive,
  PassiveAction,
} from "../types/card";
import type { Instance } from "./state";

// Compatibility for persisted definitions; new cards use declarative effects.
export const legacyPassiveTriggers: Record<string, string[]> = {
  aplicarStatusAtacante: ["onAttacked"],
  bonusAtaqueAdjacente: ["continuous"],
  restringirAtaqueBasico: ["onTargeted"],
  ganharVida: ["onDeath"],
  curarMago: ["onSpellCast"],
  recuperarMana: ["onDeath"],
  comprarCarta: ["onSpellCast"],
  comprarCartaCemiterio: ["onRevive"],
  ganharVidaEManaSacrificio: ["onSacrifice"],
  manaCampoVazio: ["onTurnStart"],
  causarDanoExtra: ["onStatusApplied"],
  acumularDanoFogo: ["onSpellCast"],
  curarMagoAgua: ["onSpellCast"],
};
export const legacyFireCounter = "legacy-fire-spells";
const effects: Record<string, (h: LegacyPassive) => PassiveAction[]> = {
  aplicarStatusAtacante: (h) => [
    { id: "status", alvo: "atacante", status: h.status!, duracao: h.duracao! },
  ],
  bonusAtaqueAdjacente: (h) => [
    {
      id: "attackAura",
      valor: h.valor ?? 0,
      filtro: h.elemento ? { elemento: h.elemento } : undefined,
      porVizinho: h.porVizinho,
    },
  ],
  restringirAtaqueBasico: (h) => [
    {
      id: "blockAttack",
      filtro: h.tipoAtacante ? { tipo: h.tipoAtacante } : undefined,
      qualquerDe: [
        ...(h.elemento ? [{ elemento: h.elemento }] : []),
        ...(h.direcao ? [{ direcao: h.direcao }] : []),
      ],
    },
  ],
  ganharVida: (h) => [{ id: "growMaxHp", alvo: "fonte", valor: h.valor ?? 1 }],
  curarMago: (h) => [{ id: "heal", alvo: "magoAliado", valor: h.valor ?? 1 }],
  recuperarMana: (h) => [
    { id: "mana", jogador: "aliado", valor: h.valor ?? 1 },
  ],
  comprarCarta: (h) => [{ id: "draw", jogador: "aliado", valor: h.valor ?? 1 }],
  comprarCartaCemiterio: () => [{ id: "recover", jogador: "aliado", valor: 1 }],
  ganharVidaEManaSacrificio: () => [
    { id: "mana", jogador: "aliado", valor: 2 },
    { id: "heal", alvo: "magoAliado", valor: 2 },
  ],
  manaCampoVazio: (h) => [
    { id: "mana", jogador: "aliado", valor: h.valor ?? 5 },
  ],
  causarDanoExtra: (h) => [
    { id: "damage", alvo: "cartaEvento", valor: h.valor ?? 4 },
  ],
  acumularDanoFogo: () => [
    {
      id: "spellDamageBonus",
      elemento: "Fogo",
      valor: 1,
      contador: legacyFireCounter,
      aCada: 2,
    },
  ],
  curarMagoAgua: () => [
    { id: "heal", alvo: "magoAliado", valor: 3, excedente: 6 },
  ],
};
export function normalizePassive(h: HabilidadePassiva): DeclarativePassive {
  if ("efeitos" in h) return h;
  const rule: DeclarativePassive = {
    gatilho: h.gatilho,
    descricao: h.descricao,
    escopo:
      h.gatilho === "onAttacked"
        ? "proprio"
        : h.gatilho === "onStatusApplied"
          ? "inimigo"
          : "aliado",
    excluirFonte: h.gatilho === "onDeath",
    efeitos: effects[h.efeito]?.(h) ?? [],
  };
  if (h.gatilho === "onDeath") rule.filtroEvento = { tipo: "Tropa" };
  if (h.condicao === "aliadoMorreTerra")
    rule.filtroEvento = { ...rule.filtroEvento, elemento: "Terra" };
  if (h.condicao === "aliadoMorreAr")
    rule.filtroEvento = { ...rule.filtroEvento, elemento: "Ar" };
  if (h.gatilho === "onSpellCast" && h.condicao)
    rule.filtroEvento = { elemento: h.condicao as Instance["elemento"] };
  if (h.gatilho === "onStatusApplied")
    rule.filtroEvento = { status: h.condicao };
  if (h.efeito === "acumularDanoFogo") rule.filtroEvento = { elemento: "Fogo" };
  if (h.efeito === "curarMagoAgua") rule.filtroEvento = { elemento: "Agua" };
  const requiredElement =
    h.efeito === "acumularDanoFogo"
      ? "Fogo"
      : h.efeito === "curarMagoAgua"
        ? "Agua"
        : undefined;
  if (requiredElement && h.condicao && h.condicao !== requiredElement)
    rule.efeitos = [];
  if (h.efeito === "manaCampoVazio")
    rule.condicoes = [{ tipo: "campoVazio", jogador: "aliado" }];
  return rule;
}
export function initializeLegacyCounters(card: Instance) {
  if (
    !card.habilidadesPassivas.some(
      (h) => "efeito" in h && h.efeito === "acumularDanoFogo",
    )
  )
    return;
  const counters = (card.passiveCounters ??= {});
  counters[legacyFireCounter] ??= card.fireSpellsCast ?? 0;
}
export function synchronizeLegacyCounters(card: Instance) {
  if (card.passiveCounters?.[legacyFireCounter] === undefined) return;
  card.fireSpellsCast = card.passiveCounters[legacyFireCounter];
  card.fireDamageBonus = Math.floor(card.fireSpellsCast / 2);
}
