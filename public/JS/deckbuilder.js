let deckAtualIndex = 0
let cardSelect = null
let playerProfile = JSON.parse(localStorage.getItem("playerProfile")) || {
    nome: "Novo Duelista",
    avatar: "assets/avatar/avatar_padrao.png",
    nivel: 1,
    xp: 0,
    vitorias: 0,
    decks: [
        { nome: "Deck Inicial", cartas: [], mago: null }
    ]
};
let colecaoDeDecks = playerProfile.decks;

function salvarDados() {
    // Atualizamos a lista de decks dentro do objeto de perfil antes de salvar
    playerProfile.decks = colecaoDeDecks; 
    localStorage.setItem("playerProfile", JSON.stringify(playerProfile));
}

function definirMago(card) {
  if (card.type !== "mago") {
    alert("Gay")
    return
  }
  colecaoDeDecks[deckAtualIndex].mago = card
  renderDeck()
  alert(`${card.name} é o seu novo Mago!`)
}

function renderCards(filtro = "todos") {
  const container = document.getElementById("card-list");
  container.innerHTML = "";

  const cardFilter = filtro === 'todos'
    ? allCards
    : allCards.filter(card => card.type === filtro);

  cardFilter.forEach(card => {
    const div = document.createElement("div");
    div.classList.add("card");
    div.innerHTML = `
      <img src="${card.image}" alt="${card.name}" class="card-img">
    `;
    div.onclick = () => {
      if (cardSelect === div) {
        console.log(cardSelect)
        clearPreview()
      } else {
        if (cardSelect) {
          cardSelect.classList.remove("selected")
        }
        div.classList.add("selected")
        cardSelect = div
        showPreview(card)
      }
    }
    container.appendChild(div);
  });
}

function renderDeck() {
  const deckContainer = document.getElementById("deck-cards");
  deckContainer.innerHTML = "";

  const deckAtual = colecaoDeDecks[deckAtualIndex]

  const count = {};
  deckAtual.cartas.forEach(card => {
    count[card.id] = (count[card.id] || 0) + 1
  })

  const uniCards = deckAtual.cartas.filter((card, index, self) =>
    index === self.findIndex((t) => t.id === card.id)
  )

  uniCards.forEach((card) => {
    const div = document.createElement("div");
    div.classList.add("card");
    div.innerHTML = `
      <div class="card-counter">${count[card.id]}X</div>
      <img src="${card.image}" alt="${card.name}" class="card-img">
    `;
    div.onclick = () => {
      removeFromDeck(card.id);
    }
    deckContainer.appendChild(div);
  });
  const mago = document.getElementById("mage-container")
  mago.innerHTML = ""
  if (deckAtual.mago && deckAtual.mago.image){
    const img = document.createElement("img")
    img.classList.add("mago")
    img.src = deckAtual.mago.image
    mago.appendChild(img)
  } else {
    mago.innerHTML = "<p style='color: #5170ff; text-align: center;'>Selecione seu Mago Principal</p>";
  }

  document.getElementById("deck-count").innerText = colecaoDeDecks[deckAtualIndex].cartas.length;
  document.getElementById("actual-deck").innerText = colecaoDeDecks[deckAtualIndex].nome
}

function addToDeck(card) {
  if (colecaoDeDecks[deckAtualIndex].cartas.length >= 40) {
    alert("Deck cheio! Máximo 40 cartas.");
    return;
  }

  if (card.type === "criatura") {
    const cardCount = colecaoDeDecks[deckAtualIndex].cartas.filter(item => item.id === card.id).length
    if (cardCount >= 3) {
      alert("Não pode ter mais de 3 cartas iguais no deck ")
      return
    }
  } 
  
  if (card.type === "feitiço") {
    const cardCount = colecaoDeDecks[deckAtualIndex].cartas.filter(item => item.id === card.id).length
    if (cardCount >= 3) {
      alert("Não pode ter mais de 3 cartas iguais no deck ")
      return
    }
  }

  if (card.type === "arma") {
    const cardCount = colecaoDeDecks[deckAtualIndex].cartas.filter(item => item.id === card.id).length
    if (cardCount >= 2) {
      alert("Não pode ter mais de 2 cartas iguais no deck ")
      return
    }
  }

  if (card.type === "estrutura") {
    const cardCount = colecaoDeDecks[deckAtualIndex].cartas.filter(item => item.id === card.id).length
    if (cardCount >= 2) {
      alert("Não pode ter mais de 2 cartas iguais no deck ")
      return
    }
  }

  colecaoDeDecks[deckAtualIndex].cartas.push(card)
  renderDeck();
}

function removeFromDeck(cardId) {
  const deckAtual = colecaoDeDecks[deckAtualIndex].cartas

  const index = deckAtual.findIndex(card => card.id === cardId)

  if (!index !== -1){
    deckAtual.splice(index, 1)
    renderDeck();
  }
}

// Botão para Salvar o Deck
document.getElementById("save-deck").onclick = () => {
  if (colecaoDeDecks[deckAtualIndex].cartas.length < 10) {
    alert("Seu deck precisa ter pelo menos 10 cartas!");
    return;
  }
  localStorage.setItem("colecaoDeDecks", JSON.stringify(colecaoDeDecks));
  salvarDados()
  atualizarSelectDecks()
  alert("Deck salvo com sucesso!");
  window.location.href = "index.html"; // volta para o jogo
};

function atualizarSelectDecks() {
  const select = document.getElementById("seletor-decks");
  select.innerHTML = "";
  colecaoDeDecks.forEach((deck, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.text = deck.nome;
    select.appendChild(option);
  });
  select.value = deckAtualIndex;
}

// Quando mudar o select, trocamos o deck atual
document.getElementById("seletor-decks").onchange = (e) => {
  deckAtualIndex = e.target.value;
  renderDeck(); // Re-renderiza a lista de cartas do novo deck selecionado
};

document.getElementById("btn-novo-deck").onclick = () => {
  const nome = prompt("Qual o nome do novo deck?");
  if (nome) {
    colecaoDeDecks.push({ nome: nome, cartas: [] });
    deckAtualIndex = colecaoDeDecks.length - 1; // Vai para o novo deck
    atualizarSelectDecks();
    renderDeck();
  }
};


function showPreview(card) {
  const container = document.querySelector(".preview-sidebar")
  const cardPreview = document.getElementById("card-preview")
  const btn = document.getElementById("btn-new-card")
  const btnMago = document.getElementById("addMago")

  cardPreview.innerHTML = `
  <img src="${card.image}" class="card-img">
  <div>
    <p>Nome: ${card.name}<br>
    Custo de Mana: ${card.cost}<br>
    Tipo: ${card.type}
    <p>${card.description}</p>
    <p>${card.type == "criatura" ? `Atq: ${card.atk} Hp: ${card.hp}` : ""}</p>
  </div>
  `
  btn.style.display = "block"

  btn.onclick = () => {
    addToDeck(card)
  }

  if (card.type === "mago") {
    document.getElementById("addMago").style.display = "block"
    btn.style.display = "none"

    btnMago.onclick = () => {
      definirMago(card)
    }
  } else {
     document.getElementById("addMago").style.display = "none"
  }
}

function clearPreview() {
  const cardPreview = document.getElementById("card-preview")
  const btnAdd = document.getElementById("btn-new-card")
  const btnMago = document.getElementById("addMago")

  // Limpa o texto e esconde o botão
  cardPreview.innerHTML = "Selecione uma carta..."
  btnAdd.style.display = "none"
  btnMago.style.display = "none"

  // Remove o destaque visual da carta na lista
  if (cardSelect) {
    cardSelect.classList.remove("selected")
    cardSelect = null
  }
}

async function exportDeck() {
  const deck = colecaoDeDecks[deckAtualIndex];
  const grid = document.getElementById("export-grid");
  const magoContainer = document.getElementById("export-mago-preview");
  
  // 1. Atualiza Nome e Limpa containers
  document.getElementById("export-deck-name").innerText = `${deck.nome}`;
  grid.innerHTML = "";
  magoContainer.innerHTML = "";

  // 2. Lógica de Agrupamento (Contagem)
  const contagem = {};
  deck.cartas.forEach(c => contagem[c.id] = (contagem[c.id] || 0) + 1);
  
  const unicas = deck.cartas.filter((c, i, self) => 
    i === self.findIndex(t => t.id === c.id)
  );

  // 3. Renderiza as cartas no grid de exportação
  unicas.forEach(card => {
    const wrapper = document.createElement("div");
    wrapper.className = "export-card-wrapper";
    wrapper.innerHTML = `
      <div class="export-card-counter">${contagem[card.id]}X</div>
      <img src="${card.image}" style="width: 100%; border-radius: 5px;">
    `;
    grid.appendChild(wrapper);
  });

  // 4. Renderiza o Mago (se existir)
  if (deck.mago) {
    magoContainer.innerHTML = `
      <img src="${deck.mago.image}" style="width: 350px; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.3));">
    `;
  }

  // 5. Tira o print com html2canvas
  const areaExport = document.getElementById("export-area");
  const canvas = await html2canvas(areaExport, { 
    useCORS: true, // Importante para carregar imagens de outros domínios
    scale: 2 // Aumenta a qualidade da imagem
  });

  // 6. Download
  const link = document.createElement("a");
  link.download = `deck-${deck.nome}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}


renderDeck()
renderCards()
atualizarSelectDecks()

