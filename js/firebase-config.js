import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDt8z1zNvG43sgiUKwcGQCx79KRNq_5Cjc",
    authDomain: "nordgo-food.firebaseapp.com",
    projectId: "nordgo-food",
    storageBucket: "nordgo-food.firebasestorage.app",
    messagingSenderId: "318696200197",
    appId: "1:318696200197:web:00050b20e3b155ae7f246c",
    measurementId: "G-3SYYB0MCGY"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/**
 * LÓGICA DE REDIRECIONAMENTO INTELIGENTE
 * Garante que o lojista vá para a página correta: perfil-loja.html
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
        // Busca o documento do usuário para verificar o vínculo com a loja
        const userSnap = await getDoc(doc(db, "usuarios", user.uid));
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            
            // Verificamos se o campo 'loja' existe e redirecionamos para perfil-loja.html
            if (userData.loja && userData.loja.trim() !== "") {
                window.location.href = `${pathPrefix}perfil-loja.html`;
            } else {
                window.location.href = `${pathPrefix}login-loja.html`;
            }
        } else {
            window.location.href = `${pathPrefix}login-loja.html`;
        }
    } catch (e) {
        console.error("Erro ao redirecionar para loja:", e);
    }
};

/**
 * Lógica Automática do Menu Superior
 */
onAuthStateChanged(auth, async (user) => {
    const headerRight = document.querySelector('.header-right') || document.getElementById('user-area');
    if (!headerRight) return;

    const isRoot = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    const pathPrefix = isRoot ? 'html/' : '';

    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            const userData = userDoc.data();
            
            const nomeExibir = userData?.nome ? userData.nome.split(' ')[0] : "Usuário";
            
            // Define o link de "Minha Loja" apenas para usuários do tipo 'dono'
            const linkMinhaLoja = userData?.tipo === 'dono' 
                ? `<a href="#" onclick="window.irParaMinhaLoja(); return false;"><i class="fa-solid fa-store"></i> Minha Loja</a>` 
                : '';

            headerRight.innerHTML = `
                <div class="user-menu-container">
                    <span class="user-name-display">
                        Olá, ${nomeExibir} <i class="fa-solid fa-chevron-down" style="font-size: 0.7rem;"></i>
                    </span>
                    <div class="dropdown-content">
                        <a href="${pathPrefix}perfil.html"><i class="fa-regular fa-user"></i> Meu Perfil</a>
                        ${linkMinhaLoja}
                        <button id="btn-logout-global" class="btn-logout-menu">
                            <i class="fa-solid fa-right-from-bracket"></i> Sair
                        </button>
                    </div>
                </div>
            `;

            document.getElementById('btn-logout-global').onclick = async () => {
                try {
                    await signOut(auth);
                    window.location.href = isRoot ? 'index.html' : '../index.html';
                } catch (error) {
                    console.error("Erro ao deslogar:", error);
                }
            };

        } catch (error) {
            console.error("Erro ao carregar menu do usuário:", error);
        }
    } else {
        const loginPath = isRoot ? 'html/login.html' : 'login.html';
        headerRight.innerHTML = `
            <button onclick="window.location.href='${loginPath}'" class="btn-login">Entrar</button>
        `;
    }
});

/**
 * Função global para notificações (Toasts)
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
    
    const icon = tipo === 'success' ? 'fa-check-circle' : 'fa-circle-exclamation';
    
    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${mensagem}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.5s ease-in forwards';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

export { app, db, auth, googleProvider };