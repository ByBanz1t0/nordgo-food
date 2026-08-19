import { db, auth, app, mostrarNotificacao } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    getDoc,
    doc,
    limit, 
    enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-functions.js";

// PERSISTÊNCIA LOCAL
try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn("Cache ativo em outra aba.");
        } else if (err.code === 'unimplemented') {
            console.warn("Sem suporte a persistência offline.");
        }
    });
} catch (e) {
    console.warn("Persistência local:", e);
}

const functions = getFunctions(app);
const calcularTotalServer = httpsCallable(functions, "calcularTotalCarrinho");

const listaLojasHtml = document.getElementById('lista-lojas-carrinho');
const btnConfirmarDados = document.getElementById('btn-confirmar-dados');

// BOTÃO VOLTAR
const btnVoltar = document.getElementById('btn-voltar-carrinho');
if (btnVoltar) {
    btnVoltar.onclick = () => {
        window.location.href = '../index.html';
    };
}

let usuarioLogado = null;
let cupomAtivo = null;
let cuponsLocaisAtivos = {}; 
let fotosCategorias = {}; 
let dadosPrecosServidor = null; 
let mapaSubtotaisLojas = {}; 
let categoriasCarregadas = false;

const cacheProdutosBanco = {};

// REDIRECIONAR CHECKOUT
if (btnConfirmarDados) {
    btnConfirmarDados.onclick = () => {
        if (!usuarioLogado) { 
            mostrarNotificacao("Você precisa fazer login para continuar.", "error"); 
            return; 
        }
        
        const itens = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
        if (itens.length === 0) {
            mostrarNotificacao("Seu carrinho está vazio.", "error");
            return;
        }

        const lojasNoCarrinho = [...new Set(itens.map(item => item.lojaId))];
        if (lojasNoCarrinho.length > 1) {
            mostrarNotificacao("Para prosseguir, o carrinho deve conter itens de apenas um estabelecimento.", "error");
            return; 
        }

        localStorage.setItem('nordgo_cupom_global', JSON.stringify(cupomAtivo));
        localStorage.setItem('nordgo_cupons_locais', JSON.stringify(cuponsLocaisAtivos));

        window.location.href = "checkout.html";
    };
}

// INICIALIZAÇÃO PARALELA (SEM BLOQUEIOS EM CASCATA)
onAuthStateChanged(auth, async (user) => {
    usuarioLogado = user;
    if (!categoriasCarregadas) {
        await Promise.all([
            carregarCategoriasBanco(),
            carregarCarrinho()
        ]);
    } else {
        await carregarCarrinho();
    }
});

async function carregarCategoriasBanco() {
    try {
        const catSnap = await getDocs(collection(db, "categorias"));
        fotosCategorias = {};
        catSnap.forEach(docCat => {
            const c = docCat.data();
            const nomeCat = (c.nome || "").trim();
            const arquivoFoto = c.imagem || c.fotoArquivo || c.foto || "";
            if (nomeCat && arquivoFoto) {
                fotosCategorias[nomeCat] = arquivoFoto;
                fotosCategorias[nomeCat.toLowerCase()] = arquivoFoto;
            }
        });
        categoriasCarregadas = true;
    } catch (error) {
        console.warn("Aviso ao carregar categorias:", error);
    }
}

function formatarUrlImagem(caminhoOriginal) {
    if (!caminhoOriginal || typeof caminhoOriginal !== 'string') {
        return '../assets/images/placeholder.png';
    }

    const path = caminhoOriginal.trim();

    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
    }

    const nomeArquivo = path.split('/').pop();
    return `../assets/images/${nomeArquivo}`;
}

// VALIDAÇÃO DE CUPONS
async function validarCupom(codigo, lojaId = null, subtotalAtual = 0) {
    if (!usuarioLogado) { mostrarNotificacao("Faça login para usar cupons.", "error"); return null; }
    if (!codigo) { mostrarNotificacao("Digite o código do cupom.", "error"); return null; }

    try {
        const q = query(collection(db, "cupons"), where("codigo", "==", codigo.toUpperCase()), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) { mostrarNotificacao("Cupom inválido ou inexistente.", "error"); return null; }

        const cupomDoc = snapshot.docs[0];
        const data = cupomDoc.data();
        const agora = new Date();

        if (lojaId === null) {
            if (data.escopo !== "global") { mostrarNotificacao("Este cupom pertence a uma loja específica.", "error"); return null; }
        } else {
            if (data.escopo === "global") { mostrarNotificacao("Insira este cupom no painel de resumo geral.", "error"); return null; }
            if (data.escopo === "loja" && data.lojaId !== lojaId) { mostrarNotificacao("Cupom inválido para esta loja.", "error"); return null; }
        }

        const usoMinimoExigido = data.valorMinimo || data.usoMinimo || 0;
        if (usoMinimoExigido > 0 && subtotalAtual < usoMinimoExigido) {
            mostrarNotificacao(`Compra mínima para este cupom: R$ ${usoMinimoExigido.toFixed(2)}`, "error"); 
            return null;
        }

        if (data.usuariosQueUsaram && data.usuariosQueUsaram.includes(usuarioLogado.uid)) { 
            mostrarNotificacao("Você já utilizou este cupom anteriormente.", "error"); 
            return null; 
        }

        if (data.limiteUsos && data.usosAtuais >= data.limiteUsos) { 
            mostrarNotificacao("Este cupom já esgotou.", "error"); 
            return null; 
        }

        if (data.dataExpiracao && new Date(data.dataExpiracao) < agora) { 
            mostrarNotificacao("Este cupom já está expirado.", "error"); 
            return null; 
        }

        return { id: cupomDoc.id, ...data };
    } catch (error) { 
        console.error("Erro ao validar cupom:", error); 
        return null; 
    }
}

const btnAplicarGlobal = document.getElementById('btn-aplicar-global');
if (btnAplicarGlobal) {
    btnAplicarGlobal.addEventListener('click', async () => {
        const inputGlobal = document.getElementById('cupom-plataforma');
        const codigo = inputGlobal ? inputGlobal.value.trim() : "";
        const subtotalGeral = Object.values(mapaSubtotaisLojas).reduce((acc, val) => acc + val, 0);

        const validado = await validarCupom(codigo, null, subtotalGeral);
        if (validado) {
            cupomAtivo = validado;
            mostrarNotificacao("Cupom global aplicado com sucesso!");
            await carregarCarrinho();
        }
    });
}

window.aplicarCupomLocal = async (lojaId) => {
    const input = document.getElementById(`cupom-${lojaId}`);
    if (!input || !input.value) { mostrarNotificacao("Digite o código do cupom da loja.", "error"); return; }

    const subtotalLojaEspecifica = mapaSubtotaisLojas[lojaId] || 0;

    const validado = await validarCupom(input.value.trim(), lojaId, subtotalLojaEspecifica);
    if (validado) {
        cuponsLocaisAtivos[lojaId] = validado;
        mostrarNotificacao("Cupom da loja aplicado!");
        await carregarCarrinho();
    }
};

window.removerCupomLocal = async (lojaId) => {
    delete cuponsLocaisAtivos[lojaId];
    mostrarNotificacao("Cupom da loja removido.");
    await carregarCarrinho();
};

window.removerCupomGlobal = async () => {
    cupomAtivo = null;
    mostrarNotificacao("Cupom global removido.");
    await carregarCarrinho();
};

// BUSCA IMAGENS EM LOTE (SEM TRAVAMENTO SEQUENCIAL)
async function preCarregarImagensProdutos(itens) {
    const idsFaltantes = [...new Set(itens.map(i => i.id.includes('_v_') ? i.id.split('_v_')[0] : i.id))]
        .filter(id => !cacheProdutosBanco[id]);

    if (idsFaltantes.length > 0) {
        await Promise.all(idsFaltantes.map(async (idReal) => {
            try {
                const snap = await getDoc(doc(db, "produtos", idReal));
                if (snap.exists()) {
                    cacheProdutosBanco[idReal] = snap.data();
                }
            } catch (e) {
                console.warn(`Erro ao pré-carregar produto ${idReal}:`, e);
            }
        }));
    }
}

function resolverImagemProdutoSincrona(item, dadosServidor = null) {
    const idReal = item.id.includes('_v_') ? item.id.split('_v_')[0] : item.id;
    const pBanco = cacheProdutosBanco[idReal] || {};

    const fotoProduto = pBanco.imagem || dadosServidor?.imagem || item?.imagem || "";
    if (fotoProduto && typeof fotoProduto === 'string' && fotoProduto.trim() !== '' && !fotoProduto.includes('placeholder.png')) {
        return formatarUrlImagem(fotoProduto);
    }

    const categoria = (pBanco.categoria || dadosServidor?.categoria || item?.categoria || "").trim();
    if (categoria && (fotosCategorias[categoria] || fotosCategorias[categoria.toLowerCase()])) {
        const arquivoCat = fotosCategorias[categoria] || fotosCategorias[categoria.toLowerCase()];
        return formatarUrlImagem(arquivoCat);
    }

    return '../assets/images/placeholder.png';
}

window.alterarQtd = async (id, delta) => {
    let car = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    const i = car.findIndex(p => p.id === id);
    if (i !== -1) {
        car[i].quantidade += delta;
        if (car[i].quantidade <= 0) car.splice(i, 1);
        localStorage.setItem('nordgo_carrinho', JSON.stringify(car));
        await carregarCarrinho();
    }
};

// GERENCIADOR DO CARRINHO
async function carregarCarrinho() {
    const itens = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    if (itens.length === 0) {
        document.getElementById('carrinho-vazio')?.classList.remove('hidden');
        document.getElementById('conteudo-carrinho')?.classList.add('hidden');
        return;
    }
    document.getElementById('carrinho-vazio')?.classList.add('hidden');
    document.getElementById('conteudo-carrinho')?.classList.remove('hidden');

    const agrupados = itens.reduce((acc, item) => {
        const lid = item.lojaId || 'outros';
        if (!acc[lid]) acc[lid] = [];
        acc[lid].push(item);
        return acc;
    }, {});

    try {
        const payload = itens.map(i => ({ 
            id: i.id,
            precoUnitario: parseFloat(i.preco) || 0,
            quantidade: i.quantidade 
        }));

        // Executa a chamada da Cloud Function e o pré-carregamento dos produtos em paralelo
        const [resposta] = await Promise.all([
            calcularTotalServer({ itens: payload }),
            preCarregarImagensProdutos(itens)
        ]);

        dadosPrecosServidor = resposta.data;
        renderizar(agrupados, dadosPrecosServidor.itens);
        
        const subtotalConsolidado = Object.values(mapaSubtotaisLojas).reduce((acc, val) => acc + val, 0);
        calcularDescontosETotais(subtotalConsolidado);

    } catch (error) {
        console.warn("Aviso ao validar com o servidor, aplicando cálculo local:", error);
        await preCarregarImagensProdutos(itens);
        renderizar(agrupados, null);
        const subtotalConsolidado = Object.values(mapaSubtotaisLojas).reduce((acc, val) => acc + val, 0);
        calcularDescontosETotais(subtotalConsolidado);
    }
}

function renderizar(lojasAgrupadas, itensServidor) {
    if (!listaLojasHtml) return;
    listaLojasHtml.innerHTML = '';
    mapaSubtotaisLojas = {};

    const mapaProdutosServidor = {};
    if (itensServidor) {
        itensServidor.forEach(p => {
            const chave = p.idVirtual || p.id;
            mapaProdutosServidor[chave] = p;
        });
    }

    const fragment = document.createDocumentFragment();

    for (const lid in lojasAgrupadas) {
        const itens = lojasAgrupadas[lid];
        const cupomLocal = cuponsLocaisAtivos[lid];

        const nomeExibicaoLoja = (itens[0].nomeLoja && itens[0].nomeLoja !== lid) 
            ? itens[0].nomeLoja 
            : 'Estabelecimento';

        let subtotalLoja = 0;

        const cardLojaDiv = document.createElement('div');
        cardLojaDiv.className = 'card-loja-carrinho';

        let itensHtml = '';
        for (const item of itens) {
            const idReal = item.id.includes('_v_') ? item.id.split('_v_')[0] : item.id;
            const dadosServidor = mapaProdutosServidor[item.id] || mapaProdutosServidor[idReal];
            
            let precoOficial = 0;

            if (item.id.includes('_v_')) {
                // BLINDAGEM ANTI-ZERO: 
                // Se a Cloud Function devolver 0 por estar desatualizada, assume o valor real do localStorage.
                const precoLocal = parseFloat(item.preco) || 0;
                const precoServer = (dadosServidor && dadosServidor.precoUnitario !== undefined) ? dadosServidor.precoUnitario : 0;
                
                precoOficial = Math.max(precoLocal, precoServer);
            } else {
                precoOficial = (dadosServidor && dadosServidor.precoUnitario !== undefined) 
                    ? dadosServidor.precoUnitario 
                    : (parseFloat(item.preco) || 0);
            }

            const imgUrl = resolverImagemProdutoSincrona(item, dadosServidor);
            
            subtotalLoja += precoOficial * item.quantidade;

            itensHtml += `
                <div class="item-carrinho-simples">
                    <img src="${imgUrl}" alt="${item.nome}" loading="lazy" onerror="this.onerror=null; this.src='../assets/images/placeholder.png';">
                    <div class="info-item">
                        <h4>${item.nome}</h4>
                        <span>R$ ${precoOficial.toFixed(2)}</span>
                    </div>
                    <div class="controles-qtd-carrinho">
                        <button onclick="alterarQtd('${item.id}', -1)"><i class="fa-solid fa-minus"></i></button>
                        <span>${item.quantidade}</span>
                        <button onclick="alterarQtd('${item.id}', 1)"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>`;
        }

        mapaSubtotaisLojas[lid] = subtotalLoja;

        cardLojaDiv.innerHTML = `
            <div class="header-loja-carrinho"><i class="fa-solid fa-store"></i> <span>${nomeExibicaoLoja}</span></div>
            <div class="itens-container">${itensHtml}</div>
            <div class="footer-loja-carrinho">
                <div class="cupom-loja-area">
                    <label style="color: #2f3542; font-weight:600; font-size:0.8rem;">${cupomLocal ? 'Cupom Aplicado ✓' : 'Cupom da Loja'}</label>
                    <div class="input-group" style="display: flex; gap: 6px;">
                        <input type="text" id="cupom-${lid}" placeholder="${cupomLocal ? cupomLocal.codigo : 'Código da loja'}" ${cupomLocal ? 'disabled' : ''}>
                        ${cupomLocal ? `
                            <button class="btn-aplicar" style="background:#ff4757;" onclick="window.removerCupomLocal('${lid}')" title="Remover Cupom"><i class="fa-solid fa-xmark"></i></button>
                        ` : `
                            <button class="btn-aplicar" onclick="window.aplicarCupomLocal('${lid}')">Aplicar</button>
                        `}
                    </div>
                </div>
                <div class="subtotal-loja-container"><span class="label-sub">Subtotal Loja</span><span class="valor-sub">R$ ${subtotalLoja.toFixed(2)}</span></div>
            </div>`;

        fragment.appendChild(cardLojaDiv);
    }

    listaLojasHtml.appendChild(fragment);
}

function calcularDescontosETotais(subtotalBase) {
    let totalDescontos = 0;

    if (cupomAtivo) {
        totalDescontos += cupomAtivo.tipo === "porcentagem" ? (subtotalBase * cupomAtivo.valor / 100) : cupomAtivo.valor;
    }

    for (const lid in cuponsLocaisAtivos) {
        const cp = cuponsLocaisAtivos[lid];
        const subtotalLojaEspecifica = mapaSubtotaisLojas[lid] || 0;
        totalDescontos += cp.tipo === "porcentagem" ? (subtotalLojaEspecifica * cp.valor / 100) : cp.valor;
    }

    const linhaDesconto = document.getElementById('linha-desconto-global');
    const descontoGlobalElem = document.getElementById('desconto-global');

    if (totalDescontos > 0) {
        linhaDesconto?.classList.remove('hidden');
        if (descontoGlobalElem) descontoGlobalElem.innerText = `- R$ ${totalDescontos.toFixed(2)}`;
    } else { 
        linhaDesconto?.classList.add('hidden'); 
    }
    
    const totalFinal = Math.max(0, subtotalBase - totalDescontos);
    const subtotalGeralElem = document.getElementById('subtotal-geral');
    if (subtotalGeralElem) subtotalGeralElem.innerText = `R$ ${totalFinal.toFixed(2)}`;
}