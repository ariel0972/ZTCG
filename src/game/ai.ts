import { deploymentCards } from "./deployment";
import { aiCandidates } from "./ai-actions";
import { aiBoardScore, aiStrategy } from "./ai-strategy";
import { randomAiDeck } from "./ai-deck";
import { randomUUID } from "node:crypto";
import { cardSchema, type Card } from "../types/card";
import type { Waiting } from "./store";
import { Game } from "./engine";
export const AI_DELAY_MS = 2500;
const unknownCard = cardSchema.parse({
  numeroCatalogo: "000",
  nome: "Carta desconhecida",
  tipo: "Feitico",
  custoMana: 99,
  alvo: "Global",
  publicado: false,
});
export function aiEntry(
  catalog: Card[],
  now: number,
  options: { mageId?: string } = {},
  random = Math.random,
): Waiting {
  const deck = randomAiDeck(catalog, options.mageId, random);
  return {
    id: randomUUID().replace(/-/g, "").slice(0, 24),
    nome: "IA · Guardião de treino",
    bot: true,
    deckId: "ai",
    deck,
    catalog,
    ...(options.mageId ? { aiMageId: options.mageId } : {}),
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
    const best = [...enemy.hand].sort(
      (a, b) =>
        (b.hp ?? 0) +
        (b.ataque ?? 0) * 2 +
        b.custoMana -
        ((a.hp ?? 0) + (a.ataque ?? 0) * 2 + a.custoMana),
    )[0];
    return { type: "chooseHand", cardId: best?.id };
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
      cardId: deploymentCards(s, choice).sort(
        (a, b) =>
          (b.hp ?? 0) +
          (b.ataque ?? 0) * 2 -
          ((a.hp ?? 0) + (a.ataque ?? 0) * 2),
      )[0]?.id,
      destinationId: [...(view.reviveDestinations ?? [])].sort((a, b) => {
        const power = (id: string) => {
          const sl = s.slots.find((s) => s.id === id)!;
          return (
            (sl.card?.ataque ?? 0) +
            (sl.card ? (sl.card.hp ?? 0) - sl.card.hpAtual : 0) +
            (sl.column === 0 || sl.column === 2 ? 1 : 0)
          );
        };
        return power(b) - power(a);
      })[0],
    };
  }
  if (s.phase === "COIN_TOSS") return { type: "chooseCoin", face: "heads" };
  if (s.phase === "PREPARATION" && player.preparation.bonusDraws)
    return { type: "preparationBonus", accept: false };
  const candidates = aiCandidates(game, bot),
    strategy = aiStrategy(game, bot);
  const publicGame = Game.restore(game.exportState(), () => 0.5);
  for (const enemy of publicGame.state.players.filter((p) => p.id !== bot)) {
    enemy.hand = [];
    enemy.deck = enemy.deck.map((c) => ({
      ...unknownCard,
      id: c.id,
      ownerId: enemy.id,
      hpAtual: 0,
      attacked: false,
      usedAbility: false,
      statuses: [],
    }));
  }
  const before = aiBoardScore(publicGame, bot, strategy);
  const ranked: {
    command: Record<string, unknown>;
    score: number;
    trial: Game;
  }[] = [];
  for (const command of candidates) {
    try {
      const trial = Game.restore(publicGame.exportState(), () => 0.5);
      const concealed =
        command.type === "attack" &&
        s.slots.find((sl) => sl.id === command.targetId)?.card?.concealedTrap;
      let score = 1;
      if (!concealed) {
        trial.execute(bot, {
          ...command,
          version: trial.state.version,
          actionId: randomUUID(),
        });
        // Forecast the public effect, without assuming the opponent will decline a dodge.
        for (let i = 0; i < 6 && trial.state.pendingImpact; i++)
          trial.execute(trial.state.pendingImpact.request.ownerId, {
            type: "respondDodge",
            dodge: true,
            version: trial.state.version,
            actionId: randomUUID(),
          });
        score = aiBoardScore(trial, bot, strategy) - before;
        if (trial.state.status === "FINISHED")
          score = trial.state.winner === bot ? 1000000 : -1000000;
        if (trial.state.pendingHandChoice?.ownerId === bot)
          score +=
            (view.players.find((p) => p.id !== bot)?.handCount ?? 0) > 0
              ? 2
              : 0;
      }
      ranked.push({ command, score, trial });
    } catch {
      /* The engine validates all costs, targets, opening restrictions and status. */
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  let best: Record<string, unknown> | null = null,
    bestScore = 0.05;
  for (const candidate of ranked.slice(0, 8)) {
    let score = candidate.score;
    if (
      score < 100000 &&
      !candidate.trial.responseKey() &&
      aiNeedsAction(candidate.trial, bot)
    ) {
      let follow = 0;
      // A bounded second step finds equip/buff/movement or removal followed by damage.
      for (const next of aiCandidates(candidate.trial, bot).slice(0, 24)) {
        try {
          const trial = Game.restore(candidate.trial.exportState(), () => 0.5);
          trial.execute(bot, {
            ...next,
            version: trial.state.version,
            actionId: randomUUID(),
          });
          const gain =
            trial.state.status === "FINISHED" && trial.state.winner === bot
              ? 100000
              : aiBoardScore(trial, bot, strategy) -
                aiBoardScore(candidate.trial, bot, strategy);
          follow = Math.max(follow, gain);
        } catch {
          /* Invalid follow-ups are ignored. */
        }
      }
      score += follow * 0.7;
    }
    if (score > bestScore) {
      best = candidate.command;
      bestScore = score;
    }
  }
  return best ?? { type: "endTurn" };
}
