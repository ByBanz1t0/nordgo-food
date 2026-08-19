import { auth, db, storage, mostrarNotificacao } from './firebase-config.js';
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import { 
    collection, 
    getDocs, 
    getDoc, 
    setDoc, 
    deleteDoc, 
    doc, 
    updateDoc, 
    query, 
    orderBy, 
    addDoc,
    where, 
    arrayUnion, 
    arrayRemove,
    onSnapshot,
    enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-functions.js";

// PERSISTÊNCIA LOCAL
try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn("Múltiplas abas abertas: o cache persistente funciona em apenas uma aba por vez.");
        } else if (err.code === 'unimplemented') {
            console.warn("O navegador atual não suporta persistência de dados offline.");
        }
    });
} catch (e) {
    console.warn("Não foi possível inicializar a persistência local:", e);
}

// Variáveis Globais de Permissão e Cache
let usuarioLogadoCargo = "cliente"; // 'admin', 'suporte', 'cliente'
let ehAdminMaster = false;

let cacheListaLojas = [];
let cacheListaUsuarios = [];
let cacheListaCategorias = [];
let unsubscribeMonitorPixAdmin = null;

let base64CategoriaNova = null;
let base64CategoriaEditando = null;

// Troca de Abas
const tabs = document.querySelectorAll('.tab-btn');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active-content'));
        
        tab.classList.add('active');
        document.getElementById(tab.getAttribute('data-tab'))?.classList.add('active-content');

        tab.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
        });
    });
});

// Monitor de Autenticação e Permissão de Acesso
onAuthStateChanged(auth, async (user) => {
    const userArea = document.getElementById('user-area');
    const tituloHeader = document.getElementById('titulo-painel-header');

    if (!user) { 
        window.location.href = 'login.html'; 
        return; 
    }

    try {
        const userDocRef = doc(db, "usuarios", user.uid);
        const userSnap = await getDoc(userDocRef);
        const userData = userSnap.exists() ? userSnap.data() : {};

        ehAdminMaster = userData.isAdmin === true || userData.cargo === 'admin' || userData.role === 'admin';
        const ehSuporte = userData.cargo === 'suporte' || userData.role === 'suporte';

        if (!ehAdminMaster && !ehSuporte) {
            alert("Acesso Negado: Esta área é restrita à equipe de gestão e suporte.");
            window.location.href = '../index.html';
            return;
        }

        usuarioLogadoCargo = ehAdminMaster ? "admin" : "suporte";

        if (tituloHeader) {
            tituloHeader.innerText = ehAdminMaster ? "Painel Admin" : "Painel Suporte";
        }

        // APLICA AS RESTRIÇÕES DE VISIBILIDADE DAS ABAS PARA SUPORTE
        aplicarRestricoesDeInterfaceCargo();

        // Carrega os módulos permitidos
        carregarCategorias();
        carregarLojas();
        carregarLogisticaGeral();
        carregarUsuarios();
        inicializarCamposDeBusca();

        // Carrega dados financeiros somente se for Admin
        if (ehAdminMaster) {
            carregarCupons();
            carregarTaxaPlataforma();
            carregarBalancoRepassesAdmin();
            carregarMotivosCancelamento();
            carregarSolicitacoesReembolso();
        }

    } catch (err) {
        console.error("Erro ao verificar permissões:", err);
        alert("Erro de autenticação ao validar permissões.");
        window.location.href = '../index.html';
    }
});

function aplicarRestricoesDeInterfaceCargo() {
    if (usuarioLogadoCargo === "suporte") {
        // Oculta abas que o suporte não pode ver
        document.querySelectorAll('.aba-restrita-admin').forEach(elem => {
            elem.style.display = 'none';
        });
    }
}

/* ============================================================
   FUNÇÃO: COMPRESSÃO E CORTE 1:1 DE IMAGEM DA CATEGORIA
   ============================================================ */
function compactarImagemQuadrada(arquivo, dimensao = 250, qualidade = 0.8) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.readAsDataURL(arquivo);
        
        leitor.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = dimensao;
                canvas.height = dimensao;
                const ctx = canvas.getContext('2d');

                const ladoMenor = Math.min(img.width, img.height);
                const centroX = (img.width - ladoMenor) / 2;
                const centroY = (img.height - ladoMenor) / 2;

                ctx.drawImage(img, centroX, centroY, ladoMenor, ladoMenor, 0, 0, dimensao, dimensao);
                const webpBase64 = canvas.toDataURL('image/webp', qualidade);
                resolve(webpBase64);
            };

            img.onerror = (error) => reject(error);
        };

        leitor.onerror = (error) => reject(error);
    });
}

// Inputs de arquivo para novas e edições de categorias
const catFotoInput = document.getElementById('cat-foto-input');
const previewCatFoto = document.getElementById('preview-cat-foto');

if (catFotoInput) {
    catFotoInput.onchange = async (e) => {
        if (e.target.files && e.target.files[0]) {
            try {
                mostrarNotificacao("Otimizando imagem...", "info");
                base64CategoriaNova = await compactarImagemQuadrada(e.target.files[0], 250, 0.8);
                if (previewCatFoto) previewCatFoto.src = base64CategoriaNova;
            } catch (err) {
                console.error(err);
                mostrarNotificacao("Erro ao processar imagem.", "error");
            }
        }
    };
}

const editCatFotoInput = document.getElementById('edit-cat-foto-input');
const previewEditCatFoto = document.getElementById('preview-edit-cat-foto');

if (editCatFotoInput) {
    editCatFotoInput.onchange = async (e) => {
        if (e.target.files && e.target.files[0]) {
            try {
                mostrarNotificacao("Otimizando imagem...", "info");
                base64CategoriaEditando = await compactarImagemQuadrada(e.target.files[0], 250, 0.8);
                if (previewEditCatFoto) previewEditCatFoto.src = base64CategoriaEditando;
            } catch (err) {
                console.error(err);
                mostrarNotificacao("Erro ao processar imagem.", "error");
            }
        }
    };
}

/* ============================================================
   BUSCAS NAS TABELAS
   ============================================================ */
function inicializarCamposDeBusca() {
    let inputBuscaLojas = document.getElementById('search-lojas');
    if (!inputBuscaLojas) {
        const tabelaLojas = document.getElementById('tabela-admin-lojas');
        if (tabelaLojas && tabelaLojas.closest('.tab-content')) {
            const containerAba = tabelaLojas.closest('.tab-content');
            const divWrapper = document.createElement('div');
            divWrapper.className = "admin-search-wrapper";
            divWrapper.innerHTML = `
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="search-lojas" placeholder="Buscar loja por Nome ou ID..." class="admin-search-input">
            `;
            containerAba.insertBefore(divWrapper, containerAba.firstChild);
            inputBuscaLojas = document.getElementById('search-lojas');
        }
    }

    if (inputBuscaLojas) {
        inputBuscaLojas.oninput = (e) => {
            const termo = e.target.value.trim().toLowerCase();
            renderizarTabelaLojas(termo);
        };
    }

    let inputBuscaUsuarios = document.getElementById('search-usuarios');
    if (!inputBuscaUsuarios) {
        const tabelaUsuarios = document.getElementById('tabela-admin-usuarios');
        if (tabelaUsuarios && tabelaUsuarios.closest('.tab-content')) {
            const containerAba = tabelaUsuarios.closest('.tab-content');
            const divWrapper = document.createElement('div');
            divWrapper.className = "admin-search-wrapper";
            divWrapper.innerHTML = `
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="search-usuarios" placeholder="Buscar usuário por Nome, E-mail ou ID..." class="admin-search-input">
            `;
            containerAba.insertBefore(divWrapper, containerAba.firstChild);
            inputBuscaUsuarios = document.getElementById('search-usuarios');
        }
    }

    if (inputBuscaUsuarios) {
        inputBuscaUsuarios.oninput = (e) => {
            const termo = e.target.value.trim().toLowerCase();
            renderizarTabelaUsuarios(termo);
        };
    }
}

/* ============================================================
   1. MÓDULO: CATEGORIAS (CADASTRO, LISTAGEM E EDIÇÃO COM LÁPIS)
   ============================================================ */
async function carregarCategorias() {
    const container = document.getElementById('lista-admin-categorias');
    if (!container) return;
    try {
        const snap = await getDocs(query(collection(db, "categorias"), orderBy("nome", "asc")));
        container.innerHTML = "";
        cacheListaCategorias = [];

        if(snap.empty) { 
            container.innerHTML = `<p class="txt-vazio">Nenhuma categoria encontrada.</p>`; 
            return; 
        }

        const fragment = document.createDocumentFragment();

        snap.forEach(docSnap => {
            const cat = docSnap.data();
            cat.id = docSnap.id;
            cacheListaCategorias.push(cat);

            const rawFoto = cat.imagem || cat.foto || cat.fotoArquivo || 'placeholder.png';
            const nomeArquivo = rawFoto.split('/').pop();
            const fotoUrl = rawFoto.startsWith('http') ? rawFoto : `../assets/images/${nomeArquivo}`;

            // Suporte NÃO pode apagar (botão lixeira visível apenas para admin)
            const botaoDeletarHtml = ehAdminMaster 
                ? `<button class="btn-delete-item" data-id="${docSnap.id}" title="Excluir Categoria"><i class="fa-solid fa-trash"></i></button>`
                : '';

            const item = document.createElement('div');
            item.className = 'admin-list-item';
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="${fotoUrl}" alt="${cat.nome}" style="width: 32px; height: 32px; object-fit: cover; border-radius: 6px;" onerror="this.src='../assets/images/placeholder.png';">
                    <span><strong>${cat.nome}</strong> <small class="txt-slug">(/${docSnap.id})</small></span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="btn-edit-categoria" data-id="${docSnap.id}" title="Editar Categoria" style="background:#f1f2f6; border:none; color:#2f3542; padding:6px 10px; border-radius:6px; cursor:pointer;">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${botaoDeletarHtml}
                </div>
            `;
            fragment.appendChild(item);
        });

        container.appendChild(fragment);

        // Listener de Edição (Lápis)
        container.querySelectorAll('.btn-edit-categoria').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                abrirModalEdicaoCategoria(id);
            };
        });

        // Listener de Exclusão (Admin)
        container.querySelectorAll('.btn-delete-item').forEach(btn => {
            btn.onclick = async (e) => {
                if(confirm("Excluir esta categoria?")) {
                    await deleteDoc(doc(db, "categorias", e.currentTarget.getAttribute('data-id')));
                    mostrarNotificacao("Categoria removida!"); 
                    carregarCategorias();
                }
            };
        });
    } catch (err) { container.innerHTML = "<p>Erro ao carregar.</p>"; }
}

function abrirModalEdicaoCategoria(catId) {
    const cat = cacheListaCategorias.find(c => c.id === catId);
    if (!cat) return;

    document.getElementById('edit-cat-id-antigo').value = cat.id;
    document.getElementById('edit-cat-nome').value = cat.nome || '';
    document.getElementById('edit-cat-slug').value = cat.slug || cat.id;

    const rawFoto = cat.imagem || cat.foto || cat.fotoArquivo || 'placeholder.png';
    const nomeArquivo = rawFoto.split('/').pop();
    const fotoUrl = rawFoto.startsWith('http') ? rawFoto : `../assets/images/${nomeArquivo}`;

    if (previewEditCatFoto) previewEditCatFoto.src = fotoUrl;
    base64CategoriaEditando = null;
    if (editCatFotoInput) editCatFotoInput.value = "";

    document.getElementById('modal-editar-categoria-admin')?.classList.add('active');
}

document.getElementById('btn-fechar-modal-edit-cat')?.addEventListener('click', () => {
    document.getElementById('modal-editar-categoria-admin')?.classList.remove('active');
});

document.getElementById('btn-salvar-edicao-categoria')?.addEventListener('click', async () => {
    const idAntigo = document.getElementById('edit-cat-id-antigo').value;
    const nomeNovo = document.getElementById('edit-cat-nome').value.trim();
    let slugNovo = document.getElementById('edit-cat-slug').value.trim().toLowerCase().replace(/[\s_]+/g, '-');

    if (!nomeNovo) {
        mostrarNotificacao("Informe o nome da categoria.", "error");
        return;
    }

    if (!slugNovo) {
        slugNovo = nomeNovo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "e").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
    }

    const btn = document.getElementById('btn-salvar-edicao-categoria');
    btn.disabled = true;
    btn.innerText = "Salvando alterações...";

    try {
        const catExistente = cacheListaCategorias.find(c => c.id === idAntigo) || {};
        let urlImagemFinal = catExistente.imagem || catExistente.fotoArquivo || `default-${slugNovo}.png`;

        if (base64CategoriaEditando) {
            const storageRef = ref(storage, `categorias/${Date.now()}_${slugNovo}.webp`);
            await uploadString(storageRef, base64CategoriaEditando, 'data_url');
            urlImagemFinal = await getDownloadURL(storageRef);
        }

        const dadosAtualizados = {
            nome: nomeNovo,
            slug: slugNovo,
            imagem: urlImagemFinal,
            fotoArquivo: urlImagemFinal,
            atualizadoEm: new Date().toISOString()
        };

        // Se o slug/ID mudou, cria o novo documento e apaga o antigo
        if (slugNovo !== idAntigo) {
            await setDoc(doc(db, "categorias", slugNovo), dadosAtualizados);
            await deleteDoc(doc(db, "categorias", idAntigo));
        } else {
            await updateDoc(doc(db, "categorias", idAntigo), dadosAtualizados);
        }

        mostrarNotificacao("Categoria atualizada com sucesso!");
        document.getElementById('modal-editar-categoria-admin')?.classList.remove('active');
        await carregarCategorias();

    } catch (err) {
        console.error("Erro ao editar categoria:", err);
        mostrarNotificacao("Erro ao atualizar categoria.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = "Salvar Alterações";
    }
});

const btnSalvarCat = document.getElementById('btn-salvar-categoria');
if (btnSalvarCat) {
    btnSalvarCat.onclick = async () => {
        const input = document.getElementById('cat-nome');
        const nomeValue = input.value.trim();
        if(!nomeValue) { mostrarNotificacao("Informe o nome da categoria.", "error"); return; }

        const slug = nomeValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "e").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");

        btnSalvarCat.disabled = true;
        btnSalvarCat.innerText = "Salvando...";

        try {
            let fotoArquivoNome = `default-${slug}.png`;
            let urlImagemFirebase = "";

            if (base64CategoriaNova) {
                const storageRef = ref(storage, `categorias/${Date.now()}_${slug}.webp`);
                await uploadString(storageRef, base64CategoriaNova, 'data_url');
                urlImagemFirebase = await getDownloadURL(storageRef);
                fotoArquivoNome = urlImagemFirebase;
            }

            await setDoc(doc(db, "categorias", slug), { 
                nome: nomeValue, 
                slug: slug, 
                fotoArquivo: fotoArquivoNome,
                imagem: urlImagemFirebase || fotoArquivoNome,
                criadoEm: new Date().toISOString()
            });

            mostrarNotificacao("Categoria adicionada com sucesso!"); 
            input.value = ""; 
            base64CategoriaNova = null;
            if (previewCatFoto) previewCatFoto.src = "../assets/images/placeholder.png";
            if (catFotoInput) catFotoInput.value = "";
            carregarCategorias();
        } catch (error) { 
            console.error(error);
            mostrarNotificacao("Erro ao criar categoria.", "error"); 
        } finally {
            btnSalvarCat.disabled = false;
            btnSalvarCat.innerText = "Cadastrar Categoria";
        }
    };
}

/* ============================================================
   2. MÓDULO: LOJAS (SUPORTE PODE APROVAR/SUSPENDER E VER INFO)
   ============================================================ */
async function carregarLojas() {
    try {
        const snap = await getDocs(collection(db, "lojas"));
        cacheListaLojas = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            cacheListaLojas.push(data);
        });

        const termoAnterior = document.getElementById('search-lojas')?.value.trim().toLowerCase() || "";
        renderizarTabelaLojas(termoAnterior);
    } catch (err) { 
        console.error(err);
        const tbody = document.getElementById('tabela-admin-lojas');
        if (tbody) tbody.innerHTML = "<tr><td colspan='5' class='txt-center'>Erro ao carregar lojas.</td></tr>"; 
    }
}

function renderizarTabelaLojas(termoFiltro = "") {
    const tbody = document.getElementById('tabela-admin-lojas');
    if (!tbody) return;
    tbody.innerHTML = "";

    const lojasFiltradas = cacheListaLojas.filter(loja => {
        if (!termoFiltro) return true;
        const nome = (loja.nome || "").toLowerCase();
        const id = (loja.id || "").toLowerCase();
        return nome.includes(termoFiltro) || id.includes(termoFiltro);
    });

    if (lojasFiltradas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="txt-center">Nenhuma loja encontrada para o termo pesquisado.</td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    lojasFiltradas.forEach(loja => {
        const tr = document.createElement('tr');
        
        let statusClass = 'status-pendente';
        if (loja.status === 'aprovado') statusClass = 'status-aprovado';
        if (loja.status === 'suspenso') statusClass = 'status-suspenso';

        let actionBtn = '';
        if (loja.status === 'aprovado') {
            actionBtn = `<button class="btn-status-toggle btn-block" data-id="${loja.id}" data-status="suspenso"><i class="fa-solid fa-ban"></i> Suspender</button>`;
        } else {
            actionBtn = `<button class="btn-status-toggle btn-allow" data-id="${loja.id}" data-status="aprovado"><i class="fa-solid fa-check"></i> Aprovar</button>`;
        }

        const cidadeExibir = loja.cidadeLoja || "Não informada";

        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div>
                        <strong>${loja.nome || 'Sem Nome'}</strong><br>
                        <small style="color:#747d8c; font-size:0.75rem;">ID: ${loja.id}</small>
                    </div>
                    <button class="btn-info-loja-modal" data-id="${loja.id}" title="Ver Informações Completas" style="background: none; border: none; color: #ff6400; font-size: 1.15rem; cursor: pointer; padding: 4px;">
                        <i class="fa-solid fa-circle-info"></i>
                    </button>
                </div>
            </td>
            <td>${loja.categoria || 'Geral'}</td>
            <td>${cidadeExibir}</td>
            <td><span class="badge-status ${statusClass}">${loja.status || 'pendente'}</span></td>
            <td>${actionBtn}</td>
        `;
        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);

    tbody.querySelectorAll('.btn-status-toggle').forEach(btn => {
        btn.onclick = async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const novoStatus = e.currentTarget.getAttribute('data-status');
            await updateDoc(doc(db, "lojas", id), { status: novoStatus });
            mostrarNotificacao(`Status da loja atualizado!`); 
            await carregarLojas();
        };
    });

    tbody.querySelectorAll('.btn-info-loja-modal').forEach(btn => {
        btn.onclick = (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            abrirModalInfoLoja(id);
        };
    });
}

// MODAL DE DETALHES COMPLETOS DA LOJA (i)
async function abrirModalInfoLoja(lojaId) {
    const modal = document.getElementById('modal-info-loja-admin');
    const corpo = document.getElementById('corpo-modal-info-loja');
    if (!modal || !corpo) return;

    modal.classList.add('active');
    corpo.innerHTML = `<p class="txt-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando dados completos...</p>`;

    const loja = cacheListaLojas.find(l => l.id === lojaId);
    if (!loja) {
        corpo.innerHTML = `<p style="color:#ff4757;">Loja não localizada.</p>`;
        return;
    }

    let dadosProprietario = { nome: "Não localizado", email: "Não localizado", telefone: "-" };
    if (loja.donoUid) {
        try {
            const userSnap = await getDoc(doc(db, "usuarios", loja.donoUid));
            if (userSnap.exists()) {
                dadosProprietario = userSnap.data();
            }
        } catch (e) {
            console.warn("Erro ao buscar dados do dono:", e);
        }
    }

    const logoUrl = loja.logoUrl || loja.logoLoja || '../assets/images/default-loja.png';
    const bannerHtml = loja.bannerLoja 
        ? `<div style="width:100%; height:120px; border-radius:8px; background:url('${loja.bannerLoja}') center/cover no-repeat; margin-bottom:12px;"></div>`
        : `<div style="width:100%; height:80px; border-radius:8px; background:${loja.temaLoja || '#ff6400'}; margin-bottom:12px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:600;">Sem Banner Personalizado</div>`;

    corpo.innerHTML = `
        ${bannerHtml}
        <div style="display:flex; gap:14px; align-items:center; margin-bottom:14px;">
            <img src="${logoUrl}" style="width:60px; height:60px; border-radius:50%; object-fit:cover; border:2px solid #ff6400;" onerror="this.src='../assets/images/default-loja.png';">
            <div>
                <h3 style="margin:0; color:#2f3542; font-size:1.15rem;">${loja.nome || 'Sem Nome'}</h3>
                <span style="font-size:0.8rem; color:#747d8c;">ID Loja: ${loja.id}</span><br>
                <span class="badge-status ${loja.status === 'aprovado' ? 'status-aprovado' : 'status-suspenso'}" style="font-size:0.75rem;">Status: ${loja.status || 'pendente'}</span>
            </div>
        </div>

        <hr style="border:none; border-top:1px solid #edf2f7; margin:12px 0;">

        <div style="font-size:0.85rem; color:#2f3542; line-height:1.6;">
            <h4 style="color:#ff6400; margin-bottom:6px;"><i class="fa-solid fa-user-tie"></i> Proprietário da Conta</h4>
            <strong>Nome:</strong> ${dadosProprietario.nome || 'Sem Nome'}<br>
            <strong>E-mail:</strong> ${dadosProprietario.email || 'Não informado'}<br>
            <strong>UID do Usuário:</strong> <code>${loja.donoUid || 'Não vinculado'}</code>
        </div>

        <hr style="border:none; border-top:1px solid #edf2f7; margin:12px 0;">

        <div style="font-size:0.85rem; color:#2f3542; line-height:1.6;">
            <h4 style="color:#ff6400; margin-bottom:6px;"><i class="fa-solid fa-location-dot"></i> Contato & Localização</h4>
            <strong>Telefone:</strong> ${loja.telefone || 'Não informado'}<br>
            <strong>E-mail de Contato:</strong> ${loja.email || 'Não informado'}<br>
            <strong>Endereço:</strong> ${loja.ruaLoja || loja.rua || 'Rua não informada'}, Nº ${loja.numeroLoja || '-'} - ${loja.bairroLoja || loja.bairro || 'Bairro'} (${loja.cidadeLoja || loja.cidade || 'Cidade'})<br>
            <strong>CEP:</strong> ${loja.cepLoja || 'Não informado'}
        </div>

        <hr style="border:none; border-top:1px solid #edf2f7; margin:12px 0;">

        <div style="font-size:0.85rem; color:#2f3542; line-height:1.6;">
            <h4 style="color:#ff6400; margin-bottom:6px;"><i class="fa-solid fa-credit-card"></i> Mercado Pago & Logística</h4>
            <strong>Mercado Pago Conectado:</strong> ${loja.mpConectado ? 'Sim ✓ (ID: ' + (loja.mpUserId || '-') + ')' : 'Não Conectado ✗'}<br>
            <strong>Frete Padrão:</strong> R$ ${(parseFloat(loja.frete) || 0).toFixed(2)} | <strong>Frete Grátis a partir de:</strong> R$ ${(parseFloat(loja.freteGratisMin) || 0).toFixed(2)}<br>
            <strong>Tempo Estimado de Entrega:</strong> ${loja.tempoEntrega || '30-50'} min | <strong>Retirada:</strong> ${loja.tempoRetirada || '15-20'} min<br>
            <strong>Status de Abertura:</strong> <code>${loja.statusMaster || 'automatico'}</code>
        </div>
    `;
}

document.getElementById('btn-fechar-modal-info-loja')?.addEventListener('click', () => {
    document.getElementById('modal-info-loja-admin')?.classList.remove('active');
});

/* ============================================================
   3. MÓDULO: CUPONS (ADMIN)
   ============================================================ */
async function carregarCupons() {
    const container = document.getElementById('lista-admin-cupons');
    if (!container) return;
    try {
        const snap = await getDocs(query(collection(db, "cupons"), orderBy("dataCriacao", "desc")));
        container.innerHTML = "";
        if(snap.empty) { container.innerHTML = `<p class="txt-vazio">Nenhum cupom ativo encontrado.</p>`; return; }

        const fragment = document.createDocumentFragment();

        snap.forEach(docSnap => {
            const cupom = docSnap.data();
            const sufixo = cupom.tipo === 'porcentagem' ? '%' : ' R$';
            
            const usoMinimo = cupom.usoMinimo || cupom.valorMinimo || 0;
            const usosAtuais = cupom.usosAtuais || 0;
            const limiteUsos = cupom.validade || cupom.limiteUsos || "∞";
            const escopo = cupom.escopo || "global";
            const nomeLojaOrigem = cupom.nomeLoja || "";

            let txtExpiracaoMeta = "Sem prazo";
            let isExpiradoPorTempo = false;
            
            if (cupom.dataExpiracao) {
                const dataExpObj = new Date(cupom.dataExpiracao);
                txtExpiracaoMeta = dataExpObj.toLocaleString('pt-br', { dateStyle: 'short', timeStyle: 'short' });
                if (dataExpObj < new Date()) {
                    isExpiradoPorTempo = true;
                }
            }

            const item = document.createElement('div');
            item.className = 'admin-list-item';
            
            item.innerHTML = `
                <div>
                    <div>
                        <strong>${cupom.codigo}</strong>
                        <span>${escopo === 'global' ? 'Global App' : `Loja: ${nomeLojaOrigem}`}</span>
                        ${isExpiradoPorTempo ? '<span>Expirado</span>' : ''}
                    </div>
                    <div>
                        <i class="fa-solid fa-tags"></i> <strong>Desconto:</strong> ${cupom.valor}${sufixo} <br>
                        <i class="fa-solid fa-basket-shopping"></i> <strong>Pedido Mínimo:</strong> R$ ${parseFloat(usoMinimo).toFixed(2)} <br>
                        <i class="fa-solid fa-chart-pie"></i> <strong>Uso Geral:</strong> ${usosAtuais} / ${limiteUsos} utilizações <br>
                        <i class="fa-solid fa-clock"></i> <strong>Prazo:</strong> ${txtExpiracaoMeta}
                    </div>
                </div>
                <button class="btn-delete-cupom" data-id="${docSnap.id}"><i class="fa-solid fa-trash"></i></button>
            `;
            fragment.appendChild(item);
        });

        container.appendChild(fragment);

        container.querySelectorAll('.btn-delete-cupom').forEach(btn => {
            btn.onclick = async (e) => {
                if(confirm("Excluir este cupom permanentemente?")) {
                    await deleteDoc(doc(db, "cupons", e.currentTarget.getAttribute('data-id')));
                    mostrarNotificacao("Cupom removido!"); 
                    carregarCupons();
                }
            };
        });
    } catch (err) { console.error(err); container.innerHTML = "<p>Erro ao carregar cupons ativos.</p>"; }
}

const btnSalvarCupom = document.getElementById('btn-salvar-cupom');
if (btnSalvarCupom) {
    btnSalvarCupom.onclick = async () => {
        const codigo = document.getElementById('cupom-codigo').value.trim().toUpperCase();
        const tipo = document.getElementById('cupom-tipo').value;
        const valor = document.getElementById('cupom-valor').value.trim();
        const usoMinimo = document.getElementById('cupom-minimo').value.trim();
        const limiteUsos = document.getElementById('cupom-validade').value.trim();
        const horas = document.getElementById('cupom-horas').value.trim();

        if(!codigo || !valor) { mostrarNotificacao("Preencha Código e Valor.", "error"); return; }

        const dataCriacao = new Date();
        const dataExpiracao = new Date(dataCriacao.getTime() + (Number(horas) * 60 * 60 * 1000));

        try {
            await addDoc(collection(db, "cupons"), {
                ativo: true, 
                codigo: codigo, 
                dataCriacao: dataCriacao.toISOString(), 
                dataExpiracao: dataExpiracao.toISOString(), 
                escopo: "global", 
                tipo: tipo, 
                usoMinimo: Number(usoMinimo || 0), 
                usosAtuais: 0, 
                limiteUsos: Number(limiteUsos || 0),
                valor: Number(valor)
            });
            mostrarNotificacao(`Cupom criado! Expira em ${horas}h.`);
            carregarCupons();
        } catch (error) { mostrarNotificacao("Erro ao salvar.", "error"); }
    };
}

/* ============================================================
   4. MÓDULO: LOGÍSTICA GEOGRÁFICA (SUPORTE E ADMIN TOTAL)
   ============================================================ */
async function carregarLogisticaGeral() {
    const listaCidades = document.getElementById('lista-admin-cidades');
    const listaBairros = document.getElementById('lista-admin-bairros');
    const selectCidades = document.getElementById('bairro-cidade-select');

    if (!listaCidades || !listaBairros || !selectCidades) return;

    try {
        const snapRegioes = await getDocs(collection(db, "regioes"));
        listaCidades.innerHTML = ""; listaBairros.innerHTML = "";
        selectCidades.innerHTML = `<option value="">Selecione a Cidade</option>`;

        if(snapRegioes.empty) {
            listaCidades.innerHTML = `<p class="txt-vazio">Nenhuma cidade cadastrada.</p>`;
            listaBairros.innerHTML = `<p class="txt-vazio">Nenhum bairro cadastrado.</p>`;
            return;
        }

        const fragCidades = document.createDocumentFragment();
        const fragBairros = document.createDocumentFragment();

        snapRegioes.forEach(docSnap => {
            const docIdComposto = docSnap.id; 
            const dadosCidade = docSnap.data();
            
            const cityNome = dadosCidade.nome || docIdComposto.split('-')[0];
            const cityUf = dadosCidade.uf || docIdComposto.split('-')[1] || '';
            const listaDeBairrosDessaCidade = dadosCidade.bairros || [];

            const itemCidade = document.createElement('div');
            itemCidade.className = 'admin-list-item';
            itemCidade.innerHTML = `<span><strong>${cityNome} - ${cityUf}</strong></span><button class="btn-delete-cidade" data-id="${docIdComposto}"><i class="fa-solid fa-trash"></i></button>`;
            fragCidades.appendChild(itemCidade);

            const opt = document.createElement('option');
            opt.value = docIdComposto; opt.textContent = `${cityNome} - ${cityUf}`;
            selectCidades.appendChild(opt);

            listaDeBairrosDessaCidade.forEach(bairroNome => {
                const itemBairro = document.createElement('div');
                itemBairro.className = 'admin-list-item';
                itemBairro.innerHTML = `<span>${bairroNome} <small class="txt-city-ref">(${cityNome}-${cityUf})</small></span><button class="btn-delete-bairro" data-cidade="${docIdComposto}" data-bairro="${bairroNome}"><i class="fa-solid fa-trash"></i></button>`;
                fragBairros.appendChild(itemBairro);
            });
        });

        listaCidades.appendChild(fragCidades);
        listaBairros.appendChild(fragBairros);

        listaCidades.querySelectorAll('.btn-delete-cidade').forEach(btn => {
            btn.onclick = async (e) => {
                const idComposto = e.currentTarget.getAttribute('data-id');
                if(confirm(`Excluir a região de ${idComposto} e todos os bairros vinculados?`)) {
                    await deleteDoc(doc(db, "regioes", idComposto));
                    mostrarNotificacao("Região deletada!"); 
                    carregarLogisticaGeral();
                }
            };
        });

        listaBairros.querySelectorAll('.btn-delete-bairro').forEach(btn => {
            btn.onclick = async (e) => {
                const cid = e.currentTarget.getAttribute('data-cidade');
                const bai = e.currentTarget.getAttribute('data-bairro');
                if(confirm(`Remover o bairro "${bai}" de ${cid}?`)) {
                    await updateDoc(doc(db, "regioes", cid), { bairros: arrayRemove(bai) });
                    mostrarNotificacao("Bairro removido!"); 
                    carregarLogisticaGeral();
                }
            };
        });
    } catch (err) { console.error(err); }
}

const btnSalvarCidade = document.getElementById('btn-salvar-cidade');
if (btnSalvarCidade) {
    btnSalvarCidade.onclick = async () => {
        const inputNome = document.getElementById('cidade-nome');
        const inputUf = document.getElementById('cidade-uf');
        const nomeRaw = inputNome.value.trim();
        const ufRaw = inputUf.value.trim().toUpperCase();

        if(!nomeRaw || !ufRaw) { mostrarNotificacao("Preencha o Nome e a UF da cidade.", "error"); return; }
        if(ufRaw.length !== 2) { mostrarNotificacao("A UF deve conter exatamente 2 letras.", "error"); return; }

        const nomeCidade = nomeRaw.charAt(0).toUpperCase() + nomeRaw.slice(1);
        const docIdComposto = `${nomeCidade}-${ufRaw}`;

        try {
            const docRef = doc(db, "regioes", docIdComposto);
            const snapCheck = await getDoc(docRef);
            if(snapCheck.exists()) { mostrarNotificacao("Esta Cidade-UF já está mapeada!", "error"); return; }

            await setDoc(docRef, { nome: nomeCidade, uf: ufRaw, bairros: [] });
            mostrarNotificacao("Região cadastrada com sucesso!");
            inputNome.value = ""; inputUf.value = ""; carregarLogisticaGeral();
        } catch (err) { mostrarNotificacao("Erro ao salvar cidade.", "error"); }
    };
}

const btnSalvarBairro = document.getElementById('btn-salvar-bairro');
if (btnSalvarBairro) {
    btnSalvarBairro.onclick = async () => {
        const selectCid = document.getElementById('bairro-cidade-select');
        const inputBairro = document.getElementById('bairro-nome');
        const cidadeIdComposto = selectCid.value;
        const bairroNomeRaw = inputBairro.value.trim();

        if(!cidadeIdComposto || !bairroNomeRaw) { mostrarNotificacao("Selecione a cidade e digite o bairro.", "error"); return; }

        const bairroNome = bairroNomeRaw.charAt(0).toUpperCase() + bairroNomeRaw.slice(1);
        try {
            await updateDoc(doc(db, "regioes", cidadeIdComposto), { bairros: arrayUnion(bairroNome) });
            mostrarNotificacao(`Bairro vinculado!`); inputBairro.value = ""; carregarLogisticaGeral();
        } catch (err) { mostrarNotificacao("Erro ao vincular bairro.", "error"); }
    };
}

/* ============================================================
   5. MÓDULO: GERENCIAMENTO DE USUÁRIOS (CARGOS: ADMIN SÓ ALTERA)
   ============================================================ */
async function carregarUsuarios() {
    try {
        const snap = await getDocs(collection(db, "usuarios"));
        cacheListaUsuarios = [];

        snap.forEach(docSnap => {
            const uid = docSnap.id;
            if (uid.startsWith('cpf_')) return;
            const usuario = docSnap.data();
            usuario.id = uid;
            cacheListaUsuarios.push(usuario);
        });

        const termoAnterior = document.getElementById('search-usuarios')?.value.trim().toLowerCase() || "";
        renderizarTabelaUsuarios(termoAnterior);

    } catch (err) {
        console.error("Erro ao carregar lista de usuários:", err);
        const tbody = document.getElementById('tabela-admin-usuarios');
        if (tbody) tbody.innerHTML = "<tr><td colspan='6' class='txt-center'>Erro crítico ao processar tabela de usuários.</td></tr>";
    }
}

function renderizarTabelaUsuarios(termoFiltro = "") {
    const tbody = document.getElementById('tabela-admin-usuarios');
    if (!tbody) return;
    tbody.innerHTML = "";

    const usuariosFiltrados = cacheListaUsuarios.filter(u => {
        if (!termoFiltro) return true;
        const nome = (u.nome || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        const id = (u.id || "").toLowerCase();
        return nome.includes(termoFiltro) || email.includes(termoFiltro) || id.includes(termoFiltro);
    });

    if (usuariosFiltrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="txt-center">Nenhum usuário encontrado para o termo pesquisado.</td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    usuariosFiltrados.forEach(usuario => {
        const tr = document.createElement('tr');
        const uid = usuario.id;
        const ehOProprioUsuarioLogado = auth.currentUser && auth.currentUser.uid === uid;

        let cargoAtual = 'cliente';
        if (usuario.isAdmin === true || usuario.cargo === 'admin' || usuario.role === 'admin') {
            cargoAtual = 'admin';
        } else if (usuario.cargo === 'suporte' || usuario.role === 'suporte') {
            cargoAtual = 'suporte';
        }

        let classeCargo = 'status-pendente';
        if (cargoAtual === 'admin') classeCargo = 'status-aprovado';
        if (cargoAtual === 'suporte') classeCargo = 'status-pendente" style="background:#e1f5fe; color:#0288d1;';

        const statusUsuario = usuario.status || 'ativo'; 
        let classeStatus = 'status-aprovado';
        if (statusUsuario === 'suspenso') classeStatus = 'status-suspenso';

        // O suporte NÃO tem permissão de alterar cargos (select desabilitado)
        const selectDesabilitado = (!ehAdminMaster || ehOProprioUsuarioLogado) ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : '';

        let seletorCargoHtml = `
            <select class="select-admin select-cargo-usuario" data-id="${uid}" ${selectDesabilitado} style="padding: 4px 8px; font-size: 0.8rem;">
                <option value="cliente" ${cargoAtual === 'cliente' ? 'selected' : ''}>Cliente</option>
                <option value="suporte" ${cargoAtual === 'suporte' ? 'selected' : ''}>Suporte</option>
                <option value="admin" ${cargoAtual === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
        `;

        // Tanto Suporte quanto Admin podem suspender/reativar
        let btnAcessoHtml = '';
        if (statusUsuario === 'suspenso') {
            btnAcessoHtml = `<button class="btn-status-toggle btn-allow btn-acesso-toggle" data-id="${uid}" data-status="ativo"><i class="fa-solid fa-user-check"></i> Reativar</button>`;
        } else {
            btnAcessoHtml = `<button class="btn-status-toggle btn-block btn-acesso-toggle" data-id="${uid}" data-status="suspenso" ${ehOProprioUsuarioLogado ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}><i class="fa-solid fa-user-slash"></i> Suspender</button>`;
        }

        tr.innerHTML = `
            <td>
                <strong>${usuario.nome || 'Sem Nome'}</strong><br>
                <small style="color:#747d8c; font-size:0.75rem;">ID: ${uid}</small>
            </td>
            <td>${usuario.email || 'Sem E-mail'}</td>
            <td><span class="badge-status ${classeCargo}">${cargoAtual.toUpperCase()}</span></td>
            <td><span class="badge-status ${classeStatus}">${statusUsuario}</span></td>
            <td>${seletorCargoHtml}</td>
            <td>${btnAcessoHtml}</td>
        `;
        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);

    // Mudança de Cargo (Exclusiva do Admin)
    tbody.querySelectorAll('.select-cargo-usuario').forEach(select => {
        select.onchange = async (e) => {
            if (!ehAdminMaster) {
                mostrarNotificacao("Apenas Administradores podem alterar níveis de cargo.", "error");
                await carregarUsuarios();
                return;
            }

            const uid = e.currentTarget.getAttribute('data-id');
            const novoCargo = e.currentTarget.value;
            const ehAdmin = novoCargo === 'admin';

            if (confirm(`Confirmar alteração de cargo deste usuário para "${novoCargo.toUpperCase()}"?`)) {
                try {
                    await updateDoc(doc(db, "usuarios", uid), { 
                        cargo: novoCargo,
                        role: novoCargo,
                        isAdmin: ehAdmin 
                    });
                    mostrarNotificacao(`Cargo atualizado para ${novoCargo}!`);
                    await carregarUsuarios();
                } catch (err) {
                    console.error(err);
                    mostrarNotificacao("Erro ao atualizar cargo.", "error");
                }
            } else {
                await carregarUsuarios();
            }
        };
    });

    // Ações de Suspensão / Reativação (Suporte e Admin)
    tbody.querySelectorAll('.btn-acesso-toggle').forEach(btn => {
        btn.onclick = async (e) => {
            if (e.currentTarget.hasAttribute('disabled')) return;
            const id = e.currentTarget.getAttribute('data-id');
            const novoStatus = e.currentTarget.getAttribute('data-status');
            
            const mensagemConfirmacao = novoStatus === 'suspenso' 
                ? "Tem certeza de que deseja suspender o acesso deste usuário ao aplicativo?" 
                : "Deseja reativar o acesso deste usuário?";

            if (confirm(mensagemConfirmacao)) {
                try {
                    await updateDoc(doc(db, "usuarios", id), { status: novoStatus });
                    mostrarNotificacao(`Status de acesso modificado para ${novoStatus}!`);
                    await carregarUsuarios();
                } catch (err) {
                    mostrarNotificacao("Permissão negada ao alterar status.", "error");
                }
            }
        };
    });
}

/* ============================================================
   6. MÓDULO: TAXA DA PLATAFORMA (ADMIN)
   ============================================================ */
async function carregarTaxaPlataforma() {
    const infoContainer = document.getElementById('info-taxa-container');
    const inputTaxa = document.getElementById('taxa-porcentagem');

    try {
        const docRef = doc(db, "configuracoes", "plataforma");
        const snap = await getDoc(docRef);

        let taxaAtual = 2.0;

        if (snap.exists() && snap.data().taxaPorcentagem !== undefined) {
            taxaAtual = parseFloat(snap.data().taxaPorcentagem);
        } else {
            await setDoc(docRef, { taxaPorcentagem: 2.0, atualizadoEm: new Date().toISOString() }, { merge: true });
        }

        if (inputTaxa) inputTaxa.value = taxaAtual;

        if (infoContainer) {
            const exemploVenda = 100.00;
            const tarifaMP = 1.00;
            const comissaoNordGoOnline = Math.max(0, (exemploVenda * (taxaAtual / 100)) - tarifaMP);
            const repasseLojaOnline = exemploVenda - (tarifaMP + comissaoNordGoOnline);

            const comissaoNordGoOffline = (exemploVenda * (taxaAtual / 100));
            const repasseLojaOffline = exemploVenda - comissaoNordGoOffline;

            infoContainer.innerHTML = `
                <div>
                    <span>Taxa Vigente da Plataforma:</span><br>
                    <strong>${taxaAtual.toFixed(1)}%</strong>
                </div>
                <div>
                    <strong>Simulação de um pedido de R$ 100,00:</strong><br>
                    <div>
                        <strong>• Pagamento On-line (Pix/Cartão MP):</strong><br>
                        - Tarifa MP estimada (1.0%): <span>R$ ${tarifaMP.toFixed(2)}</span><br>
                        - Retenção NordGo Split (${(taxaAtual - 1.0).toFixed(1)}%): <span>R$ ${comissaoNordGoOnline.toFixed(2)}</span><br>
                        - Repasse Líquido Lojista: <span>R$ ${repasseLojaOnline.toFixed(2)}</span>
                    </div>
                    <div>
                        <strong>• Pagamento Offline (Dinheiro/Maquininha Própria):</strong><br>
                        - Comissão NordGo (${taxaAtual.toFixed(1)}%): <span>R$ ${comissaoNordGoOffline.toFixed(2)}</span><br>
                        - Saldo Líquido Lojista: <span>R$ ${repasseLojaOffline.toFixed(2)}</span>
                    </div>
                </div>
            `;
        }
    } catch (err) {
        console.error("Erro ao carregar taxa:", err);
        if (infoContainer) infoContainer.innerHTML = "<p>Erro ao carregar dados da taxa.</p>";
    }
}

const btnSalvarTaxa = document.getElementById('btn-salvar-taxa');
if (btnSalvarTaxa) {
    btnSalvarTaxa.onclick = async () => {
        const inputTaxa = document.getElementById('taxa-porcentagem');
        if (!inputTaxa) return;

        const novoValor = parseFloat(inputTaxa.value);
        if (isNaN(novoValor) || novoValor < 0 || novoValor > 100) {
            mostrarNotificacao("Informe um valor percentual válido entre 0 e 100.", "error");
            return;
        }

        try {
            await setDoc(doc(db, "configuracoes", "plataforma"), {
                taxaPorcentagem: novoValor,
                atualizadoEm: new Date().toISOString()
            }, { merge: true });

            mostrarNotificacao(`Taxa da plataforma atualizada para ${novoValor}%!`);
            await carregarTaxaPlataforma();
        } catch (err) {
            console.error("Erro ao salvar taxa:", err);
            mostrarNotificacao("Erro ao atualizar taxa da plataforma.", "error");
        }
    };
}

/* ============================================================
   7. MÓDULO: REPASSES & BALANÇO DE LOJAS (ADMIN)
   ============================================================ */
async function carregarBalancoRepassesAdmin() {
    const tbody = document.getElementById('tabela-admin-balanco-repasses');
    if (!tbody) return;

    try {
        const snapLojas = await getDocs(collection(db, "lojas"));
        const mapaLojas = {};
        snapLojas.forEach(docSnap => {
            mapaLojas[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });

        const snapPedidos = await getDocs(query(collection(db, "pedidos"), where("status", "==", "concluido")));
        const balancoPorLoja = {};

        Object.keys(mapaLojas).forEach(lid => {
            balancoPorLoja[lid] = {
                lojaData: mapaLojas[lid],
                comissaoDevida: 0,
                cuponsNordGo: 0
            };
        });

        snapPedidos.forEach(docSnap => {
            const p = docSnap.data();
            const lid = p.lojaId;

            if (balancoPorLoja[lid]) {
                const formaPagamentoTexto = (p.formaPagamento || 'Pix').toLowerCase();
                const ehPagamentoOnline = formaPagamentoTexto.includes('pix') || 
                                          formaPagamentoTexto.includes('cartão de crédito (app)') || 
                                          formaPagamentoTexto.includes('online');

                if (!ehPagamentoOnline && (p.statusRepasse || 'pendente') === 'pendente') {
                    balancoPorLoja[lid].comissaoDevida += parseFloat(p.comissaoNordGoValor || 0);
                }

                if (p.descontoPlataforma && parseFloat(p.descontoPlataforma) > 0 && (p.statusRepasse || 'pendente') === 'pendente') {
                    balancoPorLoja[lid].cuponsNordGo += parseFloat(p.descontoPlataforma);
                }
            }
        });

        tbody.innerHTML = "";
        let totalComissoesGeral = 0;
        let totalCuponsGeral = 0;
        const fragment = document.createDocumentFragment();

        Object.keys(balancoPorLoja).forEach(lid => {
            const item = balancoPorLoja[lid];
            const lData = item.lojaData;
            
            totalComissoesGeral += item.comissaoDevida;
            totalCuponsGeral += item.cuponsNordGo;

            const saldoFinal = item.cuponsNordGo - item.comissaoDevida;

            let statusMpText = `<span class="badge-status status-suspenso">Não Conectado</span>`;
            if (lData.mpConectado && lData.mpAccessToken) {
                statusMpText = `<span class="badge-status status-aprovado">Conectado ✓</span>`;
            }

            let textoSaldoClasse = "color: #57606f;";
            let statusSaldoBadge = "Zerado";

            if (saldoFinal > 0) {
                textoSaldoClasse = "color: #2ed573; font-weight: 600;";
                statusSaldoBadge = `NordGo deve R$ ${saldoFinal.toFixed(2)}`;
            } else if (saldoFinal < 0) {
                textoSaldoClasse = "color: #ff4757; font-weight: 600;";
                statusSaldoBadge = `Loja deve R$ ${Math.abs(saldoFinal).toFixed(2)}`;
            }

            let btnPagarPix = "";
            if (saldoFinal > 0.50) {
                if (lData.mpConectado && lData.mpAccessToken) {
                    btnPagarPix = `<button class="btn-pagar-pix-lojista" data-lojaid="${lid}" data-valor="${saldoFinal.toFixed(2)}"><i class="fa-solid fa-qrcode"></i> Pagar via Pix</button>`;
                } else {
                    btnPagarPix = `<small style="color:#a4b0be;">Aguardando MP do Lojista</small>`;
                }
            } else {
                btnPagarPix = `<small style="color:#747d8c;">Acertado</small>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <strong>${lData.nome || 'Loja'}</strong><br>
                    <small style="color:#747d8c;">ID: ${lid}</small>
                </td>
                <td>${statusMpText}</td>
                <td style="color: #ff4757; font-weight: 600;">R$ ${item.comissaoDevida.toFixed(2)}</td>
                <td style="color: #2ed573; font-weight: 600;">R$ ${item.cuponsNordGo.toFixed(2)}</td>
                <td style="${textoSaldoClasse}">${statusSaldoBadge}</td>
                <td>${btnPagarPix}</td>
            `;
            fragment.appendChild(tr);
        });

        tbody.appendChild(fragment);

        document.getElementById('txt-admin-total-comissoes-receber').innerText = `R$ ${totalComissoesGeral.toFixed(2)}`;
        document.getElementById('txt-admin-total-cupons-pagar').innerText = `R$ ${totalCuponsGeral.toFixed(2)}`;
        
        const balancoGeral = totalCuponsGeral - totalComissoesGeral;
        const txtBalancoGeral = document.getElementById('txt-admin-balanco-liquido-geral');
        if (txtBalancoGeral) {
            txtBalancoGeral.innerText = `R$ ${Math.abs(balancoGeral).toFixed(2)}`;
            txtBalancoGeral.style.color = balancoGeral >= 0 ? '#2ed573' : '#ff4757';
        }

        tbody.querySelectorAll('.btn-pagar-pix-lojista').forEach(btn => {
            btn.onclick = async (e) => {
                const lojaId = e.currentTarget.getAttribute('data-lojaid');
                const valor = parseFloat(e.currentTarget.getAttribute('data-valor'));
                await abrirModalPixRepasseAdmin(lojaId, valor);
            };
        });

    } catch (err) {
        console.error("Erro ao carregar balanço de repasses:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="txt-center">Erro ao carregar balanço financeiro.</td></tr>`;
    }
}

async function abrirModalPixRepasseAdmin(lojaId, valor) {
    try {
        mostrarNotificacao("Gerando Pix de transferência para a conta do lojista...", "info");
        const functions = getFunctions();
        const gerarPixTransferenciaLojista = httpsCallable(functions, "gerarPixTransferenciaLojista");

        const res = await gerarPixTransferenciaLojista({ lojaId, valor });

        if (res.data && res.data.sucesso) {
            document.getElementById('img-qr-code-repasse-admin').src = `data:image/png;base64,${res.data.qrCodeBase64}`;
            document.getElementById('input-pix-copia-cola-admin').value = res.data.qrCodeCopiaECola;

            document.getElementById('btn-copiar-pix-admin').onclick = () => {
                navigator.clipboard.writeText(res.data.qrCodeCopiaECola);
                mostrarNotificacao("Código Pix Copia e Cola copiado!");
            };

            document.getElementById('modal-pix-repasse-admin')?.classList.add('active');

            if (unsubscribeMonitorPixAdmin) unsubscribeMonitorPixAdmin();

            const qPending = query(
                collection(db, "pedidos"),
                where("lojaId", "==", lojaId),
                where("statusRepasse", "==", "pendente")
            );

            unsubscribeMonitorPixAdmin = onSnapshot(qPending, (snapshot) => {
                if (snapshot.empty) {
                    mostrarNotificacao("🎉 Repasse transferido com sucesso ao lojista!", "success");
                    document.getElementById('modal-pix-repasse-admin')?.classList.remove('active');
                    
                    if (unsubscribeMonitorPixAdmin) {
                        unsubscribeMonitorPixAdmin();
                        unsubscribeMonitorPixAdmin = null;
                    }
                    carregarBalancoRepassesAdmin();
                }
            });

        } else {
            mostrarNotificacao("Erro ao gerar QR Code Pix. Tente novamente.", "error");
        }
    } catch (err) {
        console.error("Erro ao gerar Pix do Admin:", err);
        mostrarNotificacao(`Erro: ${err.message || 'Falha ao comunicar com o Mercado Pago'}`, "error");
    }
}

document.getElementById('btn-fechar-modal-pix-admin')?.addEventListener('click', () => {
    document.getElementById('modal-pix-repasse-admin')?.classList.remove('active');
    if (unsubscribeMonitorPixAdmin) {
        unsubscribeMonitorPixAdmin();
        unsubscribeMonitorPixAdmin = null;
    }
});

/* ============================================================
   8. MÓDULO: MOTIVOS DE CANCELAMENTO / REEMBOLSO (ADMIN)
   ============================================================ */
async function carregarMotivosCancelamento() {
    const container = document.getElementById('lista-admin-motivos');
    if (!container) return;

    try {
        const docRef = doc(db, "configuracoes", "motivos_cancelamento");
        const snap = await getDoc(docRef);
        container.innerHTML = "";

        if (!snap.exists() || !Array.isArray(snap.data().lista) || snap.data().lista.length === 0) {
            container.innerHTML = `<p class="txt-vazio">Nenhum motivo cadastrado.</p>`;
            return;
        }

        const listaMotivos = snap.data().lista;
        const fragment = document.createDocumentFragment();

        listaMotivos.forEach(motivo => {
            const item = document.createElement('div');
            item.className = 'admin-list-item';
            item.innerHTML = `
                <span><i class="fa-solid fa-triangle-exclamation" style="color: #e74c3c; margin-right: 8px;"></i> ${motivo}</span>
                <button class="btn-delete-motivo" data-motivo="${motivo}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            `;
            fragment.appendChild(item);
        });

        container.appendChild(fragment);

        container.querySelectorAll('.btn-delete-motivo').forEach(btn => {
            btn.onclick = async (e) => {
                const motivoParaRemover = e.currentTarget.getAttribute('data-motivo');
                if (confirm(`Remover "${motivoParaRemover}" da lista de motivos?`)) {
                    await updateDoc(docRef, { lista: arrayRemove(motivoParaRemover) });
                    mostrarNotificacao("Motivo removido com sucesso!");
                    carregarMotivosCancelamento();
                }
            };
        });

    } catch (err) {
        console.error("Erro ao carregar motivos:", err);
        container.innerHTML = "<p>Erro ao carregar motivos.</p>";
    }
}

const btnSalvarMotivo = document.getElementById('btn-salvar-motivo');
if (btnSalvarMotivo) {
    btnSalvarMotivo.onclick = async () => {
        const input = document.getElementById('motivo-texto');
        const motivoTexto = input ? input.value.trim() : "";

        if (!motivoTexto) {
            mostrarNotificacao("Digite o texto do motivo.", "error");
            return;
        }

        try {
            const docRef = doc(db, "configuracoes", "motivos_cancelamento");
            await setDoc(docRef, {
                lista: arrayUnion(motivoTexto)
            }, { merge: true });

            mostrarNotificacao("Motivo cadastrado com sucesso!");
            if (input) input.value = "";
            carregarMotivosCancelamento();

        } catch (err) {
            console.error("Erro ao salvar motivo:", err);
            mostrarNotificacao("Erro ao salvar motivo.", "error");
        }
    };
}

/* ============================================================
   9. MÓDULO: GERENCIAMENTO DE REEMBOLSOS (ADMIN)
   ============================================================ */
async function carregarSolicitacoesReembolso() {
    const tbody = document.getElementById('tabela-admin-reembolsos');
    if (!tbody) return;

    try {
        const q = query(collection(db, "pedidos"), where("status", "==", "reembolso_solicitado"));
        const snap = await getDocs(q);
        tbody.innerHTML = "";

        if (snap.empty) {
            tbody.innerHTML = `<tr><td colspan="6" class="txt-center">Nenhuma solicitação de reembolso pendente no momento.</td></tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();

        snap.forEach(docSnap => {
            const p = docSnap.data();
            const id = docSnap.id;
            const sol = p.solicitacaoReembolso || {};

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <strong>#...${id.slice(-6).toUpperCase()}</strong><br>
                    <small style="color:#747d8c;">Loja: ${p.nomeLoja || 'N/A'}</small>
                </td>
                <td>
                    <strong>${p.clientNome || 'Cliente'}</strong><br>
                    <small style="color:#747d8c;">ID: ${p.clientId || 'N/A'}</small>
                </td>
                <td>
                    <strong style="color: #e74c3c;">${sol.motivo || 'Motivo não informado'}</strong><br>
                    <small style="color: #57606f;">${sol.detalhes || 'Sem detalhes'}</small>
                </td>
                <td><strong>R$ ${parseFloat(p.total || 0).toFixed(2)}</strong></td>
                <td><span class="badge-status status-pendente">Em Análise</span></td>
                <td>
                    <div style="display: flex; gap: 6px;">
                        <button class="btn-status-toggle btn-allow btn-aprovar-reembolso" data-id="${id}">
                            <i class="fa-solid fa-check"></i> Aprovar
                        </button>
                        <button class="btn-status-toggle btn-block btn-recusar-reembolso" data-id="${id}">
                            <i class="fa-solid fa-xmark"></i> Recusar
                        </button>
                    </div>
                </td>
            `;
            fragment.appendChild(tr);
        });

        tbody.appendChild(fragment);

        const functions = getFunctions();
        const aprovarReembolsoCallable = httpsCallable(functions, "aprovarReembolsoPedido");
        const recusarReembolsoCallable = httpsCallable(functions, "recusarReembolsoPedido");

        tbody.querySelectorAll('.btn-aprovar-reembolso').forEach(btn => {
            btn.onclick = async (e) => {
                const pedidoId = e.currentTarget.getAttribute('data-id');
                
                if (confirm("Confirmar a APROVAÇÃO do reembolso para este pedido?")) {
                    try {
                        mostrarNotificacao("Analisando modalidade do pagamento...", "info");
                        const pedidoSnap = await getDoc(doc(db, "pedidos", pedidoId));
                        if (!pedidoSnap.exists()) {
                            mostrarNotificacao("Pedido não localizado no sistema.", "error");
                            return;
                        }

                        const dadosPedido = pedidoSnap.data();
                        const formaPagamentoTxt = (dadosPedido.formaPagamento || '').toLowerCase();
                        
                        const ehPagamentoOnlinePlataforma = formaPagamentoTxt.includes('pix') || 
                                                            formaPagamentoTxt.includes('cartão de crédito (app)') || 
                                                            formaPagamentoTxt.includes('online');

                        if (ehPagamentoOnlinePlataforma && dadosPedido.idPagamentoMP) {
                            mostrarNotificacao("Processando devolução bancária via API Mercado Pago...", "info");
                            const res = await aprovarReembolsoCallable({ pedidoId });
                            if (res.data.sucesso) {
                                mostrarNotificacao("Reembolso aprovado e valor estornado no banco!");
                                carregarSolicitacoesReembolso();
                            }
                        } else {
                            await updateDoc(doc(db, "pedidos", pedidoId), {
                                status: "cancelado",
                                statusPagamento: "estornado_presencial",
                                solicitacaoReembolsoAtendida: true,
                                dataFinalizacaoReembolso: new Date().toISOString()
                            });
                            mostrarNotificacao("Reembolso aprovado! Como o pagamento foi presencial, a devolução deve ser tratada diretamente com o lojista.");
                            carregarSolicitacoesReembolso();
                        }

                    } catch (err) {
                        console.error("Erro ao aprovar reembolso:", err);
                        mostrarNotificacao(`Erro: ${err.message || 'Falha ao processar estorno'}`, "error");
                    }
                }
            };
        });

        tbody.querySelectorAll('.btn-recusar-reembolso').forEach(btn => {
            btn.onclick = async (e) => {
                const pedidoId = e.currentTarget.getAttribute('data-id');
                const justificativa = prompt("Informe o motivo da recusa do reembolso para o cliente:");
                
                if (justificativa) {
                    try {
                        mostrarNotificacao("Atualizando pedido...", "info");
                        const res = await recusarReembolsoCallable({ pedidoId, justificativaAnalise: justificativa });
                        if (res.data.sucesso) {
                            mostrarNotificacao("Solicitação de reembolso recusada.");
                            carregarSolicitacoesReembolso();
                        }
                    } catch (err) {
                        console.error("Erro ao recusar reembolso:", err);
                        mostrarNotificacao(`Erro: ${err.message}`, "error");
                    }
                }
            };
        });

    } catch (err) {
        console.error("Erro ao carregar solicitações de reembolso:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="txt-center">Erro ao carregar solicitações.</td></tr>`;
    }
}

/* ============================================================
   ROLAGEM HORIZONTAL DAS ABAS
   ============================================================ */
function habilitarScrollHorizontalAbasAdmin() {
    const containerAbas = document.querySelector('.admin-tabs');
    if (!containerAbas) return;

    containerAbas.addEventListener('wheel', (event) => {
        if (event.deltaY !== 0) {
            event.preventDefault();
            containerAbas.scrollBy({
                left: event.deltaY * 1.8,
                behavior: 'smooth'
            });
        }
    }, { passive: false });
}

habilitarScrollHorizontalAbasAdmin();