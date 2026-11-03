import type { Card } from "../src/types/card";
import raw from "../src/data/catalog.json";
const current = (id: string) =>
  raw.find((c) => c.numeroCatalogo === id)! as unknown as Card;
export const rogueWindUpdates: Record<string, Partial<Card>> = {
  "088": {
    tipo: "Tropa",
    custoMana: 4,
    hp: 8,
    ataque: 3,
    manaGerada: 2,
    subtipo: "Humano",
    elemento: "Neutro",
    direcaoAtaque: "Frente",
    resistencia: ["Neutro"],
    fraqueza: ["Ar"],
    grupos: ["Assassino"],
    publicado: true,
    descricao:
      "Ataca uma vez por rodada. Quando mata uma tropa inimiga, compra 1 carta do próprio baralho.",
    habilidadesPassivas: [
      {
        gatilho: "onKill",
        escopo: "proprio",
        filtroAlvo: { tipo: "Tropa", relacao: "inimigo" },
        efeitos: [{ id: "draw", jogador: "aliado", valor: 1 }],
      },
    ],
    habilidadesAtivas: [
      {
        id: "furtoRapido",
        nome: "Furto rápido",
        custoMana: 4,
        alvo: "Global",
        descricao:
          "Rouba 1 carta do topo do baralho inimigo, sem olhar o baralho.",
        efeitos: [{ id: "stealDeck", valor: 1 }],
      },
      {
        id: "destravar",
        nome: "Destravar",
        custoMana: 4,
        alvo: "Cemiterio",
        maxAlvos: 1,
        filtroAlvo: { tipo: "Feitico" },
        descricao: "Escolha 1 feitiço do seu cemitério e devolva-o à sua mão.",
        efeitos: [{ id: "recover", valor: 1, tiposCarta: ["Feitico"] }],
      },
    ],
  },
  "097": {
    tipo: "Feitico",
    custoMana: 4,
    elemento: "Neutro",
    alvo: "Global",
    publicado: true,
    descricao:
      "Role um dado de 6 lados. Se cair par, roube 3 cartas do topo do baralho inimigo; se cair ímpar, roube 1. Não permite olhar o baralho.",
    efeitos: [
      {
        id: "stealDeck",
        valor: 1,
        dado: { lados: 6, bonusPar: 2, bonusImpar: 0 },
      },
    ],
  },
  "043": {
    tipo: "Tropa",
    publicado: true,
    descricao:
      "Ataca duas vezes por rodada e pode mudar de posição uma vez por turno com Campo livre. Bater das Asas causa 2 de dano a uma tropa inimiga. Lufada devolve apenas a tropa ou ocupante escolhido diretamente à frente e seus armamentos à mão; se houver estrutura, causa 3 de dano nela em vez de devolver.",
    habilidadesAtivas: [
      {
        id: "baterDasAsas",
        nome: "Bater das Asas",
        custoMana: 3,
        alvo: "UnicoInimigo",
        tiposAlvo: ["Tropa"],
        filtroAlvo: { tipo: "Tropa" },
        descricao:
          "Causa 2 de dano a qualquer tropa inimiga. A estrutura absorve normalmente.",
        efeitos: [{ id: "damage", valor: 2 }],
      },
      {
        id: "lufada",
        nome: "Lufada",
        custoMana: 5,
        alvo: "UnicoInimigo",
        tiposAlvo: ["Tropa"],
        filtroAlvo: { tipo: "Tropa" },
        apenasFrontal: true,
        descricao:
          "Escolha a tropa, montaria ou ocupante diretamente à frente. Com estrutura, causa 3 de dano nela. Sem estrutura, devolve só a carta escolhida e seus armamentos à mão do oponente, mantendo a outra carta em campo.",
        efeitos: [
          {
            id: "returnToHand",
            apenasAlvo: true,
            devolverVinculos: true,
            requerEstrutura: false,
          },
          { id: "damage", valor: 3, valorEstrutura: 3, requerEstrutura: true },
        ],
      },
    ],
  },
  "042": {
    tipo: "Tropa",
    publicado: true,
    descricao:
      "Ataca uma vez por rodada. Depois de receber um ataque, fica Escondida por 1 rodada completa; não evita o dano do ataque. Escavação incapacita a tropa inimiga à frente por 1 rodada; estrutura protege. Cuspe de Lama aplica Lama ao campo da tropa à frente por 2 rodadas completas, mesmo com estrutura, sem dano.",
    habilidadesAtivas: [
      ...current("042").habilidadesAtivas.filter((h) => h.id !== "cuspeDeLama"),
      {
        id: "cuspeDeLama",
        nome: "Cuspe de Lama",
        custoMana: 5,
        alvo: "UnicoInimigo",
        alvoAutomatico: "Frontal",
        filtroAlvo: { tipo: "Tropa" },
        descricao:
          "Aplica Lama diretamente ao campo da tropa inimiga à frente por 2 rodadas completas, mesmo com estrutura. Não causa dano nem retira a tropa que já ocupa o campo.",
        efeitos: [{ id: "terrain", terreno: "Lama", duracao: 2 }],
      },
    ],
  },
};
