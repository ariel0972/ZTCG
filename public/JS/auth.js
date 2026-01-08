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

function logout() {
    localStorage.removeItem("playerProfile");
    sessionStorage.removeItem("playerProfile");
    window.location.reload(); // Recarrega para voltar ao estado deslogado
}

// Chame a função sempre que a página abrir
window.onload = renderNavbar;