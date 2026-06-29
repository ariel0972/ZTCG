// src/types/card.ts

export type CardType = 'Tropa' | 'Feitiço' | 'Mago' | 'Estrutura' | 'Armamento';

export interface Card {
  id: string;
  name: string;
  type: CardType;
  attack: number;
  defense: number;
  cost: number;
  effects: string[];
  imageUrl?: string; // o "?" significa que é opcional
}

export interface Deck {
  id: string;
  name: string;
  ownerId: string;
  cards: Card[];
  wizardCard?: Card; // o Mago principal do deck
  createdAt: Date;
}