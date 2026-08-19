import { auth, db, mostrarNotificacao } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    GoogleAuthProvider, 
    signInWithPopup,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

import { 
    doc, setDoc, getDoc, updateDoc, arrayUnion 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const sectionLogin = document.getElementById('section-login');
const sectionCadastro = document.getElementById('section-cadastro');
const sectionSkeleton = document.getElementById('section-skeleton');
const txtTituloHeader = document.getElementById('header-dinamico-titulo');

let cadastrandoUsuario = false;

document.getElementById('btn-voltar-index').onclick = () => {
    window.location.href = '../index.html';
};

// ============================================================
// CONTROLE DO MODAL DE TERMOS LGPD
// ============================================================
const modalLgpd = document.getElementById('modal-lgpd');
const linkAbrirLgpd = document.getElementById('link-abrir-lgpd');
const btnFecharModalLgpd = document.getElementById('btn-fechar-modal-lgpd');

if (linkAbrirLgpd && modalLgpd) {
    linkAbrirLgpd.onclick = (e) => {
        e.preventDefault();
        modalLgpd.classList.remove('hidden');
    };
}

if (btnFecharModalLgpd && modalLgpd) {
    btnFecharModalLgpd.onclick = () => {
        modalLgpd.classList.add('hidden');
    };
}

// ============================================================
// INTERCEPTOR DE AUTENTICAÇÃO E CHECAGEM DE CONTAS SUSPENSAS
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (user && !cadastrandoUsuario) {
        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                
                if (userData.status === "suspenso") {
                    mostrarNotificacao("Sua conta está suspensa. Contate o administrador.", "error");
                    await signOut(auth);
                    localStorage.removeItem('nordgo_cep_usuario'); 
                    sectionSkeleton?.classList.add('hidden');
                    sectionLogin?.classList.remove('hidden');
                    return;
                }

                // Sincroniza o CEP do perfil logado no localStorage
                if (userData.enderecoCliente && Array.isArray(userData.enderecoCliente)) {
                    const enderecoPadrao = userData.enderecoCliente.find(end => end.padrao === true) || userData.enderecoCliente[0];
                    if (enderecoPadrao && enderecoPadrao.cep) {
                        localStorage.setItem('nordgo_cep_usuario', enderecoPadrao.cep);
                    }
                }
            }
            sectionSkeleton?.classList.add('hidden');
            window.location.href = '../index.html';
        } catch (err) {
            console.error("Erro na verificação de acesso:", err);
            sectionSkeleton?.classList.add('hidden');
            sectionLogin?.classList.remove('hidden');
        }
    } else if (!user) {
        sectionSkeleton?.classList.add('hidden');
        sectionLogin?.classList.remove('hidden');
    }
});

// ============================================================
// MÁSCARAS DE ENTRADA
// ============================================================
const aplicarMascaraCPF = (v) => {
    v = v.replace(/\D/g, "");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    return v;
};

const aplicarMascaraTel = (v) => {
    v = v.replace(/\D/g, "");
    v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
    v = v.replace(/(\d)(\d{4})$/, "$1-$2");
    return v;
};

const aplicarMascaraCEP = (v) => {
    v = v.replace(/\D/g, "");
    v = v.replace(/^(\d{5})(\d)/, "$1-$2");
    return v;
};

document.getElementById('reg-cpf')?.addEventListener('input', (e) => e.target.value = aplicarMascaraCPF(e.target.value));
document.getElementById('reg-telefone')?.addEventListener('input', (e) => e.target.value = aplicarMascaraTel(e.target.value));
document.getElementById('reg-cep')?.addEventListener('input', (e) => e.target.value = aplicarMascaraCEP(e.target.value));

// ============================================================
// CONSULTA VIA CEP
// ============================================================
document.getElementById('reg-cep')?.addEventListener('blur', async (e) => {
    const cep = e.target.value.replace(/\D/g, "");
    if (cep.length !== 8) {
        if (cep.length > 0) mostrarNotificacao("CEP incompleto.", "error");
        return;
    }

    const inputBairro = document.getElementById('reg-bairro');
    const inputCidade = document.getElementById('reg-cidade');
    const inputEstado = document.getElementById('reg-estado');
    const inputRua = document.getElementById('reg-rua');

    try {
        if (inputCidade) inputCidade.value = "Buscando...";
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const dados = await response.json();

        if (dados.erro) {
            mostrarNotificacao("CEP não localizado.", "error");
            if (inputCidade) inputCidade.value = "";
            return;
        }

        if (inputCidade) inputCidade.value = dados.localidade || "";
        if (inputEstado) inputEstado.value = dados.uf || "";

        if (inputBairro) {
            if (dados.bairro && dados.bairro.trim() !== "") {
                inputBairro.value = dados.bairro;
                inputBairro.readOnly = true;
                inputBairro.classList.add('input-bloqueado');
            } else {
                inputBairro.value = "";
                inputBairro.readOnly = false;
                inputBairro.classList.remove('input-bloqueado');
                inputBairro.placeholder = "Informe o seu bairro";
            }
        }
        if (inputRua) inputRua.value = dados.logradouro || "";
        document.getElementById('reg-numero')?.focus();
    } catch (err) {
        console.error("Erro no ViaCEP:", err);
        if (inputCidade) inputCidade.value = "";
    }
});

// ============================================================
// REGRAS E VALIDAÇÃO DE SENHA E CPF
// ============================================================
const validarSenhaForte = (senha) => {
    // Requisitos: Mínimo 8 caracteres, 1 maiúscula, 1 número e 1 caractere especial (!@#$%^&*)
    return /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])(?=.{8,})/.test(senha);
};

const validarCPFMatematico = (cpf) => {
    cpf = cpf.replace(/\D/g, "");
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    
    let soma = 0;
    let resto;
    
    for (let i = 1; i <= 9; i++) {
        soma = soma + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;
    
    soma = 0;
    for (let i = 1; i <= 10; i++) {
        soma = soma + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    }
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;
    
    return true;
};

// ============================================================
// INJEÇÃO DO ÍCONE DE INFORMAÇÃO (i) E TOOLTIP DA SENHA
// ============================================================
function inicializarTooltipSenhaInfo() {
    const inputSenhaReg = document.getElementById('reg-senha');
    if (!inputSenhaReg) return;

    // Busca o label associado ou o elemento pai
    const parentContainer = inputSenhaReg.closest('.input-group') || inputSenhaReg.parentElement;
    const labelSenha = parentContainer?.querySelector('label') || parentContainer;

    if (labelSenha && !document.getElementById('wrapper-info-senha-tooltip')) {
        const infoWrapper = document.createElement('span');
        infoWrapper.id = 'wrapper-info-senha-tooltip';
        infoWrapper.style.cssText = `
            display: inline-flex;
            align-items: center;
            margin-left: 6px;
            position: relative;
            cursor: pointer;
            vertical-align: middle;
        `;

        infoWrapper.innerHTML = `
            <i class="fa-solid fa-circle-info" style="color: #ff6400; font-size: 0.95rem;"></i>
            <div id="tooltip-box-senha" style="
                display: none;
                position: absolute;
                bottom: 130%;
                left: 50%;
                transform: translateX(-50%);
                background: #2f3542;
                color: #ffffff;
                padding: 10px 14px;
                border-radius: 8px;
                font-size: 0.75rem;
                line-height: 1.4;
                width: 230px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.25);
                z-index: 9999;
                pointer-events: none;
                text-align: left;
                font-weight: 400;
            ">
                <strong style="color: #ff6400; display:block; margin-bottom: 4px; font-size: 0.8rem;">Requisitos da Senha:</strong>
                <ul style="margin: 0; padding-left: 16px; list-style: disc;">
                    <li>Mínimo de <strong>8 caracteres</strong></li>
                    <li>Pelo menos <strong>1 letra maiúscula</strong> (A-Z)</li>
                    <li>Pelo menos <strong>1 número</strong> (0-9)</li>
                    <li>Pelo menos <strong>1 símbolo especial</strong> (!@#$%^&*)</li>
                </ul>
                <div style="
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    margin-left: -5px;
                    border-width: 5px;
                    border-style: solid;
                    border-color: #2f3542 transparent transparent transparent;
                "></div>
            </div>
        `;

        const tooltipBox = infoWrapper.querySelector('#tooltip-box-senha');

        // Eventos de exibição (Mouse e Toque)
        infoWrapper.addEventListener('mouseenter', () => tooltipBox.style.display = 'block');
        infoWrapper.addEventListener('mouseleave', () => tooltipBox.style.display = 'none');
        infoWrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            tooltipBox.style.display = tooltipBox.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', () => {
            if (tooltipBox) tooltipBox.style.display = 'none';
        });

        labelSenha.appendChild(infoWrapper);
    }
}

// Inicializa o tooltip ao carregar
inicializarTooltipSenhaInfo();

// ============================================================
// TROCA DE TELAS (LOGIN / CADASTRO)
// ============================================================
document.getElementById('link-ir-cadastro').onclick = (e) => {
    e.preventDefault();
    sectionLogin.classList.add('hidden'); 
    sectionCadastro.classList.remove('hidden'); 
    txtTituloHeader.innerText = "Cadastro"; 
    inicializarTooltipSenhaInfo();
};

document.getElementById('btn-voltar-login').onclick = () => {
    sectionCadastro.classList.add('hidden'); 
    sectionLogin.classList.remove('hidden'); 
    txtTituloHeader.innerText = "Login"; 
};

// ============================================================
// LOGIN COM E-MAIL E SENHA
// ============================================================
document.getElementById('btn-login').onclick = async () => {
    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;
    if(!email || !senha) { 
        mostrarNotificacao("Preencha todos os campos.", "error"); 
        return; 
    }

    const btn = document.getElementById('btn-login');
    try {
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Entrando...';
        btn.disabled = true;
        await signInWithEmailAndPassword(auth, email, senha);
        mostrarNotificacao("Bem-vindo de volta!");
    } catch (error) {
        btn.disabled = false;
        btn.innerText = 'Entrar';
        
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            mostrarNotificacao("E-mail ou senha incorretos.", "error");
        } else if (error.code === 'auth/invalid-email') {
            mostrarNotificacao("Formato de e-mail inválido.", "error");
        } else {
            mostrarNotificacao("Erro ao autenticar. Tente novamente.", "error");
        }
    }
};

// ============================================================
// CADASTRO DE NOVO CLIENTE
// ============================================================
document.getElementById('btn-cadastrar-final').onclick = async () => {
    const obterValor = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : "";
    };

    const nome = obterValor('reg-nome');
    const email = obterValor('reg-email');
    const senha = document.getElementById('reg-senha')?.value || "";
    const senhaConfirmar = document.getElementById('reg-senha-confirmar')?.value || "";
    const cpfCliente = obterValor('reg-cpf');
    const telefoneCliente = obterValor('reg-telefone');
    const rua = obterValor('reg-rua');
    const numero = obterValor('reg-numero');
    
    const bairroCru = obterValor('reg-bairro');
    const bairro = bairroCru.charAt(0).toUpperCase() + bairroCru.slice(1).toLowerCase();
    
    const cidadeCru = obterValor('reg-cidade');
    const cidade = cidadeCru.charAt(0).toUpperCase() + cidadeCru.slice(1).toLowerCase();
    
    const estado = obterValor('reg-estado').toUpperCase();
    const observacao = obterValor('reg-obs') || "Sem observação";
    const cep = obterValor('reg-cep');
    
    const aceitouLgpd = document.getElementById('reg-lgpd')?.checked;

    if(!nome || !email || !senha || !senhaConfirmar || !cpfCliente || !rua || !numero || !bairro || !cep || !cidade || !estado) {
        mostrarNotificacao("Preencha todos os dados obrigatórios.", "error");
        return;
    }

    if (!aceitouLgpd) {
        mostrarNotificacao("É necessário aceitar os Termos de Uso e LGPD para criar uma conta.", "error");
        return;
    }

    if (senha !== senhaConfirmar) {
        mostrarNotificacao("As senhas digitadas não coincidem.", "error");
        return;
    }

    if (!validarSenhaForte(senha)) {
        mostrarNotificacao("Senha fraca! Verifique as regras no ícone (i) ao lado da senha.", "error");
        return;
    }

    if (!validarCPFMatematico(cpfCliente)) {
        mostrarNotificacao("CPF inválido. Verifique os dígitos informados.", "error");
        return;
    }

    const btn = document.getElementById('btn-cadastrar-final');

    try {
        cadastrandoUsuario = true;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando dados...';
        
        // 1. Validação de duplicidade de CPF na coleção /cpfs_cadastrados
        const cpfLimpoId = cpfCliente.replace(/\D/g, "");
        const cpfRef = doc(db, "cpfs_cadastrados", cpfLimpoId);
        const cpfSnap = await getDoc(cpfRef);

        if (cpfSnap.exists()) {
            mostrarNotificacao("Este CPF já está cadastrado em outra conta.", "error");
            btn.disabled = false;
            btn.innerText = 'Finalizar Cadastro';
            cadastrandoUsuario = false;
            return;
        }

        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Criando conta...';
        const userCred = await createUserWithEmailAndPassword(auth, email, senha);
        
        if (!userCred || !userCred.user || !userCred.user.uid) {
            throw new Error("UID do usuário não gerado.");
        }

        const novoEnderecoObj = {
            id: Date.now().toString(),
            apelido: "Casa",
            rua: rua,
            numero: numero,
            bairro: bairro,
            cidade: `${cidade} - ${estado}`,
            observacao: observacao,
            padrao: true,
            cep: cep
        };

        const payloadFinal = {
            nome: nome,
            email: email,
            cpfCliente: cpfCliente,
            telefoneCliente: telefoneCliente,
            tipo: "cliente",
            cargo: "cliente",
            role: "cliente",
            isAdmin: false,
            status: "ativo",
            aceitouLgpd: true,
            dataAceiteLgpd: new Date().toISOString(),
            dataCriacao: new Date().toISOString(),
            fotoUrl: "",
            enderecoCliente: [novoEnderecoObj]
        };

        // Grava perfil do usuário
        await setDoc(doc(db, "usuarios", userCred.user.uid), payloadFinal);

        // 2. Registra o bloqueio do CPF
        await setDoc(doc(db, "cpfs_cadastrados", cpfLimpoId), {
            userId: userCred.user.uid,
            criadoEm: new Date().toISOString()
        });

        localStorage.setItem('nordgo_cep_usuario', cep);

        // Registro não-bloqueante de região
        try {
            const idRegiaoDoc = `${cidade}-${estado}`;
            const regiaoRef = doc(db, "regioes", idRegiaoDoc);
            const regiaoSnap = await getDoc(regiaoRef);

            if (!regiaoSnap.exists()) {
                await setDoc(regiaoRef, {
                    nome: cidade,
                    uf: estado,
                    bairros: [bairro]
                });
            } else {
                await updateDoc(regiaoRef, {
                    bairros: arrayUnion(bairro)
                });
            }
        } catch (regiaoErr) {
            console.warn("Aviso: Mapeamento de região automática restrito:", regiaoErr.message);
        }

        mostrarNotificacao("Conta criada com sucesso!");
        cadastrandoUsuario = false;
        setTimeout(() => window.location.href = '../index.html', 1000);

    } catch (error) { 
        cadastrandoUsuario = false; 
        btn.disabled = false;
        btn.innerText = 'Finalizar Cadastro';
        
        if (error.code === 'auth/email-already-in-use') {
            mostrarNotificacao("Este e-mail já está cadastrado em outra conta.", "error");
        } else if (error.code === 'auth/invalid-email') {
            mostrarNotificacao("O endereço de e-mail informado é inválido.", "error");
        } else if (error.code === 'auth/weak-password') {
            mostrarNotificacao("A senha informada não atende aos requisitos mínimos do sistema.", "error");
        } else {
            mostrarNotificacao("Falha ao criar conta. Tente novamente.", "error");
        }
    }
};

// ============================================================
// RECUPERAÇÃO DE SENHA
// ============================================================
document.getElementById('btn-esqueci-senha').onclick = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) { 
        mostrarNotificacao("Informe seu e-mail no campo acima.", "error"); 
        return; 
    }
    try {
        await sendPasswordResetEmail(auth, email);
        mostrarNotificacao("E-mail de redefinição enviado com sucesso!");
    } catch (e) { 
        mostrarNotificacao("Erro ao enviar e-mail. Verifique o endereço digitado.", "error"); 
    }
};

// ============================================================
// LOGIN COM GOOGLE
// ============================================================
document.getElementById('btn-google').onclick = async () => {
    const provider = new GoogleAuthProvider();
    try {
        cadastrandoUsuario = true; 

        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        
        if (!userDoc.exists()) {
            await setDoc(doc(db, "usuarios", user.uid), {
                nome: user.displayName || "Usuário Google",
                email: user.email,
                tipo: "cliente",
                cargo: "cliente",
                role: "cliente",
                isAdmin: false,
                status: "ativo",
                aceitouLgpd: true,
                dataAceiteLgpd: new Date().toISOString(),
                fotoUrl: user.photoURL || "",
                dataCriacao: new Date().toISOString(),
                enderecoCliente: []
            });
            mostrarNotificacao("Conta criada com sucesso via Google!");
        } else if (userDoc.data().status === "suspenso") {
            mostrarNotificacao("Esta conta Google está suspensa.", "error");
            await signOut(auth);
            localStorage.removeItem('nordgo_cep_usuario');
            cadastrandoUsuario = false; 
            return;
        } else {
            mostrarNotificacao("Bem-vindo de volta!");
        }

        cadastrandoUsuario = false;
        setTimeout(() => {
            window.location.href = '../index.html';
        }, 1000);

    } catch (e) { 
        cadastrandoUsuario = false; 
        console.error("Erro no login Google:", e);
        mostrarNotificacao("Falha no login com Google.", "error"); 
    }
};