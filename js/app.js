import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    updateDoc,
    doc, 
    getDoc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    GoogleAuthProvider, 
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

// 1. Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDt8z1zNvG43sgiUKwcGQCx79KRNq_5Cjc", // Chave atualizada
  authDomain: "nordgo-food.firebaseapp.com",
  projectId: "nordgo-food",
  storageBucket: "nordgo-food.firebasestorage.app",
  messagingSenderId: "318696200197",
  appId: "1:318696200197:web:00050b20e3b155ae7f246c",
  measurementId: "G-3SYYB0MCGY"
};
// 2. Inicialização
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ============================================================
// LÓGICA DE INTERFACE E AUTENTICAÇÃO (GLOBAL)
// ============================================================

/**
 * Monitora o estado do usuário e atualiza o cabeçalho
 */
onAuthStateChanged(auth, async (user) => {
    const userArea = document.querySelector('.header-right');
    if (!userArea) return;

    if (user) {
        const userRef = doc(db, "usuarios", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const dados = userSnap.data();
            let botoesAdicionais = "";

            if (dados.tipo === "dono") {
                botoesAdicionais = `
                    <button onclick="window.location.href='html/painel.html'" class="btn-painel">
                        Gerenciar ${dados.restaurante}
                    </button>
                `;
            }

            userArea.innerHTML = `
                <div class="user-menu">
                    ${botoesAdicionais}
                    <span class="user-name">Olá, ${dados.nome.split(' ')[0]}</span>
                    <div class="user-icon">
                        <img src="${user.photoURL || 'https://via.placeholder.com/35'}" alt="User">
                    </div>
                </div>`;
        }
    } else {
        userArea.innerHTML = `
            <button onclick="window.location.href='html/login.html'" class="btn-login">
                Entrar
            </button>`;
    }
});

/**
 * Função para criar/garantir documento do usuário no Firestore
 */
async function garantirPerfilFirestore(user, nomeManual = "") {
    const userRef = doc(db, "usuarios", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        await setDoc(userRef, {
            nome: nomeManual || user.displayName || "Usuário Novo",
            email: user.email,
            tipo: "cliente",
            restaurante: "",
            dataCriacao: serverTimestamp()
        });
    }
}

// ============================================================
// LÓGICA DA VITRINE (PÁGINA INICIAL)
// ============================================================

async function renderizarRestaurantes() {
    const lista = document.getElementById('lista-restaurantes');
    if (!lista) return; // Só executa se estiver na Home

    try {
        const querySnapshot = await getDocs(collection(db, "restaurantes"));
        lista.innerHTML = ""; 

        querySnapshot.forEach((doc) => {
            const dados = doc.data();
            const id = doc.id;
            const corTema = dados.tema || '#5D3FD3'; 

            const card = `
                <div class="card-loja" onclick="window.location.href='html/cardapio.html?loja=${id}'">
                    <div class="banner" style="background-color: ${corTema}">
                        <img src="${dados.logoUrl || 'https://via.placeholder.com/80'}" alt="Logo">
                    </div>
                    <div class="info">
                        <h3>${dados.nome}</h3>
                        <p>Clique para ver o cardápio</p>
                    </div>
                </div>`;
            lista.innerHTML += card;
        });
    } catch (e) {
        console.error("Erro ao buscar lojas: ", e);
        lista.innerHTML = "<p>Erro ao carregar restaurantes.</p>";
    }
}

// ============================================================
// LÓGICA DE LOGIN E CADASTRO (PÁGINA DE LOGIN)
// ============================================================

document.addEventListener('click', async (e) => {
    // Cadastro com E-mail
    if (e.target.id === 'btn-cadastrar') {
        const email = document.getElementById('email')?.value;
        const senha = document.getElementById('senha')?.value;
        const nome = document.getElementById('nome')?.value;

        if (!email || !senha || !nome) return alert("Preencha todos os campos.");

        try {
            const res = await createUserWithEmailAndPassword(auth, email, senha);
            await garantirPerfilFirestore(res.user, nome);
            window.location.href = "../index.html";
        } catch (err) {
            alert("Erro ao cadastrar: " + err.message);
        }
    }

    // Login com E-mail
    if (e.target.id === 'btn-login') {
        const email = document.getElementById('email')?.value;
        const senha = document.getElementById('senha')?.value;

        if (!email || !senha) return alert("Preencha e-mail e senha.");

        try {
            await signInWithEmailAndPassword(auth, email, senha);
            window.location.href = "../index.html";
        } catch (err) {
            alert("Falha no login. Verifique suas credenciais.");
        }
    }

    // Login com Google
    if (e.target.id === 'btn-google') {
        const provider = new GoogleAuthProvider();
        try {
            const res = await signInWithPopup(auth, provider);
            await garantirPerfilFirestore(res.user);
            window.location.href = "../index.html";
        } catch (err) {
            console.error("Erro Google Auth:", err);
        }
    }

    // Lógica para Salvar Alterações do Perfil
    if (e.target.id === 'btn-salvar-perfil') {
        const user = auth.currentUser; // Pega o usuário logado no momento
        const novoNome = document.getElementById('perfil-nome').value;

        if (!user) return alert("Você precisa estar logado!");
        if (!novoNome) return alert("O nome não pode estar vazio.");

        const userRef = doc(db, "usuarios", user.uid);

        try {
            // Atualiza apenas o campo 'nome' no Firestore
            await updateDoc(userRef, {
                nome: novoNome
            });
            
            alert("Perfil atualizado com sucesso!");
            
            // Opcional: Recarrega a página para atualizar o "Olá, Nome" no header
            window.location.reload(); 
        } catch (err) {
            console.error("Erro ao atualizar perfil:", err);
            alert("Erro ao salvar alterações.");
        }
    }

});

// Inicialização
renderizarRestaurantes();

import { signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

// ... (mantenha o código anterior) ...

/**
 * FUNÇÃO: Carrega dados na página de perfil
 */
async function carregarDadosPerfil(user) {
    const nomeInput = document.getElementById('perfil-nome');
    const emailInput = document.getElementById('perfil-email');
    const tipoInput = document.getElementById('perfil-tipo');
    const fotoImg = document.getElementById('perfil-foto');

    if (!nomeInput) return; // Só executa se estiver na página perfil.html

    const userRef = doc(db, "usuarios", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        const dados = userSnap.data();
        nomeInput.value = dados.nome;
        emailInput.value = dados.email;
        tipoInput.value = dados.tipo;
        if (user.photoURL) fotoImg.src = user.photoURL;
    }
}

onAuthStateChanged(auth, async (user) => {
    const userArea = document.querySelector('.header-right');
    if (!userArea) return;

    // Detecta se estamos na raiz ou dentro da pasta /html
    const noRoot = window.location.pathname.includes('/html/');
    const prefixo = noRoot ? '' : 'html/';
    const prefixoHome = noRoot ? '../' : '';

    if (user) {
        const userRef = doc(db, "usuarios", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const dados = userSnap.data();
            let botoesAdicionais = "";

            if (dados.tipo === "dono") {
                botoesAdicionais = `
                    <button onclick="window.location.href='${prefixo}painel.html'" class="btn-painel">
                        Gerenciar ${dados.restaurante}
                    </button>`;
            }

            userArea.innerHTML = `
                <div class="user-menu-container" style="display: flex; align-items: center; gap: 1rem;">
                    ${botoesAdicionais}
                    <a href="${prefixo}perfil.html" style="text-decoration: none; color: inherit;">
                        <div class="user-menu">
                            <span class="user-name">Olá, ${dados.nome.split(' ')[0]}</span>
                            <div class="user-icon">
                                <img src="${user.photoURL || prefixoHome + 'assets/images/default-user.png'}" alt="User">
                            </div>
                        </div>
                    </a>
                </div>`;
            
            // CHAMA A CARGA DE DADOS DO PERFIL
            carregarDadosPerfil(user);
        }
    } else {
        userArea.innerHTML = `<button onclick="window.location.href='${prefixo}login.html'" class="btn-login">Entrar</button>`;
    }
});

// Lógica de Logout (Adicionar dentro do ouvinte de cliques global)
document.addEventListener('click', async (e) => {
    if (e.target.id === 'btn-logout') {
        try {
            await signOut(auth);
            window.location.href = '../index.html';
        } catch (err) {
            console.error("Erro ao sair:", err);
        }
    }
    // ... (restante dos cliques de login/cadastro) ...
});