let deck = [];
let mao = [];

// Campos como slots fixos
let campoJogador = [null, null, null];
let campoOponente = [null, null, null];

let hpJogador = 20;
let hpOponente = 20;
let turno = 1;
let jaAtacou = false;

function iniciarJogo() {
  const savedDeck = JSON.parse(localStorage.getItem("meuDeck"));
  if (!savedDeck || savedDeck.length < 10) {
    alert("Você precisa montar um deck antes de jogar!");
    window.location.href = "deckbuilder.html";
    return;
  }

  deck = [...savedDeck];
  embaralhar(deck);

  for (let i = 0; i < 5; i++) comprarCarta();

  renderizarMao();
  renderizarCampo();
  atualizarStatus();
}

function embaralhar(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function comprarCarta() {
  if (deck.length === 0) return;
  mao.push(deck.shift());
}

function renderizarMao() {
  const maoDiv = document.getElementById("mao-jogador");
  maoDiv.innerHTML = "";
  mao.forEach((carta, index) => {
    const div = document.createElement("div");
    div.classList.add("card");
    div.innerText = `${carta.name} (Custo: ${carta.cost})`;
    div.onclick = () => jogarCarta(index);
    maoDiv.appendChild(div);
  });
}

function jogarCarta(i) {
  const carta = mao[i];
  const cartaOriginal = allCards.find(c => c.id === carta.id);
  // Verifica se é tropa e se há espaço no campo
  if (carta.type === "criatura") {
    const slotLivre = campoJogador.indexOf(null);
    if (slotLivre === -1) {
      alert("Você só pode ter 3 tropas no campo!");
      return;
    }
    campoJogador[slotLivre] = carta;
  } else if (carta.type === "feitiço") {
    // Verificamos se a carta original tem o efeito definido
    if (cartaOriginal && typeof cartaOriginal.effect === "function") {

      // Criamos o contexto para o feitiço usar 
      const contexto = {
        campoJogador: campoJogador,
        campoOponente: campoOponente,
        hpOponente: hpOponente,
        causarDanoDireto: (valor) => { hpOponente -= valor; }
      };

      cartaOriginal.effect(contexto);
    } else {
      console.error("Erro: Efeito da carta não encontrado ou não é uma função.");
    }
  }

  mao.splice(i, 1);
  renderizarMao();
  renderizarCampo();
  atualizarStatus();
}

function renderizarCampo() {
  const campoDiv = document.getElementById("campo-jogador");
  campoDiv.innerHTML = "";
  campoJogador.forEach((carta, index) => {
    const div = document.createElement("div");
    div.classList.add("card")
    div.id = `slot-jogador-${index}`
    if (carta) {
      div.innerHTML = `
        ${carta.name} <br>
        ATK: ${carta.atk} | DEF: ${carta.hp} <br>
        Tipo: ${carta.attackPattern}
      `;
      div.onclick = () => atacarComTropa(index);
    }
    campoDiv.appendChild(div);
  });

  const campoOpoDiv = document.getElementById("campo-oponente");
  campoOpoDiv.innerHTML = "";
  campoOponente.forEach((carta, index) => {
    const div = document.createElement("div");
    div.classList.add("card");
    div.id = `slot-oponente-${index}`
    if (carta) {
      div.innerHTML = `
        ${carta.name} <br>
        ATK: ${carta.atk} | DEF: ${carta.hp}
      `;
    }
    campoOpoDiv.appendChild(div);
  });
}

function cartaFeitiço(dmg, alvo) {
  if (alvo) {
    if (alvo === "enemy") {
      const inimigoCamp = campoOponente.some(c => c !== null)

      if (inimigoCamp) {
        campoOponente.forEach((inimigo, i) => {
          if (inimigo) {
            inimigo.hp -= dmg
            if (inimigo.hp <= 0) {
              campoOponente[i] = null
            }
          }
        })
      } else {
        hpOponente -= dmg
      }
    }
  } else {
    hpOponente -= dmg
  }

  renderizarCampo();
  atualizarStatus();
}

async function atacarComTropa(posicao) {
  if (jaAtacou) {
    alert("Você já atacou neste turno!");
    return;
  }
  const tropa = campoJogador[posicao];
  if (!tropa) return;

  const inimigosVivos = campoOponente.some(c => c !== null);
  let alvos = [];
  if (tropa.attackPattern === "front") {
    alvos.push(posicao);
  } else if (tropa.attackPattern === "diagonal") {
    if (posicao > 0) alvos.push(posicao - 1);
    if (posicao < 2) alvos.push(posicao + 1);
  } else if (tropa.attackPattern === "universal") {
    alvos = [posicao];
    if (posicao > 0) alvos.push(posicao - 1);
    if (posicao < 2) alvos.push(posicao + 1);
  }

  let atacou = false;
  if (inimigosVivos) {
    for (let alvo of alvos) {
      if (campoOponente[alvo]) {
        await aplicarEfeitoDano(`slot-oponente-${alvo}`)
        campoOponente[alvo].def -= tropa.atk;
        if (campoOponente[alvo].def <= 0) {
          campoOponente[alvo] = null;
        }
        atacou = true;
        break;
      } else {
        await aplicarEfeitoDano(`hp-oponente`)
        hpOponente -= tropa.atk
        atacou = true
      }

    }
  } else {
    await aplicarEfeitoDano(`hp-oponente`)
    hpOponente -= tropa.atk;
    atacou = true;
  }

  if (atacou) {
    jaAtacou = true;
    renderizarCampo();
    atualizarStatus();
    if (hpOponente <= 0) alert("Você venceu!");
  } else {
    alert("Nenhum inimigo ao alcance para atacar!");
  }
}

function atualizarStatus() {
  document.getElementById("turno").innerText = turno;
  document.getElementById("hp-jogador").innerText = hpJogador;
  document.getElementById("hp-oponente").innerText = hpOponente;
}

// Função auxiliar para esperar X milissegundos
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let turnoDoJogador = true; // Nova flag de controle

async function passarTurno() {
  if (!turnoDoJogador) return; // Impede clicar enquanto a IA joga

  // --- FIM DO TURNO DO JOGADOR ---
  turnoDoJogador = false;
  atualizarIndicadorTurno("Vez do Oponente...");

  // Bloquear interações (ex: ocultar botão de passar turno)
  document.getElementById("passar-turno").style.display = "none";

  // --- TURNO DA IA (Atrasado) ---
  await delay(1200); // Espera 1 segundo antes de começar

  // 1. IA decide se joga carta
  const slotLivre = campoOponente.indexOf(null);
  if (slotLivre !== -1 && Math.random() < 0.6) {
    const cartaAleatoria = allCards.find(c => c.type === "criatura");
    campoOponente[slotLivre] = { ...cartaAleatoria };
    renderizarCampo();
    await delay(1200); // Pausa após jogar a carta para o jogador ver
  }

  // 2. IA decide atacar
  const atacanteIndex = campoOponente.findIndex(c => c);
  if (atacanteIndex !== -1) {
    await executarAtaqueIA(atacanteIndex);
    renderizarCampo();
    atualizarStatus();
    await delay(1200); // Pausa após o ataque
  }

  // --- VOLTA PARA O JOGADOR ---
  turno++;
  jaAtacou = false;
  turnoDoJogador = true;
  comprarCarta();

  document.getElementById("passar-turno").style.display = "block";
  atualizarIndicadorTurno("Sua Vez!");
  renderizarMao();
  renderizarCampo();
  atualizarStatus();

  if (hpJogador <= 0) alert("Você perdeu!");
}

function atualizarIndicadorTurno(mensagem) {
  const el = document.getElementById("status-turno");
  el.innerText = mensagem;
  el.className = turnoDoJogador ? "turno-jogador" : "turno-oponente";
}

async function aplicarEfeitoDano(idElemento) {
  const elemento = document.getElementById(idElemento);
  if (!elemento) return;

  // Adiciona a classe de animação
  elemento.classList.add("shake");
  
  // Espera a animação terminar (0.4s no CSS = 400ms aqui)
  await delay(400);
  
  // Remove a classe para poder repetir depois
  elemento.classList.remove("shake");
  console.log(idElemento)
}

// Extraímos a lógica de ataque da IA para ficar mais limpo
async function executarAtaqueIA(index) {
  const tropa = campoOponente[index];
  const inimigosVivos = campoJogador.some(c => c !== null);

  if (inimigosVivos) {
    const alvo = campoJogador.findIndex(c => c);
    if (alvo !== -1) {
      campoJogador[alvo].def -= tropa.atk;
      await aplicarEfeitoDano(`slot-jogador-${alvo}`)
      if (campoJogador[alvo].def <= 0) campoJogador[alvo] = null;
    }
  } else {
    await aplicarEfeitoDano("hp-jogador")
    hpJogador -= tropa.atk;
  }
}


document.getElementById("passar-turno").onclick = passarTurno;

iniciarJogo()