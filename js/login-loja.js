import { auth, db, mostrarNotificacao } from './firebase-config.js';
import { doc, getDoc, getDocs, updateDoc, collection, addDoc, setDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

const containerCadastro = document.getElementById('section-criar-loja');

const selectWrapper = document.querySelector('.custom-select-wrapper');
const selectTrigger = document.getElementById('categoria-trigger');
const selectedText = document.getElementById('categoria-selected-text');
const optionsBox = document.getElementById('categoria-options');
const inputHiddenCategoria = document.getElementById('loja-categoria');

// Evento do Select Customizado de Categoria
if (selectTrigger) {
    selectTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        selectWrapper.classList.toggle('active');
    });

    document.addEventListener('click', () => {
        selectWrapper.classList.remove('active');
    });
}

// Máscara Dinâmica CPF/CNPJ
const inputCpfCnpj = document.getElementById('loja-cpf-cnpj');
if (inputCpfCnpj) {
    inputCpfCnpj.oninput = (e) => {
        let v = e.target.value.replace(/\D/g, "");
        if (v.length <= 11) {
            v = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
        } else {
            v = v.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
        }
        e.target.value = v;
    };
}

// Máscara Dinâmica para Telefone/WhatsApp
const inputTelefone = document.getElementById('loja-telefone');
if (inputTelefone) {
    inputTelefone.oninput = (e) => {
        let v = e.target.value.replace(/\D/g, "");
        v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
        v = v.replace(/(\d)(\d{4})$/, "$1-$2");
        e.target.value = v;
    };
}

// Máscara e Busca Dinâmica de CEP
const aplicarMascaraCEP = (valor) => {
    return valor.replace(/\D/g, "").replace(/^(\d{5})(\d)/, "$1-$2");
};

const inputCep = document.getElementById('loja-cep');
if (inputCep) {
    inputCep.oninput = (e) => e.target.value = aplicarMascaraCEP(e.target.value);

    inputCep.addEventListener('blur', async (e) => {
        const cep = e.target.value.replace(/\D/g, "");
        
        if (cep.length !== 8) {
            if (cep.length > 0) mostrarNotificacao("CEP incompleto.", "error");
            return;
        }

        const inputBairro = document.getElementById('loja-bairro');
        const inputCidade = document.getElementById('loja-cidade');
        const inputEstado = document.getElementById('loja-estado');
        const inputRua = document.getElementById('loja-rua');

        try {
            inputCidade.value = "Buscando...";
            
            const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const dados = await response.json();

            if (dados.erro) {
                mostrarNotificacao("CEP não encontrado.", "error");
                inputCidade.value = "";
                return;
            }

            inputCidade.value = dados.localidade;
            inputEstado.value = dados.uf;

            if (dados.bairro && dados.bairro.trim() !== "") {
                inputBairro.value = dados.bairro;
                inputBairro.readOnly = true;
                inputBairro.classList.add('input-bloqueado');
            } else {
                inputBairro.value = "";
                inputBairro.readOnly = false;
                inputBairro.classList.remove('input-bloqueado');
                inputBairro.placeholder = "Informe o bairro";
            }

            inputRua.value = dados.logradouro || "";
            document.getElementById('loja-numero').focus();

        } catch (err) {
            console.error("Erro ViaCEP:", err);
            mostrarNotificacao("Serviço de busca de CEP offline.", "error");
            inputCidade.value = "";
        }
    });
}

// Carregar Categorias do Banco
async function carregarCategorias() {
    try {
        const querySnapshot = await getDocs(collection(db, "categorias"));
        optionsBox.innerHTML = ""; 

        querySnapshot.forEach((docSnap) => {
            const nomeCat = docSnap.data().nome;
            
            const optionDiv = document.createElement('div');
            optionDiv.className = 'custom-option';
            optionDiv.textContent = nomeCat;
            optionDiv.setAttribute('data-value', nomeCat);

            optionDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                
                inputHiddenCategoria.value = nomeCat;
                selectedText.textContent = nomeCat;
                selectedText.removeAttribute('style'); 

                document.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                optionDiv.classList.add('selected');

                selectWrapper.classList.remove('active');
            });

            optionsBox.appendChild(optionDiv);
        });
    } catch (e) { 
        console.error("Erro ao carregar categorias:", e); 
    }
}

// Monitor de Autenticação e Segurança
onAuthStateChanged(auth, async (user) => {
    if (!user) { 
        window.location.href = 'login.html'; 
        return; 
    }

    try {
        const userDoc = await getDoc(doc(db, "usuarios", user.uid));
        const userData = userDoc.data();

        if (userData?.status === "suspenso") {
            mostrarNotificacao("Sua conta está suspensa. Acesso negado.", "error");
            await signOut(auth);
            setTimeout(() => window.location.href = 'login.html', 1500);
            return;
        }

        if (userData?.loja) {
            window.location.href = 'perfil-loja.html';
            return; 
        }

        await carregarCategorias();
        containerCadastro.classList.remove('hidden');

    } catch (error) {
        console.error("Erro no Auth:", error);
        mostrarNotificacao("Erro ao validar acesso.", "error");
    }
});

// Ação Principal: Criar Loja
const btnFinalizar = document.getElementById('btn-finalizar-loja');
if (btnFinalizar) {
    btnFinalizar.onclick = async () => {
        const user = auth.currentUser;
        
        const cidadeRaw = document.getElementById('loja-cidade').value.trim();
        const estadoRaw = document.getElementById('loja-estado').value.trim().toUpperCase();
        const bairroRaw = document.getElementById('loja-bairro').value.trim();

        // Captura de Telefone (Obrigatório) e E-mail (Opcional)
        const telefoneVal = document.getElementById('loja-telefone').value.trim();
        const emailVal = document.getElementById('loja-email').value.trim();

        // Capitalização padronizada
        const cidade = cidadeRaw ? cidadeRaw.charAt(0).toUpperCase() + cidadeRaw.slice(1).toLowerCase() : "";
        const bairro = bairroRaw ? bairroRaw.charAt(0).toUpperCase() + bairroRaw.slice(1).toLowerCase() : "";

        const dadosLoja = {
            nome: document.getElementById('loja-nome').value.trim(),
            cpfCnpj: document.getElementById('loja-cpf-cnpj').value.trim(),
            categoria: inputHiddenCategoria.value, 
            telefone: telefoneVal,                          // ➔ Salva o Telefone Obrigatório
            email: emailVal || "",                          // ➔ Salva o E-mail Opcional
            descricao: document.getElementById('loja-descricao').value.trim(),
            cepLoja: document.getElementById('loja-cep').value.trim(),
            bairroLoja: bairro,
            cidadeLoja: `${cidade} - ${estadoRaw}`, 
            estadoLoja: estadoRaw,
            ruaLoja: document.getElementById('loja-rua').value.trim(),
            numeroLoja: document.getElementById('loja-numero').value.trim(),
            complementoLoja: document.getElementById('loja-complemento').value.trim(),
            donoUid: user.uid,
            status: "pendente",
            criadoEm: new Date(),
            temaLoja: "#ff6400"
        };

        // Validação Estrita de Obrigatórios
        if (!dadosLoja.nome || !dadosLoja.cpfCnpj || !dadosLoja.categoria || !telefoneVal || !cidadeRaw || !bairroRaw) {
            mostrarNotificacao("Preencha Nome, Documento, Categoria, Telefone e um CEP válido.", "error");
            return;
        }

        try {
            btnFinalizar.disabled = true;
            btnFinalizar.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Criando Loja...';

            // 1. Cria o documento da loja no Firestore
            const lojaRef = await addDoc(collection(db, "lojas"), dadosLoja);
            
            // 2. Atualiza o perfil do usuário para dono
            await updateDoc(doc(db, "usuarios", user.uid), { 
                tipo: "dono",
                loja: lojaRef.id 
            });

            // 3. Mapeamento Geográfico Automático (NordGo Maps)
            if (cidade && estadoRaw && bairro) {
                try {
                    const idRegiaoDoc = `${cidade}-${estadoRaw}`;
                    const regiaoRef = doc(db, "regioes", idRegiaoDoc);
                    const regiaoSnap = await getDoc(regiaoRef);

                    if (!regiaoSnap.exists()) {
                        await setDoc(regiaoRef, {
                            cidade: cidade,
                            uf: estadoRaw,
                            bairros: [bairro]
                        });
                    } else {
                        await updateDoc(regiaoRef, {
                            bairros: arrayUnion(bairro)
                        });
                    }
                } catch (geoError) {
                    console.warn("[NordGo Maps]:", geoError.message);
                }
            }

            mostrarNotificacao("Loja criada com sucesso!");
            setTimeout(() => window.location.href = 'perfil-loja.html', 1500);

        } catch (e) {
            btnFinalizar.disabled = false;
            btnFinalizar.innerHTML = '<i class="fa-solid fa-rocket"></i> Criar minha loja';
            console.error("Erro ao criar loja:", e);
            mostrarNotificacao("Erro ao salvar os dados.", "error");
        }
    };
}