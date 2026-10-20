import { Schema, model } from "mongoose";
import { Card, cardTypes, elements, targets, triggers } from "../../types/card";
const n = { type: Number, min: 0, max: 1000 };
const spellVariantStatus = new Schema(
  {
    id: { type: String, enum: ["status"], required: true },
    alvo: {
      type: String,
      enum: ["TodosInimigos", "TodasTropasInimigas"],
      required: true,
    },
    status: { type: String, required: true },
    duracao: { ...n, min: 1, required: true },
    valor: n,
    unidade: { type: String, enum: ["turno", "rodada"] },
  },
  { _id: false, strict: "throw" },
);
const spellVariant = new Schema(
  {
    elemento: { type: String, enum: elements, required: true },
    bonusDano: n,
    causaDano: Boolean,
    duracao: { ...n, min: 1 },
    status: String,
    efeitos: { type: [spellVariantStatus], default: undefined },
  },
  { _id: false, strict: "throw" },
);
const effect = new Schema(
  {
    id: { type: String, required: true },
    alvo: { type: String, enum: ["Proprio"] },
    valor: n,
    status: String,
    duracao: n,
    elemento: { type: String, enum: elements },
    unidade: { type: String, enum: ["turno", "rodada"] },
    carta: String,
    seNaoUsada: String,
    requerStatus: String,
    inicio: { type: String, enum: ["proximaRodada"] },
    valorEstrutura: n,
    bonusAtaque: n,
    bonusHp: n,
    recompensaMorteRodada: {
      type: new Schema(
        { mana: { ...n, max: 20, required: true } },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    perfurante: Boolean,
    reacoesElemento: {
      type: [
        new Schema(
          {
            elemento: { type: String, enum: elements, required: true },
            multiplicador: { type: Number, min: 0, max: 10 },
            remover: Boolean,
          },
          { _id: false, strict: "throw" },
        ),
      ],
      default: undefined,
    },
    curaPosterior: {
      type: new Schema(
        {
          multiplicador: { type: Number, min: 1, max: 10, required: true },
          rodadas: { type: Number, min: 1, max: 10, required: true },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    recompensaAoEliminar: {
      type: new Schema(
        {
          mana: { ...n, max: 20, required: true },
          tipo: { type: String, enum: cardTypes },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    direcao: { type: String, enum: ["direita", "vizinho"] },
    borda: { type: String, enum: ["mao", "manter"] },
    estrutura: { type: String, enum: ["impedirUso", "manter"] },
    filtroAlvo: {
      type: new Schema(
        {
          tipo: { type: String, enum: cardTypes },
          elemento: { type: String, enum: elements },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    variantesMago: { type: [spellVariant], default: undefined },
  },
  { _id: false, strict: "throw" },
);
const active = new Schema(
  {
    id: { type: String, required: true },
    nome: { type: String, required: true },
    descricao: { type: String, maxlength: 2000 },
    custoMana: { ...n, required: true },
    custoVida: { ...n, min: 1 },
    esperaRodadas: { type: Number, min: 0, max: 100 },
    alvo: { type: String, enum: targets },
    alvoAutomatico: { type: String, enum: ["Proprio", "Frontal"] },
    maxAlvos: { type: Number, min: 1, max: 20 },
    filtroAlvo: {
      type: new Schema(
        {
          numeroCatalogo: String,
          tipo: { type: String, enum: cardTypes },
          elemento: { type: String, enum: elements },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    efeitos: [effect],
  },
  { _id: false, strict: "throw" },
);
const passiveFilter = new Schema(
  {
    numeroCatalogo: String,
    tipo: { type: String, enum: cardTypes },
    elemento: { type: String, enum: elements },
    direcao: { type: String, enum: ["Frente", "Diagonal", "Universal"] },
    status: String,
  },
  { _id: false, strict: "throw" },
);
const passiveCondition = new Schema(
  {
    tipo: {
      type: String,
      enum: ["campoVazio", "vidaPercentual", "cartaEmCampo"],
    },
    filtro: { type: passiveFilter, default: undefined },
    presente: Boolean,
    jogador: { type: String, enum: ["aliado", "inimigo"] },
    alvo: { type: String, enum: ["fonte", "cartaEvento", "alvoAtaque"] },
    percentual: n,
    comparacao: { type: String, enum: ["menor", "menorOuIgual"] },
  },
  { _id: false, strict: "throw" },
);
const passiveAction = new Schema(
  {
    id: { type: String, required: true },
    alvo: String,
    valor: n,
    jogador: { type: String, enum: ["aliado", "inimigo"] },
    elemento: { type: String, enum: elements },
    status: String,
    duracao: n,
    excedente: n,
    contador: String,
    aCada: n,
    fonteRecebe: Boolean,
    porVizinho: Boolean,
    carta: String,
    destino: String,
    filtro: { type: passiveFilter, default: undefined },
    qualquerDe: { type: [passiveFilter], default: undefined },
    acumulavel: Boolean,
    colunaAtacante: { type: Number, min: 0, max: 2 },
    esperaRodadas: { type: Number, min: 0, max: 100 },
  },
  { _id: false, strict: "throw" },
);
const passive = new Schema(
  {
    gatilho: { type: String, enum: triggers, required: true },
    efeito: String,
    escopo: {
      type: String,
      enum: ["proprio", "aliado", "inimigo", "qualquer"],
    },
    excluirFonte: Boolean,
    reacao: {
      type: new Schema(
        {
          nome: { type: String, required: true },
          quando: {
            type: String,
            enum: ["provoca", "recebe", "provocaOuRecebe"],
            required: true,
          },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    filtroEvento: { type: passiveFilter, default: undefined },
    filtroAlvo: {
      type: new Schema(
        {
          tipo: { type: String, enum: cardTypes },
          elemento: { type: String, enum: elements },
          relacao: { type: String, enum: ["aliado", "inimigo"] },
        },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    condicoes: { type: [passiveCondition], default: undefined },
    efeitos: { type: [passiveAction], default: undefined },
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
    requerElementoMago: { type: String, enum: elements },
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
    alvoAutomatico: { type: String, enum: ["UltimoAtacanteTropa"] },
    ignoraEsconder: Boolean,
    tiposAlvo: { type: [String], enum: cardTypes, default: undefined },
    efeitos: [effect],
    habilidadesAtivas: [active],
    habilidadesPassivas: [passive],
    palavrasChave: [String],
    montaria: {
      type: new Schema(
        { filtro: { type: passiveFilter, default: undefined } },
        { _id: false, strict: "throw" },
      ),
      default: undefined,
    },
    fraqueza: [String],
    resistencia: [String],
    limites: [limits],
    publicado: { type: Boolean, default: false },
    versao: { type: Number, default: 1 },
  },
  { timestamps: true, strict: "throw" },
);
export default model<Card>("Card", schema);
