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
    const token = localStorage.getItem("token") ||
        sessionStorage.getItem("token")

    const user = JSON.parse(localStorage.getItem("playerProfile")) || JSON.parse(sessionStorage.getItem("playerProfile"))

    if (!token || !user) {
        alert('Seu acesso foi negado, expirado ou excluído')
        return
    }

    try {
        // 1. Busca Dados do Usuário (Nome, Nível, XP)
        const resUser = await fetch(`/user/${user.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const dataUser = await resUser.json();

        const resDecks = await fetch(`/decks/user/${user.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const dataDecks = await resDecks.json();

        if (dataUser.success && dataDecks.success) {
            playerProfile = {
                id: dataUser.user._id,
                nome: dataUser.user.nome,
                avatarURL: dataUser.user.avatarURL,
                nivel: dataUser.user.nivel,
                vitorias: dataUser.user.vitorias,
                partidas: dataUser.user.partidas,
                decks: dataDecks.decks
            };
            
            colecaoDeDecks = playerProfile.decks;
            if (window.location.pathname === "/HTML/deckbuilder.html" || window.location.pathname === "/") {
                atualizarSelectDecks()
                renderDeck()
            }

            if (window.location.pathname === '/HTML/perfil.html') renderPerfil()

            salvarDados()
            

            alert("Sincronização Completa")
        }

    } catch (error) {
        console.error("Erro na sincronização dupla:", error);
    }
}

function logout() {
    localStorage.clear()
    sessionStorage.clear()
    window.location.reload(); // Recarrega para voltar ao estado deslogado
}


window.addEventListener('load', async () => {
    renderNavbar()
    // await syncDB()
})
