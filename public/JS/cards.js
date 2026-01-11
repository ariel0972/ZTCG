// cards.js
const allCards = [
  {
    id: 1,
    name: "Bola de fogo",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Bola de fogo.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 8,
    name: "Bola de luz",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Bola de luz.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 31,
    name: "Barreira Ignea",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Barreira Ígnea.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 35,
    name: "Tornado de Fogo",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Tornado de fogo.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 85,
    name: "Reerguer da Fúria",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Reerguer da Fúria.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 102,
    name: "Lança Chamas",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Lança Chamas.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 103,
    name: "Asas Incandescentes",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Asas Incandescentes.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 104,
    name: "Cauterizar",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Cauterizar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 2,
    name: "Jato da àgua",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Jato da água.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 32,
    name: "Congelar",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Congelar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 86,
    name: "Reeguer da Tristeza",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Reerguer da Tristeza.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 105,
    name: "Splash",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Splash.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 119,
    name: "Prisão de àgua",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Prisão de água.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 120,
    name: "Chuva acida",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Chuva Acida.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 121,
    name: "Nevoeiro Denso",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Nevoeiro Denso.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 122,
    name: "Água Curativa",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Água curativa.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 123,
    name: "Tsunami",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Tsunami.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 3,
    name: "Ataque Pedregoso",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Ataque de Pedregulhos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 33,
    name: "Bola de Demolição",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Bola de Demolição.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 55,
    name: "Teremoto",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Terremoto.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 84,
    name: "Reerguer do Orgulho",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Reerguer do Orgulho.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 106,
    name: "Polinizar",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Polinizar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 4,
    name: "Furacão",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Furacão.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 9,
    name: "Furacão de Areia",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Furacão de Areia.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 34,
    name: "Tufão",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Tufão.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 57,
    name: "Lâminas Aéreas",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Lâmina de Vento.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 87,
    name: "Reerguer da Impaciência",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Reerguer de Impaciência.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 94,
    name: "Esfera de Vórtice",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Esfera de Vórtice.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 39,
    name: "Sifão de Mana",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Sifão de Mana.png',
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
    image: '../assets/Cards/Lágrima de Zarcos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 79,
    name: "Raiz Roxa",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Raiz Roxa.png',
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
    image: '../assets/Cards/Fluxo Forte.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 96,
    name: "Cristal Azul",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Cristal Kin - Azul.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 124,
    name: "Cristal Rosa",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Cristal Kin - Rosa.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 126,
    name: "Pulso de mana",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Pulso de mana.png',
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
    image: '../assets/Cards/amplificar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 5,
    name: "Chuva de Flechas",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Chuva de Flechas.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 6,
    name: "Escudo Protetor",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Escudo de Proteção.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 7,
    name: "Tremor",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Tremor.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 10,
    name: "Chuva de Meteoros",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Chuva de Meteoros.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 11,
    name: "Raio de luz",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Raio de luz.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 30,
    name: "Olho da Verdade",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Olho da Verdade.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 45,
    name: "Cheiro de Sangue",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Cheiro de Sangue.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 46,
    name: "Picada de Cobra",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Picada de Cobra.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 50,
    name: "Banir Armamento",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Banir armamento.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 51,
    name: "Chamar Armamento",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Chamar Armamento.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 52,
    name: "Encantar Armamento",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Encantar Armamento.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 53,
    name: "Nome Sagrado",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Nome Sagrado.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 54,
    name: "Nome profano",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Nome Profano.png',
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
    image: '../assets/Cards/Encanto da Traição.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 61,
    name: "Falar com os mortos",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Falar com Mortos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 71,
    name: "Circulo de Invocação",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Circulo de Invocação.png',
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
    image: '../assets/Cards/Cegueira dos Caídos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 80,
    name: "Reviver Tropa",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Reviver Tropa.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 82,
    name: "Cura de Sangue",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Cura de Sangue.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 92,
    name: "Mochila de recursos",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Mochila de Recursos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 93,
    name: "Chamar Tropa",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Chamar Tropa.png',
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
    image: '../assets/Cards/Furtar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 100,
    name: "Toque de Cura",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Toque de Cura.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 101,
    name: "Antidoto",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Antidoto.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 112,
    name: "Busca elemental",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Busca Elemental.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 113,
    name: "Previsão",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Previsão.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 114,
    name: "Recuar",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Recuar.png',
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
    image: '../assets/Cards/Sacrifício.png',
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
    image: '../assets/Cards/Refletir.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 129,
    name: "Armadilha de Urso",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Armadilha de Urso.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 131,
    name: "Trazer dos Mortos",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Trazer dos Mortos.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 132,
    name: "Escavação",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Escavação.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 133,
    name: "Visão Espectral",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/visão espectral.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 134,
    name: "Elevar Moral",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Elevar Moral.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 135,
    name: "Provocar",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Provocar.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 64,
    name: "Ataque de Canivetes",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Ataque de Canivetes.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 65,
    name: "Chamar gangue",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Chamar Gangue.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 66,
    name: "Peste Negra",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Peste Negra.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 72,
    name: "Leptospirose",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Leptospirose.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 81,
    name: "Plantar arma",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Plantar Arma.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 83,
    name: "Pacto",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Pacto.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 62,
    name: "Maldição da Escolha",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Maldição da Escolha.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 67,
    name: "Maldição da Morte",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Maldição da Morte.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 68,
    name: "Amaldiçoar Arma",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Amaldiçoar Arma.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 69,
    name: "Maldição do Esquecimento",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Maldição do Esquecimento.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 116,
    name: "Maldição da Destruição",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Maldição da Destruição.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 118,
    name: "Maresia",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Maresia.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 128,
    name: "Amaldiçoar Estrutura",
    type: "feitiço",
    cost: 2,
    image: '../assets/Cards/Amaldiçoar Estrutura.png',
    effect: (teste) => {
      console.log(teste) // enemy = inimigo em geral, tropa = qualquer tropa em campo, any = qualquer um pode receber o efeito, mage = apenas o mago inimigo
    },
    description: ""
  },
  {
    id: 37,
    name: "Espada dos Mil Mortos",
    type: "arma",
    cost: 6,
    image: '../assets/Cards/Espada dos Mil Mortos.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 38,
    name: "Arco de Ranbow",
    type: "arma",
    cost: 6,
    image: '../assets/Cards/Arco de Ranbow.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 47,
    name: "Pele de Luokis",
    type: "arma",
    cost: 6,
    image: '../assets/Cards/Pele de Luokis.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 48,
    name: "Machado",
    type: "arma",
    cost: 6,
    image: '../assets/Cards/Machado.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 49,
    name: "Arco Elemental",
    type: "arma",
    cost: 6,
    image: '../assets/Cards/Arco Elemental.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 99,
    name: "Faca de Brinquedo",
    type: "arma",
    cost: 6,
    image: '../assets/Cards/Faca de Brinquedo.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 56,
    name: "Torre",
    type: "torre",
    cost: 6,
    image: '../assets/Cards/Torre.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 58,
    name: "Torreta",
    type: "torre",
    cost: 6,
    image: '../assets/Cards/Torreta.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 59,
    name: "Muro de terra",
    type: "torre",
    cost: 6,
    image: '../assets/Cards/Muro de Terra.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 91,
    name: "Canhão",
    type: "torre",
    cost: 6,
    image: '../assets/Cards/Canhão.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 109,
    name: "Canhão de Mana Instável",
    type: "torre",
    cost: 6,
    image: '../assets/Cards/Canhão de Mana Instável.png',
    atk: 2,
    hp: 1,
  },
  {
    id: 20,
    name: "Assassino",
    type: "criatura",
    image: '../assets/Cards/Assassino.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 21,
    name: "Cavaleiro",
    type: "criatura",
    image: '../assets/Cards/Cavaleiro.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 22,
    name: "Goblin",
    type: "criatura",
    image: '../assets/Cards/Goblin.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 23,
    name: "Guerreiro",
    type: "criatura",
    image: '../assets/Cards/Guerreiro.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 24,
    name: "Arqueiro",
    type: "criatura",
    image: '../assets/Cards/Arqueiro.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 25,
    name: "Golém",
    type: "criatura",
    image: '../assets/Cards/Golem.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 63,
    name: "Cachorro",
    type: "criatura",
    image: '../assets/Cards/Cachorro.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 74,
    name: "Cavalo",
    type: "criatura",
    image: '../assets/Cards/Cavalo.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 75,
    name: "Escudeiro",
    type: "criatura",
    image: '../assets/Cards/Escudeiro.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 77,
    name: "Goblin Sombrio",
    type: "criatura",
    image: '../assets/Cards/Goblin Sombrio.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 88,
    name: "Ladino",
    type: "criatura",
    image: '../assets/Cards/Ladino.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 89,
    name: "Enxame de Ratos",
    type: "criatura",
    image: '../assets/Cards/Enxame de Ratos.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 95,
    name: "Esqueleto",
    type: "criatura",
    image: '../assets/Cards/Esqueleto.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 98,
    name: "Médico da Peste",
    type: "criatura",
    image: '../assets/Cards/Médico da Peste.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 130,
    name: "Rebelde",
    type: "criatura",
    image: '../assets/Cards/Rebelde.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 44,
    name: "Salamandra",
    type: "criatura",
    image: '../assets/Cards/Salamandra.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 110,
    name: "Cágado de magma",
    type: "criatura",
    image: '../assets/Cards/Cagado.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 111,
    name: "Dançarina das Chamas",
    type: "criatura",
    image: '../assets/Cards/Dançarina das Chamas.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 117,
    name: "Esqueleto em Chamas",
    type: "criatura",
    image: '../assets/Cards/Esqueleto em Chamas.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 26,
    name: "Golém de água",
    type: "criatura",
    image: '../assets/Cards/Golem de água.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 41,
    name: "Piranha",
    type: "criatura",
    image: '../assets/Cards/Piranha.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
{
    id: 42,
    name: "Toupeira",
    type: "criatura",
    image: '../assets/Cards/Toupeira.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 76,
    name: "Árvore Lanukia",
    type: "criatura",
    image: '../assets/Cards/Arvore Lanukia.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 78,
    name: "Planta Carnivora",
    type: "criatura",
    image: '../assets/Cards/Planta Carnívoro.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 43,
    name: "Beija flor de Fagniz",
    type: "criatura",
    image: '../assets/Cards/Beija-flor de Fagniz.png',
    attackPattern: "front",
    cost: 4,
    atk: 2,
    hp: 1,
    mana: 1
  },
  {
    id: 28,
    name: "Aprendiz de mago",
    type: "mago",
    image: "../assets/Cards/Aprendiz de Mago.png",
    hp: 18
  },
  {
    id: 16,
    name: "Mago de fogo",
    type: "mago",
    image: "../assets/Cards/Mago de fogo.png",
    hp: 18
  },
  {
    id: 17,
    name: "Mago de água",
    type: "mago",
    image: "../assets/Cards/Mago de água.png",
    hp: 18
  },
  {
    id: 19,
    name: "Mago de ar",
    type: "mago",
    image: "../assets/Cards/Mago de ar.png",
    hp: 18
  },
  {
    id: 18,
    name: "Mago de terra",
    type: "mago",
    image: "../assets/Cards/Mago de terra.png",
    hp: 18
  },
  {
    id: 29,
    name: "Bruxo",
    type: "mago",
    image: "../assets/Cards/Bruxo.png",
    hp: 18
  },
  {
    id: 70,
    name: "Druida",
    type: "mago",
    image: "../assets/Cards/Druida.png",
    hp: 18
  },
  {
    id: 108,
    name: "Necromante",
    type: "mago",
    image: "../assets/Cards/Necromante.png",
    hp: 18
  }
];
