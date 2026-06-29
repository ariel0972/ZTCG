// src/db/models/Card.ts
import { Schema, model, Document } from 'mongoose';
import { CardType } from '../../types/card';

// "Document" adiciona os campos que o Mongoose injeta (_id, __v, etc.)
export interface ICard extends Document {
  name: string;
  type: CardType;
  attack: number;
  defense: number;
  cost: number;
  effects: string[];
  imageUrl?: string;
}

const CardSchema = new Schema<ICard>({
  name:     { type: String, required: true },
  type:     { type: String, enum: ['Tropa', 'Feitiço', 'Mago', 'Estrutura', 'Armamento'], required: true },
  attack:   { type: Number, required: true },
  defense:  { type: Number, required: true },
  cost:     { type: Number, required: true },
  effects:  [{ type: String }],
  imageUrl: { type: String }
});

export default model<ICard>('Card', CardSchema);