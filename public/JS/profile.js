let playerProfile = JSON.parse(localStorage.getItem("playerProfile")) || {
    nome: "Novo Duelista",
    avatar: "assets/avatar.png",
    nivel: 1,
    xp: 0,
    vitorias: 0,
    decks: [
        { nome: "Deck Inicial", cartas: [], mago: null }
    ]
}

let colecaoDeDecks = playerProfile.decks;

function salvarDados() {
    playerProfile.decks = colecaoDeDecks;
    localStorage.setItem("playerProfile", JSON.stringify(playerProfile));
}


function editarPerfil() {
    document.querySelector('.overlay').classList.add('active');
    document.querySelector('.edit-panel').classList.add('active');

    document.getElementById("input-nome").value = playerProfile.nome;
}

function fecharPainel() {
    document.querySelector('.overlay').classList.remove('active');
    document.querySelector('.edit-panel').classList.remove('active');
}

function salvarAlteracoes() {
    const novoNome = document.getElementById("input-nome").value;
    const inputFoto = document.getElementById("input-foto");

    if (novoNome) {
        playerProfile.nome = novoNome;
    }

    if (inputFoto.files && inputFoto.files[0]) {
        const leitor = new FileReader();

        leitor.onload = function (e) {
            playerProfile.avatar = e.target.result;
            finalizarSalvamento();
        };

        leitor.readAsDataURL(inputFoto.files[0]);
    } else {
        finalizarSalvamento();
    }
}

function finalizarSalvamento() {
    localStorage.setItem("playerProfile", JSON.stringify(playerProfile));
    renderPerfil();
    fecharPainel();
    alert("Perfil atualizado com sucesso!");
}

function renderPerfil() {
    document.getElementById("player-name").innerText = playerProfile.nome;
    document.getElementById("player-avatar").src = playerProfile.avatar || "assets/avatar.png";

    const decks = document.getElementById('lista-decks')
    decks.innerHTML = ``

    colecaoDeDecks.forEach(deck => {
        const p = document.createElement("p")
        p.classList.add("deck-profil-list")
        p.innerHTML = `${deck.nome} - ${deck.mago.name}`

        decks.appendChild(p)
    });
}



renderPerfil()