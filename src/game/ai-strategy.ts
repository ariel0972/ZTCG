import { Game } from "./engine";
import { currentBasicAttack } from "./passives";
import { slotCards } from "./state";
export type AiStrategy = "finish" | "survive" | "develop" | "pressure";
export function aiStrategy(game: Game, bot: string): AiStrategy {
  const me = game.player(bot),
    foe = game.state.players.find((p) => p.id !== bot)!;
  if (
    foe.mage.hpAtual <=
    Math.max(6, me.hand.filter((c) => c.tipo === "Feitico").length * 2)
  )
    return "finish";
  const threats = game.state.slots
    .filter((s) => s.ownerId === foe.id)
    .flatMap(slotCards)
    .filter((c) => c.tipo === "Tropa" && !c.concealedTrap)
    .reduce((n, c) => n + currentBasicAttack(c, game.state.slots), 0);
  if (me.mage.hpAtual <= Math.max((me.mage.hp ?? 20) * 0.35, threats * 0.6))
    return "survive";
  if (
    game.state.slots.filter(
      (s) => s.ownerId === bot && s.kind === "Tropa" && s.card,
    ).length < 2 &&
    me.hand.some((c) => c.tipo === "Tropa")
  )
    return "develop";
  return "pressure";
}
export function aiBoardScore(g: Game, bot: string, strategy: AiStrategy) {
  const me = g.player(bot),
    foe = g.state.players.find((p) => p.id !== bot)!;
  const power = (owner: string) =>
    g.state.slots
      .filter((s) => s.ownerId === owner)
      .flatMap(slotCards)
      .filter((c) => c.tipo !== "Mago" && !c.concealedTrap)
      .reduce((n, c) => {
        const attack = currentBasicAttack(c, g.state.slots),
          blocked = c.statuses.some(
            (s) =>
              s.turnosRestantes > 0 &&
              ["Congelado", "Cego", "Atordoado", "Incapacitado"].includes(
                s.nome,
              ),
          );
        const buffs = c.statuses
          .filter((s) => s.turnosRestantes > 0)
          .reduce(
            (v, s) =>
              v +
              (["EscudoProtecao", "ReducaoAtaqueTropa", "Interceptar"].includes(
                s.nome,
              )
                ? (s.valor ?? 1) * 0.5
                : 0) -
              ([
                "Sangrando",
                "Envenenado",
                "Queimado",
                "Peste Negra",
                "Leptospirose",
              ].includes(s.nome)
                ? Math.min(c.hpAtual, (s.valor ?? 1) * 2) * 0.35
                : 0),
            0,
          );
        return (
          n +
          Math.max(0, c.hpAtual) * 0.28 +
          attack * (blocked ? 0.15 : 0.85) +
          buffs +
          (c.tipo === "Armamento" ? 1 : 0)
        );
      }, 0);
  const manaBonus = (g.state.attachments ?? [])
    .filter((a) => a.ownerId === bot)
    .reduce((n, a) => n + a.manaBonus, 0);
  const ongoing = (g.state.ongoingSpells ?? []).reduce(
    (n, s) =>
      n +
      (s.ownerId === bot ? 1 : -1) *
        s.damage *
        Math.min(2, s.rounds) *
        (s.target === "TodasTropasInimigas" ? 1 : 2),
    0,
  );
  const boost = me.mage.statuses
    .filter((s) => s.turnosRestantes > 0 && s.spellBoost)
    .reduce(
      (n, s) =>
        n +
        s.spellBoost!.bonus *
          me.hand.filter(
            (c) =>
              c.tipo === "Feitico" &&
              ["Zarcos", "Neutro"].includes(c.elemento ?? "Neutro"),
          ).length *
          0.7,
      0,
    );
  const futureHealing = g.state.slots
    .filter((s) => s.ownerId === bot)
    .flatMap(slotCards)
    .reduce(
      (n, c) =>
        n +
        (c.scheduledHeals ?? []).reduce(
          (v, h) =>
            v +
            Math.min(h.amount, Math.max(0, (c.hp ?? 0) - c.hpAtual)) *
              (c.tipo === "Mago" && strategy === "survive" ? 4 : 0.3),
          0,
        ),
      0,
    );
  return (
    me.mage.hpAtual * (strategy === "survive" ? 14 : 2.5) -
    foe.mage.hpAtual * (strategy === "finish" ? 12 : 8) +
    power(bot) -
    power(foe.id) * (strategy === "survive" ? 1.8 : 1) +
    me.mana * 0.1 +
    me.hand.length *
      (g.state.phase === "PREPARATION" ? 0.1 : me.hand.length < 3 ? 2 : 1) +
    manaBonus * (me.mana < 12 ? 1.5 : 0.3) +
    ongoing +
    boost +
    futureHealing
  );
}
