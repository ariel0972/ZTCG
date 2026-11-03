import { deploymentCards } from "./deployment";
import { aiCandidates } from "./ai-actions";
import { aiBoardScore, aiStrategy } from "./ai-strategy";
import { currentBasicAttack } from "./passives";
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
// Evaluate optional public reflections both ways, without inspecting hidden cards.
function projectedResponses(game: Game): Game[] {
  const branches = [game];
  for (let n = 0; n < 12; n++) {
    const index = branches.findIndex(
      (g) =>
        g.state.status === "ACTIVE" &&
        (g.state.pendingImpact || g.state.pendingAttack),
    );
    if (index < 0) break;
    const trial = branches[index],
      impact = trial.state.pendingImpact;
    if (impact) {
      trial.execute(impact.request.ownerId, {
        type: "respondDodge",
        dodge: true,
        version: trial.state.version,
        actionId: randomUUID(),
      });
      continue;
    }
    const pending = trial.state.pendingAttack!,
      owner = trial.state.players.find(
        (p) => p.id !== pending.attackerOwnerId,
      )!.id;
    const choices = branches.length < 4 ? [true, false] : [true];
    branches.splice(
      index,
      1,
      ...choices.map((reflect) => {
        const next = Game.restore(trial.exportState(), () => 0.5);
        next.execute(owner, {
          type: "respondAttack",
          reflect,
          version: next.state.version,
          actionId: randomUUID(),
        });
        return next;
      }),
    );
  }
  return branches;
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
  const terminal = (g: Game, reward: number) =>
    g.state.status === "FINISHED"
      ? g.state.winner === bot
        ? reward
        : -1000000
      : undefined;
  const scoreBranch = (g: Game) =>
    (terminal(g, 1000000) ?? aiBoardScore(g, bot, strategy) - before) +
    (g.state.pendingHandChoice?.ownerId === bot &&
    (view.players.find((p) => p.id !== bot)?.handCount ?? 0) > 0
      ? 2
      : 0);
  const ranked: {
    command: Record<string, unknown>;
    score: number;
    trials: Game[];
    concealed: boolean;
  }[] = [];
  for (const command of candidates) {
    try {
      const trial = Game.restore(publicGame.exportState(), () => 0.5);
      const concealed = !!(
        command.type === "attack" &&
        s.slots.find((sl) => sl.id === command.targetId)?.card?.concealedTrap
      );
      let trials = [trial],
        score = 1;
      if (!concealed) {
        trial.execute(bot, {
          ...command,
          version: trial.state.version,
          actionId: randomUUID(),
        });
        trials = projectedResponses(trial);
        score = Math.min(...trials.map(scoreBranch));
        if (trials.every((g) => terminal(g, 1000000) === 1000000))
          return command;
      }
      ranked.push({ command, score, trials, concealed });
    } catch {
      /* The engine validates all costs, targets, opening restrictions and status. */
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const attackPower = (command: Record<string, unknown>) => {
    const slot = s.slots.find((sl) => sl.id === command.slotId),
      card =
        command.source === "rider"
          ? slot?.rider
          : command.source === "structure"
            ? slot?.structure
            : slot?.card;
    return card ? currentBasicAttack(card, s.slots) : 0;
  };
  const mageAttacks = ranked
    .filter(
      (c) =>
        c.command.type === "attack" &&
        s.slots.some(
          (sl) => sl.id === c.command.targetId && sl.kind === "Mago",
        ),
    )
    .sort((a, b) => attackPower(b.command) - attackPower(a.command))
    .slice(0, 4);
  const frontier = [...new Set([...ranked.slice(0, 8), ...mageAttacks])];
  let best: Record<string, unknown> | null = null,
    bestScore = 0.05;
  for (const candidate of frontier) {
    const score = candidate.concealed
      ? candidate.score
      : Math.min(
          ...candidate.trials.map((branch) => {
            let result = scoreBranch(branch);
            if (
              result < 100000 &&
              !branch.responseKey() &&
              aiNeedsAction(branch, bot)
            ) {
              let follow = 0;
              for (const next of aiCandidates(branch, bot).slice(0, 24)) {
                try {
                  const trial = Game.restore(branch.exportState(), () => 0.5);
                  trial.execute(bot, {
                    ...next,
                    version: trial.state.version,
                    actionId: randomUUID(),
                  });
                  const gain = Math.min(
                    ...projectedResponses(trial).map(
                      (g) =>
                        terminal(g, 100000) ??
                        aiBoardScore(g, bot, strategy) -
                          aiBoardScore(branch, bot, strategy),
                    ),
                  );
                  follow = Math.max(follow, gain);
                } catch {
                  /* Invalid follow-ups are ignored. */
                }
              }
              result += follow * 0.7;
            }
            return result;
          }),
        );
    if (score > bestScore) {
      best = candidate.command;
      bestScore = score;
    }
  }

  return best ?? { type: "endTurn" };
}
