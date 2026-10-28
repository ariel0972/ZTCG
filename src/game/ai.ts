import { randomUUID } from "node:crypto";
import type { Card } from "../types/card";
import type { Waiting } from "./store";
import { AppError } from "../lib/errors";
import { Game } from "./engine";
import { entryCost } from "./entry-cost";
import { slotCards } from "./state";
export const AI_DELAY_MS = 900;
export function aiEntry(catalog: Card[], now: number): Waiting {
  const mage =
    catalog.find((c) => c.numeroCatalogo === "016" && c.publicado) ??
    catalog.find((c) => c.tipo === "Mago" && c.publicado);
  const troops = catalog
    .filter((c) => c.tipo === "Tropa" && c.publicado && !entryCost(c))
    .slice(0, 9);
  const spells = ["001", "002", "003", "008", "009", "057"].flatMap((id) =>
    catalog.filter(
      (c) =>
        c.numeroCatalogo === id &&
        c.publicado &&
        !entryCost(c) &&
        (!c.requerElementoMago || c.requerElementoMago === mage?.elemento),
    ),
  );
  const cartas = [...troops, ...spells]
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  if (!mage || cartas.length !== 40)
    throw new AppError(
      503,
      "O baralho da IA está indisponível neste catálogo.",
    );
  return {
    id: randomUUID().replace(/-/g, "").slice(0, 24),
    nome: "IA · Guardião de treino",
    bot: true,
    deckId: "ai",
    deck: { nome: "Guardião de treino", mago: mage.numeroCatalogo, cartas },
    catalog: catalog.filter(
      (c) =>
        c.numeroCatalogo === mage.numeroCatalogo ||
        cartas.includes(c.numeroCatalogo),
    ),
    catalogHash: "ai",
    joinedAt: now,
  };
}
export function aiNeedsAction(game: Game, bot: string) {
  const s = game.state;
  if (s.status !== "ACTIVE") return false;
  if (s.pendingImpact) return s.pendingImpact.request.ownerId === bot;
  if (s.pendingHandChoice) return s.pendingHandChoice.ownerId === bot;
  if (s.pendingSpell) return s.pendingSpell.casterId !== bot;
  if (s.pendingAttack) return s.pendingAttack.attackerOwnerId !== bot;
  if (s.pendingRevives?.length) return s.pendingRevives[0].ownerId === bot;
  if (s.phase === "PREPARATION") return !game.player(bot).preparation.ready;
  if (s.phase === "COIN_TOSS")
    return !s.coinToss?.result && s.coinToss?.chooserId === bot;
  return s.current === bot;
}
function boardScore(g: Game, bot: string) {
  const foe = g.state.players.find((p) => p.id !== bot)!;
  const power = (owner: string) =>
    g.state.slots
      .filter((s) => s.ownerId === owner)
      .flatMap(slotCards)
      .filter((c) => c.tipo !== "Mago" && c.hpAtual > 0)
      .reduce(
        (n, c) =>
          n +
          c.hpAtual * 0.24 +
          (c.ataque ?? 0) * 0.9 +
          c.statuses
            .filter((s) => s.nome === "BonusAtaque" && s.turnosRestantes > 0)
            .reduce((n, s) => n + (s.valor ?? 0) * 0.8, 0),
        0,
      );
  return (
    (g.player(bot).mage.hpAtual - foe.mage.hpAtual) * 2 +
    power(bot) -
    power(foe.id) +
    g.player(bot).mana * 0.05
  );
}
export function chooseAiCommand(
  game: Game,
  bot: string,
): Record<string, unknown> | null {
  if (!aiNeedsAction(game, bot)) return null;
  const s = game.state,
    view = game.snapshot(bot),
    player = game.player(bot);
  if (s.pendingImpact)
    return {
      type: "respondDodge",
      dodge: true,
      choiceKey: s.pendingImpact.request.key,
    };
  if (s.pendingHandChoice) {
    const enemy = s.players.find((p) => p.id !== bot)!;
    return { type: "chooseHand", cardId: enemy.hand[0]?.id };
  }
  if (s.pendingSpell)
    return {
      type: "respondSpell",
      ...(view.responseCards?.[0] ? { cardId: view.responseCards[0] } : {}),
    };
  if (s.pendingAttack) return { type: "respondAttack", reflect: true };
  if (s.pendingRevives?.length) {
    const choice = s.pendingRevives[0];
    return {
      type: "chooseRevive",
      cardId: choice.cards[0],
      destinationId: view.reviveDestinations?.[0],
    };
  }
  if (s.phase === "COIN_TOSS") return { type: "chooseCoin", face: "heads" };
  if (s.phase === "PREPARATION" && player.preparation.bonusDraws)
    return { type: "preparationBonus", accept: false };
  const candidates: Record<string, unknown>[] = [];
  const front = view.slots.filter(
    (sl) =>
      sl.ownerId === bot && sl.kind === "Tropa" && !sl.card && !sl.terrain,
  );
  for (const card of player.hand) {
    if (card.tipo === "Tropa" && !entryCost(card))
      for (const slot of front)
        candidates.push({
          type: "play",
          cardId: card.id,
          slotId: slot.id,
          targets: [],
        });
    if (s.phase !== "BATTLE" || card.tipo !== "Feitico") continue;
    if (
      [
        "Global",
        "TodosInimigos",
        "TodasTropasInimigas",
        "TodosAliados",
      ].includes(card.alvo ?? "")
    )
      candidates.push({ type: "play", cardId: card.id, targets: [] });
    else if (
      ["UnicoInimigo", "UnicoAliado", "MultiplosInimigos"].includes(
        card.alvo ?? "",
      )
    )
      for (const slot of view.slots.filter((sl) =>
        ["UnicoInimigo", "MultiplosInimigos"].includes(card.alvo!)
          ? sl.ownerId !== bot
          : sl.ownerId === bot,
      ))
        if (slot.card && !("oculta" in slot.card && slot.card.oculta))
          candidates.push({
            type: "play",
            cardId: card.id,
            targets: [slot.card.id],
          });
  }
  if (s.phase === "BATTLE")
    for (const slot of view.slots.filter((sl) => sl.ownerId === bot))
      for (const source of ["card", "rider", "structure"] as const) {
        const card = slot[source];
        if (!card || !("habilidadesAtivas" in card)) continue;
        for (const targetId of (slot.attackTargets?.[source] ?? []).filter(
          (id) => view.slots.some((target) => target.id === id && target.card),
        ))
          candidates.push({
            type: "attack",
            slotId: slot.id,
            targetId,
            source,
          });
        for (const ability of card.habilidadesAtivas) {
          const base = {
            type: "ability",
            slotId: slot.id,
            source,
            abilityId: ability.id,
          };
          if (
            !ability.alvo ||
            ability.alvoAutomatico ||
            [
              "Global",
              "TodosInimigos",
              "TodasTropasInimigas",
              "TodosAliados",
            ].includes(ability.alvo)
          )
            candidates.push({ ...base, targets: [] });
          else if (["UnicoInimigo", "UnicoAliado"].includes(ability.alvo))
            for (const target of view.slots.filter((sl) =>
              ability.alvo === "UnicoAliado"
                ? sl.ownerId === bot
                : sl.ownerId !== bot,
            ))
              if (
                target.card &&
                !("oculta" in target.card && target.card.oculta)
              )
                candidates.push({ ...base, targets: [target.card.id] });
        }
      }
  let best: Record<string, unknown> | null = null,
    bestScore = 0.05;
  const before = boardScore(game, bot);
  for (const command of candidates.slice(0, 90)) {
    try {
      const trial = Game.restore(game.exportState());
      // Planning uses public board information, never the opponent's hidden hand.
      for (const enemy of trial.state.players.filter((p) => p.id !== bot))
        enemy.hand = [];
      const concealed =
        command.type === "attack" &&
        s.slots.find((sl) => sl.id === command.targetId)?.card?.concealedTrap;
      let score: number;
      if (concealed) score = 2;
      else {
        trial.execute(bot, {
          ...command,
          version: trial.state.version,
          actionId: randomUUID(),
        });
        score = boardScore(trial, bot) - before;
        if (trial.state.status === "FINISHED")
          score = trial.state.winner === bot ? 10000 : -10000;
        if (trial.responseKey()) score += 0.5;
      }
      if (score > bestScore) {
        best = command;
        bestScore = score;
      }
    } catch {
      /* Illegal candidates never alter the real match. */
    }
  }
  return best ?? { type: "endTurn" };
}
