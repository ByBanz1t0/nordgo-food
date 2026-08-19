import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";

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
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

/**
 * REDIRECIONAMENTO INTELIGENTE PARA LOJISTAS
 */
export async function irParaMinhaLoja() {
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
            
            if (userData && typeof userData.loja === 'string' && userData.loja.trim() !== "") {
                window.location.href = `${pathPrefix}perfil-loja.html`;
            } else {
                window.location.href = `${pathPrefix}login-loja.html`;
            }
        } else {
            window.location.href = `${pathPrefix}login-loja.html`;
        }
    } catch (e) {
        console.error("Erro crítico ao redirecionar para loja:", e);
    }
}

window.irParaMinhaLoja = irParaMinhaLoja;

/**
 * MONITOR DE AUTENTICAÇÃO E CONSTRUÇÃO DO MENU
 */
onAuthStateChanged(auth, async (user) => {
    const isRoot = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    const pathPrefix = isRoot ? 'html/' : '';

    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            const userData = userDoc.data();
            
            // Trava de segurança para usuários suspensos
            if (userData?.status === "suspenso") {
                mostrarNotificacao("Sua conta está suspensa. Contate o administrador.", "error");
                localStorage.removeItem('nordgo_cep_usuario');
                await signOut(auth);
                
                if (!window.location.pathname.includes('login.html')) {
                    setTimeout(() => {
                        window.location.href = `${pathPrefix}login.html`;
                    }, 1500);
                }
                return;
            }

            const headerRight = document.getElementById('user-area') || document.querySelector('.header-right');
            if (!headerRight) return;

            const nomeExibir = userData?.nome ? userData.nome.split(' ')[0] : "Usuário";
            const fotoPerfil = userData?.fotoUrl || (isRoot ? 'assets/images/default-user.png' : '../assets/images/default-user.png');
            
            // VERIFICAÇÃO DE ACESSO: ADMIN OU SUPORTE
            const ehAdmin = userData?.isAdmin === true || userData?.cargo === 'admin' || userData?.role === 'admin';
            const ehSuporte = userData?.cargo === 'suporte' || userData?.role === 'suporte';
            
            let linkAdminHtml = '';
            if (ehAdmin) {
                linkAdminHtml = `<a href="${pathPrefix}gerenciamento.html"><i class="fa-solid fa-sliders"></i> Painel Admin</a>`;
            } else if (ehSuporte) {
                linkAdminHtml = `<a href="${pathPrefix}gerenciamento.html"><i class="fa-solid fa-headset"></i> Painel Suporte</a>`;
            }
            
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
                        <a href="${pathPrefix}pedidos.html"><i class="fa-solid fa-clock-rotate-left"></i> Meus Pedidos</a>
                        <a href="${pathPrefix}perfil.html"><i class="fa-regular fa-user"></i> Meu Perfil</a>
                        <a href="javascript:void(0);" id="link-loja-global"><i class="fa-solid fa-store"></i> Minha Loja</a>
                        ${linkAdminHtml} 
                        <button id="btn-logout-global" class="btn-logout-menu">
                            <i class="fa-solid fa-right-from-bracket"></i> Sair
                        </button>
                    </div>
                </div>
            `;

            document.getElementById('btn-logout-global').onclick = async () => {
                await signOut(auth);
                window.location.href = isRoot ? 'index.html' : '../index.html';
            };

        } catch (error) {
            console.error("Erro ao carregar menu:", error);
        }
    } else {
        const headerRight = document.getElementById('user-area') || document.querySelector('.header-right');
        if (!headerRight) return;

        const loginPath = isRoot ? 'html/login.html' : 'login.html';
        headerRight.innerHTML = `
            <button onclick="window.location.href='${loginPath}'" class="btn-login">
                <i class="fa-solid fa-right-to-bracket"></i> Entrar
            </button>
        `;
    }
});

document.addEventListener('click', function(e) {
    const botaoMinhaLoja = e.target.closest('#link-loja-global');
    
    if (botaoMinhaLoja) {
        e.preventDefault();
        e.stopPropagation();
        irParaMinhaLoja(); 
    }
});

/**
 * NOTIFICAÇÕES (TOASTS)
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

export { app, db, auth, storage, googleProvider };