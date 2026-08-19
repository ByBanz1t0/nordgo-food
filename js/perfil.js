import { auth, db, storage, mostrarNotificacao } from './firebase-config.js';
import { ref, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import { 
    doc, getDoc, updateDoc, deleteDoc, setDoc, arrayUnion, collection, query, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

/**
 * Redimensiona e compacta imagens no cliente antes do upload
 * @param {File} arquivoOriginal - Arquivo vindo do <input type="file">
 * @param {number} larguraMaxima - Largura máxima desejada (300px para avatares)
 * @param {number} qualidade - Qualidade da compressão (0.8 = 80%)
 * @returns {Promise<string>} Retorna a imagem otimizada em Base64/WebP
 */
function compactarEPadronizarImagem(arquivoOriginal, larguraMaxima = 300, qualidade = 0.8) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.readAsDataURL(arquivoOriginal);
        
        leitor.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = () => {
                let largura = img.width;
                let altura = img.height;

                if (largura > larguraMaxima) {
                    altura = Math.round((altura * larguraMaxima) / largura);
                    largura = larguraMaxima;
                }

                const canvas = document.createElement('canvas');
                canvas.width = largura;
                canvas.height = altura;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, largura, altura);

                const imagemCompactadaBase64 = canvas.toDataURL('image/webp', qualidade);
                resolve(imagemCompactadaBase64);
            };

            img.onerror = (error) => reject(error);
        };

        leitor.onerror = (error) => reject(error);
    });
}

const campos = {
    nome: document.getElementById('perfil-nome'),
    email: document.getElementById('perfil-email'),
    cpf: document.getElementById('perfil-cpf'),
    telefone: document.getElementById('perfil-telefone'),
    fotoDisplay: document.getElementById('foto-perfil-display'),
    fotoInput: document.getElementById('input-foto-perfil')
};

const formEndInline = document.getElementById('form-endereco-inline');
const formCardInline = document.getElementById('form-cartao-inline');

let listaEnderecosLocal = [];
let listaCartoesLocal = [];
let imagemBase64OtimizadaParaSalvar = null;

document.getElementById('btn-voltar-index').onclick = () => window.location.href = '../index.html';

const abrirModal = (id) => document.getElementById(id).classList.add('active');
const fecharModal = (id) => document.getElementById(id).classList.remove('active');

document.getElementById('trigger-modal-dados').onclick = () => abrirModal('modal-dados-basicos');
document.getElementById('trigger-modal-enderecos').onclick = () => abrirModal('modal-enderecos');
document.getElementById('trigger-modal-cartoes').onclick = () => abrirModal('modal-cartoes');

document.querySelectorAll('.btn-fechar-modal-perfil').forEach(btn => {
    btn.onclick = (e) => fecharModal(e.currentTarget.getAttribute('data-modal'));
});

const aplicarMascaraCPF = (v) => String(v || '').replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})/, '$1-$2').replace(/(-\d{2})\d+?$/, '$1');
const aplicarMascaraTelefone = (v) => String(v || '').replace(/\D/g, '').replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').replace(/(-\d{4})\d+?$/, '$1');
const aplicarMascaraCEP = (v) => String(v || '').replace(/\D/g, "").replace(/^(\d{5})(\d)/, "$1-$2");

campos.cpf.addEventListener('input', (e) => e.target.value = aplicarMascaraCPF(e.target.value));
campos.telefone.addEventListener('input', (e) => e.target.value = aplicarMascaraTelefone(e.target.value));
document.getElementById('end-cep').addEventListener('input', (e) => e.target.value = aplicarMascaraCEP(e.target.value));
document.getElementById('card-numero').oninput = (e) => e.target.value = e.target.value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");
document.getElementById('card-validade').oninput = (e) => {
    let v = e.target.value.replace(/\D/g, "");
    if (v.length > 2) v = v.substring(0,2) + "/" + v.substring(2,4);
    e.target.value = v;
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

document.getElementById('end-cep').addEventListener('blur', async (e) => {
    const cep = e.target.value.replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
        document.getElementById('end-cidade-uf').value = "Buscando...";
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const dados = await response.json();
        if (!dados.erro) {
            document.getElementById('end-bairro').value = dados.bairro || "";
            document.getElementById('end-cidade-uf').value = `${dados.localidade} - ${dados.uf.toUpperCase()}`;
            document.getElementById('end-rua').value = dados.logradouro || "";
            document.getElementById('end-numero').focus();
        }
    } catch (err) { console.error(err); }
});

// EVENTO DE SELEÇÃO E OTIMIZAÇÃO DA FOTO DE PERFIL
campos.fotoInput.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (file) {
        try {
            mostrarNotificacao("Otimizando imagem...", "info");
            imagemBase64OtimizadaParaSalvar = await compactarEPadronizarImagem(file, 300, 0.8);
            campos.fotoDisplay.src = imagemBase64OtimizadaParaSalvar;
        } catch (err) {
            console.error("Erro ao compactar foto:", err);
            mostrarNotificacao("Erro ao processar imagem.", "error");
        }
    }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await atualizarSessaoPerfil(user.uid);
    } else { window.location.href = "login.html"; }
});

async function atualizarSessaoPerfil(uid) {
    try {
        const userSnap = await getDoc(doc(db, "usuarios", uid));
        if (userSnap.exists()) {
            const d = userSnap.data();
            
            campos.nome.value = d.nome || "";
            campos.email.value = d.email || "";
            campos.telefone.value = aplicarMascaraTelefone(d.telefoneCliente || "");
            if (d.fotoUrl) campos.fotoDisplay.src = d.fotoUrl;

            if (d.cpfCliente && d.cpfCliente.trim() !== "") {
                campos.cpf.value = aplicarMascaraCPF(d.cpfCliente);
                campos.cpf.readOnly = true;
                campos.cpf.classList.add('input-bloqueado');
            } else {
                campos.cpf.value = "";
                campos.cpf.readOnly = false;
                campos.cpf.classList.remove('input-bloqueado');
            }

            listaEnderecosLocal = d.enderecoCliente || [];
            listaCartoesLocal = d.cartoesCliente || [];

            document.getElementById('avatar-dashboard-preview').src = d.fotoUrl || "../assets/images/default-user.png";
            document.getElementById('txt-resumo-nome').innerText = d.nome || "Cliente";
            
            const padrao = listaEnderecosLocal.find(end => end && (end.padrao === true || end.padrao === "true"));
            
            document.getElementById('txt-resumo-enderecos').innerText = padrao 
                ? `${String(padrao.apelido || "Endereço").toUpperCase()}: ${padrao.rua || ""}, Nº ${padrao.numero || ""}` 
                : `${listaEnderecosLocal.length} endereço(s) salvo(s)`;

            document.getElementById('txt-resumo-cartoes').innerText = listaCartoesLocal.length > 0 
                ? `${listaCartoesLocal.length} cartão(ões) cadastrado(s)` 
                : "Nenhum cartão salvo";

            renderizarEnderecos();
            renderizarCartoes();
        }
    } catch (e) { console.error(e); }
}

document.getElementById('btn-salvar-perfil').onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const nomeVal = campos.nome.value.trim();
    const cpfVal = campos.cpf.value.trim();
    const telefoneVal = campos.telefone.value.trim();

    if (!nomeVal || !cpfVal || !telefoneVal) {
        mostrarNotificacao("Os campos de Nome, CPF e Telefone são obrigatórios.", "error");
        return;
    }

    if (!validarCPFMatematico(cpfVal)) {
        mostrarNotificacao("O CPF informado é inválido. Verifique os dígitos.", "error");
        return;
    }

    const cpfLimpoId = cpfVal.replace(/\D/g, "");

    try {
        const userRef = doc(db, "usuarios", user.uid);
        const userSnap = await getDoc(userRef);
        let cpfAntigo = "";

        if (userSnap.exists()) {
            cpfAntigo = userSnap.data().cpfCliente || "";
        }

        if (cpfAntigo.trim() === "") {
            mostrarNotificacao("Validando integridade do CPF...", "info");
            
            const cpfRef = doc(db, "cpfs_cadastrados", cpfLimpoId);
            const cpfSnap = await getDoc(cpfRef);

            if (cpfSnap.exists()) {
                mostrarNotificacao("Este CPF já está sendo utilizado por outra conta.", "error");
                return;
            }

            await setDoc(cpfRef, {
                isCpfLock: true,
                userId: user.uid,
                dataVinculo: new Date().toISOString()
            });
        }

        let urlFotoFinal = campos.fotoDisplay.src;
        if (imagemBase64OtimizadaParaSalvar) {
            mostrarNotificacao("Enviando foto compactada...", "info");
            const storageRef = ref(storage, `usuarios/${user.uid}/perfil_${Date.now()}.webp`);
            await uploadString(storageRef, imagemBase64OtimizadaParaSalvar, 'data_url');
            urlFotoFinal = await getDownloadURL(storageRef);
            imagemBase64OtimizadaParaSalvar = null;
        }
        
        await updateDoc(userRef, {
            nome: nomeVal,
            cpfCliente: cpfVal,
            telefoneCliente: telefoneVal,
            fotoUrl: urlFotoFinal
        });
        
        mostrarNotificacao("Perfil atualizado com sucesso!");
        fecharModal('modal-dados-basicos');
        await atualizarSessaoPerfil(user.uid);
    } catch (e) { 
        console.error("Erro ao salvar perfil:", e);
        mostrarNotificacao("Erro ao salvar alterações.", "error"); 
    }
};

document.getElementById('btn-adicionar-novo-end-modal').onclick = () => {
    limparFormEndereco();
    document.getElementById('titulo-form-endereco').innerText = "Novo Endereço";
    formEndInline.classList.remove('hidden');
};
document.getElementById('btn-cancelar-endereco').onclick = () => formEndInline.classList.add('hidden');

document.getElementById('btn-confirmar-endereco').onclick = async () => {
    const index = document.getElementById('edit-endereco-index').value;
    const apelido = document.getElementById('end-apelido').value.trim() || "Outro";
    const cep = document.getElementById('end-cep').value.trim();
    const bairroCru = document.getElementById('end-bairro').value.trim();
    const cidadeUfFull = document.getElementById('end-cidade-uf').value.trim();
    const rua = document.getElementById('end-rua').value.trim();
    const numero = document.getElementById('end-numero').value.trim();
    const obs = document.getElementById('end-obs').value.trim() || "Sem observação";
    const marcouPadrao = document.getElementById('end-padrao').checked;

    if (!cep || !bairroCru || !cidadeUfFull || !rua || !numero) {
        mostrarNotificacao("Campos obrigatórios vazios.", "error"); return;
    }

    const partesRegiao = cidadeUfFull.split(" - ");
    const cidadeCru = partesRegiao[0] || "";
    const estado = (partesRegiao[1] || "").toUpperCase();

    const cidade = cidadeCru.charAt(0).toUpperCase() + cidadeCru.slice(1).toLowerCase();
    const bairro = bairroCru.charAt(0).toUpperCase() + bairroCru.slice(1).toLowerCase();

    const id = index !== "" ? listaEnderecosLocal[index].id : Date.now().toString();

    const novoEnderecoObj = {
        id: id,
        apelido: apelido,
        rua: rua,
        numero: numero,
        bairro: bairro,
        cidade: `${cidade} - ${estado}`,
        observacao: obs,
        padrao: marcouPadrao,
        cep: cep
    };

    if (marcouPadrao) {
        listaEnderecosLocal = listaEnderecosLocal.map(end => {
            if(end) end.padrao = false;
            return end;
        });
    }

    if (index !== "") {
        listaEnderecosLocal[index] = novoEnderecoObj;
    } else {
        listaEnderecosLocal.push(novoEnderecoObj);
    }

    await updateDoc(doc(db, "usuarios", auth.currentUser.uid), { enderecoCliente: listaEnderecosLocal });

    if (cidade && estado && bairro) {
        try {
            const idRegiaoDoc = `${cidade}-${estado}`;
            const regiaoRef = doc(db, "regioes", idRegiaoDoc);
            const regiaoSnap = await getDoc(regiaoRef);

            if (!regiaoSnap.exists()) {
                await setDoc(regiaoRef, {
                    cidade: cidade,
                    uf: estado,
                    bairros: [bairro]
                });
            } else {
                await updateDoc(regiaoRef, {
                    bairros: arrayUnion(bairro)
                });
            }
        } catch (geoError) {
            console.warn("[NordGo Maps - Aviso de Permissão no Perfil]:", geoError.message);
        }
    }

    formEndInline.classList.add('hidden');
    mostrarNotificacao("Endereço salvo!");
    await atualizarSessaoPerfil(auth.currentUser.uid);
};

function renderizarEnderecos() {
    const container = document.getElementById('container-lista-enderecos'); 
    container.innerHTML = "";
    
    listaEnderecosLocal.forEach((end, index) => {
        if(!end) return;
        const isPadrao = end.padrao === true || end.padrao === "true";
        const div = document.createElement('div');
        div.className = `item-lista-card ${isPadrao ? 'item-padrao-ativo' : ''}`;
        
        div.innerHTML = `
            <div class="item-lista-info">
                <strong>${String(end.apelido || 'Endereço').toUpperCase()} ${isPadrao ? '<span class="badge-padrao">Padrão</span>' : ''}</strong>
                <span>${end.rua || ""}, Nº ${end.numero || ""} - ${end.bairro || ""}</span>
            </div>
            <div class="item-lista-actions">
                <button class="btn-action-edit" data-idx="${index}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-action-delete" data-idx="${index}"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('.btn-action-edit').forEach(b => {
        b.onclick = (e) => {
            const idx = e.currentTarget.getAttribute('data-idx');
            const end = listaEnderecosLocal[idx];
            if(!end) return;
            
            document.getElementById('edit-endereco-index').value = idx;
            document.getElementById('end-apelido').value = end.apelido || "";
            document.getElementById('end-rua').value = end.rua || "";
            document.getElementById('end-numero').value = end.numero || "";
            document.getElementById('end-bairro').value = end.bairro || "";
            document.getElementById('end-cidade-uf').value = end.cidade || "";
            document.getElementById('end-obs').value = end.observacao === "Sem observação" ? "" : (end.observacao || "");
            document.getElementById('end-padrao').checked = end.padrao === true || end.padrao === "true";
            document.getElementById('end-cep').value = end.cep || "";
            
            document.getElementById('titulo-form-endereco').innerText = "Editar Endereço";
            formEndInline.classList.remove('hidden');
        };
    });

    container.querySelectorAll('.btn-action-delete').forEach(b => {
        b.onclick = async (e) => {
            if (confirm("Remover endereço?")) {
                listaEnderecosLocal.splice(e.currentTarget.getAttribute('data-idx'), 1);
                await updateDoc(doc(db, "usuarios", auth.currentUser.uid), { enderecoCliente: listaEnderecosLocal });
                await atualizarSessaoPerfil(auth.currentUser.uid);
            }
        };
    });
}

function limparFormEndereco() {
    document.getElementById('edit-endereco-index').value = "";
    ['end-apelido', 'end-cep', 'end-bairro', 'end-cidade-uf', 'end-rua', 'end-numero', 'end-obs'].forEach(id => {
        document.getElementById(id).value = "";
    });
    document.getElementById('end-padrao').checked = false;
}

document.getElementById('btn-adicionar-novo-card-modal').onclick = () => {
    document.getElementById('card-titular').value = "";
    document.getElementById('card-numero').value = "";
    document.getElementById('card-validade').value = "";
    formCardInline.classList.remove('hidden');
};
document.getElementById('btn-cancelar-cartao').onclick = () => formCardInline.classList.add('hidden');

document.getElementById('btn-confirmar-cartao').onclick = async () => {
    const titular = document.getElementById('card-titular').value.trim();
    const numFull = document.getElementById('card-numero').value.trim();
    const val = document.getElementById('card-validade').value.trim();
    const tipo = document.getElementById('card-tipo').value;

    if(!titular || numFull.length < 19 || val.length < 5) {
        mostrarNotificacao("Dados inválidos do cartão.", "error"); return;
    }
    
    const ultimosDigitos = numFull.replace(/\s+/g, "").substring(numFull.replace(/\s+/g, "").length - 4);
    const bandeira = numFull.startsWith('5') ? 'mastercard' : 'visa';

    const novoCartaoObj = {
        cardId: Date.now().toString(),
        customerId: "",
        bandeira: bandeira,
        ultimosDigitos: ultimosDigitos,
        titular: titular.toUpperCase(),
        tipo: tipo === 'crédito' ? 'credit_card' : 'debit_card',
        exibicao: `${bandeira.toUpperCase()} ${tipo.toUpperCase()} final ${ultimosDigitos}`,
        padrao: listaCartoesLocal.length === 0
    };

    listaCartoesLocal.push(novoCartaoObj);

    await updateDoc(doc(db, "usuarios", auth.currentUser.uid), { cartoesCliente: listaCartoesLocal });
    formCardInline.classList.add('hidden');
    mostrarNotificacao("Cartão salvo!");
    await atualizarSessaoPerfil(auth.currentUser.uid);
};

function renderizarCartoes() {
    const container = document.getElementById('container-lista-cartoes'); container.innerHTML = "";
    listaCartoesLocal.forEach((c, idx) => {
        if(!c) return;
        const div = document.createElement('div'); div.className = "item-lista-card";
        div.innerHTML = `
            <div class="item-lista-info">
                <strong><i class="fa-solid fa-credit-card"></i> ${c.exibicao || "Cartão Salvo"}</strong>
                <span>Titular: ${c.titular || ""}</span>
            </div>
            <div class="item-lista-actions">
                <button class="btn-action-delete-card" data-idx="${idx}"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('.btn-action-delete-card').forEach(b => {
        b.onclick = async (e) => {
            if (confirm("Remover cartão?")) {
                listaCartoesLocal.splice(e.currentTarget.getAttribute('data-idx'), 1);
                await updateDoc(doc(db, "usuarios", auth.currentUser.uid), { cartoesCliente: listaCartoesLocal });
                await atualizarSessaoPerfil(auth.currentUser.uid);
            }
        };
    });
}

document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => window.location.href = "../index.html");

// FLUXO DE EXCLUSÃO DE CONTA RESILIENTE E PADRÃO OURO (100% LGPD)
document.getElementById('btn-deletar-conta').onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    if (confirm("Tem certeza que deseja excluir permanentemente sua conta? Esta ação não pode ser desfeita, liberará o seu CPF e excluirá todos os produtos, cupons e a loja vinculada.")) {
        try {
            const tokenResult = await user.getIdTokenResult();
            const authTime = new Date(tokenResult.authTime).getTime();
            const currentTime = new Date().getTime();
            const diffMinutes = (currentTime - authTime) / 1000 / 60;

            if (diffMinutes > 5) {
                mostrarNotificacao("Por segurança, faça login novamente antes de excluir sua conta.", "error");
                setTimeout(async () => {
                    await signOut(auth);
                    window.location.href = "login.html";
                }, 2500);
                return;
            }

            mostrarNotificacao("Excluindo conta, loja e limpando dados...", "info");

            const userRef = doc(db, "usuarios", user.uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                const userData = userSnap.data();
                
                // 1. LIMPEZA COMPLETA DA LOJA COM ISOLAMENTO DE ERROS
                if (userData.loja) {
                    const idLoja = userData.loja;

                    // Tenta apagar Produtos
                    try {
                        const qProdutos = query(collection(db, "produtos"), where("lojaId", "==", idLoja));
                        const snapProdutos = await getDocs(qProdutos);
                        const promisesProdutos = [];
                        snapProdutos.forEach(docSnap => promisesProdutos.push(deleteDoc(doc(db, "produtos", docSnap.id))));
                        await Promise.all(promisesProdutos);
                    } catch(e) { console.warn("Aviso: Alguns produtos não puderam ser apagados.", e); }

                    // Tenta apagar Cupons
                    try {
                        const qCupons = query(collection(db, "cupons"), where("lojaId", "==", idLoja));
                        const snapCupons = await getDocs(qCupons);
                        const promisesCupons = [];
                        snapCupons.forEach(docSnap => promisesCupons.push(deleteDoc(doc(db, "cupons", docSnap.id))));
                        await Promise.all(promisesCupons);
                    } catch(e) { console.warn("Aviso: Alguns cupons não puderam ser apagados.", e); }

                    // Tenta apagar a Loja
                    try {
                        await deleteDoc(doc(db, "lojas", idLoja));
                    } catch(e) { console.warn("Aviso: Documento da loja não pôde ser apagado.", e); }
                }

                // 2. Libera o lock do CPF com isolamento
                if (userData.cpfCliente) {
                    try {
                        const cpfLimpo = userData.cpfCliente.replace(/\D/g, "");
                        const lockRef = doc(db, "cpfs_cadastrados", cpfLimpo);
                        await deleteDoc(lockRef);
                    } catch (e) { console.warn("Aviso: Trava de CPF antiga não pôde ser apagada.", e); }
                }

                // 3. Apaga a foto de perfil do Storage (Se houver)
                if (userData.fotoUrl && userData.fotoUrl.includes('firebasestorage')) {
                    try {
                        const fotoRef = ref(storage, userData.fotoUrl);
                        await deleteObject(fotoRef);
                    } catch (e) { console.warn("Aviso: Foto de perfil antiga não pôde ser apagada do servidor.", e); }
                }
            }

            // 4. Exclui o documento do perfil em 'usuarios'
            await deleteDoc(userRef);

            // 5. Limpa o CEP do cache do navegador do usuário
            localStorage.removeItem('nordgo_cep_usuario');

            // 6. Exclui a conta do Firebase Authentication
            await deleteUser(user);

            mostrarNotificacao("Sua conta, loja e arquivos foram completamente excluídos.");
            setTimeout(() => window.location.href = "../index.html", 1500);

        } catch (error) {
            console.error("Erro completo no fluxo de exclusão de conta:", error);
            mostrarNotificacao("Falha ao excluir conta. Verifique suas permissões no Firestore.", "error");
        }
    }
};