function renderNavbar() {
    // Busca em ambos (prioridade para session se houver conflito)
    const profile = JSON.parse(localStorage.getItem("playerProfile")) ||
        JSON.parse(sessionStorage.getItem("playerProfile"))

    const authLinks = document.getElementById('auth-links');

    if (profile) {
        authLinks.innerHTML = `
            <a href="perfil.html" class="nav-profile">
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

    if (!token || !user) return

    console.log(user)
    try {
        // 1. Busca Dados do Usuário (Nome, Nível, XP)
        const resUser = await fetch(`/user/${user._id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const dataUser = await resUser.json();

        const resDecks = await fetch(`/decks/user/${user._id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const dataDecks = await resDecks.json();

        if (dataUser.success && dataDecks.success) {
            playerProfile = {
                id: dataUser.user.id,
                nome: dataUser.user.nome,
                avatarURL: dataUser.user.avatarURL,
                nivel: dataUser.user.nivel,
                vitorias: dataUser.user.vitorias,
                partidas: dataUser.user.partidas,
                decks: dataDecks.decks
            };
            
            colecaoDeDecks = playerProfile.decks;

            salvarDados();
            atualizarSelectDecks();
            renderDeck();

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
    await syncDB()
})
