import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDt8z1zNvG43sgiUKwcGQCx79KRNq_5Cjc",
    authDomain: "nordgo-food.firebaseapp.com",
    projectId: "nordgo-food",
    storageBucket: "nordgo-food.firebasestorage.app",
    messagingSenderId: "318696200197",
    appId: "1:318696200197:web:00050b20e3b155ae7f246c",
    measurementId: "G-3SYYB0MCGY"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/**
 * REDIRECIONAMENTO INTELIGENTE PARA LOJISTAS
 */
window.irParaMinhaLoja = async function() {
    const user = auth.currentUser;
    const isRoot = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    const pathPrefix = isRoot ? 'html/' : '';

    if (!user) {
        window.location.href = `${pathPrefix}login.html`;
        return;
    }

    try {
        const userSnap = await getDoc(doc(db, "usuarios", user.uid));
        if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.loja && userData.loja.trim() !== "") {
                window.location.href = `${pathPrefix}perfil-loja.html`;
            } else {
                window.location.href = `${pathPrefix}login-loja.html`;
            }
        }
    } catch (e) {
        console.error("Erro ao redirecionar para loja:", e);
    }
};

/**
 * MONITOR DE AUTENTICAÇÃO E CONSTRUÇÃO DO MENU
 */
onAuthStateChanged(auth, async (user) => {
    const headerRight = document.getElementById('user-area') || document.querySelector('.header-right');
    if (!headerRight) return;

    const isRoot = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    const pathPrefix = isRoot ? 'html/' : '';

    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            const userData = userDoc.data();
            const nomeExibir = userData?.nome ? userData.nome.split(' ')[0] : "Usuário";
            const fotoPerfil = userData?.fotoUrl || (isRoot ? 'assets/images/default-user.png' : '../assets/images/default-user.png');
            
            const linkMinhaLoja = userData?.tipo === 'dono' 
                ? `<a href="#" id="link-loja-global"><i class="fa-solid fa-store"></i> Minha Loja</a>` 
                : '';

            // Layout do Usuário Logado
            headerRight.innerHTML = `
                <div class="user-menu-container">
                    <div class="pill-badge pill-user">
                        <div class="user-photo-placeholder">
                            <img src="${fotoPerfil}" alt="Perfil">
                        </div>
                        <span class="user-name-text">Olá, ${nomeExibir}</span>
                        <i class="fa-solid fa-chevron-down icone-seta" style="font-size: 0.7rem; margin-left: 5px;"></i>
                    </div>
                    
                    <div class="dropdown-content">
                        <a href="${pathPrefix}perfil.html"><i class="fa-regular fa-user"></i> Meu Perfil</a>
                        ${linkMinhaLoja}
                        <button id="btn-logout-global" class="btn-logout-menu">
                            <i class="fa-solid fa-right-from-bracket"></i> Sair
                        </button>
                    </div>
                </div>
            `;

            // Atribuição de eventos após injetar o HTML
            if (userData?.tipo === 'dono') {
                const btnLoja = document.getElementById('link-loja-global');
                if (btnLoja) {
                    btnLoja.onclick = (e) => {
                        e.preventDefault();
                        window.irParaMinhaLoja();
                    };
                }
            }

            document.getElementById('btn-logout-global').onclick = async () => {
                await signOut(auth);
                window.location.href = isRoot ? 'index.html' : '../index.html';
            };

        } catch (error) {
            console.error("Erro ao carregar menu:", error);
        }
    } else {
        // Layout do Usuário Deslogado (Limpo de estilos inline)
        const loginPath = isRoot ? 'html/login.html' : 'login.html';
        headerRight.innerHTML = `
            <button onclick="window.location.href='${loginPath}'" class="btn-login">
                <i class="fa-solid fa-right-to-bracket"></i> Entrar
            </button>
        `;
    }
});

/**
 * UTILITÁRIO DE NOTIFICAÇÕES (TOASTS)
 */
export function mostrarNotificacao(mensagem, tipo = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerHTML = `<i class="fa-solid ${tipo === 'success' ? 'fa-check-circle' : 'fa-circle-exclamation'}"></i><span>${mensagem}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.5s ease-in forwards';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

export { app, db, auth, googleProvider };