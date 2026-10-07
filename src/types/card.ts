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
  "onStructureDestroyed",
  "onHeal",
  "onHealed",
  "onKill",
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
const passiveCardTargets = [
  "fonte",
  "magoAliado",
  "magoInimigo",
  "cartaEvento",
  "atacante",
  "alvoAtaque",
] as const;
export const passiveFilterSchema = z
  .object({
    tipo: z.enum(cardTypes).optional(),
    elemento: z.enum(elements).optional(),
    direcao: z.enum(["Frente", "Diagonal", "Universal"]).optional(),
    status: z.string().max(80).optional(),
  })
  .strict()
  .refine(
    (filter) => Object.values(filter).some((value) => value !== undefined),
    "Defina pelo menos um filtro.",
  );
const cardAction = { alvo: z.enum(passiveCardTargets), valor: number };
const playerAction = { jogador: z.enum(["aliado", "inimigo"]), valor: number };
export const passiveActionSchema = z.discriminatedUnion("id", [
  z
    .object({
      id: z.literal("damage"),
      ...cardAction,
      elemento: z.enum(elements).optional(),
    })
    .strict(),
  z
    .object({
      id: z.literal("heal"),
      ...cardAction,
      excedente: number.optional(),
    })
    .strict(),
  z.object({ id: z.literal("growMaxHp"), ...cardAction }).strict(),
  z
    .object({
      id: z.literal("status"),
      alvo: z.enum(passiveCardTargets),
      status: z.string().min(1).max(80),
      duracao: number.min(1),
      valor: number.optional(),
    })
    .strict(),
  z.object({ id: z.literal("mana"), ...playerAction }).strict(),
  z.object({ id: z.literal("draw"), ...playerAction }).strict(),
  z.object({ id: z.literal("recover"), ...playerAction }).strict(),
  z
    .object({
      id: z.literal("spellDamageBonus"),
      elemento: z.enum(elements),
      valor: number.min(1),
      contador: identifier,
      aCada: number.min(1),
    })
    .strict(),
  z
    .object({
      id: z.literal("attackAura"),
      valor: number.min(1),
      filtro: passiveFilterSchema.optional(),
      fonteRecebe: z.boolean().optional(),
      porVizinho: z.boolean().optional(),
    })
    .strict(),
  z.object({ id: z.literal("attackBonus"), valor: number.min(1) }).strict(),
  z
    .object({
      id: z.literal("summonFromDeck"),
      carta: z.union([z.literal("mesmaCarta"), z.string().regex(/^\d{3,6}$/)]),
      destino: z.literal("slotEvento"),
    })
    .strict(),
  z
    .object({ id: z.literal("move"), destino: z.literal("slotEvento") })
    .strict(),
  z
    .object({
      id: z.literal("blockAttack"),
      filtro: passiveFilterSchema.optional(),
      qualquerDe: z.array(passiveFilterSchema).min(1).max(12).optional(),
    })
    .strict(),
]);
export const declarativePassiveSchema = z
  .object({
    gatilho: z.enum(triggers),
    descricao: z.string().max(2000).optional(),
    escopo: z.enum(["proprio", "aliado", "inimigo", "qualquer"]),
    excluirFonte: z.boolean().optional(),
    filtroEvento: passiveFilterSchema.optional(),
    filtroAlvo: z
      .object({
        tipo: z.enum(cardTypes).optional(),
        elemento: z.enum(elements).optional(),
        relacao: z.enum(["aliado", "inimigo"]).optional(),
      })
      .strict()
      .optional(),
    condicoes: z
      .array(
        z.discriminatedUnion("tipo", [
          z
            .object({
              tipo: z.literal("campoVazio"),
              jogador: z.enum(["aliado", "inimigo"]),
            })
            .strict(),
          z
            .object({
              tipo: z.literal("vidaPercentual"),
              alvo: z.enum(["fonte", "cartaEvento"]),
              percentual: number.max(100),
              comparacao: z.enum(["menor", "menorOuIgual"]),
            })
            .strict(),
        ]),
      )
      .max(12)
      .optional(),
    efeitos: z.array(passiveActionSchema).min(1).max(12),
  })
  .strict();
export const legacyPassiveSchema = z
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
export const passiveSchema = z.union([
  legacyPassiveSchema,
  declarativePassiveSchema,
]);
export type LegacyPassive = z.infer<typeof legacyPassiveSchema>;
export type DeclarativePassive = z.infer<typeof declarativePassiveSchema>;
export type PassiveAction = z.infer<typeof passiveActionSchema>;
export type PassiveFilter = z.infer<typeof passiveFilterSchema>;
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
