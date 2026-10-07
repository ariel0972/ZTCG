import { z } from "zod";
export const cardTypes = [
  "Mago",
  "Tropa",
  "Feitico",
  "Estrutura",
  "Armamento",
] as const;
export const elements = [
  "Fogo",
  "Agua",
  "Terra",
  "Ar",
  "Zarcos",
  "Neutro",
] as const;
export const targets = [
  "UnicoInimigo",
  "UnicoAliado",
  "TodosInimigos",
  "TodasTropasInimigas",
  "Global",
  "Estrutura",
  "Deck",
  "DeckOponente",
  "Cemiterio",
  "MultiplosInimigos",
  "CampoAliado",
  "CampoInimigo",
  "Mao",
] as const;
export const triggers = [
  "onDeath",
  "onSpellCast",
  "onDamageTaken",
  "onAttacked",
  "continuous",
  "onTargeted",
  "onEquip",
  "onAttack",
  "onTurnStart",
  "onTurnEnd",
  "onSummon",
  "onRevive",
  "onSacrifice",
  "onStatusApplied",
] as const;
const number = z.number().int().min(0).max(1000);
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const effectSchema = z
  .object({
    id: identifier,
    valor: number.optional(),
    status: z.string().max(80).optional(),
    duracao: number.optional(),
    elemento: z.enum(elements).optional(),
  })
  .strict();
export const activeSchema = z
  .object({
    id: identifier,
    nome: z.string().trim().min(1).max(100),
    custoMana: number,
    descricao: z.string().max(2000).optional(),
    alvo: z.enum(targets).optional(),
    efeitos: z.array(effectSchema).max(12).optional(),
  })
  .strict();
export const passiveSchema = z
  .object({
    gatilho: z.enum(triggers),
    descricao: z.string().max(2000).optional(),
    efeito: identifier,
    valor: number.optional(),
    condicao: z.string().max(80).optional(),
    elemento: z.enum(elements).optional(),
    direcao: z.enum(["Frente", "Diagonal", "Universal"]).optional(),
    tipoAtacante: z.enum(cardTypes).optional(),
    status: z.string().max(80).optional(),
    duracao: number.optional(),
    porVizinho: z.boolean().optional(),
  })
  .strict();
export const limitsSchema = z
  .object({
    tropasMobilizadas: number,
    tropaAtacam: number,
    feiticosUsados: number,
    feiticosUnicos: number,
  })
  .strict();
export const imageSchema = z
  .string()
  .max(400)
  .refine(
    (v) => /^\/(?!\/)[^\\]*$/.test(v) || /^https?:\/\//.test(v),
    "Use caminho /assets/... ou URL http(s).",
  );
export const cardSchema = z
  .object({
    numeroCatalogo: z.string().regex(/^\d{3,6}$/),
    nome: z.string().trim().min(1).max(100),
    tipo: z.enum(cardTypes),
    custoMana: number,
    assinatura: z.boolean().default(false),
    elemento: z.enum(elements).optional(),
    descricao: z.string().max(4000).default(""),
    imgURL: imageSchema.optional(),
    hp: number.optional(),
    ataque: number.optional(),
    manaGerada: number.optional(),
    recuperacaoMana: number.optional(),
    bonusAtaque: number.optional(),
    bonusHp: number.optional(),
    subtipo: z
      .enum(["Animal", "Humano", "Monstro", "Planta", "Invocação"])
      .optional(),
    direcaoAtaque: z.enum(["Frente", "Diagonal", "Universal"]).optional(),
    alvo: z.enum(targets).optional(),
    maxAlvos: z.number().int().min(1).max(3).default(1),
    efeitos: z.array(effectSchema).max(12).default([]),
    habilidadesAtivas: z.array(activeSchema).max(12).default([]),
    habilidadesPassivas: z.array(passiveSchema).max(12).default([]),
    palavrasChave: z.array(z.string().min(1).max(80)).max(20).default([]),
    fraqueza: z.array(z.enum(elements)).max(6).default([]),
    resistencia: z.array(z.enum(elements)).max(6).default([]),
    limites: z.array(limitsSchema).max(1).default([]),
    publicado: z.boolean().default(false),
    versao: z.number().int().positive().default(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    const required = (key: keyof typeof c) => {
      if (c[key] === undefined)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Campo obrigatório para ${c.tipo}.`,
        });
    };
    if (["Tropa", "Mago", "Estrutura"].includes(c.tipo)) {
      required("hp");
      required("ataque");
      if (c.hp === 0)
        ctx.addIssue({
          code: "custom",
          path: ["hp"],
          message: "Vida precisa ser positiva.",
        });
    }
    if (c.tipo === "Tropa") {
      required("direcaoAtaque");
      required("manaGerada");
    }
    if (c.tipo === "Mago") {
      required("recuperacaoMana");
      if (c.limites.length !== 1)
        ctx.addIssue({
          code: "custom",
          path: ["limites"],
          message: "Defina os limites do mago.",
        });
    }
    if (c.tipo === "Feitico") required("alvo");
    if (c.tipo === "Armamento") {
      required("bonusAtaque");
      required("bonusHp");
    }
    if (
      new Set(c.habilidadesAtivas.map((h) => h.id)).size !==
      c.habilidadesAtivas.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["habilidadesAtivas"],
        message: "IDs repetidos.",
      });
  });
export type Card = z.infer<typeof cardSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type HabilidadeAtiva = z.infer<typeof activeSchema>;
export type HabilidadePassiva = z.infer<typeof passiveSchema>;
export type ControleCampo = z.infer<typeof limitsSchema>;
export type Elemento = (typeof elements)[number];
export type TipoCarta = (typeof cardTypes)[number];
export type DirecaoAtaque = NonNullable<Card["direcaoAtaque"]>;
export type TipoAlvoFeitico = (typeof targets)[number];
