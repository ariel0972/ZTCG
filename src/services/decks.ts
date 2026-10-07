import Deck from "../db/models/decks";
import { Types } from "mongoose";
import { cardReference, validateDeck } from "../domain/deck";
import { getCatalog } from "./catalog";
import { AppError } from "../lib/errors";
import { playableErrors } from "../game/capabilities";
export function deckDTO(raw: Record<string, any>) {
  const invalid: string[] = [];
  const refs = (Array.isArray(raw.cartas) ? raw.cartas : [])
    .map((c: unknown) => {
      try {
        return cardReference(c);
      } catch {
        invalid.push("Carta legada sem referência.");
        return "";
      }
    })
    .filter(Boolean);
  let mage: string | null = null;
  if (raw.mago && raw.mago !== "null") {
    try {
      mage = cardReference(raw.mago);
    } catch {
      invalid.push("Mago legado inválido.");
    }
  }
  return {
    _id: String(raw._id),
    nome: raw.nome,
    cartas: refs,
    mago: mage,
    icone:
      /^\/assets\/icons\/(neutro|agua|ar|fogo|terra|zarcos|tropa|feitiço)\.svg$/.test(
        raw.icone,
      )
        ? raw.icone
        : "/assets/icons/neutro.svg",
    verso: ["common", "zarcos", "water", "air", "fire", "earth"].includes(
      raw.verso,
    )
      ? raw.verso
      : "common",
    publico: raw.publico === true,
    revisao: raw.revisao ?? 0,
    avisosMigracao: invalid,
  };
}
export async function ownedDeck(id: string, userId: string, playing = false) {
  if (!/^[a-f\d]{24}$/i.test(id))
    throw new AppError(422, "ID de deck inválido.");
  // collection evita cast prematuro de objetos do formato legado para String.
  const raw = await Deck.collection.findOne({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(userId),
  });
  if (!raw) throw new AppError(404, "Deck não encontrado.", "NOT_FOUND");
  const deck = deckDTO(raw),
    catalog = await getCatalog();
  const errors = [
    ...deck.avisosMigracao,
    ...validateDeck(deck, catalog, playing),
  ];
  if (playing) {
    const ids = new Set([deck.mago, ...deck.cartas]);
    for (const card of catalog.filter((c) => ids.has(c.numeroCatalogo)))
      errors.push(
        ...playableErrors(card).map((error) => `${card.nome}: ${error}`),
      );
  }
  if (errors.length)
    throw new AppError(
      422,
      "Revise as cartas do deck.",
      "INVALID_DECK",
      errors,
    );
  return { deck, catalog };
}
