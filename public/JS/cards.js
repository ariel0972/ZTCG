// cards.js
const allCards = [
  {
    id: 1,
    name: "Bola de fogo",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/bola de fogo.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 2,
    name: "Jato da água",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/Jato da água.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 90,
    name: "Fluxo Forte",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/Fluxo forte.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 40,
    name: "Lágrima de Zarcos",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/lágrima de zarcos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 5,
    name: "Chuva de flechas",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Chuva de Flechas.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 60,
    name: "Encanto da Traição",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/Encanto da traição.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 97,
    name: "Furtar",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/Furtar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 115,
    name: "Sacrificio",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/Sacrifício.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 6,
    name: "Escudo de Porteção",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/escudo de proteção.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 127,
    name: "Amplificar",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/amplificar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 37,
    name: "Espada dos Mil Mortos",
    type: "arma",
    cost: 2,
    image: '../assets/cards/espada dos mil mortos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 48,
    name: "Machado",
    type: "arma",
    cost: 2,
    image: 'public/assets/cards/machado.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 98,
    name: "Palhaço",
    type: "criatura",
    cost: 2,
    image: 'public/assets/cards/palhaço.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 77,
    name: "Goblin Sombrio",
    type: "criatura",
    cost: 2,
    image: 'public/assets/cards/goblin sombrio.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 39,
    name: "Sifão de mana",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/sifão de mana.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 47,
    name: "Pele de Luokis",
    type: "arma",
    cost: 2,
    image: 'public/assets/cards/Pele de luokis.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 93,
    name: "Chamar tropa",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/chamar tropa.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 135,
    name: "Visão espectral",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/visão espectral.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 125,
    name: "Refletir",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/refletir.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 73,
    name: "Cegueira dos Caídos",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/Cegueira dos Caídos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 99,
    name: "Faca de Brinquedo",
    type: "arma",
    cost: 2,
    image: 'public/assets/cards/faca de brinquedo.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 131,
    name: "Trazer dos mortos",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/trazer dos mortos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 30,
    name: "Chamar tropa",
    type: "feitiço",
    cost: 2,
    image: 'public/assets/cards/olho da verdade.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 27,
    name: "Rato",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/rato.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 88,
    name: "Ladino",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/ladino.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 74,
    name: "Cavalo",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/cavalo.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 44,
    name: "Salamandra",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/salamandra.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 26,
    name: "Golém de água",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/golem de água.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 42,
    name: "Toupeira",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/Toupeira.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 43,
    name: "Beija Flor",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/beija-flor de fagniz.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 23,
    name: "Guerreiro",
    type: "criatura",
    cost: 3,
    image: 'public/assets/cards/guerreiro.png',
    element: "Neutro",
    atk: 3,
    hp: 11,
    attackPattern: "universal",
  },
  {
    id: 20,
    name: "Assasino",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/assassino.png',
    atk: 2,
    hp: 1,
    attackPattern: "front"
  },
  {
    id: 21,
    name: "Cavaleiro",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/cavaleiro.png',
    atk: 3,
    hp: 12,
    attackPattern: "front"
  },
  {
    id: 24,
    name: "Arqueiro",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/arqueiro.png',
    atk: 4,
    hp: 11,
    attackPattern: "diagonal"
  },
  {
    id: 22,
    name: "Goblin",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/goblin.png',
    atk: 2,
    hp: 6,
    attackPattern: "diagonal"
  },
  {
    id: 25,
    name: "Golem",
    type: "criatura",
    cost: 4,
    image: 'public/assets/cards/golem.png',
    atk: 4,
    hp: 1,
    attackPattern: "diagonal"
  },
  {
    id: 28,
    name: "Aprendiz de mago",
    type: "mago",
    image: "public/assets/cards/aprendiz de mago.png",
    hp: 18
  },
  {
    id: 16,
    name: "Mago de fogo",
    type: "mago",
    image: "public/assets/cards/mago de fogo.png",
    hp: 18
  },
  {
    id: 17,
    name: "Mago de água",
    type: "mago",
    image: "public/assets/cards/mago de água.png",
    hp: 18
  },
  {
    id: 19,
    name: "Mago de ar",
    type: "mago",
    image: "public/assets/cards/Mago de ar.png",
    hp: 18
  },
  {
    id: 18,
    name: "Mago de terra",
    type: "mago",
    image: "public/assets/cards/mago de terra.png",
    hp: 18
  },
  {
    id: 29,
    name: "Bruxo",
    type: "mago",
    image: "public/assets/cards/bruxo.png",
    hp: 18
  },
  {
    id: 70,
    name: "Druida",
    type: "mago",
    image: "public/assets/cards/druida.png",
    hp: 18
  },
  {
    id: 108,
    name: "Necromante",
    type: "mago",
    image: "public/assets/cards/necromante.png",
    hp: 18
  }
];
