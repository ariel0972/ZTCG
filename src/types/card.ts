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
  "TodosAliados",
  "Global",
  "Estrutura",
  "Deck",
  "DeckOponente",
  "Reserva",
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
  "onElementalReaction",
] as const;
const number = z.number().int().min(0).max(1000);
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const spellVariantStatusSchema = z
  .object({
    id: z.literal("status"),
    alvo: z.enum(["TodosInimigos", "TodasTropasInimigas"]),
    status: z.string().min(1).max(80),
    duracao: z.number().int().min(1).max(1000),
    valor: number.optional(),
    unidade: z.enum(["turno", "rodada"]).optional(),
  })
  .strict();
export const spellVariantSchema = z
  .object({
    elemento: z.enum(elements),
    bonusDano: number.optional(),
    causaDano: z.boolean().optional(),
    duracao: z.number().int().min(1).max(1000).optional(),
    status: z.string().max(80).optional(),
    efeitos: z.array(spellVariantStatusSchema).max(12).optional(),
  })
  .strict();
export const effectSchema = z
  .object({
    id: identifier,
    alvo: z.literal("Proprio").optional(),
    valor: number.optional(),
    descontoMana: number.optional(),
    zonas: z
      .array(z.enum(["Deck", "Cemiterio"]))
      .min(1)
      .max(2)
      .optional(),
    excluirSubtipos: z
      .array(z.enum(["Animal", "Humano", "Monstro", "Planta", "Invocação"]))
      .max(5)
      .optional(),
    destino: z.enum(["Tropa", "Estrutura"]).optional(),
    selecaoCampo: z.enum(["TodasTropas", "TodasEstruturas"]).optional(),
    ignoraProtecaoStatus: z.boolean().optional(),
    duracaoInicial: number.min(1).optional(),
    concessao: z
      .object({
        bonusAtaque: number.optional(),
        palavrasChave: z.array(z.string().min(1).max(80)).max(20).optional(),
        elementoAtaque: z.enum(elements).optional(),
        visual: z.enum(["asasDeFogo"]).optional(),
      })
      .strict()
      .optional(),
    tiposCarta: z.array(z.enum(cardTypes)).min(1).max(5).optional(),
    destinatarios: z
      .array(z.enum(["Tropa", "Mago"]))
      .min(1)
      .max(2)
      .optional(),
    ignorarLimite: z.boolean().optional(),
    trocaAliada: z.boolean().optional(),
    elementoMago: z.enum(elements).optional(),
    recompensaSacrificio: z
      .object({
        mana: number.max(20),
        vida: number,
        vidaEspecial: number.optional(),
        subtipos: z
          .array(z.enum(["Animal", "Humano", "Monstro", "Planta", "Invocação"]))
          .max(5)
          .optional(),
      })
      .strict()
      .optional(),
    bonusContraSubtipos: z
      .object({
        subtipos: z
          .array(z.enum(["Animal", "Humano", "Monstro", "Planta", "Invocação"]))
          .min(1)
          .max(5),
        valor: number,
      })
      .strict()
      .optional(),
    elementos: z.array(z.enum(elements)).min(1).max(6).optional(),
    fracao: z.number().min(0).max(1).optional(),
    limiteManaOrigem: number.max(20).optional(),
    removerAoUsarElemento: z.enum(elements).optional(),
    janelaTurnos: number.min(1).max(20).optional(),
    status: z.string().max(80).optional(),
    duracao: number.optional(),
    elemento: z.enum(elements).optional(),
    unidade: z.enum(["turno", "rodada"]).optional(),
    requerStatus: z.string().max(80).optional(),
    inicio: z.enum(["proximaRodada", "proximoTurnoAliado"]).optional(),
    valorEstrutura: number.optional(),
    bonusAtaque: number.optional(),
    bonusHp: number.optional(),
    recompensaMorteRodada: z
      .object({ mana: number.max(20) })
      .strict()
      .optional(),
    perfurante: z.boolean().optional(),
    ignoraResistencia: z.boolean().optional(),
    devolverVinculos: z.boolean().optional(),
    regrasCampo: z
      .object({
        descontos: z
          .array(
            z
              .object({ elemento: z.enum(elements), valor: number.min(1) })
              .strict(),
          )
          .max(6)
          .optional(),
        danoNormal: z.array(z.enum(elements)).max(6).optional(),
        anularFeiticos: z.array(z.enum(elements)).max(6).optional(),
      })
      .strict()
      .optional(),
    reacoesElemento: z
      .array(
        z
          .object({
            elemento: z.enum(elements),
            multiplicador: z.number().min(0).max(10).optional(),
            remover: z.boolean().optional(),
          })
          .strict()
          .refine(
            (r) => r.remover === true || r.multiplicador !== undefined,
            "Defina multiplicador ou remoção.",
          ),
      )
      .max(6)
      .optional(),
    curaPosterior: z
      .object({
        multiplicador: z.number().int().min(1).max(10),
        rodadas: z.number().int().min(1).max(10),
      })
      .strict()
      .optional(),
    recompensaAoEliminar: z
      .object({
        mana: number.max(20).optional(),
        compra: number.optional(),
        tipo: z.enum(cardTypes).optional(),
      })
      .strict()
      .optional(),
    origem: z.enum(["fonte", "alvo"]).optional(),
    direcao: z.enum(["direita", "vizinho"]).optional(),
    borda: z.enum(["mao", "manter"]).optional(),
    semDestino: z.literal("manter").optional(),
    estrutura: z.enum(["impedirUso", "manter"]).optional(),
    filtroAlvo: z
      .object({
        tipo: z.enum(cardTypes).optional(),
        elemento: z.enum(elements).optional(),
        excetoElementos: z.array(z.enum(elements)).min(1).max(6).optional(),
      })
      .strict()
      .refine(
        (f) => Object.values(f).some((v) => v !== undefined),
        "Defina pelo menos um filtro.",
      )
      .optional(),
    carta: z
      .string()
      .regex(/^\d{3,6}$/)
      .optional(),
    seNaoUsada: z
      .string()
      .regex(/^\d{3,6}$/)
      .optional(),
    variantesMago: z.array(spellVariantSchema).max(6).optional(),
  })
  .strict();
export const actionOptionSchema = z
  .object({
    id: identifier,
    nome: z.string().trim().min(1).max(120),
    alvo: z.enum(targets),
    maxAlvos: z.number().int().min(1).max(3).optional(),
    tiposAlvo: z.array(z.enum(cardTypes)).min(1).max(5).optional(),
    efeitos: z.array(effectSchema).min(1).max(12),
  })
  .strict();
export const activeSchema = z
  .object({
    tiposAlvo: z.array(z.enum(cardTypes)).min(1).max(5).optional(),
    id: identifier,
    nome: z.string().trim().min(1).max(100),
    custoMana: number,
    custoVida: number.min(1).optional(),
    esperaRodadas: z.number().int().min(0).max(100).optional(),
    descricao: z.string().max(2000).optional(),
    alvo: z.enum(targets).optional(),
    alvoAutomatico: z.enum(["Proprio", "Frontal"]).optional(),
    maxAlvos: z.number().int().min(1).max(20).optional(),
    filtroAlvo: z
      .object({
        numeroCatalogo: z
          .string()
          .regex(/^\d{3,6}$/)
          .optional(),
        tipo: z.enum(cardTypes).optional(),
        elemento: z.enum(elements).optional(),
      })
      .strict()
      .optional(),
    efeitos: z.array(effectSchema).max(12).optional(),
    opcoes: z.array(actionOptionSchema).min(2).max(5).optional(),
  })
  .strict();
const passiveCardTargets = [
  "fonte",
  "magoAliado",
  "magoInimigo",
  "cartaEvento",
  "atacante",
  "alvoAtaque",
  "tropaVinculada",
] as const;
export const passiveFilterSchema = z
  .object({
    numeroCatalogo: z
      .string()
      .regex(/^\d{3,6}$/)
      .optional(),
    tipo: z.enum(cardTypes).optional(),
    elemento: z.enum(elements).optional(),
    direcao: z.enum(["Frente", "Diagonal", "Universal"]).optional(),
    status: z.string().max(80).optional(),
    ataqueMinimo: number.optional(),
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
      id: z.literal("stackReduction"),
      valor: number.min(1),
      maximo: number.min(1),
      removerElemento: z.enum(elements),
    })
    .strict(),
  z
    .object({
      id: z.literal("statusWard"),
      excecoes: z.array(z.string().min(1).max(80)).max(30),
    })
    .strict(),
  z
    .object({
      id: z.literal("reactionDamage"),
      valor: number.min(1),
      duracao: number.min(1),
    })
    .strict(),
  z
    .object({
      id: z.literal("dodgeImpact"),
      esperaRodadas: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({ id: z.literal("attackLifesteal"), excedente: number.optional() })
    .strict(),
  z
    .object({
      id: z.literal("discardMana"),
      valor: number,
      custoAtual: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      id: z.literal("counterAttack"),
      alvo: z.enum(["cartaEvento", "atacante"]),
    })
    .strict(),
  z
    .object({
      id: z.literal("interceptAttack"),
      colunaAtacante: z.number().int().min(0).max(2).optional(),
    })
    .strict(),
  z.object({ id: z.literal("blockOwnAttack") }).strict(),
  z.object({ id: z.literal("abilityDiscount"), valor: number.min(1) }).strict(),
  z
    .object({ id: z.literal("attackElement"), elemento: z.enum(elements) })
    .strict(),
  z
    .object({ id: z.literal("attackLimit"), valor: number.min(1).max(10) })
    .strict(),
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
  z.object({ id: z.literal("growAttack"), ...cardAction }).strict(),
  z.object({ id: z.literal("manaRecovery"), valor: number }).strict(),
  z
    .object({
      id: z.literal("reflectAttack"),
      filtro: passiveFilterSchema.optional(),
      esperaRodadas: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      id: z.literal("status"),
      alvo: z.enum(passiveCardTargets),
      status: z.string().min(1).max(80),
      duracao: number.min(1),
      unidade: z.enum(["turno", "rodada"]).optional(),
      valor: number.optional(),
    })
    .strict(),
  z.object({ id: z.literal("mana"), ...playerAction }).strict(),
  z.object({ id: z.literal("draw"), ...playerAction }).strict(),
  z.object({ id: z.literal("recover"), ...playerAction }).strict(),
  z
    .object({ id: z.literal("revive"), jogador: z.enum(["aliado", "inimigo"]) })
    .strict(),
  z
    .object({
      id: z.literal("spellDamageTurn"),
      valor: number.min(1),
      acumulavel: z.boolean().optional(),
    })
    .strict(),
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
    reacao: z
      .object({
        nome: z.string().min(1).max(80),
        quando: z.enum(["provoca", "recebe", "provocaOuRecebe"]),
      })
      .strict()
      .optional(),
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
              tipo: z.literal("cartaEmCampo"),
              jogador: z.enum(["aliado", "inimigo"]),
              filtro: passiveFilterSchema,
              presente: z.boolean().default(true),
            })
            .strict(),
          z
            .object({
              tipo: z.literal("campoFrontal"),
              elemento: z.enum(elements),
              verificar: z.enum(["carta", "elementoAplicado"]),
            })
            .strict(),
          z
            .object({
              tipo: z.literal("campoVazio"),
              jogador: z.enum(["aliado", "inimigo"]),
            })
            .strict(),
          z
            .object({
              tipo: z.literal("vidaPercentual"),
              alvo: z.enum(["fonte", "cartaEvento", "alvoAtaque"]),
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
export const entryCostSchema = z
  .object({
    quantidade: z.number().int().min(1).max(5),
    tiposCarta: z
      .array(z.enum(["Tropa", "Feitico", "Estrutura", "Armamento"]))
      .min(1)
      .max(4),
    origens: z
      .array(z.enum(["mao", "campo"]))
      .min(1)
      .max(2),
    mesmoElemento: z.boolean().optional(),
    elementos: z.array(z.enum(elements)).min(1).max(6).optional(),
  })
  .strict()
  .refine((c) => !(c.mesmoElemento && c.elementos), {
    message: "Escolha mesmoElemento ou elementos específicos, não ambos.",
  });
export const cardSchema = z
  .object({
    numeroCatalogo: z.string().regex(/^\d{3,6}$/),
    nome: z.string().trim().min(1).max(100),
    tipo: z.enum(cardTypes),
    custoMana: number,
    assinatura: z.boolean().default(false),
    custoEntrada: entryCostSchema.optional(),
    requerElementoMago: z.enum(elements).optional(),
    destinoAposUso: z.enum(["cemiterio", "banido"]).optional(),
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
    alvoAutomatico: z.enum(["UltimoAtacanteTropa"]).optional(),
    ignoraEsconder: z.boolean().optional(),
    tiposAlvo: z.array(z.enum(cardTypes)).min(1).max(5).optional(),
    varianteCampo: z
      .object({
        filtro: z
          .object({ tipo: z.enum(cardTypes), elemento: z.enum(elements) })
          .strict(),
        escopo: z.enum(["qualquer", "aliado", "inimigo"]),
        custoMana: number,
        efeitos: z.array(effectSchema).min(1).max(12),
      })
      .strict()
      .optional(),
    efeitos: z.array(effectSchema).max(12).default([]),
    opcoes: z.array(actionOptionSchema).min(2).max(5).optional(),
    habilidadesAtivas: z.array(activeSchema).max(12).default([]),
    habilidadesPassivas: z.array(passiveSchema).max(12).default([]),
    palavrasChave: z.array(z.string().min(1).max(80)).max(20).default([]),
    montaria: z
      .object({ filtro: passiveFilterSchema.optional() })
      .strict()
      .optional(),
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
