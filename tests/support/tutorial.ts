import { randomUUID } from "node:crypto";
import {
  tutorialLessons,
  tutorialExpected,
  type TutorialProgress,
} from "../../src/game/tutorial";
import { Game } from "../../src/game/engine";
export function nextTutorialAction(
  p: TutorialProgress,
  face: "heads" | "tails" = "heads",
  column = 0,
) {
  const lesson = tutorialLessons[p.step],
    expected = tutorialExpected(p),
    g = p.game && Game.restore(p.game);
  return {
    type: lesson.action,
    version: p.version,
    actionId: randomUUID(),
    ...(lesson.action === "inspect" ? { cardId: expected.cardId } : {}),
    ...(lesson.action === "chooseCoin" ? { face } : {}),
    ...(lesson.action === "play"
      ? {
          cardId: expected.cardId,
          ...(lesson.id === "spell"
            ? {
                targets: [
                  g!.state.slots.find((s) => s.id === expected.targetSlotId)!
                    .card!.id,
                ],
              }
            : {
                slotId: g!.state.slots.find(
                  (s) =>
                    s.ownerId === p._id &&
                    s.kind === "Tropa" &&
                    !s.card &&
                    (lesson.id === "preparation"
                      ? s.column === column
                      : expected.destinations?.includes(s.id)),
                )!.id,
              }),
        }
      : {}),
    ...(lesson.action === "ability"
      ? { slotId: expected.sourceSlotId, abilityId: expected.abilityId }
      : {}),
    ...(lesson.action === "attack"
      ? { slotId: expected.sourceSlotId, targetId: expected.targetSlotId }
      : {}),
  };
}
