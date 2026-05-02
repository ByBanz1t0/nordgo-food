import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { 
    getFirestore, collection, getDocs, updateDoc, doc, getDoc, setDoc, serverTimestamp, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { 
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, 
    signOut, GoogleAuthProvider, signInWithPopup, deleteUser
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

// 1. Configuração do Firebase
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

// Auxiliares de Navegação
const noRoot = window.location.pathname.includes('/html/');
const prefixo = noRoot ? '' : 'html/';
const prefixoHome = noRoot ? '../' : '';

// ============================================================
// MONITORAMENTO DE USUÁRIO
// ============================================================

onAuthStateChanged(auth, async (user) => {
    const userArea = document.querySelector('.header-right');
    
    if (user) {
        if (userArea) userArea.innerHTML = `<span style="color: #666; font-size: 0.8rem;">Autenticando...</span>`;

        try {
            const userRef = doc(db, "usuarios", user.uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                const dados = userSnap.data();
                const temLoja = dados.loja && dados.loja !== "";

                if (userArea) {
                    userArea.innerHTML = `
                        <div class="user-dropdown">
                            <div class="user-menu-trigger">
                                <span class="user-name">Olá, ${dados.nome ? dados.nome.split(' ')[0] : 'Usuário'}</span>
                                <div class="user-icon">
                                    <img src="${user.photoURL || prefixoHome + 'assets/images/default-user.png'}" alt="User">
                                </div>
                            </div>
                            <ul class="dropdown-content">
                                <li><a href="${prefixo}perfil.html">Meu perfil</a></li>
                                ${dados.tipo === "dono" || temLoja ? `<li><a href="${prefixo}painel.html">Minha loja</a></li>` : ''}
                                <li><button id="btn-logout-menu">Sair</button></li>
                            </ul>
                        </div>`;
                }
                preencherCamposPerfil(user, dados);
                if (window.location.pathname.includes('painel.html')) {
                    carregarDadosPainel(user, dados.loja);
                }
            } else {
                await garantirPerfilFirestore(user);
            }
        } catch (error) {
            console.error("Erro ao carregar dados:", error);
        }
    } else {
        if (userArea) userArea.innerHTML = `<button onclick="window.location.href='${prefixo}login.html'" class="btn-login">Entrar</button>`;
    }
});

// ============================================================
// EVENTOS DE CLIQUE
// ============================================================

document.addEventListener('click', async (e) => {
    const id = e.target.id;
    const target = e.target;

    // Navegação Login/Cadastro
    if (id === 'link-ir-cadastro') {
        e.preventDefault();
        document.getElementById('section-login')?.classList.add('hidden');
        document.getElementById('section-cadastro')?.classList.remove('hidden');
    }

    if (id === 'btn-voltar-login') {
        document.getElementById('section-cadastro')?.classList.add('hidden');
        document.getElementById('section-login')?.classList.remove('hidden');
    }

    // Auth Login
    if (id === 'btn-login') {
        const email = document.getElementById('email').value;
        const senha = document.getElementById('senha').value;
        try {
            await signInWithEmailAndPassword(auth, email, senha);
            window.location.href = prefixoHome + 'index.html';
        } catch (err) { 
            mostrarNotificacao("E-mail ou senha incorretos."); 
        }
    }

    // Auth Cadastro
    if (id === 'btn-cadastrar-final') {
        const dados = {
            nome: document.getElementById('cad-nome').value,
            email: document.getElementById('cad-email').value,
            senha: document.getElementById('cad-senha').value,
            telefone: document.getElementById('cad-telefone').value,
            cep: document.getElementById('cad-cep').value,
            bairro: document.getElementById('cad-bairro').value,
            rua: document.getElementById('cad-rua').value,
            numero: document.getElementById('cad-numero').value,
            obs: document.getElementById('cad-obs').value
        };

        if (!dados.email || !dados.senha || !dados.nome) return mostrarNotificacao("Preencha Nome, E-mail e Senha.");

        try {
            const res = await createUserWithEmailAndPassword(auth, dados.email, dados.senha);
            await setDoc(doc(db, "usuarios", res.user.uid), {
                nome: dados.nome,
                email: dados.email,
                telefoneCliente: dados.telefone,
                cepCliente: dados.cep,
                bairroCliente: dados.bairro,
                ruaCliente: dados.rua,
                nCliente: dados.numero,
                observacaoCliente: dados.obs,
                tipo: "cliente", 
                loja: "", 
                dataCriacao: serverTimestamp()
            });

            mostrarNotificacao("Cadastro realizado!", "success");
            setTimeout(() => window.location.href = prefixoHome + 'index.html', 1500);
        } catch (err) { mostrarNotificacao("Erro ao cadastrar."); }
    }

    // Google Login
    if (id === 'btn-google') {
        try {
            const result = await signInWithPopup(auth, googleProvider);
            await garantirPerfilFirestore(result.user);
            window.location.href = prefixoHome + 'index.html';
        } catch (err) { console.error("Erro Google:", err); }
    }

    if (id === 'btn-logout-menu' || id === 'btn-logout') {
        await signOut(auth);
        window.location.href = prefixoHome + 'index.html';
    }

    // Gerenciamento de Loja (Salvar Config)
    if (id === 'btn-acao-loja') {
        const user = auth.currentUser;
        if (user) gerenciarLoja(user);
    }

    if (id === 'btn-status-toggle') {
        alternarStatusLoja();
    }

    // Modais e Dashboard
    if (id === 'btn-fechar-modal' || target.id === 'modal-overlay') {
        document.getElementById('modal-overlay')?.classList.add('hidden');
    }

    const card = target.closest('.card-modulo');
    if (card) {
        const modulo = card.dataset.modulo;
        if (modulo === 'config') {
            document.getElementById('section-dashboard').classList.add('hidden');
            document.getElementById('section-config-loja').classList.remove('hidden');
        } else {
            abrirModalGerenciamento(modulo);
        }
    }

    if (id === 'btn-cancelar-config') {
        document.getElementById('section-config-loja').classList.add('hidden');
        document.getElementById('section-dashboard').classList.remove('hidden');
    }
});

// ============================================================
// FUNÇÕES DE GESTÃO
// ============================================================

async function abrirModalGerenciamento(modulo) {
    const modalOverlay = document.getElementById('modal-overlay');
    const modalBody = document.getElementById('modal-body');
    const modalTitulo = document.getElementById('modal-titulo');

    if (!modalOverlay || !modalBody) return;

    modalOverlay.classList.remove('hidden');
    modalOverlay.style.display = 'flex'; // Garante visibilidade
    modalBody.innerHTML = ""; 

    if (modulo === 'config') {
        modalTitulo.innerText = "⚙️ Editar Informações da Loja";
        
        // Pegamos os valores atuais dos inputs escondidos ou do dashboard
        const nomeAtual = document.getElementById('loja-nome')?.value || "";
        const descAtual = document.getElementById('loja-descricao')?.value || "";
        const catAtual = document.getElementById('loja-categoria')?.value || "";
        const zapAtual = document.getElementById('loja-whatsapp')?.value || ""; // se tiver
        const temaAtual = document.getElementById('loja-tema')?.value || "#ff4757";

        modalBody.innerHTML = `
            <div class="form-container-modal">
                <div class="form-group">
                    <label>Nome da Loja</label>
                    <input type="text" id="edit-loja-nome" value="${nomeAtual}" placeholder="Ex: Nordeste Burguer">
                </div>
                <div class="form-group">
                    <label>Categoria</label>
                    <input type="text" id="edit-loja-categoria" value="${catAtual}" placeholder="Ex: Hamburgueria">
                </div>
                <div class="form-group">
                    <label>Descrição Curta</label>
                    <input type="text" id="edit-loja-desc" value="${descAtual}" placeholder="O melhor tempero da região">
                </div>
                <div class="form-row" style="display: flex; gap: 10px;">
                    <div class="form-group" style="flex: 2;">
                        <label>Cor do Tema</label>
                        <input type="color" id="edit-loja-tema" value="${temaAtual}" style="height: 45px; padding: 5px;">
                    </div>
                </div>
                <button id="btn-salvar-modal-loja" class="btn-acao" style="width: 100%; margin-top: 20px;">
                    Salvar Alterações
                </button>
            </div>
        `;
    } 
    else if (modulo === 'horarios') {
        // ... (seu código de horários aqui)
    }
}

async function carregarDadosPainel(user, lojaId) {
    const secDashboard = document.getElementById('section-dashboard');
    const secConfig = document.getElementById('section-config-loja');

    if (!lojaId) {
        secDashboard?.classList.add('hidden');
        secConfig?.classList.remove('hidden');
    } else {
        secDashboard?.classList.remove('hidden');
        secConfig?.classList.add('hidden');

        onSnapshot(doc(db, "lojas", lojaId), (docSnap) => {
            if (docSnap.exists()) {
                const d = docSnap.data();
                if (document.getElementById('dash-nome-loja')) document.getElementById('dash-nome-loja').innerText = d.nome;
                
                const badge = document.getElementById('badge-status');
                const btnStatus = document.getElementById('btn-status-toggle');

                if (badge && btnStatus) {
                    const aberta = d.status === 'aberta';
                    badge.innerText = aberta ? "Aberta" : "Fechada";
                    badge.className = `badge-loja ${aberta ? 'aberta' : 'fechada'}`;
                    btnStatus.innerText = aberta ? "Fechar Loja" : "Abrir Loja";
                }

                // Preenche formulário de config
                const mapping = {
                    'loja-nome': d.nome, 'loja-categoria': d.categoria, 'loja-descricao': d.descricao,
                    'loja-logo': d.logoLoja, 'loja-tema': d.temaLoja, 'loja-cep': d.cepLoja,
                    'loja-rua': d.ruaLoja, 'loja-bairro': d.bairroLoja, 'loja-numero': d.numeroLoja
                };
                for (let key in mapping) {
                    const el = document.getElementById(key);
                    if (el) el.value = mapping[key] || (key === 'loja-tema' ? "#ff4757" : "");
                }
            }
        });
    }
}

async function alternarStatusLoja() {
    const user = auth.currentUser;
    const userSnap = await getDoc(doc(db, "usuarios", user.uid));
    const lojaId = userSnap.data()?.loja;
    if (!lojaId) return;

    const lojaRef = doc(db, "lojas", lojaId);
    const lojaSnap = await getDoc(lojaRef);
    const novoStatus = lojaSnap.data()?.status === 'aberta' ? 'fechada' : 'aberta';

    await updateDoc(lojaRef, { status: novoStatus });
    mostrarNotificacao(`Loja ${novoStatus}!`, "success");
}

async function gerenciarLoja(user) {
    const dadosLoja = {
        nome: document.getElementById('loja-nome').value,
        categoria: document.getElementById('loja-categoria').value,
        descricao: document.getElementById('loja-descricao').value,
        logoLoja: document.getElementById('loja-logo').value,
        cepLoja: document.getElementById('loja-cep').value,
        ruaLoja: document.getElementById('loja-rua').value,
        bairroLoja: document.getElementById('loja-bairro').value,
        numeroLoja: document.getElementById('loja-numero').value,
        temaLoja: document.getElementById('loja-tema').value,
        donoUid: user.uid,
        ultimaAtualizacao: serverTimestamp()
    };

    if (!dadosLoja.nome) return mostrarNotificacao("Nome é obrigatório.");

    try {
        const userRef = doc(db, "usuarios", user.uid);
        const userSnap = await getDoc(userRef);
        const lojaId = userSnap.data()?.loja;

        if (lojaId) {
            await updateDoc(doc(db, "lojas", lojaId), dadosLoja);
            mostrarNotificacao("Dados salvos!", "success");
            document.getElementById('section-config-loja').classList.add('hidden');
            document.getElementById('section-dashboard').classList.remove('hidden');
        } else {
            const novaLojaRef = doc(collection(db, "lojas"));
            dadosLoja.status = 'fechada';
            await setDoc(novaLojaRef, dadosLoja);
            await updateDoc(userRef, { loja: novaLojaRef.id, tipo: "dono" });
            location.reload();
        }
    } catch (err) { mostrarNotificacao("Erro ao salvar."); }
}

async function garantirPerfilFirestore(user) {
    const userRef = doc(db, "usuarios", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
        await setDoc(userRef, {
            nome: user.displayName || "Usuário Novo",
            email: user.email,
            tipo: "cliente",
            loja: "",
            dataCriacao: serverTimestamp()
        });
    }
}

function preencherCamposPerfil(user, dados) {
    const campos = {
        'perfil-nome': dados.nome, 'perfil-email': dados.email || user.email,
        'perfil-telefone': dados.telefoneCliente, 'perfil-cep': dados.cepCliente,
        'perfil-bairro': dados.bairroCliente, 'perfil-rua': dados.ruaCliente,
        'perfil-numero': dados.nCliente, 'perfil-obs': dados.observacaoCliente
    };
    for (let id in campos) {
        const el = document.getElementById(id);
        if (el) el.value = campos[id] || "";
    }
}

function mostrarNotificacao(mensagem, tipo = 'error') {
    let container = document.querySelector('.toast-container') || document.createElement('div');
    if (!container.parentElement) {
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerText = mensagem;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

async function renderizarLojas() {
    const lista = document.getElementById('lista-restaurantes');
    if (!lista) return;
    const querySnapshot = await getDocs(collection(db, "lojas")); 
    lista.innerHTML = ""; 
    querySnapshot.forEach((doc) => {
        const d = doc.data();
        lista.innerHTML += `
            <div class="card-loja" onclick="window.location.href='${prefixo}cardapio.html?loja=${doc.id}'">
                <div class="banner" style="background-color: ${d.temaLoja || '#ff4757'}">
                    <img src="${d.logoLoja || prefixoHome + 'assets/images/default-store.png'}">
                </div>
                <div class="info">
                    <h3>${d.nome}</h3>
                    <p>${d.categoria} • ${d.bairroLoja || 'Centro'}</p>
                </div>
            </div>`;
    });
}

renderizarLojas();