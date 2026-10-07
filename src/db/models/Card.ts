import { Schema, model } from "mongoose";
import { Card, cardTypes, elements, targets, triggers } from "../../types/card";
const n = { type: Number, min: 0, max: 1000 };
const effect = new Schema(
  {
    id: { type: String, required: true },
    valor: n,
    status: String,
    duracao: n,
    elemento: { type: String, enum: elements },
  },
  { _id: false, strict: "throw" },
);
const active = new Schema(
  {
    id: { type: String, required: true },
    nome: { type: String, required: true },
    descricao: { type: String, maxlength: 2000 },
    custoMana: { ...n, required: true },
    alvo: { type: String, enum: targets },
    efeitos: [effect],
  },
  { _id: false, strict: "throw" },
);
const passive = new Schema(
  {
    gatilho: { type: String, enum: triggers, required: true },
    efeito: { type: String, required: true },
    valor: n,
    condicao: String,
    elemento: { type: String, enum: elements },
    direcao: { type: String, enum: ["Frente", "Diagonal", "Universal"] },
    tipoAtacante: { type: String, enum: cardTypes },
    status: String,
    duracao: n,
    porVizinho: Boolean,
    descricao: { type: String, maxlength: 2000 },
  },
  { _id: false, strict: "throw" },
);
const limits = new Schema(
  {
    tropasMobilizadas: n,
    tropaAtacam: n,
    feiticosUsados: n,
    feiticosUnicos: n,
  },
  { _id: false, strict: "throw" },
);
const schema = new Schema<Card>(
  {
    numeroCatalogo: { type: String, required: true, unique: true },
    nome: { type: String, required: true, trim: true },
    tipo: { type: String, enum: cardTypes, required: true },
    custoMana: { ...n, required: true },
    assinatura: { type: Boolean, default: false },
    elemento: { type: String, enum: elements },
    descricao: String,
    imgURL: String,
    hp: n,
    ataque: n,
    manaGerada: n,
    recuperacaoMana: n,
    bonusAtaque: n,
    bonusHp: n,
    subtipo: String,
    direcaoAtaque: { type: String, enum: ["Frente", "Diagonal", "Universal"] },
    alvo: { type: String, enum: targets },
    maxAlvos: { type: Number, min: 1, max: 3, default: 1 },
    efeitos: [effect],
    habilidadesAtivas: [active],
    habilidadesPassivas: [passive],
    palavrasChave: [String],
    fraqueza: [String],
    resistencia: [String],
    limites: [limits],
    publicado: { type: Boolean, default: false },
    versao: { type: Number, default: 1 },
  },
  { timestamps: true, strict: "throw" },
);
export default model<Card>("Card", schema);
