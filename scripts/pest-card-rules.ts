import type { Card, Effect, HabilidadePassiva } from "../src/types/card";
const linked = { tipo: "cartaVinculada" as const };
const applyElement = (
  elemento: NonNullable<Card["elemento"]>,
): HabilidadePassiva => ({
  gatilho: "onAttack",
  escopo: "aliado",
  condicoes: [linked],
  efeitos: [{ id: "applyElement", alvo: "alvoAtaque", elemento }],
});
const attackElement = (elemento: Card["elemento"]): HabilidadePassiva => ({
  gatilho: "continuous",
  escopo: "proprio",
  efeitos: [{ id: "attackElement", elemento: elemento! }],
});
export const leptospirosisEffects: Effect[] = [
  {
    id: "damage",
    valor: 2,
    anularSeCampo: { jogador: "inimigo", grupo: "Rato", minimo: 1 },
  },
  {
    id: "growMaxHp",
    valor: 1,
    ateSairCampo: true,
    selecao: { jogador: "aliado", grupo: "Rato" },
  },
];
const plague: Effect = {
  id: "status",
  status: "Peste Negra",
  valor: 1,
  duracao: 1,
  semExpiracao: true,
  acumularValor: true,
};
const neutralTroop = {
  tipo: "Tropa" as const,
  elemento: "Neutro" as const,
  direcaoAtaque: "Frente" as const,
  resistencia: ["Neutro" as const],
  fraqueza: ["Fogo" as const],
  publicado: true,
};
export const pestCardUpdates: Record<string, Partial<Card>> = {
  "049": {
    tipo: "Armamento",
    custoMana: 7,
    bonusHp: 0,
    bonusAtaque: 2,
    elemento: "Neutro",
    publicado: true,
    descricao:
      "Só pode equipar tropas de alcance Diagonal ou Universal. Escolha um elemento ao equipar, até sair do campo. Água cura 1 PV de quem ataca; Fogo dá +2 de dano além do bônus do arco; Terra atordoa por 1 rodada; Ar devolve a tropa atingida e seus armamentos à mão, exceto se for de Ar, estiver montada ou protegida por estrutura. Aplica o elemento escolhido no ataque.",
    restricaoEquipamento: {
      tipos: ["Tropa"],
      direcoes: ["Diagonal", "Universal"],
    },
    habilidadesPassivas: [],
    modosEquipamento: [
      {
        id: "agua",
        nome: "Água · curar 1 PV por ataque",
        habilidadesPassivas: [
          attackElement("Agua"),
          applyElement("Agua"),
          {
            gatilho: "onAttack",
            escopo: "aliado",
            condicoes: [linked],
            efeitos: [{ id: "heal", alvo: "cartaEvento", valor: 1 }],
          },
        ],
      },
      {
        id: "fogo",
        nome: "Fogo · +2 de dano",
        bonusAtaque: 2,
        habilidadesPassivas: [attackElement("Fogo"), applyElement("Fogo")],
      },
      {
        id: "terra",
        nome: "Terra · atordoar por 1 rodada",
        habilidadesPassivas: [
          attackElement("Terra"),
          applyElement("Terra"),
          {
            gatilho: "onAttack",
            escopo: "aliado",
            condicoes: [linked],
            efeitos: [
              {
                id: "status",
                alvo: "alvoAtaque",
                status: "Atordoado",
                duracao: 1,
              },
            ],
          },
        ],
      },
      {
        id: "ar",
        nome: "Ar · devolver tropa à mão",
        habilidadesPassivas: [
          attackElement("Ar"),
          applyElement("Ar"),
          {
            gatilho: "onAttack",
            escopo: "aliado",
            filtroAlvo: { tipo: "Tropa", relacao: "inimigo" },
            condicoes: [linked],
            efeitos: [
              {
                id: "returnToHand",
                alvo: "alvoAtaque",
                bloquearComEstrutura: true,
                bloquearComMontaria: true,
                excetoElementos: ["Ar"],
              },
            ],
          },
        ],
      },
    ],
  },
  "048": {
    tipo: "Armamento",
    custoMana: 5,
    bonusHp: 0,
    bonusAtaque: 2,
    elemento: "Neutro",
    publicado: true,
    descricao:
      "Animais não podem usar este armamento. Uma tropa equipada de alcance Diagonal ou Universal aplica Sangramento à tropa inimiga atingida pelo ataque básico: 1 de dano por ciclo durante 3 rodadas.",
    restricaoEquipamento: { tipos: ["Tropa"], excluirSubtipos: ["Animal"] },
    habilidadesPassivas: [
      {
        gatilho: "onAttack",
        escopo: "aliado",
        condicoes: [
          {
            tipo: "cartaVinculada",
            filtro: { direcoes: ["Diagonal", "Universal"] },
          },
        ],
        filtroAlvo: { tipo: "Tropa", relacao: "inimigo" },
        efeitos: [
          {
            id: "status",
            alvo: "alvoAtaque",
            status: "Sangrando",
            valor: 1,
            duracao: 3,
          },
        ],
      },
    ],
  },
  "066": {
    tipo: "Feitico",
    custoMana: 4,
    elemento: "Neutro",
    alvo: "TodasTropasInimigas",
    publicado: true,
    descricao:
      "Infecta todas as tropas inimigas com Peste Negra: 1 de dano por ciclo, sem expirar, removível por limpeza. Cada nova aplicação acumula +1 no dano. Com 3 cartas do grupo Rato no seu campo, também infecta o mago inimigo. Cada aplicação concede +1 ATQ aos seus Ratos, acumulável, enquanto restar um inimigo infectado.",
    efeitos: [
      plague,
      {
        ...plague,
        selecao: { jogador: "inimigo", tipo: "Mago" },
        requerCampo: { jogador: "aliado", grupo: "Rato", minimo: 3 },
      },
      { id: "statusAura", grupo: "Rato", status: "Peste Negra", valor: 1 },
    ],
  },
  "107": {
    ...neutralTroop,
    custoMana: 5,
    hp: 12,
    ataque: 2,
    manaGerada: 3,
    subtipo: "Humano",
    descricao:
      "Ataca uma vez por rodada. Quando outro aliado morre, ganha Campo livre até o fim do turno atual.",
    habilidadesPassivas: [
      {
        gatilho: "onDeath",
        escopo: "aliado",
        excluirFonte: true,
        efeitos: [
          {
            id: "status",
            alvo: "fonte",
            status: "Campo livre",
            duracao: 1,
            unidade: "turno",
          },
        ],
      },
    ],
    habilidadesAtivas: [
      {
        id: "cura",
        nome: "Cura",
        custoMana: 4,
        alvo: "UnicoAliado",
        tiposAlvo: ["Tropa", "Mago"],
        descricao:
          "Cura 2 PV de tropa ou mago aliado. O Médico perde apenas seus ataques restantes neste turno, sem consumir ataques do mago. Pode usar depois de atacar.",
        efeitos: [
          { id: "heal", valor: 2 },
          { id: "blockAttacks", alvo: "Proprio" },
        ],
      },
      {
        id: "medicar",
        nome: "Medicar",
        custoMana: 5,
        alvo: "TodosAliados",
        descricao:
          "Remove condições negativas de todos os aliados. Se remover Peste Negra, o Médico recebe +1 ATQ até o fim do turno.",
        efeitos: [
          { id: "cleanse", bonusLimpeza: { status: "Peste Negra", ataque: 1 } },
        ],
      },
    ],
  },
  "089": {
    ...neutralTroop,
    custoMana: 5,
    hp: 12,
    ataque: 2,
    manaGerada: 3,
    subtipo: "Animal",
    grupos: ["Rato"],
    descricao:
      "Ataca duas vezes por rodada. Quando outro aliado morre, ganha +1 de vida máxima e atual até sair do campo. Propagar: após sobreviver a um ataque com metade da vida ou menos, usa os efeitos de Leptospirose sem mana ou carta, uma vez por rodada.",
    habilidadesPassivas: [
      {
        gatilho: "continuous",
        escopo: "proprio",
        efeitos: [{ id: "attackLimit", valor: 2 }],
      },
      {
        gatilho: "onDeath",
        escopo: "aliado",
        excluirFonte: true,
        efeitos: [
          { id: "growMaxHp", alvo: "fonte", valor: 1, ateSairCampo: true },
        ],
      },
      {
        id: "propagar",
        gatilho: "onAttacked",
        escopo: "proprio",
        limitePorRodada: 1,
        condicoes: [
          {
            tipo: "vidaPercentual",
            alvo: "fonte",
            percentual: 50,
            comparacao: "menorOuIgual",
          },
        ],
        efeitos: [
          {
            id: "executeEffects",
            alvo: "TodosInimigos",
            efeitos: leptospirosisEffects,
          },
        ],
      },
    ],
  },
  "027": {
    ...neutralTroop,
    custoMana: 2,
    hp: 4,
    ataque: 2,
    manaGerada: 1,
    subtipo: "Animal",
    grupos: ["Rato"],
    fraqueza: ["Fogo", "Terra"],
    descricao:
      "Ataca uma vez por rodada. Quando outra tropa aliada morre, toma seu lugar. Praga: para cada carta que você roubar do deck inimigo, este Rato deixa uma maldição no lugar. Ao comprá-la, o adversário sofre 1 de dano direto no mago, descarta a maldição e compra outra carta. Cada Rato em campo cria sua própria maldição.",
    habilidadesPassivas: [
      {
        gatilho: "onDeath",
        escopo: "aliado",
        excluirFonte: true,
        filtroEvento: { tipo: "Tropa" },
        efeitos: [{ id: "move", destino: "slotEvento" }],
      },
      {
        gatilho: "onDeckStolen",
        escopo: "aliado",
        efeitos: [
          {
            id: "replaceStolen",
            carta: "066",
            efeitosAoComprar: [
              { id: "damage", valor: 1, perfurante: true },
              { id: "draw", valor: 1 },
            ],
          },
        ],
      },
    ],
  },
  "072": {
    tipo: "Feitico",
    custoMana: 5,
    elemento: "Neutro",
    alvo: "TodosInimigos",
    publicado: true,
    descricao:
      "Causa 2 de dano imediato a todos os inimigos. Seus Ratos ganham +1 de vida máxima e atual até sair do campo. Se houver uma carta do grupo Rato no campo inimigo, todos os efeitos são anulados.",
    efeitos: leptospirosisEffects,
  },
};
