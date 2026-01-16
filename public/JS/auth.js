function renderNavbar() {
    // Busca em ambos (prioridade para session se houver conflito)
    const profile = JSON.parse(localStorage.getItem("playerProfile")) ||
        JSON.parse(sessionStorage.getItem("playerProfile"))

    const authLinks = document.getElementById('auth-links');

    if (profile) {
        authLinks.innerHTML = `
            <a href="/HTML/perfil.html" class="nav-profile">
                <img src="${profile.avatarURL}" alt="Avatar" class="nav-avatar">
                <span>${profile.nome}</span>
            </a>
            <button onclick="logout()" class="btn-logout">Sair</button>
        `;
    }
}

// Sincroniza o banco de dados com os do navegador
async function syncDB() {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token")
    const user = JSON.parse(localStorage.getItem("playerProfile")) || JSON.parse(sessionStorage.getItem("playerProfile"))

    if (!token || !user) {
        console.log('Usuário não excontrado')
        return
    }

    try {

        const [resUser, resDecks] = await Promise.all([
            fetch(`/user/${user.id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`/decks/user/${user.id}`, { headers: { 'Authorization': `Bearer ${token}` } })
        ])
        const dataUser = await resUser.json()
        const dataDecks = await resDecks.json();

        if (dataUser.success && dataDecks.success) {
            const serverDecks = dataDecks.decks
            const localDecks = user.decks || []

            // const decksParaSubir = localDecks.filter(local => 
            //     !serverDecks.some(server => server._id === local._id) && !local._id
            // );

            // // 3. Sincroniza os decks faltantes para o banco
            // if (decksParaSubir.length > 0) {
            //     alert(`Sincronizando ${decksParaSubir.length} novos decks locais...`);
            //     for (const deck of decksParaSubir) {
            //         await fetch(`/decks/user`, {
            //             method: 'POST',
            //             headers: { 
            //                 'Content-Type': 'application/json',
            //                 'Authorization': `Bearer ${token}` 
            //             },
            //             body: JSON.stringify({
            //                 nome: deck.nome,
            //                 cartas: deck.cartas,
            //                 mago: deck.mago,
            //                 icone: deck.icone
            //             })
            //         });
            //     }
            //     // Recarrega os decks do servidor após o upload para pegar os novos IDs
            //     return syncDB(); 
            // }

            // // 4. Atualiza o estado global com a verdade vinda do servidor
            // playerProfile = {
            //     id: dataUser.user._id,
            //     nome: dataUser.user.nome,
            //     avatarURL: dataUser.user.avatarURL,
            //     nivel: dataUser.user.nivel,
            //     vitorias: dataUser.user.vitorias,
            //     partidas: dataUser.user.partidas,
            //     decks: serverDecks // O servidor é a fonte da verdade final
            // };

            // colecaoDeDecks = playerProfile.decks;
            
            // // Renderização condicional por página
            // const path = window.location.pathname;
            // if (path.includes("deckbuilder.html") || path === "/") {
            //     atualizarSelectDecks();
            //     renderDeck();
            // }
            // if (path.includes("perfil.html")) renderPerfil();

            // salvarDados();
            // showSync(true)
            // console.log("Sincronização Completa!");

            playerProfile = {
                ...dataUser.user,
                id: dataUser.user._id,
                decks: serverDecks
            }

            colecaoDeDecks = playerProfile.decks

            salvarDados()

            const path = window.location.pathname
            if (path.includes("deckbuilder.html") || path === "/") {
                atualizarSelectDecks();
                renderDeck();
            }

            if (path.includes("perfil.html")) renderPerfil()

            showSync(true)
        }

    } catch (error) {
        console.error("Erro na sincronização dupla:", error)
    }
}

function showSync(sucesso) {
    const indicator = document.getElementById("sync-indicator");
    const text = document.getElementById("sync-text");
    
    if (!indicator) return;

    if (sucesso) {
        indicator.className = "sync-success";
        text.innerText = "Sincronizado";
        setTimeout(() => {
            indicator.style.display = 'none'
        }, 3000);
    } else {
        indicator.className = "sync-error";
        text.innerText = "Erro de Sincronização";
    }
}

function logout() {
    localStorage.clear()
    sessionStorage.clear()
    window.location.reload(); // Recarrega para voltar ao estado deslogado
}


window.addEventListener('load', async () => {
    renderNavbar()
    await syncDB()
})
