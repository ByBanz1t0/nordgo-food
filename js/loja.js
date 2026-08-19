import { auth, db, mostrarNotificacao } from './firebase-config.js';
import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { adicionarAoCarrinho, atualizarCarrinhoFlutuante } from './cart-helper.js';

// ATIVAÇÃO DO CACHE PERSISTENTE LOCAL
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

const params = new URLSearchParams(window.location.search);
const lojaId = params.get('loja') || params.get('id'); 
let nomeLojaGlobal = ""; 
let fotosCategorias = {}; 

let produtosCarregadosLocais = [];
let produtoSelecionadoAtual = null;
let lojaAbertaAtualmente = true;

if (!lojaId) { 
    window.location.href = '../index.html'; 
} else { 
    inicializarPagina(); 
}

// SINCRONIZAÇÃO DE USUÁRIO NO HEADER
onAuthStateChanged(auth, (user) => {
    const userArea = document.getElementById('user-area');
    if (!userArea) return;

    if (user) {
        userArea.innerHTML = `
            <div class="pill-badge" style="cursor: pointer;" onclick="window.location.href='perfil.html'">
                <i class="fa-regular fa-user"></i>
                <span class="user-name-text">${user.displayName ? user.displayName.split(' ')[0] : 'Minha Conta'}</span>
            </div>
        `;
    } else {
        userArea.innerHTML = `
            <div class="pill-badge" style="cursor: pointer;" onclick="window.location.href='login.html'">
                <button class="btn-login">
                    <i class="fa-solid fa-arrow-right-to-bracket"></i>
                    <span class="user-name-text">Entrar</span>
                </button>
            </div>
        `;
    }
});

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

/* ============================================================
   FUNÇÃO DE VERIFICAÇÃO DE HORÁRIO DE FUNCIONAMENTO
   ============================================================ */
function verificarLojaAberta(loja) {
    const statusMaster = loja.statusMaster || "automatico";

    if (statusMaster === "aberto") return true;
    if (statusMaster === "fechado") return false;

    const horariosSemana = loja.horariosSemana || {};
    const agora = new Date();
    
    const mapaDias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
    const diaChaveAtual = mapaDias[agora.getDay()];
    
    const configDiaAtual = horariosSemana[diaChaveAtual];

    if (!configDiaAtual || !configDiaAtual.aberto) {
        return false;
    }

    const inicioStr = configDiaAtual.inicio || "18:00";
    const fimStr = configDiaAtual.fim || "23:00";

    const [hInicio, mInicio] = inicioStr.split(':').map(Number);
    const [hFim, mFim] = fimStr.split(':').map(Number);

    const minutosAtuais = agora.getHours() * 60 + agora.getMinutes();
    const minutosInicio = hInicio * 60 + mInicio;
    let minutosFim = hFim * 60 + mFim;

    if (minutosFim < minutosInicio) {
        minutosFim += 24 * 60;
        if (minutosAtuais < minutosInicio) {
            const minutosAtuaisMadrugada = minutosAtuais + 24 * 60;
            return minutosAtuaisMadrugada >= minutosInicio && minutosAtuaisMadrugada <= minutosFim;
        }
    }

    return minutosAtuais >= minutosInicio && minutosAtuais <= minutosFim;
}

async function inicializarPagina() {
    try {
        const qProdutos = query(collection(db, "produtos"), where("lojaId", "==", lojaId));
        const qCategorias = collection(db, "categorias");
        const docLojaRef = doc(db, "lojas", lojaId);

        // DISPARO PARALELO PRINCIPAL: Loja + Produtos + Categorias
        const [lojaSnap, prodSnap, catSnap] = await Promise.all([
            getDoc(docLojaRef),
            getDocs(qProdutos),
            getDocs(qCategorias)
        ]);

        if (!lojaSnap.exists()) { 
            window.location.href = '../index.html'; 
            return; 
        }

        catSnap.forEach(docCat => {
            const c = docCat.data();
            const nomeCat = (c.nome || "").trim();
            const arquivo = c.fotoArquivo || c.foto || c.imagem || "";
            if (nomeCat && arquivo) {
                fotosCategorias[nomeCat] = arquivo;
                fotosCategorias[nomeCat.toLowerCase()] = arquivo;
            }
        });

        const loja = lojaSnap.data();

        if (loja.status !== 'aprovado') {
            document.title = "Estabelecimento Indisponível | NordGo";
            document.getElementById('header-nome-loja').innerText = "Indisponível";
            
            document.getElementById('loja-content').innerHTML = `
                <div class="loja-indisponivel-container" style="text-align: center; padding: 5rem 1rem; font-family: 'Poppins', sans-serif;">
                    <i class="fa-solid fa-store-slash" style="font-size: 4rem; color: #ff6400; margin-bottom: 1.5rem;"></i>
                    <h2 style="color: #2f3542; font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 600;">Estabelecimento Indisponível</h2>
                    <p style="color: #747d8c; margin-bottom: 2rem; font-size: 0.95rem;">Desculpe, este estabelecimento está temporariamente fechado ou foi desativado pela plataforma.</p>
                    <button onclick="window.location.href='../index.html'" class="btn-principal" style="max-width: 200px; margin: 0 auto; display: block;">Voltar para o Início</button>
                </div>
            `;
            return;
        }

        nomeLojaGlobal = loja.nome || "Estabelecimento"; 
        lojaAbertaAtualmente = verificarLojaAberta(loja);
        renderizarDadosLoja(loja);

        const produtos = [];
        prodSnap.forEach(docSnap => produtos.push({ 
            id: docSnap.id, 
            ...docSnap.data(), 
            lojaId: lojaId, 
            nomeLoja: nomeLojaGlobal 
        }));
        
        produtosCarregadosLocais = produtos;
        renderizarCardapio(produtos);

        // DISPAROS PARALELOS SECUNDÁRIOS
        await Promise.all([
            carregarCuponsLoja(),
            carregarAvaliacoesLoja()
        ]);

        atualizarCarrinhoFlutuante();
    } catch (error) {
        console.error("Erro na inicialização:", error);
        
        const containerLoja = document.getElementById('loja-content');
        if (containerLoja) {
            containerLoja.innerHTML = `
                <div style="text-align: center; padding: 4rem 1rem; font-family: 'Poppins', sans-serif;">
                    <i class="fa-solid fa-wifi" style="font-size: 3rem; color: #ff4757; margin-bottom: 1rem;"></i>
                    <h2 style="color: #2f3542; font-size: 1.3rem; margin-bottom: 0.5rem;">Sem Conexão com o Servidor</h2>
                    <p style="color: #747d8c; font-size: 0.9rem; margin-bottom: 1.5rem;">Não foi possível carregar os dados da loja. Verifique sua conexão com a internet.</p>
                    <button onclick="window.location.reload()" style="background: #ff6400; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;">Tentar Novamente</button>
                </div>
            `;
        }
    }
}

function renderizarDadosLoja(loja) {
    document.title = `${loja.nome} | NordGo`;

    document.getElementById('header-nome-loja').innerText = loja.nome;
    document.getElementById('detalhe-nome-loja').innerText = loja.nome; 
    document.getElementById('detalhe-categoria-loja').innerText = loja.categoria;
    document.getElementById('detalhe-descricao').innerText = loja.descricao || "";
    document.getElementById('detalhe-avaliacao').innerText = loja.avaliacao || "Novo";
    document.getElementById('detalhe-tempo').innerText = `${loja.tempoEntrega || '20-30'} min`;
    
    const elemEndereco = document.getElementById('detalhe-endereco-loja');
    if (elemEndereco) {
        const rua = loja.ruaLoja || loja.rua || "";
        const numero = loja.numeroLoja || loja.numero || "";
        const bairro = loja.bairroLoja || loja.bairro || "";
        const cidade = loja.cidadeLoja || loja.cidade || "";

        let textoEndereco = "";
        if (rua) textoEndereco += rua;
        if (numero) textoEndereco += `, ${numero}`;
        if (bairro) textoEndereco += ` - ${bairro}`;
        if (cidade) textoEndereco += ` (${cidade})`;

        elemEndereco.innerHTML = textoEndereco 
            ? `<i class="fa-solid fa-location-dot" style="color: #ff6400;"></i> ${textoEndereco}`
            : `<i class="fa-solid fa-location-dot" style="color: #ff6400;"></i> Endereço não informado`;
    }

    const rawLogo = loja.logoUrl || loja.logoLoja || '../assets/images/default-loja.png';
    document.getElementById('detalhe-logo-loja').src = formatarUrlImagem(rawLogo);
    
    const banner = document.getElementById('loja-img-fundo');
    if (banner) {
        if (loja.bannerLoja && loja.bannerLoja.trim() !== "") { 
            banner.style.backgroundImage = `url('${formatarUrlImagem(loja.bannerLoja)}')`;
            banner.style.backgroundColor = 'transparent';
        } else { 
            banner.style.backgroundImage = 'none';
            banner.style.backgroundColor = loja.temaLoja || '#ff6400'; 
        }
    }
    
    const freteElem = document.getElementById('detalhe-frete');
    freteElem.innerText = (!loja.frete || loja.frete == 0) 
        ? "Frete Grátis" 
        : parseFloat(loja.frete).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });

    let bannerFechadoElem = document.getElementById('banner-loja-fechada-alerta');
    if (!lojaAbertaAtualmente) {
        if (!bannerFechadoElem) {
            bannerFechadoElem = document.createElement('div');
            bannerFechadoElem.id = 'banner-loja-fechada-alerta';
            bannerFechadoElem.style.cssText = `
                background: #ff4757; 
                color: #ffffff; 
                text-align: center; 
                padding: 10px 15px; 
                font-weight: 600; 
                font-size: 0.9rem; 
                border-radius: 8px; 
                margin: 15px 0; 
                box-shadow: 0 2px 8px rgba(255,71,87,0.25);
                font-family: 'Poppins', sans-serif;
            `;
            bannerFechadoElem.innerHTML = `<i class="fa-solid fa-clock"></i> Este estabelecimento está fechado no momento e não aceita pedidos.`;
            const headerMeta = document.querySelector('.loja-header-meta') || document.getElementById('loja-content');
            if (headerMeta) headerMeta.prepend(bannerFechadoElem);
        }
    } else if (bannerFechadoElem) {
        bannerFechadoElem.remove();
    }
}

async function carregarAvaliacoesLoja() {
    const sectionAval = document.getElementById('section-avaliacoes-loja');
    const listaAval = document.getElementById('lista-avaliacoes-loja');
    const elemNotaMedia = document.getElementById('detalhe-avaliacao');
    if (!listaAval) return;

    try {
        const qAval = query(collection(db, "avaliacoes"), where("lojaId", "==", lojaId));
        const qPedidos = query(collection(db, "pedidos"), where("lojaId", "==", lojaId), where("avaliado", "==", true));
        
        const [snapAval, snapPedidos] = await Promise.all([
            getDocs(qAval),
            getDocs(qPedidos)
        ]);

        if (snapAval.empty) return;

        listaAval.innerHTML = "";
        let somaNotasLoja = 0;
        let totalAvaliacoesLoja = 0;
        
        const mapaNotasProdutos = {};
        const pedidosMap = {};
        snapPedidos.forEach(pDoc => {
            pedidosMap[pDoc.id] = pDoc.data();
        });

        const fragment = document.createDocumentFragment();

        snapAval.forEach(docSnap => {
            const aval = docSnap.data();
            const notaVal = parseFloat(aval.nota || 5);
            somaNotasLoja += notaVal;
            totalAvaliacoesLoja++;

            const pedidoAssociado = pedidosMap[aval.pedidoId];
            if (pedidoAssociado && Array.isArray(pedidoAssociado.itens)) {
                pedidoAssociado.itens.forEach(item => {
                    const idBase = item.id ? item.id.split('_v_')[0] : null;
                    if (idBase) {
                        if (!mapaNotasProdutos[idBase]) {
                            mapaNotasProdutos[idBase] = { soma: 0, qtd: 0 };
                        }
                        mapaNotasProdutos[idBase].soma += notaVal;
                        mapaNotasProdutos[idBase].qtd += 1;
                    }
                });
            }

            let htmlEstrelas = "";
            for (let i = 1; i <= 5; i++) {
                if (i <= aval.nota) {
                    htmlEstrelas += `<i class="fa-solid fa-star" style="color: #ffa502; font-size: 0.85rem;"></i>`;
                } else {
                    htmlEstrelas += `<i class="fa-solid fa-star" style="color: #dcdde1; font-size: 0.85rem;"></i>`;
                }
            }

            const cardAval = document.createElement('div');
            cardAval.style.cssText = "background: #f8f9fa; padding: 12px 16px; border-radius: 12px; border: 1px solid #edf2f7;";
            
            cardAval.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <strong style="font-size: 0.9rem; color: #2f3542;">${aval.clienteNome || 'Cliente'}</strong>
                    <div>${htmlEstrelas}</div>
                </div>
                ${aval.comentario ? `<p style="font-size: 0.85rem; color: #57606f; margin: 0; line-height: 1.4;">"${aval.comentario}"</p>` : ''}
            `;
            fragment.appendChild(cardAval);
        });

        listaAval.appendChild(fragment);

        produtosCarregadosLocais.forEach(prod => {
            if (mapaNotasProdutos[prod.id]) {
                const dadosProd = mapaNotasProdutos[prod.id];
                prod.avaliacaoCalculada = (dadosProd.soma / dadosProd.qtd).toFixed(1);
            } else {
                prod.avaliacaoCalculada = null;
            }
        });

        renderizarCardapio(produtosCarregadosLocais);

        if (totalAvaliacoesLoja > 0) {
            const mediaLoja = (somaNotasLoja / totalAvaliacoesLoja).toFixed(1);
            if (elemNotaMedia) {
                elemNotaMedia.innerText = `${mediaLoja} (${totalAvaliacoesLoja})`;
            }
            if (sectionAval) {
                sectionAval.classList.remove('hidden');
            }
        }
    } catch (err) {
        console.error("Erro ao carregar avaliações da loja:", err);
    }
}

async function carregarCuponsLoja() {
    const sectionCupons = document.getElementById('section-cupons-loja');
    const listaCupons = document.getElementById('lista-cupons-loja');
    if (!listaCupons) return;

    try {
        const q = query(collection(db, "cupons"), where("lojaId", "==", lojaId));
        const snap = await getDocs(q);
        
        listaCupons.innerHTML = "";
        let possuiCupomValido = false;
        const agora = new Date();
        const fragment = document.createDocumentFragment();

        snap.forEach(docSnap => {
            const c = docSnap.data();
            const expirado = c.dataExpiracao ? new Date(c.dataExpiracao) < agora : false;
            const esgotado = c.limiteUsos && (c.usosAtuais >= c.limiteUsos);

            if (!expirado && !esgotado) {
                possuiCupomValido = true;
                
                const descontoTexto = c.tipo === 'porcentagem' ? `${c.valor}% OFF` : `R$ ${c.valor.toFixed(2)} OFF`;
                const minimoTexto = c.valorMinimo > 0 ? `Min: R$ ${c.valorMinimo.toFixed(2)}` : 'Sem mínimo';

                const cardCupom = document.createElement('div');
                cardCupom.className = "card-cupom-individual";
                cardCupom.title = "Clique para copiar o código";
                
                cardCupom.onclick = () => {
                    navigator.clipboard.writeText(c.codigo);
                    if (typeof mostrarNotificacao === "function") {
                        mostrarNotificacao(`Código ${c.codigo} copiado!`);
                    } else {
                        alert(`Código ${c.codigo} copiado para a área de transferência!`);
                    }
                };

                cardCupom.innerHTML = `
                    <span>Cupom Próprio</span>
                    <h4>${c.codigo}</h4>
                    <div>
                        <span>${descontoTexto}</span>
                        <span>${minimoTexto}</span>
                    </div>
                `;
                fragment.appendChild(cardCupom);
            }
        });

        if (possuiCupomValido) {
            listaCupons.appendChild(fragment);
            sectionCupons.classList.remove('hidden');
        }

    } catch (err) {
        console.error("Erro ao processar cupons da loja:", err);
    }
}

function obterImagemProduto(p) {
    if (p.imagem && typeof p.imagem === 'string' && p.imagem.trim() !== "" && !p.imagem.includes("placeholder.png")) {
        return formatarUrlImagem(p.imagem);
    }
    const cat = (p.categoria || "").trim();
    if (cat && (fotosCategorias[cat] || fotosCategorias[cat.toLowerCase()])) {
        const arquivo = fotosCategorias[cat] || fotosCategorias[cat.toLowerCase()];
        return formatarUrlImagem(arquivo);
    }
    return '../assets/images/placeholder.png';
}

function obterAvaliacaoProdutoHTML(p) {
    const notaReal = p.avaliacaoCalculada || (p.avaliacao ? parseFloat(p.avaliacao).toFixed(1) : null);

    if (!notaReal) {
        return `<span class="badge-avaliacao-item" style="font-size: 0.75rem; font-weight: 500; color: #747d8c; background: #f1f2f6; padding: 2px 8px; border-radius: 12px;">Novo</span>`;
    }

    return `
        <span class="badge-avaliacao-item" style="font-size: 0.75rem; font-weight: 600; color: #2f3542; display: inline-flex; align-items: center; gap: 3px; background: rgba(211, 211, 211, 0.44); padding: 2px 6px; border-radius: 12px;">
            <i class="fa-solid fa-star" style="color: #ffa502; font-size: 0.7rem;"></i> ${notaReal}
        </span>
    `;
}

function calcularPrecoMinimoProduto(p) {
    let precoMinimo = parseFloat(p.preco) || 0;

    if (p.temVariacoes && Array.isArray(p.grupoDeOpcoes)) {
        p.grupoDeOpcoes.forEach(grupo => {
            if (grupo.obrigatorio && Array.isArray(grupo.opcoes) && grupo.opcoes.length > 0) {
                const menorPrecoOpcao = Math.min(
                    ...grupo.opcoes.map(opcao => parseFloat(opcao.precoAdicional) || 0)
                );
                precoMinimo += menorPrecoOpcao;
            }
        });
    }

    return precoMinimo;
}

function criarCardQuadradoHTML(p, customClass = "", index = 0) {
    const indisponivel = p.disponibilidade === false || !lojaAbertaAtualmente;
    const imgUrl = obterImagemProduto(p);
    const qtdVendas = p.vendas || 0;
    const precoExibicao = calcularPrecoMinimoProduto(p);
    const loadingStrategy = index < 2 ? 'eager' : 'lazy';
    
    const cliqueAcao = p.temVariacoes 
        ? `window.abrirModalCustomizacao('${p.id}')`
        : `adicionarAoCarrinho('${p.id}', '${p.nome}', '${imgUrl}', '${lojaId}', '${nomeLojaGlobal}', ${precoExibicao})`;

    const textoBotao = !lojaAbertaAtualmente ? "Loja Fechada" : (indisponivel ? "Esgotado" : "");

    return `
        <div class="card-produto-quadrado ${customClass} ${indisponivel ? 'prod-esgotado' : ''}">
            <img src="${imgUrl}" 
                 alt="${p.nome}"
                 loading="${loadingStrategy}"
                 onerror="if (this.src !== window.location.origin + '/assets/images/placeholder.png') { this.src='../assets/images/placeholder.png'; }">
            ${p.disponibilidade === false ? '<span class="badge-esgotado">Esgotado</span>' : ''}
            
            ${qtdVendas > 0 ? `
                <span class="badge-vendas">
                    <i class="fa-solid fa-fire"></i> ${qtdVendas} vendidos
                </span>
            ` : ''}

            <div class="info-overlay">
                <h3>${p.nome} ${obterAvaliacaoProdutoHTML(p)}</h3>
                <span class="preco-tag">${p.temVariacoes ? 'A partir de ' : ''}R$ ${precoExibicao.toLocaleString('pt-br', {minimumFractionDigits: 2})}</span>
            </div>
            ${!indisponivel ? `
                <button class="btn-add-carrinho" onclick="${cliqueAcao}">
                    <i class="fa-solid ${p.temVariacoes ? 'fa-sliders' : 'fa-plus'}"></i><i class="fa-solid fa-cart-shopping"></i>
                </button>` : `
                <button class="btn-add-carrinho btn-bloqueado-fechado" disabled style="background: #a4b0be; cursor: not-allowed; opacity: 0.7;" title="${textoBotao}">
                    <i class="fa-solid fa-lock"></i>
                </button>
            `}
        </div>
    `;
}

function criarCardHorizontalHTML(p, index = 0) {
    const indisponivel = p.disponibilidade === false || !lojaAbertaAtualmente;
    const imgUrl = obterImagemProduto(p);
    const precoExibicao = calcularPrecoMinimoProduto(p);
    const loadingStrategy = index < 3 ? 'eager' : 'lazy';

    const cliqueAcao = p.temVariacoes 
        ? `window.abrirModalCustomizacao('${p.id}')`
        : `adicionarAoCarrinho('${p.id}', '${p.nome}', '${imgUrl}', '${lojaId}', '${nomeLojaGlobal}', ${precoExibicao})`;

    return `
        <div class="card-produto-horizontal ${indisponivel ? 'prod-esgotado' : ''}" onclick="${p.temVariacoes && !indisponivel ? cliqueAcao : ''}" style="${p.temVariacoes && !indisponivel ? 'cursor:pointer;' : ''}">
            <div class="prod-foto-lateral">
                <img src="${imgUrl}" 
                    alt="${p.nome}"
                    loading="${loadingStrategy}"
                    onerror="if (this.src !== window.location.origin + '/assets/images/placeholder.png') { this.src='../assets/images/placeholder.png'; }">
            </div>
            <div class="prod-conteudo">
                <div class="prod-textos">
                    <div class="prod-header-info" style="display: flex; align-items: center; gap: 6px;">
                        <h4>${p.nome}</h4>
                        ${obterAvaliacaoProdutoHTML(p)}
                    </div>
                    
                    <div onclick="event.stopPropagation();">
                        <button class="btn-toggle-desc" onclick="window.abrirModalDescricao('${p.id}')">
                            ver descrição
                        </button>
                    </div>
                </div>
                
                <div class="prod-acoes-lateral" onclick="event.stopPropagation();">
                    <span class="preco-detalhe">${p.temVariacoes ? 'A partir de ' : ''}R$ ${precoExibicao.toLocaleString('pt-br', {minimumFractionDigits: 2})}</span>
                    
                    ${!indisponivel ? `
                        <button class="btn-add-carrinho" onclick="${cliqueAcao}">
                            <i class="fa-solid ${p.temVariacoes ? 'fa-sliders' : 'fa-plus'}"></i><i class="fa-solid fa-cart-shopping"></i>
                        </button>` : `
                        <button class="btn-add-carrinho btn-bloqueado-fechado" disabled style="background: #a4b0be; cursor: not-allowed; opacity: 0.7;" title="${!lojaAbertaAtualmente ? 'Loja Fechada' : 'Esgotado'}">
                            <i class="fa-solid fa-lock"></i>
                        </button>
                    `}
                        
                    <span class="status-badge ${indisponivel ? 'status-indisponivel' : 'status-disponivel'}">
                        <i class="fa-solid ${indisponivel ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> 
                        ${!lojaAbertaAtualmente ? 'Loja Fechada' : (p.disponibilidade === false ? 'Indisponível' : 'Disponível')}
                    </span>
                </div>
            </div>
        </div>
    `;
}

const modalDesc = document.getElementById('modal-descricao-produto');
const txtTituloDesc = document.getElementById('modal-desc-titulo-produto');
const txtLojaDesc = document.getElementById('modal-desc-nome-loja');
const txtCorpoDesc = document.getElementById('modal-desc-texto-completo');
const btnFecharDesc = document.getElementById('btn-fechar-desc');
const btnFecharDescFooter = document.getElementById('btn-fechar-modal-desc-footer');

window.abrirModalDescricao = (idProduto) => {
    const prod = produtosCarregadosLocais.find(item => item.id === idProduto);
    if (!prod) return;

    if (txtTituloDesc) txtTituloDesc.innerText = prod.nome;
    if (txtLojaDesc) txtLojaDesc.innerText = nomeLojaGlobal || "Estabelecimento";
    if (txtCorpoDesc) txtCorpoDesc.innerText = prod.descricao || 'Este produto não possui uma descrição detalhada.';

    if (modalDesc) modalDesc.classList.add('active');
};

const fecharModalDesc = () => {
    if (modalDesc) modalDesc.classList.remove('active');
};

if (btnFecharDesc) btnFecharDesc.onclick = fecharModalDesc;
if (btnFecharDescFooter) btnFecharDescFooter.onclick = fecharModalDesc;

if (modalDesc) {
    modalDesc.addEventListener('click', (e) => {
        if (e.target === modalDesc) fecharModalDesc();
    });
}

function renderizarCardapio(produtos) {
    const containerMaisPedidos = document.getElementById('container-mais-pedidos');
    const listaMaisPedidos = document.getElementById('lista-mais-pedidos');
    const cardapioAgrupado = document.getElementById('cardapio-agrupado');
    
    if (!listaMaisPedidos || !cardapioAgrupado) return;

    listaMaisPedidos.innerHTML = ""; 
    cardapioAgrupado.innerHTML = "";

    const maisPedidos = [...produtos]
        .filter(p => p.vendas && p.vendas > 0)
        .sort((a, b) => b.vendas - a.vendas)
        .slice(0, 5);

    if (maisPedidos.length > 0) {
        containerMaisPedidos.classList.remove('hidden');
        const fragMaisPedidos = document.createDocumentFragment();
        
        maisPedidos.forEach((p, idx) => { 
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = criarCardQuadradoHTML(p, "scroll-item", idx);
            fragMaisPedidos.appendChild(tempDiv.firstElementChild);
        });
        
        listaMaisPedidos.appendChild(fragMaisPedidos);
    } else {
        containerMaisPedidos.classList.add('hidden');
    }

    const categoriesEncontradas = {};
    produtos.forEach(p => {
        const cat = p.categoria || "Outros";
        if (!categoriesEncontradas[cat]) categoriesEncontradas[cat] = [];
        categoriesEncontradas[cat].push(p);
    });

    const fragCardapio = document.createDocumentFragment();

    Object.keys(categoriesEncontradas).sort().forEach(catNome => {
        const produtosDaCat = categoriesEncontradas[catNome].sort((a, b) => a.nome.localeCompare(b.nome));
        
        const blocoCat = document.createElement('div');
        blocoCat.className = 'categoria-bloco';

        let htmlCatHeader = `<h2 class="titulo-categoria">${catNome}</h2><div class="grid-produtos-detalhado">`;
        let htmlCatBody = '';
        
        produtosDaCat.forEach((p, idx) => { 
            htmlCatBody += criarCardHorizontalHTML(p, idx); 
        });
        
        blocoCat.innerHTML = htmlCatHeader + htmlCatBody + `</div>`;
        fragCardapio.appendChild(blocoCat);
    });

    cardapioAgrupado.appendChild(fragCardapio);
}

const overlayCust = document.getElementById('modal-customizar-produto');
const containerGrupos = document.getElementById('container-grupos-customizacao');
const txtPrecoModal = document.getElementById('txt-preco-dinamico-modal');

window.abrirModalCustomizacao = (idProduto) => {
    if (!lojaAbertaAtualmente) {
        mostrarNotificacao("Este estabelecimento está fechado e não aceita pedidos no momento.", "error");
        return;
    }

    const prod = produtosCarregadosLocais.find(item => item.id === idProduto);
    if (!prod) return;

    produtoSelecionadoAtual = prod;
    document.getElementById('modal-cust-titulo-produto').innerText = prod.nome;
    document.getElementById('modal-cust-desc-produto').innerText = prod.descricao || 'Selecione as opções desejadas abaixo.';
    
    containerGrupos.innerHTML = "";

    const grupos = prod.grupoDeOpcoes || [];
    const fragGrupos = document.createDocumentFragment();

    grupos.forEach((grupo, idxGrupo) => {
        const divGrupo = document.createElement('div');
        divGrupo.className = "bloco-grupo-escolha";
        
        const textoObrigatorio = grupo.obrigatorio 
            ? `<span class="badge-obrigatorio-tag">Obrigatório</span>` 
            : `<span class="badge-opcional-tag">Opcional</span>`;

        const subtextoLimite = grupo.maxEscolhas > 1 
            ? `<small class="txt-limite-escolhas">Escolha até ${grupo.maxEscolhas} opções</small>`
            : '';

        divGrupo.innerHTML = `
            <div class="header-grupo-escolha-meta">
                <div>
                    <h4>${grupo.titulo}</h4>
                    ${subtextoLimite}
                </div>
                ${textoObrigatorio}
            </div>
            <div class="lista-opcoes-grupo-inputs"></div>
        `;

        const containerInputs = divGrupo.querySelector('.lista-opcoes-grupo-inputs');
        const fragInputs = document.createDocumentFragment();

        grupo.opcoes.forEach((opcao, idxOpcao) => {
            const divOpcao = document.createElement('div');
            divOpcao.className = "linha-opcao-item-custom";

            const inputType = grupo.maxEscolhas === 1 ? 'radio' : 'checkbox';
            const inputName = `grupo_${grupo.idGrupo || idxGrupo}`;
            const inputId = `input_${inputName}_${idxOpcao}`;

            const txtPrecoAdicional = opcao.precoAdicional > 0 
                ? `<span class="preco-adicional-tag-item">+ R$ ${opcao.precoAdicional.toFixed(2)}</span>`
                : `<span class="preco-adicional-tag-item gratis">Grátis</span>`;

            divOpcao.innerHTML = `
                <label for="${inputId}" class="label-wrapper-opcao-public">
                    <div class="esquerda-label-bloco">
                        <input type="${inputType}" 
                               id="${inputId}" 
                               name="${inputName}" 
                               value="${idxOpcao}" 
                               data-preco="${opcao.precoAdicional}"
                               data-nome="${opcao.nome}"
                               data-grupo="${grupo.titulo}"
                               data-idgrupo="${grupo.idGrupo || idxGrupo}"
                               data-max="${grupo.maxEscolhas}">
                        <span class="nome-opcao-texto-span">${opcao.nome}</span>
                    </div>
                    ${txtPrecoAdicional}
                </label>
            `;

            if (inputType === 'checkbox') {
                const inputCheckbox = divOpcao.querySelector('input');
                inputCheckbox.addEventListener('change', (e) => {
                    const marcados = containerInputs.querySelectorAll('input:checked');
                    if (marcados.length > grupo.maxEscolhas) {
                        e.target.checked = false; 
                        alert(`Você pode escolher no máximo ${grupo.maxEscolhas} opções para o grupo: ${grupo.titulo}`);
                    }
                    atualizarPrecoDinamicoModal();
                });
            } else {
                divOpcao.querySelector('input').addEventListener('change', atualizarPrecoDinamicoModal);
            }

            fragInputs.appendChild(divOpcao);
        });

        containerInputs.appendChild(fragInputs);
        fragGrupos.appendChild(divGrupo);
    });

    containerGrupos.appendChild(fragGrupos);

    atualizarPrecoDinamicoModal();
    overlayCust.classList.add('active');
};

function atualizarPrecoDinamicoModal() {
    if (!produtoSelecionadoAtual) return;

    let precoAcumulado = parseFloat(produtoSelecionadoAtual.preco) || 0;
    const inputsMarcados = containerGrupos.querySelectorAll('input:checked');

    inputsMarcados.forEach(input => {
        precoAcumulado += parseFloat(input.dataset.preco) || 0;
    });

    txtPrecoModal.innerText = precoAcumulado.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
}

document.getElementById('btn-confirmar-customizacao').onclick = () => {
    if (!lojaAbertaAtualmente) {
        mostrarNotificacao("Este estabelecimento está fechado.", "error");
        return;
    }

    if (!produtoSelecionadoAtual) return;

    const gruposConfig = produtoSelecionadoAtual.grupoDeOpcoes || [];
    let validacaoSucesso = true;
    let nomesOpcoesEscolhidas = [];
    let precoAcumuladoCalculado = parseFloat(produtoSelecionadoAtual.preco) || 0;

    for (let i = 0; i < gruposConfig.length; i++) {
        const grupo = gruposConfig[i];
        const inputName = `grupo_${grupo.idGrupo || i}`;
        const marcados = containerGrupos.querySelectorAll(`input[name="${inputName}"]:checked`);

        if (grupo.obrigatorio && marcados.length === 0) {
            alert(`Por favor, faça uma escolha obrigatória no grupo: ${grupo.titulo}`);
            validacaoSucesso = false;
            break;
        }
    }

    if (!validacaoSucesso) return;

    const marcadosFinais = containerGrupos.querySelectorAll('input:checked');
    marcadosFinais.forEach(input => {
        nomesOpcoesEscolhidas.push(input.dataset.nome);
        precoAcumuladoCalculado += parseFloat(input.dataset.preco) || 0;
    });

    let nomeProdutoCustomizado = produtoSelecionadoAtual.nome;
    if (nomesOpcoesEscolhidas.length > 0) {
        nomeProdutoCustomizado += ` (${nomesOpcoesEscolhidas.join(', ')})`;
    }

    const imgUrl = obterImagemProduto(produtoSelecionadoAtual);
    const idVirtualUnico = `${produtoSelecionadoAtual.id}_v_${Date.now()}`;

    if (typeof window.adicionarAoCarrinho === "function") {
        window.adicionarAoCarrinho(
            idVirtualUnico, 
            nomeProdutoCustomizado, 
            imgUrl, 
            lojaId, 
            nomeLojaGlobal,
            precoAcumuladoCalculado
        );
    } else {
        adicionarAoCarrinho(
            idVirtualUnico, 
            nomeProdutoCustomizado, 
            imgUrl, 
            lojaId, 
            nomeLojaGlobal,
            precoAcumuladoCalculado
        );
    }

    overlayCust.classList.remove('active');
    produtoSelecionadoAtual = null;
};

document.getElementById('btn-fechar-cust').onclick = () => {
    overlayCust.classList.remove('active');
    produtoSelecionadoAtual = null;
};

overlayCust.addEventListener('click', (e) => {
    if (e.target === overlayCust) {
        overlayCust.classList.remove('active');
        produtoSelecionadoAtual = null;
    }
});