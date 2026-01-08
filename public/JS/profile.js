let playerProfile = JSON.parse(localStorage.getItem("playerProfile")) || JSON.parse(sessionStorage.getItem("playerProfile"))

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

// Função auxiliar para ler arquivos como Promessa (Promise)
const lerArquivo = (arquivo) => new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result); // Resolve com a string Base64
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
});

async function salvarAlteracoes() {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    const btnSalvar = document.querySelector(".btn-salvar-perfil"); // Se tiver classe no botão

    if (!token) {
        alert("Você precisa estar logado!");
        window.location.href = "login.html";
        return;
    }

    const novoNome = document.getElementById("input-nome").value;
    const inputFoto = document.getElementById("input-foto");
    
    // Feedback visual (opcional)
    if(btnSalvar) btnSalvar.textContent = "Salvando...";

    let avatarParaEnviar = playerProfile.avatarURL; // Mantém o atual por padrão

    // 1. Processar Imagem (se houver nova)
    if (inputFoto.files && inputFoto.files[0]) {
        const arquivo = inputFoto.files[0];

        // DICA: Validar tamanho (ex: máx 200KB para não pesar no MongoDB)
        if (arquivo.size > 200 * 1024) {
            alert("A imagem é muito grande! Escolha uma menor que 200KB.");
            if(btnSalvar) btnSalvar.textContent = "Salvar";
            return;
        }

        try {
            avatarParaEnviar = await lerArquivo(arquivo); // Espera a leitura terminar!
        } catch (erro) {
            console.error("Erro ao ler imagem", erro);
            return;
        }
    }

    // 2. Enviar para o Backend
    try {
        const res = await fetch('/auth/user/edit', { // URL completa ajuda
            method: 'PUT',
            headers: {
                'Content-Type': "application/json",
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ // OBRIGATÓRIO: Transformar em string
                nome: novoNome,
                avatarURL: avatarParaEnviar
            })
        });

        const data = await res.json();

        if (data.success) {
            // Atualiza o objeto local com o que voltou do servidor (garantia de sincronia)
            playerProfile.nome = data.user.nome;
            playerProfile.avatarURL = data.user.avatarURL;
            renderPerfil()
            finalizarSalvamento();
            alert("Perfil atualizado com sucesso!");
            window.location.reload()
        } else {
            alert("Erro: " + data.content);
        }

    } catch (error) {
        console.error("Erro na requisição:", error);
        alert("Erro ao conectar com o servidor.");
    } finally {
        if(btnSalvar) btnSalvar.textContent = "Salvar";
    }
}   

function finalizarSalvamento() {
    localStorage.setItem("playerProfile", JSON.stringify(playerProfile));
    renderPerfil();
    fecharPainel();
}

function renderPerfil() {
    document.getElementById("player-name").innerText = playerProfile.nome
    document.getElementById("player-avatar").src = playerProfile.avatarURL || "public/assets/avatar.png";

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