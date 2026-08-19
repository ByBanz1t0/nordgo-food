import { db, auth, app, mostrarNotificacao } from './firebase-config.js';
import { 
    collection, 
    doc, 
    getDoc, 
    increment, 
    arrayUnion, 
    serverTimestamp,
    enableIndexedDbPersistence,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-functions.js";

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

// CONSTANTES E ENDPOINTS
const MP_PUBLIC_KEY = 'APP_USR-45368915-aa09-430e-ae3e-7b8530980108';
const URL_CF_PIX = 'https://us-central1-nordgo-food.cloudfunctions.net/criarPagamentoPix';
const URL_CF_CARTAO = 'https://us-central1-nordgo-food.cloudfunctions.net/processarPagamentoMP';

const functions = getFunctions(app);
const calcularTotalServer = httpsCallable(functions, "calcularTotalCarrinho");

// ELEMENTOS DOM
const etapaEnvio = document.getElementById('etapa-1-envio');
const etapaPagamento = document.getElementById('etapa-2-pagamento');
const btnProximaEtapa = document.getElementById('btn-proxima-etapa');
const btnFinalizarPedido = document.getElementById('btn-finalizar-pedido');
const btnVoltarEtapa = document.getElementById('btn-voltar-etapa');
const txtVoltarBotao = document.getElementById('txt-voltar-botao');

const progress1 = document.getElementById('progress-1');
const progress2 = document.getElementById('progress-2');
const line1 = document.getElementById('line-1');

const selectEndereco = document.getElementById('select-endereco-checkout');
const selectPagamento = document.getElementById('select-pagamento-checkout');
const containerTroco = document.getElementById('container-troco-checkout');
const containerCardBrick = document.getElementById('container-card-brick-checkout');
const containerSalvarCartao = document.getElementById('container-salvar-cartao-checkout');
const containerLogisticaLojas = document.getElementById('container-logistica-lojas');

// ESTADO GLOBAL
let usuarioLogado = null;
let etapaAtual = 1;

let itensCarrinho = [];
let lojasAgrupadas = {};
let fretesLojas = {};
let mapaPrecosOficiais = {};
let subtotalValidadoServidor = 0;

let listaEnderecosUsuario = [];
let bairroClienteLogado = "";
let nomeClienteLogado = "";
let enderecoCompletoObjetoSelecionado = null;

let cupomAtivo = JSON.parse(localStorage.getItem('nordgo_cupom_global')) || null;
let cuponsLocaisAtivos = JSON.parse(localStorage.getItem('nordgo_cupons_locais')) || {};

let escolhasLogisticaPorLoja = {};

// Instância e Controlador do Mercado Pago Brick
let mpInstance = null;
let cardPaymentBrickController = null;
let dadosCartaoBrickSubmit = null;

/* ============================================================
   FUNÇÕES UTILITÁRIAS
   ============================================================ */
function escaparHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatarNomeBairro(texto) {
    if (!texto) return "";
    return texto.trim().toLowerCase().split(' ').map(palavra => {
        return palavra.charAt(0).toUpperCase() + palavra.slice(1);
    }).join(' ');
}

/* ============================================================
   AUTENTICAÇÃO E CARREGAMENTO INICIAL
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
    usuarioLogado = user;
    if (!user) {
        window.location.href = "carrinho.html";
        return;
    }

    try {
        const userSnap = await getDoc(doc(db, "usuarios", user.uid));
        if (userSnap.exists()) {
            const d = userSnap.data();
            listaEnderecosUsuario = d.enderecoCliente || [];
            nomeClienteLogado = d.nome || user.displayName || "";
            
            popularSeletorEnderecos();
            popularSeletorCartoes(d.cartoesCliente || []);
        }
    } catch (err) {
        console.error("Erro ao ler dados do perfil:", err);
    }

    await carregarDadosDoCarrinho();
});

function popularSeletorEnderecos() {
    if (!selectEndereco) return;
    selectEndereco.innerHTML = "";
    if (listaEnderecosUsuario.length === 0) {
        selectEndereco.innerHTML = `<option value="">Nenhum endereço cadastrado</option>`;
        bairroClienteLogado = "";
        const txtBairro = document.getElementById('txt-bairro-atual');
        if (txtBairro) txtBairro.innerText = "Abra seu perfil para cadastrar um endereço.";
        return;
    }

    let idxPadrao = listaEnderecosUsuario.findIndex(end => end && (end.padrao === true || end.padrao === "true"));
    if (idxPadrao === -1) idxPadrao = 0;

    const fragment = document.createDocumentFragment();

    listaEnderecosUsuario.forEach((end, idx) => {
        if(!end) return;
        const opt = document.createElement('option');
        opt.value = idx;
        opt.innerText = `${(end.apelido || "Casa").toUpperCase()} - ${end.rua || ""}, ${end.numero || ""}`;
        if (idx === idxPadrao) opt.selected = true;
        fragment.appendChild(opt);
    });

    selectEndereco.appendChild(fragment);
    mudarEnderecoAtivo(idxPadrao);
}

function popularSeletorCartoes(cartoes) {
    const group = document.getElementById('optgroup-cartoes-salvos');
    if (!group) return;
    
    group.innerHTML = `<option value="Pix">Pix</option>`;
    
    if (cartoes && cartoes.length > 0) {
        const fragment = document.createDocumentFragment();
        cartoes.forEach(c => {
            if(!c) return;
            const opt = document.createElement('option');
            opt.value = `Cartão Salvo: ${c.exibicao}`;
            opt.dataset.cardId = c.cardId || c.id;
            opt.dataset.customerId = c.customerId || "";
            opt.innerText = `💳 ${c.exibicao}`;
            fragment.appendChild(opt);
        });
        group.appendChild(fragment);
    }

    const optNovo = document.createElement('option');
    optNovo.value = "novo_cartao";
    optNovo.innerText = "➕ Pagar com Novo Cartão (Crédito/Débito)";
    group.appendChild(optNovo);
}

function mudarEnderecoAtivo(idx) {
    const txtBairro = document.getElementById('txt-bairro-atual');
    if (listaEnderecosUsuario[idx]) {
        enderecoCompletoObjetoSelecionado = listaEnderecosUsuario[idx];
        bairroClienteLogado = enderecoCompletoObjetoSelecionado.bairro || "";
        if (txtBairro) txtBairro.innerText = `${bairroClienteLogado} (${enderecoCompletoObjetoSelecionado.cidade || ""})`;
    } else {
        enderecoCompletoObjetoSelecionado = null;
        bairroClienteLogado = "";
        if (txtBairro) txtBairro.innerText = "Endereço pendente";
    }
}

if (selectEndereco) {
    selectEndereco.addEventListener('change', (e) => {
        mudarEnderecoAtivo(e.target.value);
        recalcularTelasEValores();
    });
}

if (selectPagamento) {
    selectPagamento.addEventListener('change', async (e) => {
        const val = e.target.value;
        
        if (val === 'Dinheiro') {
            containerTroco?.classList.remove('hidden');
        } else {
            containerTroco?.classList.add('hidden');
        }

        if (val === 'novo_cartao') {
            containerCardBrick?.classList.remove('hidden');
            if (containerSalvarCartao) containerSalvarCartao.classList.remove('hidden');
            
            if (!cardPaymentBrickController) {
                await inicializarCardBrick();
            }
        } else {
            containerCardBrick?.classList.add('hidden');
            if (containerSalvarCartao) containerSalvarCartao.classList.add('hidden');
        }
    });
}

/* ============================================================
   INTEGRAÇÃO MERCADO PAGO BRICKS
   ============================================================ */
async function inicializarCardBrick() {
    if (typeof MercadoPago === 'undefined') {
        console.warn("SDK do Mercado Pago não carregado na página.");
        return;
    }

    if (!mpInstance) {
        mpInstance = new MercadoPago(MP_PUBLIC_KEY, {
            locale: 'pt-BR'
        });
    }

    const bricksBuilder = mpInstance.bricks();
    const totalTxt = document.getElementById('checkout-total-final')?.innerText.replace('R$', '').trim().replace(',', '.') || "10.00";
    const valorTotalNum = parseFloat(totalTxt) || 10.00;

    const settings = {
        initialization: {
            amount: valorTotalNum,
            payer: {
                email: usuarioLogado ? usuarioLogado.email : "cliente@nordgo.com",
            },
        },
        customization: {
            visual: {
                style: { theme: "default" },
            },
            paymentMethods: {
                maxInstallments: 12,
            },
        },
        callbacks: {
            onReady: () => { console.log("[Mercado Pago] Brick de Cartão pronto."); },
            onSubmit: (cardFormData) => {
                return new Promise((resolve) => {
                    dadosCartaoBrickSubmit = cardFormData;
                    btnFinalizarPedido.click();
                    resolve();
                });
            },
            onError: (error) => { console.error("[Mercado Pago] Erro no Brick:", error); }
        },
    };

    try {
        cardPaymentBrickController = await bricksBuilder.create(
            "cardPayment",
            "cardPaymentBrick_container",
            settings
        );
    } catch (e) {
        console.error("Erro ao montar o Brick:", e);
    }
}

/* ============================================================
   CARREGAMENTO E AGRUPAMENTO DO CARRINHO
   ============================================================ */
async function carregarDadosDoCarrinho() {
    itensCarrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    if (itensCarrinho.length === 0) {
        window.location.href = "carrinho.html";
        return;
    }

    try {
        const payload = itensCarrinho.map(i => ({ 
            id: i.id,
            precoUnitario: parseFloat(i.preco) || 0,
            quantidade: i.quantidade,
            variacoes: i.variacoes || []
        }));

        const resposta = await calcularTotalServer({ itens: payload });
        const dadosServidor = resposta.data;
        
        if (dadosServidor.itens) {
            dadosServidor.itens.forEach(item => {
                const chave = item.idVirtual || item.id;
                mapaPrecosOficiais[chave] = item.precoUnitario;
            });
        }

    } catch (err) {
        console.error("Erro ao validar valores com servidor, usando fallback:", err);
        itensCarrinho.forEach(i => {
            mapaPrecosOficiais[i.id] = parseFloat(i.preco) || 0;
        });
    }

    lojasAgrupadas = itensCarrinho.reduce((acc, item) => {
        const lid = item.lojaId || 'outros';
        if (!acc[lid]) acc[lid] = [];
        acc[lid].push(item);
        return acc;
    }, {});

    for (const lid in lojasAgrupadas) {
        if (!escolhasLogisticaPorLoja[lid]) {
            escolhasLogisticaPorLoja[lid] = "entrega";
        }

        try {
            const docSnap = await getDoc(doc(db, "lojas", lid)); 
            if (docSnap.exists()) {
                const d = docSnap.data();
                fretesLojas[lid] = {
                    taxasBairros: d.taxasBairros || {},
                    freteMinimoRetroativo: parseFloat(d.frete) || 0,
                    freteGratisMin: parseFloat(d.freteGratisMin) || 0,
                    tempoEntrega: d.tempoEntrega || '20-30',
                    tempoRetirada: d.tempoRetirada || '15-20' 
                };
            } else { 
                fretesLojas[lid] = { taxasBairros: {}, freteMinimoRetroativo: 0, freteGratisMin: 0, tempoEntrega: '20-30', tempoRetirada: '15-20' }; 
            }
        } catch (err) { 
            console.error("Erro ao ler frete no Firestore:", err);
            fretesLojas[lid] = { taxasBairros: {}, freteMinimoRetroativo: 0, freteGratisMin: 0, tempoEntrega: '20-30', tempoRetirada: '15-20' }; 
        }
    }

    renderizarOpcoesDeFretePorLoja();
    recalcularTelasEValores();
}

function renderizarOpcoesDeFretePorLoja() {
    if (!containerLogisticaLojas) return;
    containerLogisticaLojas.innerHTML = "";

    const fragment = document.createDocumentFragment();

    for (const lid in lojasAgrupadas) {
        const itensDaLoja = lojasAgrupadas[lid];
        const nomeLoja = itensDaLoja[0].nomeLoja || "Estabelecimento";
        const escolhaAtual = escolhasLogisticaPorLoja[lid];

        const divLoja = document.createElement('div');
        divLoja.className = "bloco-card-checkout loja-frete-item-card";
        divLoja.innerHTML = `
            <div class="header-loja-checkout-item">
                <h4><i class="fa-solid fa-store"></i> ${escaparHTML(nomeLoja)}</h4>
                <span class="badge-qtd-itens-checkout">${itensDaLoja.length} itens deste local</span>
            </div>
            
            <div class="checkout-grupo-select-interno">
                <label>Como deseja receber os produtos desta loja?</label>
                <select class="select-checkout select-logistica-loja-dinamico" data-lojaid="${escaparHTML(lid)}">
                    <option value="entrega" ${escolhaAtual === 'entrega' ? 'selected' : ''}>Receber em Casa (Delivery)</option>
                    <option value="retirada" ${escolhaAtual === 'retirada' ? 'selected' : ''}>Retirar no Estabelecimento</option>
                </select>
            </div>
            <div class="status-frete-individual-loja" id="txt-status-frete-loja-${escaparHTML(lid)}">
                Calculando frete e tempos...
            </div>
        `;

        divLoja.querySelector('.select-logistica-loja-dinamico').addEventListener('change', (e) => {
            const idDaLoja = e.target.dataset.lojaid;
            escolhasLogisticaPorLoja[idDaLoja] = e.target.value;
            recalcularTelasEValores();
        });

        fragment.appendChild(divLoja);
    }

    containerLogisticaLojas.appendChild(fragment);
}

function obterSubtotalLojaServidor(lid) {
    const itensDaLoja = lojasAgrupadas[lid] || [];
    return itensDaLoja.reduce((acc, i) => {
        let precoOficial = 0;
        if (i.id.includes('_v_')) {
            precoOficial = parseFloat(i.preco) || (mapaPrecosOficiais[i.id] !== undefined ? mapaPrecosOficiais[i.id] : 0);
        } else {
            precoOficial = mapaPrecosOficiais[i.id] !== undefined ? mapaPrecosOficiais[i.id] : (parseFloat(i.preco) || 0);
        }
        return acc + (precoOficial * (i.quantidade || 1));
    }, 0);
}

/* ============================================================
   RECÁLCULO GERAL DE TELA E VALORES
   ============================================================ */
function recalcularTelasEValores() {
    let totalFretesAcumulados = 0;
    let possuiErroDeBairroNaoAtendido = false;
    let novoSubtotalGeral = 0;

    for (const lid in lojasAgrupadas) {
        const subtotalLoja = obterSubtotalLojaServidor(lid);
        novoSubtotalGeral += subtotalLoja;
        
        const configLoja = fretesLojas[lid];
        const tipoDeEnvioEscolhido = escolhasLogisticaPorLoja[lid];
        const txtStatusHtml = document.getElementById(`txt-status-frete-loja-${lid}`);

        if (!txtStatusHtml) continue;

        if (tipoDeEnvioEscolhido === 'retirada') {
            const tempoRet = (configLoja && configLoja.tempoRetirada) ? configLoja.tempoRetirada : '15-20';
            txtStatusHtml.innerHTML = `
                <span class="frete-gratis-txt"><i class="fa-solid fa-person-walking-luggage"></i> Retirada no balcão - Sem custo de frete</span>
                <span class="tempo-estimado-txt"><i class="fa-solid fa-clock"></i> Pronto para retirada em: <strong>${escaparHTML(tempoRet)} min</strong></span>
            `;
        } else {
            if (configLoja) {
                const tempoEnt = configLoja.tempoEntrega || '20-30';

                if (configLoja.freteGratisMin > 0 && subtotalLoja >= configLoja.freteGratisMin) {
                    txtStatusHtml.innerHTML = `
                        <span class="frete-gratis-txt"><i class="fa-solid fa-circle-check"></i> Parabéns! Você ganhou Frete Grátis nesta loja</span>
                        <span class="tempo-estimado-txt"><i class="fa-solid fa-clock"></i> Tempo estimado de entrega: <strong>${escaparHTML(tempoEnt)} min</strong></span>
                    `;
                } else {
                    if (bairroClienteLogado && bairroClienteLogado.trim() !== "") {
                        const bairroFormatado = formatarNomeBairro(bairroClienteLogado);
                        const taxaBairro = configLoja.taxasBairros[bairroFormatado];

                        if (taxaBairro !== undefined) {
                            totalFretesAcumulados += taxaBairro;
                            txtStatusHtml.innerHTML = `
                                <span class="frete-pago-txt"><i class="fa-solid fa-truck"></i> Taxa de entrega para seu bairro: <strong>R$ ${taxaBairro.toFixed(2)}</strong></span>
                                <span class="tempo-estimado-txt"><i class="fa-solid fa-clock"></i> Tempo estimado de entrega: <strong>${escaparHTML(tempoEnt)} min</strong></span>
                            `;
                        } else {
                            possuiErroDeBairroNaoAtendido = true;
                            txtStatusHtml.innerHTML = `<span class="frete-erro-txt"><i class="fa-solid fa-triangle-exclamation"></i> Ops! Esta loja não realiza entregas no bairro ${escaparHTML(bairroFormatado)}</span>`;
                        }
                    } else {
                        totalFretesAcumulados += configLoja.freteMinimoRetroativo;
                        txtStatusHtml.innerHTML = `
                            <span class="frete-pago-txt"><i class="fa-solid fa-truck"></i> Taxa base de entrega: <strong>R$ ${configLoja.freteMinimoRetroativo.toFixed(2)}</strong></span>
                            <span class="tempo-estimado-txt"><i class="fa-solid fa-clock"></i> Tempo estimado de entrega: <strong>${escaparHTML(tempoEnt)} min</strong></span>
                        `;
                    }
                }
            }
        }
    }

    subtotalValidadoServidor = novoSubtotalGeral;

    if (possuiErroDeBairroNaoAtendido) {
        btnProximaEtapa.disabled = true;
        btnProximaEtapa.style.opacity = "0.5";
        btnProximaEtapa.style.cursor = "not-allowed";
    } else {
        btnProximaEtapa.disabled = false;
        btnProximaEtapa.removeAttribute('style');
    }

    let totalDescontos = 0;
    if (cupomAtivo) {
        totalDescontos += cupomAtivo.tipo === "porcentagem" ? (subtotalValidadoServidor * cupomAtivo.valor / 100) : cupomAtivo.valor;
    }
    for (const lid in cuponsLocaisAtivos) {
        const cp = cuponsLocaisAtivos[lid];
        if (lojasAgrupadas[lid]) {
            const subtotalLoja = obterSubtotalLojaServidor(lid);
            totalDescontos += cp.tipo === "porcentagem" ? (subtotalLoja * cp.valor / 100) : cp.valor;
        }
    }

    const linhaDesconto = document.getElementById('linha-checkout-desconto');
    if (totalDescontos > 0) {
        linhaDesconto?.classList.remove('hidden');
        const txtDesc = document.getElementById('checkout-desconto');
        if (txtDesc) txtDesc.innerText = `- R$ ${totalDescontos.toFixed(2)}`;
    } else {
        linhaDesconto?.classList.add('hidden');
    }

    const elSubtotal = document.getElementById('checkout-subtotal');
    const elFrete = document.getElementById('checkout-frete');
    const elTotalFinal = document.getElementById('checkout-total-final');

    if (elSubtotal) elSubtotal.innerText = `R$ ${subtotalValidadoServidor.toFixed(2)}`;
    if (elFrete) elFrete.innerText = totalFretesAcumulados === 0 ? "Grátis" : `R$ ${totalFretesAcumulados.toFixed(2)}`;
    
    const totalFinalCalculado = subtotalValidadoServidor + totalFretesAcumulados - totalDescontos;
    if (elTotalFinal) elTotalFinal.innerText = `R$ ${Math.max(0, totalFinalCalculado).toFixed(2)}`;
}

/* ============================================================
   NAVEGAÇÃO ENTRE ETAPAS
   ============================================================ */
btnProximaEtapa.onclick = () => {
    const precisaDeEndereco = Object.values(escolhasLogisticaPorLoja).includes('entrega');
    if (precisaDeEndereco && !enderecoCompletoObjetoSelecionado) {
        mostrarNotificacao("Por favor, selecione um endereço de entrega válido.", "error");
        return;
    }

    etapaAtual = 2;
    etapaEnvio.classList.add('hidden');
    etapaPagamento.classList.remove('hidden');
    
    btnProximaEtapa.classList.add('hidden');
    btnFinalizarPedido.classList.remove('hidden');

    if (txtVoltarBotao) txtVoltarBotao.innerText = "Envios";

    progress1?.classList.remove('active');
    progress1?.classList.add('completed');
    line1?.classList.add('active');
    progress2?.classList.add('active');
};

btnVoltarEtapa.onclick = () => {
    if (etapaAtual === 1) {
        window.location.href = "carrinho.html";
    } else {
        etapaAtual = 1;
        etapaPagamento.classList.add('hidden');
        etapaEnvio.classList.remove('hidden');
        
        btnFinalizarPedido.classList.add('hidden');
        btnProximaEtapa.classList.remove('hidden');

        if (txtVoltarBotao) txtVoltarBotao.innerText = "Voltar";

        progress2?.classList.remove('active');
        line1?.classList.remove('active');
        progress1?.classList.remove('completed');
        progress1?.classList.add('active');
    }
};

/* ============================================================
   CONFIRMAÇÃO E FINALIZAÇÃO DO PEDIDO
   ============================================================ */
btnFinalizarPedido.onclick = async () => {
    const formaPagamento = selectPagamento.value;
    if (!formaPagamento) { 
        mostrarNotificacao("Por favor, selecione a forma de pagamento.", "error"); 
        return; 
    }

    if (formaPagamento === 'novo_cartao' && !dadosCartaoBrickSubmit) {
        mostrarNotificacao("Por favor, preencha e confirme os dados do cartão no formulário.", "error");
        return;
    }

    btnFinalizarPedido.disabled = true;
    btnFinalizarPedido.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processando...';

    const transacaoId = `TX_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const chavesLojas = Object.keys(lojasAgrupadas);
    let lojaIdTarget = (chavesLojas.length === 1 && chavesLojas[0] !== 'outros') ? chavesLojas[0] : "multiplas_lojas";

    let totalGeralDoCarrinho = 0;
    
    // VARIÁVEIS PARA O ANTI-FRAUDE (COMPATIBILIDADE COM O NOVO BACKEND)
    let todosItensMapeados = [];
    let freteTotalAcumulado = 0;
    let descontoTotalAcumulado = 0;

    for (const lid in lojasAgrupadas) {
        const subtotalLoja = obterSubtotalLojaServidor(lid);
        const tipoDeEnvioEscolhido = escolhasLogisticaPorLoja[lid];

        let freteDaLojaIndividual = 0;
        if (tipoDeEnvioEscolhido === 'entrega') {
            const configLoja = fretesLojas[lid];
            if (configLoja && !(configLoja.freteGratisMin > 0 && subtotalLoja >= configLoja.freteGratisMin)) {
                const bairroFormatado = formatarNomeBairro(bairroClienteLogado);
                freteDaLojaIndividual = configLoja.taxasBairros[bairroFormatado] !== undefined 
                    ? configLoja.taxasBairros[bairroFormatado] 
                    : configLoja.freteMinimoRetroativo;
            }
        }

        let descontoLojaIndividual = 0;
        if (cuponsLocaisAtivos[lid]) {
            const cp = cuponsLocaisAtivos[lid];
            descontoLojaIndividual = cp.tipo === "porcentagem" ? (subtotalLoja * cp.valor / 100) : cp.valor;
        }

        let descontoPlataformaIndividual = 0;
        if (cupomAtivo) {
            const descontoGlobalTotal = cupomAtivo.tipo === "porcentagem" 
                ? (subtotalValidadoServidor * cupomAtivo.valor / 100) 
                : cupomAtivo.valor;
            descontoPlataformaIndividual = (subtotalValidadoServidor > 0) ? (subtotalLoja / subtotalValidadoServidor) * descontoGlobalTotal : 0;
        }

        const totalDevidoAoLojista = Math.max(0, subtotalLoja + freteDaLojaIndividual - descontoLojaIndividual);
        const totalCobradoDoClienteLoja = Math.max(0, totalDevidoAoLojista - descontoPlataformaIndividual);
        totalGeralDoCarrinho += totalCobradoDoClienteLoja;

        // Acumuladores Anti-fraude
        freteTotalAcumulado += freteDaLojaIndividual;
        descontoTotalAcumulado += (descontoLojaIndividual + descontoPlataformaIndividual);

        const itensDaLoja = lojasAgrupadas[lid];
        const itensMapeadosSeguros = itensDaLoja.map(i => {
            const realProdutoId = i.id.includes('_v_') ? i.id.split('_v_')[0] : i.id;
            let precoFinalMapeado = 0;
            if (i.id.includes('_v_')) {
                precoFinalMapeado = parseFloat(i.preco) || mapaPrecosOficiais[i.id] || 0;
            } else {
                precoFinalMapeado = mapaPrecosOficiais[i.id] !== undefined ? mapaPrecosOficiais[i.id] : (parseFloat(i.preco) || 0);
            }
            return {
                id: realProdutoId,
                idVirtual: i.id,
                nome: i.nome,
                preco: precoFinalMapeado,
                quantidade: i.quantidade || 1,
                variacoes: i.variacoes || [] // Necessário para revalidar preço no backend
            };
        });

        todosItensMapeados = todosItensMapeados.concat(itensMapeadosSeguros);
    }

    let taxaPlataformaVigente = 2.0;
    try {
        const configPlataformaSnap = await getDoc(doc(db, "configuracoes", "plataforma"));
        if (configPlataformaSnap.exists() && configPlataformaSnap.data().taxaPorcentagem !== undefined) {
            taxaPlataformaVigente = parseFloat(configPlataformaSnap.data().taxaPorcentagem);
        }
    } catch (errTaxa) {
        console.warn("Falha ao obter taxa vigente, aplicando 2.0%:", errTaxa);
    }

    try {
        let dadosPixRecebidos = null;
        let pagamentoAprovadoCartao = false;

        // 1. TRATAMENTO DE PIX
        if (formaPagamento === 'Pix') {
            mostrarNotificacao("Gerando cobrança Pix unificada...");

            const emailFormatado = (usuarioLogado && usuarioLogado.email && usuarioLogado.email.includes("@")) 
                ? usuarioLogado.email 
                : `cliente_${usuarioLogado.uid}@nordgo.com`;

            // ATUALIZAÇÃO IMPORTANTE PARA ANTI-FRAUDE: enviando dados brutos pro Cloud Functions validar
            const payloadPix = {
                transacaoId: transacaoId,
                totalGeral: parseFloat(totalGeralDoCarrinho.toFixed(2)),
                lojaId: String(lojaIdTarget),
                clientId: usuarioLogado.uid,
                clientNome: nomeClienteLogado || usuarioLogado.displayName || "Cliente NordGo",
                email: emailFormatado,
                itens: todosItensMapeados,
                subtotalClient: subtotalValidadoServidor,
                frete: freteTotalAcumulado,
                desconto: descontoTotalAcumulado
            };

            const respostaServidor = await fetch(URL_CF_PIX, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadPix)
            });

            dadosPixRecebidos = await respostaServidor.json();

            if (!respostaServidor.ok || dadosPixRecebidos.error) {
                throw new Error(dadosPixRecebidos.error || dadosPixRecebidos.detalhes || "Erro na API do Mercado Pago");
            }

            localStorage.setItem('nordgo_render_pix', JSON.stringify(dadosPixRecebidos));
        }

        // 2. TRATAMENTO DE CARTÃO DE CRÉDITO ONLINE
        if (formaPagamento === 'novo_cartao') {
            mostrarNotificacao("Processando transação com a operadora...");

            // ATUALIZAÇÃO IMPORTANTE PARA ANTI-FRAUDE
            const payloadCartao = {
                token: dadosCartaoBrickSubmit.token,
                issuer_id: dadosCartaoBrickSubmit.issuer_id,
                payment_method_id: dadosCartaoBrickSubmit.payment_method_id,
                transaction_amount: parseFloat(Math.max(0, totalGeralDoCarrinho).toFixed(2)),
                installments: Number(dadosCartaoBrickSubmit.installments),
                description: "Pedido NordGo",
                email: dadosCartaoBrickSubmit.payer.email || usuarioLogado.email,
                transacaoId: transacaoId,
                lojaId: String(lojaIdTarget),
                clientId: usuarioLogado.uid,
                itens: todosItensMapeados,
                subtotalClient: subtotalValidadoServidor,
                frete: freteTotalAcumulado,
                desconto: descontoTotalAcumulado
            };

            const respostaCartao = await fetch(URL_CF_CARTAO, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadCartao)
            });

            const resultadoCartao = await respostaCartao.json();

            if (!resultadoCartao.sucesso || resultadoCartao.statusPagamento !== "approved") {
                mostrarNotificacao(resultadoCartao.error || "Cartão recusado ou não autorizado.", "error");
                btnFinalizarPedido.disabled = false;
                btnFinalizarPedido.innerText = 'Finalizar Pedido';
                return;
            }

            pagamentoAprovadoCartao = true;
        }

        const idPagamentoMP = dadosPixRecebidos?.idPagamentoMP ? String(dadosPixRecebidos.idPagamentoMP) : null;
        const pixExpiracaoEm = dadosPixRecebidos?.pixExpiracaoEm || new Date(Date.now() + 5 * 60 * 1000).toISOString();

        const formaPagamentoTexto = (formaPagamento || "").toLowerCase().trim();
        const ehPagamentoOnline = formaPagamentoTexto === "pix" || 
                                   formaPagamentoTexto === "novo_cartao" ||
                                   formaPagamentoTexto.startsWith("cartão salvo") ||
                                   formaPagamentoTexto.startsWith("cartao salvo");

        /* 
        ⚠️ ALERTA DE SEGURANÇA: 
        O trecho abaixo escreve diretamente no banco de dados "pedidos" e "cupons" através do cliente (navegador).
        Para uma plataforma 100% segura contra fraudes locais (ex: pagamentos em dinheiro com valores adulterados 
        no console do navegador), a montagem e gravação final deste "payloadDocPedido" deveria ser movida para uma 
        Cloud Function separada (ex: `exports.criarPedidoSeguro`).
        */
        
        // 3. GRAVAÇÃO ATÔMICA DOS PEDIDOS E CONSUMO DE CUPONS VIA BATCH
        const batchCheckout = writeBatch(db);

        for (const lid in lojasAgrupadas) {
            const itensDaLoja = lojasAgrupadas[lid];
            const subtotalLoja = obterSubtotalLojaServidor(lid);
            const tipoDeEnvioEscolhido = escolhasLogisticaPorLoja[lid];

            let freteDaLojaIndividual = 0;
            if (tipoDeEnvioEscolhido === 'entrega') {
                const configLoja = fretesLojas[lid];
                if (configLoja && !(configLoja.freteGratisMin > 0 && subtotalLoja >= configLoja.freteGratisMin)) {
                    const bairroFormatado = formatarNomeBairro(bairroClienteLogado);
                    freteDaLojaIndividual = configLoja.taxasBairros[bairroFormatado] !== undefined 
                        ? configLoja.taxasBairros[bairroFormatado] 
                        : configLoja.freteMinimoRetroativo;
                }
            }

            let descontoLojaIndividual = 0;
            if (cuponsLocaisAtivos[lid]) {
                const cp = cuponsLocaisAtivos[lid];
                descontoLojaIndividual = cp.tipo === "porcentagem" ? (subtotalLoja * cp.valor / 100) : cp.valor;
                batchCheckout.update(doc(db, "cupons", cp.id), { 
                    usosAtuais: increment(1), 
                    usuariosQueUsaram: arrayUnion(usuarioLogado.uid) 
                });
            }

            let descontoPlataformaIndividual = 0;
            if (cupomAtivo) {
                const descontoGlobalTotal = cupomAtivo.tipo === "porcentagem" 
                    ? (subtotalValidadoServidor * cupomAtivo.valor / 100) 
                    : cupomAtivo.valor;
                descontoPlataformaIndividual = (subtotalValidadoServidor > 0) ? (subtotalLoja / subtotalValidadoServidor) * descontoGlobalTotal : 0;
            }

            const totalDevidoAoLojista = Math.max(0, subtotalLoja + freteDaLojaIndividual - descontoLojaIndividual);
            const totalCobradoDoCliente = Math.max(0, totalDevidoAoLojista - descontoPlataformaIndividual);
            const comissaoNordGoCalculada = parseFloat((subtotalLoja * (taxaPlataformaVigente / 100)).toFixed(2));

            const itensMapeadosSeguros = itensDaLoja.map(i => {
                const realProdutoId = i.id.includes('_v_') ? i.id.split('_v_')[0] : i.id;
                let precoFinalMapeado = 0;
                if (i.id.includes('_v_')) {
                    precoFinalMapeado = parseFloat(i.preco) || mapaPrecosOficiais[i.id] || 0;
                } else {
                    precoFinalMapeado = mapaPrecosOficiais[i.id] !== undefined ? mapaPrecosOficiais[i.id] : (parseFloat(i.preco) || 0);
                }
                return {
                    id: realProdutoId,
                    idVirtual: i.id,
                    nome: i.nome,
                    preco: precoFinalMapeado,
                    quantidade: i.quantidade || 1
                };
            });

            const novoPedidoRef = doc(collection(db, "pedidos"));
            const payloadDocPedido = {
                clientId: usuarioLogado.uid,
                clientNome: nomeClienteLogado || usuarioLogado.displayName || "Cliente NordGo",
                lojaId: lid,
                nomeLoja: itensDaLoja[0].nomeLoja || "Loja Parceira",
                itens: itensMapeadosSeguros,
                subtotal: subtotalLoja,
                frete: freteDaLojaIndividual,
                desconto: descontoLojaIndividual + descontoPlataformaIndividual,
                descontoLoja: descontoLojaIndividual,
                descontoPlataforma: descontoPlataformaIndividual,
                totalLojista: parseFloat(totalDevidoAoLojista.toFixed(2)),
                total: parseFloat(totalCobradoDoCliente.toFixed(2)),
                taxaPlataformaAplicada: taxaPlataformaVigente,
                comissaoNordGoValor: comissaoNordGoCalculada,
                statusRepasse: ehPagamentoOnline ? "isento_split" : "pendente",
                formaPagamento: formaPagamento === 'novo_cartao' ? 'Cartão de Crédito (App)' : formaPagamento,
                troco: formaPagamento === 'Dinheiro' ? (document.getElementById('input-troco-valor')?.value.trim() || "Não precisa") : "Não se aplica",
                tipoEntrega: tipoDeEnvioEscolhido,
                enderecoEntrega: tipoDeEnvioEscolhido === 'entrega' ? enderecoCompletoObjetoSelecionado : "Retirada no Balcão",
                status: pagamentoAprovadoCartao ? "preparo" : "pendente",
                statusPagamento: pagamentoAprovadoCartao ? "pago" : (ehPagamentoOnline ? 'pendente' : 'a_cobrar'),
                transacaoId: transacaoId,
                idPagamentoMP: idPagamentoMP,
                dataCriacao: serverTimestamp()
            };

            if (formaPagamento === 'Pix') {
                payloadDocPedido.pixExpiracaoEm = pixExpiracaoEm;
            }

            batchCheckout.set(novoPedidoRef, payloadDocPedido);
        }

        if (cupomAtivo) {
            batchCheckout.update(doc(db, "cupons", cupomAtivo.id), { 
                usosAtuais: increment(1), 
                usuariosQueUsaram: arrayUnion(usuarioLogado.uid) 
            });
        }

        // 4. SALVAMENTO OPCIONAL DO CARTÃO NO PERFIL DO USUÁRIO
        if (pagamentoAprovadoCartao && document.getElementById('check-salvar-cartao-futuro')?.checked) {
            const bandeira = (dadosCartaoBrickSubmit.payment_method_id || 'card').toLowerCase();
            const ultimos4 = dadosCartaoBrickSubmit.last_four_digits || '****';
            const tipoCard = dadosCartaoBrickSubmit.payment_type_id || 'credit_card';

            const novoCartaoObjeto = {
                cardId: `card_${Date.now()}`,
                customerId: "",
                bandeira: bandeira,
                ultimosDigitos: ultimos4,
                titular: (nomeClienteLogado || "CLIENTE").toUpperCase(),
                tipo: tipoCard,
                exibicao: `${bandeira.toUpperCase()} final ${ultimos4}`,
                padrao: false
            };

            batchCheckout.update(doc(db, "usuarios", usuarioLogado.uid), {
                cartoesCliente: arrayUnion(novoCartaoObjeto)
            });
        }

        await batchCheckout.commit();

        // 5. LIMPEZA DE SESSÃO E REDIRECIONAMENTOS
        localStorage.removeItem('nordgo_carrinho');
        localStorage.removeItem('nordgo_cupom_global');
        localStorage.removeItem('nordgo_cupons_locais');

        if (formaPagamento === 'Pix') {
            mostrarNotificacao("Pix gerado com sucesso! Redirecionando...");
            setTimeout(() => window.location.href = `pagamento.html?transacaoId=${transacaoId}`, 1200);

        } else if (pagamentoAprovadoCartao) {
            mostrarNotificacao("Pagamento aprovado com sucesso! Pedido enviado para a cozinha.");
            setTimeout(() => window.location.href = "../index.html", 1500);

        } else {
            mostrarNotificacao("Parabéns! Seus pedidos foram encaminhados para as cozinhas.");
            setTimeout(() => window.location.href = "../index.html", 1500);
        }

    } catch (err) {
        console.error("Erro crítico no checkout:", err);
        mostrarNotificacao(`Falha ao finalizar pedido: ${err.message || 'Erro de comunicação'}`, "error");
        btnFinalizarPedido.disabled = false;
        btnFinalizarPedido.innerText = 'Finalizar Pedido';
    }
};