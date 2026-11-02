import { equipmentAllowed } from "./equipment";
import type { Card } from "../types/card";
import type { DeckDefinition } from "./state";
import { AppError } from "../lib/errors";
import { playableErrors } from "./capabilities";
import { deckRules } from "../domain/deck";
import { entryCost } from "./entry-cost";
export function randomAiDeck(
  catalog: Card[],
  mageId?: string,
  random = Math.random,
): DeckDefinition {
  const available = catalog.filter(
    (c) => c.publicado && !playableErrors(c).length,
  );
  const mages = available.filter((c) => c.tipo === "Mago");
  const mage = mageId
    ? mages.find((c) => c.numeroCatalogo === mageId)
    : mages[Math.floor(random() * mages.length)];
  if (!mage)
    throw new AppError(422, "Escolha um mago publicado para o treino.");
  const pool = available.filter(
    (c) =>
      c.tipo !== "Mago" &&
      (!c.requerElementoMago || c.requerElementoMago === mage.elemento),
  );
  const usable = pool.filter((c) => {
    const cost = entryCost(c);
    return (
      !cost ||
      pool.some(
        (other) =>
          other.numeroCatalogo !== c.numeroCatalogo &&
          cost.tiposCarta.includes(other.tipo as any) &&
          (!cost.mesmoElemento ||
            (other.elemento ?? "Neutro") === (c.elemento ?? "Neutro")) &&
          (!cost.elementos ||
            cost.elementos.includes(other.elemento ?? "Neutro")),
      )
    );
  });
  const counts = new Map<string, number>(),
    cards: string[] = [];
  const weight = (c: Card) =>
    1 +
    ((c.elemento ?? "Neutro") === mage.elemento ? 1.5 : 0) +
    (c.custoMana <= 4 ? 0.5 : 0);
  const draw = (choices: Card[], amount: number) => {
    for (let i = 0; i < amount; i++) {
      const candidates = choices.filter((c) => {
        if ((counts.get(c.numeroCatalogo) ?? 0) >= deckRules.copias[c.tipo])
          return false;
        const cost = entryCost(c);
        return (
          !cost ||
          cards.filter((id) => {
            const other = pool.find((p) => p.numeroCatalogo === id)!;
            return (
              cost.tiposCarta.includes(other.tipo as any) &&
              (!cost.mesmoElemento ||
                (other.elemento ?? "Neutro") === (c.elemento ?? "Neutro")) &&
              (!cost.elementos ||
                cost.elementos.includes(other.elemento ?? "Neutro"))
            );
          }).length >= cost.quantidade
        );
      });
      if (!candidates.length) break;
      let pick = random() * candidates.reduce((n, c) => n + weight(c), 0);
      const selected =
        candidates.find((c) => (pick -= weight(c)) < 0) ??
        candidates[candidates.length - 1];
      cards.push(selected.numeroCatalogo);
      counts.set(
        selected.numeroCatalogo,
        (counts.get(selected.numeroCatalogo) ?? 0) + 1,
      );
    }
  };
  draw(
    usable.filter((c) => c.tipo === "Tropa" && !entryCost(c)),
    20,
  );
  draw(
    usable.filter((c) => c.tipo === "Tropa" && !!entryCost(c)),
    2,
  );
  draw(
    usable.filter(
      (c) =>
        c.tipo === "Armamento" &&
        [
          mage,
          ...cards.map((id) => pool.find((p) => p.numeroCatalogo === id)!),
        ].some((receiver) => equipmentAllowed(c, receiver)),
    ),
    5,
  );
  draw(
    usable.filter((c) => c.tipo === "Estrutura"),
    3,
  );
  draw(
    usable.filter((c) => c.tipo === "Feitico"),
    10,
  );
  draw(
    usable.filter((c) => c.tipo === "Tropa"),
    Math.max(0, 40 - cards.length),
  );
  draw(usable, Math.max(0, 40 - cards.length));
  if (cards.length !== 40)
    throw new AppError(
      503,
      "Não há cartas publicadas suficientes para sortear um baralho de treino.",
    );
  return {
    nome: "Baralho aleatório · " + mage.nome,
    mago: mage.numeroCatalogo,
    cartas: cards,
  };
}
