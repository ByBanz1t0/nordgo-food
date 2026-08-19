import { auth, db, mostrarNotificacao } from './firebase-config.js';
import { 
    collection, 
    getDocs, 
    query, 
    where, 
    doc, 
    getDoc,
    limit,
    enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { atualizarCarrinhoFlutuante } from './cart-helper.js';

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
const categoriaFiltro = params.get('categoria');
const termoBusca = params.get('busca');

const listaResultados = document.getElementById('lista-resultados');
const titulo = document.getElementById('titulo-pesquisa');
const subtitulo = document.getElementById('subtitulo-pesquisa');

const inputBusca = document.getElementById('input-busca');
if (inputBusca) {
    inputBusca.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && inputBusca.value.trim() !== "") {
            window.location.href = `pesquisa.html?busca=${encodeURIComponent(inputBusca.value.trim())}`;
        }
    });
}

let produtosCarregadosLocais = [];
let produtoSelecionadoAtual = null;
let dadosLocalizacaoUsuario = null;
let fotosCategorias = {};

function formatarNomeCategoria(slug) {
    if (!slug) return '';
    const mapaEspecial = {
        'acai-e-sorvetes': 'Açaí e Sorvetes',
        'doces-e-bolos': 'Doces & Bolos',
        'marmita-e-pf': 'Marmita & PF',
        'hamburguer': 'Hambúrguer',
        'farmacia': 'Farmácia',
        'saudavel': 'Saudável',
        'pizzas': 'Pizzas',
        'pizza': 'Pizzas',
        'pizzarias': 'Pizzarias',
        'pizzaria': 'Pizzarias'
    };
    const slugNormalizado = slug.toLowerCase().trim();
    if (mapaEspecial[slugNormalizado]) {
        return mapaEspecial[slugNormalizado];
    }
    return slugNormalizado
        .replace(/-/g, ' ')
        .replace(/\be\b/g, 'e')
        .replace(/\b\w/g, l => l.toUpperCase());
}

function normalizarTexto(txt) {
    if (!txt) return '';
    return txt.toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/-/g, " ");
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

async function buscarDadosViaCEP(cep) {
    try {
        const cepLimpo = cep.replace(/\D/g, '');
        if (cepLimpo.length !== 8) return null;
        
        const resp = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
        const data = await resp.json();
        
        if (data.erro) return null;
        
        return {
            cidade: data.localidade,
            uf: data.uf,
            bairro: data.bairro
        };
    } catch (err) {
        console.error("Erro ao consultar ViaCEP:", err);
        return null;
    }
}

async function validarLocalizacaoECarregar() {
    try {
        const catSnap = await getDocs(collection(db, "categorias"));
        catSnap.forEach(docCat => {
            const c = docCat.data();
            const nomeCat = (c.nome || "").trim();
            const arquivo = c.fotoArquivo || c.foto || c.imagem || "";
            if (nomeCat && arquivo) {
                fotosCategorias[nomeCat] = arquivo;
                fotosCategorias[nomeCat.toLowerCase()] = arquivo;
            }
        });
    } catch (errCat) {
        console.warn("Erro ao carregar categorias para fallback de imagem:", errCat);
    }

    onAuthStateChanged(auth, async (user) => {
        let cepValido = null;
        const userArea = document.getElementById('user-area');

        if (user) {
            if (userArea) {
                userArea.innerHTML = `
                    <div class="pill-badge" style="cursor: pointer;" onclick="window.location.href='perfil.html'">
                        <i class="fa-regular fa-user"></i>
                        <span class="user-name-text">${user.displayName ? user.displayName.split(' ')[0] : 'Minha Conta'}</span>
                    </div>
                `;
            }

            try {
                const userDoc = await getDoc(doc(db, "usuarios", user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    if (userData.enderecoCliente && Array.isArray(userData.enderecoCliente)) {
                        const enderecoPadrao = userData.enderecoCliente.find(end => end.padrao === true) || userData.enderecoCliente[0];
                        if (enderecoPadrao && enderecoPadrao.cep) {
                            cepValido = enderecoPadrao.cep;
                            localStorage.setItem('nordgo_cep_usuario', cepValido);
                        }
                    }
                }
            } catch (err) {
                console.error("Erro ao sincronizar localização do perfil:", err);
            }
        } else {
            if (userArea) {
                userArea.innerHTML = `
                    <div class="pill-badge" style="cursor: pointer;" onclick="window.location.href='./html/login.html'">
                        <button class="btn-login">
                            <i class="fa-solid fa-arrow-right-to-bracket"></i>
                            <span class="user-name-text">Entrar</span>
                        </button>
                    </div>
                `;
            }
            cepValido = localStorage.getItem('nordgo_cep_usuario');
        }

        if (cepValido) {
            dadosLocalizacaoUsuario = await buscarDadosViaCEP(cepValido);
            if (dadosLocalizacaoUsuario && subtitulo) {
                subtitulo.innerText = `Exibindo opções em ${dadosLocalizacaoUsuario.cidade} - ${dadosLocalizacaoUsuario.uf} (CEP ${cepValido})`;
            } else if (subtitulo) {
                subtitulo.innerText = `Exibindo opções próximas ao CEP ${cepValido}`;
            }
        } else if (subtitulo) {
            subtitulo.innerHTML = `Para ver os estabelecimentos da sua cidade, <a href="login.html" style="color: var(--primary-color, #ff6400); text-decoration: underline;">faça login</a> ou informe seu CEP na página inicial.`;
        }

        executarBusca();
    });
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

function criarCardHorizontalHTML(p, index = 0) {
    const indisponivel = p.disponibilidade === false;
    const imgUrl = obterImagemProduto(p);
    const precoExibicao = calcularPrecoMinimoProduto(p);
    const loadingStrategy = index < 3 ? 'eager' : 'lazy';

    const cliqueAcao = p.temVariacoes 
        ? `window.abrirModalCustomizacao('${p.id}')`
        : `adicionarAoCarrinho('${p.id}', '${p.nome}', '${imgUrl}', '${p.lojaId}', '${p.nomeLoja}')`;

    return `
        <div class="card-produto-horizontal ${indisponivel ? 'prod-esgotado' : ''}" onclick="${p.temVariacoes && !indisponivel ? cliqueAcao : ''}" style="${p.temVariacoes ? 'cursor:pointer;' : ''}">
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
                    </div>
                    <p class="nome-loja-vendedora-tag" onclick="event.stopPropagation(); window.location.href='loja.html?loja=${p.lojaId}'">
                        <i class="fa-solid fa-store"></i> ${p.nomeLoja}
                    </p>
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
                        </button>` : ''}
                        
                    <span class="status-badge ${indisponivel ? 'status-indisponivel' : 'status-disponivel'}">
                        <i class="fa-solid ${indisponivel ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> 
                        ${indisponivel ? 'Indisponível' : 'Disponível'}
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

window.abrirModalDescricao = (idProduto) => {
    const prod = produtosCarregadosLocais.find(item => item.id === idProduto);
    if (!prod) return;

    if (txtTituloDesc) txtTituloDesc.innerText = prod.nome;
    if (txtLojaDesc) txtLojaDesc.innerText = prod.nomeLoja || "Estabelecimento";
    if (txtCorpoDesc) txtCorpoDesc.innerText = prod.descricao || 'Este produto não possui uma descrição detalhada.';

    if (modalDesc) modalDesc.classList.add('active');
};

const fecharModalDesc = () => {
    if (modalDesc) modalDesc.classList.remove('active');
};

if (btnFecharDesc) btnFecharDesc.onclick = fecharModalDesc;

if (modalDesc) {
    modalDesc.addEventListener('click', (e) => {
        if (e.target === modalDesc) fecharModalDesc();
    });
}

async function executarBusca() {
    atualizarCarrinhoFlutuante();
    try {
        const qLojasAtivas = query(collection(db, "lojas"), where("status", "==", "aprovado"));
        const qProdutosLimitados = query(collection(db, "produtos"), limit(100));

        const [snapshotLojas, snapshotProdutos] = await Promise.all([
            getDocs(qLojasAtivas),
            getDocs(qProdutosLimitados)
        ]);

        let todasLojas = [];
        let produtos = [];

        snapshotLojas.forEach(docSnap => todasLojas.push({ id: docSnap.id, ...docSnap.data(), tipo: 'loja' }));

        let lojas = todasLojas.filter(l => {
            if (!dadosLocalizacaoUsuario || !dadosLocalizacaoUsuario.cidade) return true;
            
            const cidadeUser = normalizarTexto(dadosLocalizacaoUsuario.cidade);
            const cidadeLoja = normalizarTexto(l.cidade || l.endereco?.cidade || l.municipio || l.bairro || '');
            
            if (!cidadeLoja) return true;
            return cidadeLoja.includes(cidadeUser) || cidadeUser.includes(cidadeLoja);
        });

        const lojasAprovadasIds = new Set(lojas.map(l => l.id));

        snapshotProdutos.forEach(docSnap => {
            const dadosProduto = docSnap.data();
            if (lojasAprovadasIds.has(dadosProduto.lojaId)) {
                const lojaDono = lojas.find(l => l.id === dadosProduto.lojaId);
                produtos.push({ 
                    id: docSnap.id, 
                    ...dadosProduto, 
                    nomeLoja: lojaDono ? lojaDono.nome : 'Estabelecimento',
                    tipo: 'produto' 
                });
            }
        });

        produtosCarregadosLocais = produtos;

        const catUrl = categoriaFiltro ? normalizarTexto(categoriaFiltro) : null;
        const buscaUrl = termoBusca ? normalizarTexto(termoBusca) : null;
        const raizCat = catUrl ? catUrl.slice(0, 4) : ''; 

        let resultadosFinais = [];

        if (categoriaFiltro) {
            const nomeExibicao = formatarNomeCategoria(categoriaFiltro);
            if (titulo) titulo.innerText = `Categoria: ${nomeExibicao}`;

            resultadosFinais = [
                ...lojas.filter(l => {
                    const catLoja = normalizarTexto(l.categoria || '');
                    const slugLoja = normalizarTexto(l.slugCategoria || '');
                    return catLoja.includes(catUrl) || slugLoja.includes(catUrl) || 
                           (raizCat.length >= 4 && (catLoja.includes(raizCat) || slugLoja.includes(raizCat)));
                }),
                ...produtos.filter(p => {
                    const catProd = normalizarTexto(p.categoria || '');
                    const slugProd = normalizarTexto(p.slugCategoria || '');
                    return catProd.includes(catUrl) || slugProd.includes(catUrl) ||
                           (raizCat.length >= 4 && (catProd.includes(raizCat) || slugProd.includes(raizCat)));
                })
            ];
        } else if (buscaUrl) {
            if (titulo) titulo.innerText = `Buscando por: "${termoBusca}"`;
            if (inputBusca) inputBusca.value = termoBusca;
            resultadosFinais = [
                ...lojas.filter(l => normalizarTexto(l.nome).includes(buscaUrl) || normalizarTexto(l.categoria).includes(buscaUrl)),
                ...produtos.filter(p => normalizarTexto(p.nome).includes(buscaUrl) || normalizarTexto(p.categoria).includes(buscaUrl))
            ];
        }

        renderizarResultados(resultadosFinais);
    } catch (e) {
        console.error("Erro na busca:", e);
        if (listaResultados) listaResultados.innerHTML = "<p>Erro ao processar busca.</p>";
    }
}

function renderizarResultados(resultados) {
    if (!listaResultados) return;
    listaResultados.innerHTML = "";

    if (resultados.length === 0) {
        listaResultados.innerHTML = "<p class='placeholder-text'>Nenhum resultado encontrado para esta pesquisa nesta região.</p>";
        return;
    }

    const fragmentGlobal = document.createDocumentFragment();

    const lojasOrdenadas = resultados.filter(item => item.tipo === 'loja');
    const produtosOrdenadas = resultados.filter(item => item.tipo === 'produto');

    if (lojasOrdenadas.length > 0) {
        const secaoLojas = document.createElement('div');
        secaoLojas.innerHTML = `<h3 class="section-divider">Lojas encontradas</h3>`;
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'horizontal-scroll-container';
        
        lojasOrdenadas.forEach((item, idx) => {
            const rawLogo = item.logoUrl || item.logoLoja || '../assets/images/default-loja.png';
            const logoUrl = formatarUrlImagem(rawLogo);
            const loadingStrategy = idx < 3 ? 'eager' : 'lazy';

            const estiloBanner = item.bannerLoja && item.bannerLoja.trim() !== ""
                ? `background-image: url('${formatarUrlImagem(item.bannerLoja)}'); background-size: cover; background-position: center;`
                : `background-color: ${item.temaLoja || '#ff6400'};`;

            const cardLojaDiv = document.createElement('div');
            cardLojaDiv.className = 'card-loja scroll-item';
            cardLojaDiv.onclick = () => window.location.href = `loja.html?loja=${item.id}`;

            cardLojaDiv.innerHTML = `
                <div class="banner-loja" style="${estiloBanner}">
                    <img src="${logoUrl}" 
                         class="logo-loja" 
                         alt="${item.nome}" 
                         loading="${loadingStrategy}"
                         onerror="if (this.src !== window.location.origin + '/assets/images/default-loja.png') { this.src='../assets/images/default-loja.png'; }">
                </div>
                <div class="info-loja">
                    <h3>${item.nome}</h3>
                    <p><i class="fa-solid fa-star" style="color: #ffa502;"></i> ${item.avaliacao || '4.5'} • ${item.categoria}</p>
                </div>`;
            scrollContainer.appendChild(cardLojaDiv);
        });
        secaoLojas.appendChild(scrollContainer);
        fragmentGlobal.appendChild(secaoLojas);
    }

    if (produtosOrdenadas.length > 0) {
        const secaoProdutos = document.createElement('div');
        secaoProdutos.innerHTML = `<h3 class="section-divider">Produtos encontrados</h3>`;
        
        const gridProdutos = document.createElement('div');
        gridProdutos.className = 'grid-produtos-detalhado';
        
        let htmlProdutos = "";
        produtosOrdenadas.forEach((item, idx) => {
            htmlProdutos += criarCardHorizontalHTML(item, idx);
        });
        
        gridProdutos.innerHTML = htmlProdutos;
        secaoProdutos.appendChild(gridProdutos);
        fragmentGlobal.appendChild(secaoProdutos);
    }

    listaResultados.appendChild(fragmentGlobal);
}

const overlayCust = document.getElementById('modal-customizar-produto');
const containerGrupos = document.getElementById('container-grupos-customizacao');
const txtPrecoModal = document.getElementById('txt-preco-dinamico-modal');

window.abrirModalCustomizacao = (idProduto) => {
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

            containerInputs.appendChild(divOpcao);
        });

        fragGrupos.appendChild(divGrupo);
    });

    containerGrupos.appendChild(fragGrupos);

    atualizarPrecoDinamicoModal();
    if (overlayCust) overlayCust.classList.add('active');
};

function atualizarPrecoDinamicoModal() {
    if (!produtoSelecionadoAtual) return;

    let precoAcumulado = parseFloat(produtoSelecionadoAtual.preco) || 0;
    const inputsMarcados = containerGrupos.querySelectorAll('input:checked');

    inputsMarcados.forEach(input => {
        precoAcumulado += parseFloat(input.dataset.preco) || 0;
    });

    if (txtPrecoModal) {
        txtPrecoModal.innerText = precoAcumulado.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
    }
}

const btnConfirmarCust = document.getElementById('btn-confirmar-customizacao');
if (btnConfirmarCust) {
    btnConfirmarCust.onclick = () => {
        if (!produtoSelecionadoAtual) return;

        const gruposConfig = produtoSelecionadoAtual.grupoDeOpcoes || [];
        let validacaoSucesso = true;
        let nomesOpcoesEscolhidas = [];

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
                produtoSelecionadoAtual.lojaId, 
                produtoSelecionadoAtual.nomeLoja
            );
        } else if (typeof adicionarAoCarrinho === "function") {
            adicionarAoCarrinho(
                idVirtualUnico, 
                nomeProdutoCustomizado, 
                imgUrl, 
                produtoSelecionadoAtual.lojaId, 
                produtoSelecionadoAtual.nomeLoja
            );
        }

        if (overlayCust) overlayCust.classList.remove('active');
        produtoSelecionadoAtual = null;
    };
}

const btnFecharCust = document.getElementById('btn-fechar-cust');
if (btnFecharCust) {
    btnFecharCust.onclick = () => {
        if (overlayCust) overlayCust.classList.remove('active');
        produtoSelecionadoAtual = null;
    };
}

if (overlayCust) {
    overlayCust.addEventListener('click', (e) => {
        if (e.target === overlayCust) {
            overlayCust.classList.remove('active');
            produtoSelecionadoAtual = null;
        }
    });
}

validarLocalizacaoECarregar();