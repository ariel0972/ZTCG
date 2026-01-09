// Tenta pegar o índice salvo, se não existir, usa 0
let deckAtualIndex = parseInt(localStorage.getItem("ultimoDeckSelecionado")) || 0
let cardSelect = null
let playerProfile = JSON.parse(localStorage.getItem("playerProfile")) || {
  nome: "Novo Duelista",
  avatarURL: "../assets/avatar.png",
  nivel: 1,
  vitorias: 0,
  decks: [
    { nome: "Deck Inicial", cartas: [], mago: null }
  ]
}

let colecaoDeDecks = playerProfile.decks

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
      console.log(deckAtual.cartas)
      removeFromDeck(card.id);
    }
    deckContainer.appendChild(div);
  });
  const mago = document.getElementById("mage-container")
  mago.innerHTML = ""
  if (deckAtual.mago && deckAtual.mago.image) {
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

  if (!index !== -1) {
    deckAtual.splice(index, 1)
    renderDeck();
  }
}

// Botão para Salvar o Deck
document.getElementById("save-deck").onclick = async () => {
  const deckAtual = colecaoDeDecks[deckAtualIndex]

  if (deckAtual.cartas.length < 10) {
    alert("Seu deck precisa ter pelo menos 10 cartas!");
    return;
  }

  const token = localStorage.getItem("token") || sessionStorage.getItem("token");

  if (!token) {
    alert('Você precisa estar logado no banco')
    return
  }


  console.log(deckAtual)
  try {

    const res = await fetch(`/decks/${deckAtual._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': "application/json",
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        nome: deckAtual.nome,
        cartas: deckAtual.cartas,
        mago: deckAtual.mago
      })
    })

    const data = await res.json()

    if (data.success) {
      salvarDados()
      atualizarSelectDecks()
      alert(data.content)
    } else {
      alert("Erro ao salvar")
    }
  } catch (error) {
    console.error(error)
  }
}

document.getElementById("edit-deck").onclick = async () => {
  const deckAtual = colecaoDeDecks[deckAtualIndex];
  document.getElementById("modal-edicao").style.display = "flex";
  document.getElementById("input-editar-nome").value = deckAtual.nome

  const token = localStorage.getItem("token") || sessionStorage.getItem("token");

  if (!token) {
    alert('Você precisa estar logado no banco')
    return
  }

  renderizarOpcoesIcones()
}

document.getElementById("delete-deck").onclick = async () => {
 const deckAtual = colecaoDeDecks[deckAtualIndex];

    // Segurança: Não deixa deletar se for o único deck
    if (colecaoDeDecks.length <= 1) {
        alert("Você precisa ter pelo menos um deck!")
        return
    }

    const confirmar = confirm(`Tem certeza que deseja excluir o deck "${deckAtual.nome}"?`);
    if (!confirmar) return;

    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    try {
        const res = await fetch(`/decks/${deckAtual._id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await res.json();

        if (data.success) {
            alert(data.content);

            // 1. Remove do array local
            colecaoDeDecks.splice(deckAtualIndex, 1);

            // 2. Ajusta o índice para não apontar para o vazio
            deckAtualIndex = 0; 
            
            // 3. Atualiza tudo na tela
            salvarDados(); // Salva no LocalStorage
            atualizarSelectDecks();
            renderDeck();
        } else {
            alert("Erro: " + data.content);
        }
    } catch (error) {
        console.error("Erro na requisição:", error);
    }
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
  localStorage.setItem("ultimoDeckSelecionado", deckAtualIndex);
  renderDeck(); // Re-renderiza a lista de cartas do novo deck selecionado
};

document.getElementById("btn-novo-deck").onclick = async () => {
  const token = localStorage.getItem("token") || sessionStorage.getItem("token");

  if (!token) {
    alert("Você precisa estar logado para criar um deck!")
    window.location.href = "/HTML/login.html"
    return
  }

  const nome = prompt("Qual o nome do novo deck?");
  if (nome) {
    try {

      const res = await fetch(`/decks/user`, {
        method: 'POST',
        headers: {
          'Content-Type': "application/json",
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          nome: nome,
          cartas: [],
          mago: "null"
        })
      })

      const data = await res.json()

      if (data.success) {
        colecaoDeDecks.push(data.deck)
        deckAtualIndex = colecaoDeDecks.length - 1;
        atualizarSelectDecks();
        renderDeck()
        salvarDados()
        alert(data.content)
      } else {
        alert("Erro ao salvar")
      }
    } catch (error) {
      console.error(error)
    }
  }
};

// document.getElementById("btn-principal").onclick = () => {
//   // Salva o ID ou o índice do deck principal no perfil do jogador
//   playerProfile.deckPrincipalIndex = deckAtualIndex;

//   salvarDados(); // Usa sua função que já salva o playerProfile no localStorage
//   alert(`O deck "${colecaoDeDecks[deckAtualIndex].nome}" agora é o seu principal!`);
//   atualizarSelectDecks(); // Para mostrar algum destaque visual, se quiser
// };

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
  const autor = document.querySelector('.export-credits')

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

  autor.innerText = `Feito por ${playerProfile.nome}`

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

// Função para carregar o conteúdo do CSV
async function carregarCSV() {
  try {
    const response = await fetch('../assets/cards.csv'); // Caminho do seu arquivo
    const texto = await response.text();
    return texto;
  } catch (erro) {
    console.error("Erro ao carregar o CSV:", erro);
  }
}

// 1. Sua lógica de sincronização (melhorada)
function exportarCSV(csvContent, cardsArray) {
  const counts = {};
  cardsArray.forEach(card => {
    const name = card.name.toLowerCase().trim();
    counts[name] = (counts[name] || 0) + 1;
  });

  const lines = csvContent.split('\n');
  const header = lines[0];
  const updatedRows = lines.slice(1).map(line => {
    if (!line.trim()) return line;
    const columns = line.split(',');
    const cardLabel = columns[1].toLowerCase().trim();

    // Atualiza o item-count (coluna 2)
    columns[2] = counts[cardLabel] || 0;
    return columns.join(',');
  });

  return [header, ...updatedRows].join('\n');
}

// 2. Função que será chamada pelo botão
async function handleUpdateClick() {
  // Array de exemplo (no seu caso, viria do estado do seu deck/inventário)
  const deckInput = colecaoDeDecks[deckAtualIndex].cartas

  // Passo A: Lê o arquivo original
  const csvOriginal = await carregarCSV();

  if (csvOriginal) {
    // Passo B: Processa os dados
    const csvFinal = exportarCSV(csvOriginal, deckInput);

    // Passo C: Cria um link de download automático para o usuário
    downloadCSV(csvFinal, `ztcg_${colecaoDeDecks[deckAtualIndex].nome} - ${playerProfile.nome}.csv`);
  }
}

function downloadCSV(content, fileName) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.getElementById('btn-atualizar-csv').addEventListener('click', handleUpdateClick);


/* Modal de edição */

function fecharModalEdicao() {
  document.getElementById("modal-edicao").style.display = "none";
}

// 3. Renderiza os ícones dentro do modal
function renderizarOpcoesIcones() {
  const container = document.getElementById("icon-selector");
  // container.innerHTML = "";

  // listaIcones.forEach(path => {
  //     const img = document.createElement("img");
  //     img.src = path;
  //     img.className = "icon-option";
  //     if (path === iconeSelecionadoTemp) img.classList.add("selected");

  //     img.onclick = () => {
  //         iconeSelecionadoTemp = path;
  //         renderizarOpcoesIcones(); // Re-renderiza para mostrar o destaque
  //     };
  //     container.appendChild(img);
  // });
}

document.getElementById("btn-confirmar-edicao").onclick = async () => {
  const novoNome = document.getElementById("input-editar-nome").value;

  const deckAtual = colecaoDeDecks[deckAtualIndex]

  if (novoNome.trim() === "") {
    alert("O nome não pode ser vazio!");
    return;
  }

  // Atualiza no objeto local
  deckAtual.nome = novoNome;
  // colecaoDeDecks[deckAtualIndex].icone = iconeSelecionadoTemp;

  const token = localStorage.getItem("token") || sessionStorage.getItem("token");

  if (!token) {
    alert('Você precisa estar logado no banco')
    return
  }

  try {

    const res = await fetch(`/decks/${deckAtual._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': "application/json",
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        nome: deckAtual.nome,
        cartas: deckAtual.cartas,
        mago: deckAtual.mago
      })
    })

    const data = await res.json()

    if (data.success) {
      salvarDados()
      atualizarSelectDecks()
      alert(data.content)
    } else {
      alert("Erro ao salvar")
    }
  } catch (error) {
    console.error(error)
  }

  salvarDados(); // Sua função que salva no localStorage
  renderDeck();  // Atualiza o nome no cabeçalho
  atualizarSelectDecks(); // Atualiza o nome no seletor
  fecharModalEdicao();
};

renderDeck()
renderCards()
atualizarSelectDecks()

