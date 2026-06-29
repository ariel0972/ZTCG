import mongoose, { Schema, Document, Model, Types } from 'mongoose'

export interface IDeck extends Document {
  nome: string
  cartas: object[]
  mago: object
  icone: string
  userId: Types.ObjectId  // referência ao User — tipado corretamente
}

const deckSchema = new Schema<IDeck>({
  nome:   { type: String, required: true },
  cartas: { type: [Object] },
  mago:   { type: Object, required: true },
  icone:  { type: String, default: '' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' }
})

const Deck: Model<IDeck> = mongoose.model<IDeck>('Deck', deckSchema)

export default Deck