import { auth, db, storage, mostrarNotificacao } from './firebase-config.js';
import { ref, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import { 
    doc, getDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, query, where, onSnapshot, increment, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-functions.js";

// URLs e Constantes do Sistema
const URL_GESTAO = 'https://gestao.nordgo.com.br/html/login.html';
const URL_CF_AUTH_MP = 'https://us-central1-nordgo-food.cloudfunctions.net/trocarCodeMpToken';
const MP_CLIENT_ID = "6104758834234567"; 
const MP_REDIRECT_URI = "https://nordgo.com.br/html/perfil-loja.html";

/* ============================================================
   ESTADO GLOBAL DA APLICAÇÃO
   ============================================================ */
let idLojaGlobal = "";
let horariosFuncionamentoLocal = {};
let logisticaCidadesLocal = {};
let databaseRegionalLocal = {};
let listaPedidosLocal = []; 
let filtroAbaPedidos = "ativos"; 
let filtroAbaRepasses = "todos";

let idsPedidosAlertados = new Set();
let primeiraCargaRealtime = true;
let instanciaGraficoFaturamento = null;
let unsubscribeMonitorPixRepasse = null;
let audioCtxGlobal = null;

const gridMain = document.getElementById('grid-main');
const tituloLoja = document.getElementById('nome-loja-titulo');

let base64LogoCurrent = null;
let base64BannerCurrent = null;
let base64AddProdutoCurrent = null;
let base64EditProdutoCurrent = null;
let fotosCategorias = {};

const diasDaSemanaChaves = [
    { id: "seg", nome: "Segunda-feira" },
    { id: "ter", nome: "Terça-feira" },
    { id: "qua", nome: "Quarta-feira" },
    { id: "qui", nome: "Quinta-feira" },
    { id: "sex", nome: "Sexta-feira" },
    { id: "sab", nome: "Sábado" },
    { id: "dom", nome: "Domingo" }
];

/* ============================================================
   FUNÇÕES UTILITÁRIAS
   ============================================================ */

/**
 * Sanitiza strings para prevenir vulnerabilidades de XSS
 */
function escaparHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Converte diferentes formatos de data do Firestore/JS para Date
 */
function converterTimestamp(campo) {
    if (!campo) return new Date();
    if (typeof campo.toDate === 'function') return campo.toDate();
    if (campo.seconds) return new Date(campo.seconds * 1000);
    const d = new Date(campo);
    return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Calcula o menor preço possível considerando a soma das menores opções de grupos OBRIGATÓRIOS
 */
function calcularMenorPrecoVariacoes(grupos) {
    if (!grupos || !Array.isArray(grupos) || grupos.length === 0) return 0;
    let menorPrecoAcumulado = 0;

    grupos.forEach(grupo => {
        if (grupo.obrigatorio && grupo.opcoes && Array.isArray(grupo.opcoes) && grupo.opcoes.length > 0) {
            const precosValidos = grupo.opcoes
                .map(op => parseFloat(op.precoAdicional))
                .filter(val => !isNaN(val) && val >= 0);

            if (precosValidos.length > 0) {
                const menorDoGrupo = Math.min(...precosValidos);
                menorPrecoAcumulado += menorDoGrupo;
            }
        }
    });

    return Math.max(0, parseFloat(menorPrecoAcumulado.toFixed(2)));
}

/**
 * Redimensiona e compacta imagens no cliente antes do upload
 */
function compactarEPadronizarImagem(arquivoOriginal, larguraMaxima = 800, qualidade = 0.8) {
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

/**
 * Redimensiona, enquadra e compacta banners de loja no padrão 5:1 (1800x360)
 */
function compactarBannerPanoramico5x1(arquivoOriginal, larguraAlvo = 1800, alturaAlvo = 360, qualidade = 0.8) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.readAsDataURL(arquivoOriginal);

        leitor.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = larguraAlvo;
                canvas.height = alturaAlvo;
                const ctx = canvas.getContext('2d');

                const proporcaoAlvo = larguraAlvo / alturaAlvo;
                const proporcaoImg = img.width / img.height;

                let sWidth, sHeight, sx, sy;

                if (proporcaoImg > proporcaoAlvo) {
                    sHeight = img.height;
                    sWidth = img.height * proporcaoAlvo;
                    sx = (img.width - sWidth) / 2;
                    sy = 0;
                } else {
                    sWidth = img.width;
                    sHeight = img.width / proporcaoAlvo;
                    sx = 0;
                    sy = (img.height - sHeight) / 2;
                }

                ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, larguraAlvo, alturaAlvo);

                const webpBase64 = canvas.toDataURL('image/webp', qualidade);
                resolve(webpBase64);
            };

            img.onerror = (error) => reject(error);
        };

        leitor.onerror = (error) => reject(error);
    });
}

/**
 * Emite alerta sonoro de novo pedido reaproveitando a instância de AudioContext
 */
function tocarSomNovoPedido() {
    try {
        if (!audioCtxGlobal) {
            audioCtxGlobal = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtxGlobal.state === 'suspended') {
            audioCtxGlobal.resume();
        }

        const osc = audioCtxGlobal.createOscillator();
        const gain = audioCtxGlobal.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtxGlobal.currentTime); 
        osc.frequency.setValueAtTime(880, audioCtxGlobal.currentTime + 0.15); 

        gain.gain.setValueAtTime(0.3, audioCtxGlobal.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtxGlobal.currentTime + 0.6);

        osc.connect(gain);
        gain.connect(audioCtxGlobal.destination);

        osc.start();
        osc.stop(audioCtxGlobal.currentTime + 0.6);
    } catch (e) {
        console.warn("Áudio aguardando interação do usuário na página:", e);
    }
}

/* ============================================================
   FUNÇÃO DE EXCLUSÃO SEGURA NO FIREBASE STORAGE
   ============================================================ */
async function deletarArquivoStoragePorUrl(urlArquivo) {
    if (!urlArquivo || typeof urlArquivo !== 'string' || !urlArquivo.includes('firebasestorage.googleapis.com')) {
        return;
    }
    try {
        const refArquivo = ref(storage, urlArquivo);
        await deleteObject(refArquivo);
    } catch (error) {
        console.warn("Aviso ao remover arquivo do Storage:", error.message);
    }
}

/* ============================================================
   CONTROLE DE MODAIS E NAVEGAÇÃO
   ============================================================ */
const btnVoltarIndex = document.getElementById('btn-voltar-index');
if (btnVoltarIndex) {
    btnVoltarIndex.onclick = () => { window.location.href = '../index.html'; };
}

window.abrirModal = (id) => document.getElementById(id)?.classList.add('active');
window.fecharModal = (id) => document.getElementById(id)?.classList.remove('active');

document.getElementById('btn-fechar-modal-info')?.addEventListener('click', () => window.fecharModal('modal-info'));
document.getElementById('btn-fechar-modal-frete')?.addEventListener('click', () => window.fecharModal('modal-frete'));
document.getElementById('btn-fechar-modal-horarios')?.addEventListener('click', () => window.fecharModal('modal-horarios'));
document.getElementById('btn-fechar-modal-produtos')?.addEventListener('click', () => window.fecharModal('modal-produtos'));
document.getElementById('btn-fechar-modal-add-produto')?.addEventListener('click', () => window.fecharModal('modal-add-produto'));
document.getElementById('btn-fechar-modal-editar-produto')?.addEventListener('click', () => window.fecharModal('modal-editar-produto'));
document.getElementById('btn-fechar-modal-cupons')?.addEventListener('click', () => window.fecharModal('modal-cupons'));
document.getElementById('btn-fechar-modal-add-cupom')?.addEventListener('click', () => window.fecharModal('modal-add-cupom'));
document.getElementById('btn-fechar-modal-repasses')?.addEventListener('click', () => window.fecharModal('modal-repasses-financeiros'));
document.getElementById('btn-fechar-modal-pagar-repasse')?.addEventListener('click', () => {
    window.fecharModal('modal-pagar-repasse-pix');
    if (unsubscribeMonitorPixRepasse) {
        unsubscribeMonitorPixRepasse();
        unsubscribeMonitorPixRepasse = null;
    }
});
document.getElementById('btn-fechar-modal-motivo')?.addEventListener('click', () => window.fecharModal('modal-motivo-cancelamento'));
document.getElementById('btn-voltar-modal-cancelar')?.addEventListener('click', () => window.fecharModal('modal-motivo-cancelamento'));

document.getElementById('btn-abrir-criar-cupom')?.addEventListener('click', () => {
    window.fecharModal('modal-cupons');
    window.abrirModal('modal-add-cupom');
});

/* ============================================================
   LÓGICA DE CONEXÃO E OAUTH COM MERCADO PAGO
   ============================================================ */
function inicializarEventosMercadoPago() {
    const btnConectarMp = document.getElementById('btn-conectar-mp');
    if (btnConectarMp) {
        btnConectarMp.onclick = () => {
            if (!MP_CLIENT_ID || MP_CLIENT_ID === "SEU_CLIENT_ID_AQUI") {
                mostrarNotificacao("Client ID do Mercado Pago não configurado no sistema.", "error");
                return;
            }
            const urlAuthMp = `https://auth.mercadopago.com.br/authorization?client_id=${MP_CLIENT_ID}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(MP_REDIRECT_URI)}`;
            window.location.href = urlAuthMp;
        };
    }
}

async function checarRetornoOAuthMercadoPago() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code && idLojaGlobal) {
        mostrarNotificacao("Vinculando conta do Mercado Pago...", "info");
        
        try {
            const response = await fetch(URL_CF_AUTH_MP, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: code,
                    redirectUri: MP_REDIRECT_URI,
                    lojaId: idLojaGlobal
                })
            });

            const data = await response.json();

            if (data.sucesso) {
                mostrarNotificacao("Conta do Mercado Pago conectada com sucesso!");
                window.history.replaceState({}, document.title, window.location.pathname);
                await carregarDadosLoja();
            } else {
                mostrarNotificacao("Falha ao vincular conta do Mercado Pago.", "error");
            }
        } catch (err) {
            console.error("Erro OAuth MP:", err);
            mostrarNotificacao("Erro de comunicação ao vincular conta.", "error");
        }
    }
}

function atualizarStatusCardMp(lojaData) {
    const txtLegenda = document.getElementById('txt-mp-status-legenda');
    const btnConectar = document.getElementById('btn-conectar-mp');

    if (lojaData && lojaData.mpConectado && lojaData.mpUserId) {
        if (txtLegenda) {
            txtLegenda.innerHTML = `<span style="color: #2ed573; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Conta Conectada (ID MP: ${escaparHTML(lojaData.mpUserId)})</span>`;
        }
        if (btnConectar) {
            btnConectar.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Reconectar`;
            btnConectar.style.background = "#747d8c";
        }
    } else {
        if (txtLegenda) {
            txtLegenda.innerText = "Conecte sua conta para receber o valor das vendas via Pix.";
        }
        if (btnConectar) {
            btnConectar.innerHTML = `<i class="fa-solid fa-link"></i> Conectar Mercado Pago`;
            btnConectar.style.background = "#009ee3";
        }
    }
}

function renderizarDashboard() {
    if (!gridMain) return;
    gridMain.innerHTML = `
        <div class="card-dash" id="card-btn-info"><i class="fa-solid fa-store"></i><h3>Informações</h3><p>Nome, Banner e CEP</p></div>
        <div class="card-dash" id="card-btn-frete"><i class="fa-solid fa-truck-fast"></i><h3>Entregas</h3><p>Bairros e taxas</p></div>
        <div class="card-dash" id="card-btn-horarios"><i class="fa-solid fa-clock"></i><h3>Horários</h3><p>Status e horários semanais</p></div>
        <div class="card-dash" id="card-btn-repasses"><i class="fa-solid fa-hand-holding-dollar"></i><h3>Repasses</h3><p>Acerto com a plataforma</p></div>
        <div class="card-dash" id="card-btn-add-prod"><i class="fa-solid fa-circle-plus"></i><h3>Novo Produto</h3><p>Cadastrar rápido</p></div>
        <div class="card-dash" id="card-btn-menu"><i class="fa-solid fa-utensils"></i><h3>Cardápio</h3><p>Editar e excluir itens</p></div>
        <div class="card-dash" id="card-btn-cupons"><i class="fa-solid fa-ticket"></i><h3>Cupons</h3><p>Criar e remover cupons</p></div>
        <div class="card-dash card-destaque-gestao" id="card-abrir-gestao">
            <span class="badge-card-destaque">SISTEMA</span>
            <i class="fa-solid fa-desktop icone-gestao-animado"></i>
            <h3>Gestão Avançada</h3>
            <p>PDV, Mesas, Comandas e Estoque</p>
        </div>
    `;

    document.getElementById('card-btn-info').onclick = () => window.abrirModal('modal-info');
    document.getElementById('card-btn-frete').onclick = () => window.abrirModal('modal-frete');
    document.getElementById('card-btn-horarios').onclick = () => window.abrirModal('modal-horarios');
    document.getElementById('card-btn-repasses').onclick = () => window.abrirModal('modal-repasses-financeiros');
    document.getElementById('card-btn-add-prod').onclick = () => window.abrirModal('modal-add-produto');
    document.getElementById('card-btn-menu').onclick = () => window.abrirGerenciadorProdutos();
    document.getElementById('card-btn-cupons').onclick = () => window.abrirGerenciadorCupons();
    
    document.getElementById('card-abrir-gestao').onclick = () => {
        window.open(URL_GESTAO, '_blank');
    };
    
    const gatilhoExcluirModal = document.getElementById('btn-excluir-loja-modal');
    if (gatilhoExcluirModal) {
        gatilhoExcluirModal.onclick = () => window.excluirLojaCompleta();
    }
}

/* ============================================================
   EXCLUSÃO COMPLETA DA LOJA (OTIMIZADA COM BATCH)
   ============================================================ */
window.excluirLojaCompleta = async () => {
    const user = auth.currentUser;
    if (!user || !idLojaGlobal) return;

    const confirmacao1 = confirm("Tem certeza absoluta de que deseja excluir sua loja permanentemente?\n\nEsta ação apagará todo o seu cardápio, fotos cadastradas, cupons ativos e configurações logísticas!");
    if (!confirmacao1) return;

    const confirmacao2 = confirm("Aviso Final: Os dados financeiros históricos continuarão salvos para auditoria, mas todas as fotos serão limpas e o acesso será revogado. Deseja prosseguir?");
    if (!confirmacao2) return;

    try {
        mostrarNotificacao("Iniciando processo de exclusão e faxina...", "info");

        const batch = writeBatch(db);

        // 1. Limpeza de Produtos e Fotos associadas
        const qProdutos = query(collection(db, "produtos"), where("lojaId", "==", idLojaGlobal));
        const snapProdutos = await getDocs(qProdutos);
        
        const promessasDelecaoStorage = [];
        snapProdutos.docs.forEach(docSnap => {
            const prodData = docSnap.data();
            if (prodData.imagem) {
                promessasDelecaoStorage.push(deletarArquivoStoragePorUrl(prodData.imagem));
            }
            batch.delete(doc(db, "produtos", docSnap.id));
        });

        // 2. Limpeza de Cupons
        const qCupons = query(collection(db, "cupons"), where("lojaId", "==", idLojaGlobal));
        const snapCupons = await getDocs(qCupons);
        snapCupons.docs.forEach(docSnap => {
            batch.delete(doc(db, "cupons", docSnap.id));
        });

        // 3. Limpeza das fotos principais da Loja
        const snapLoja = await getDoc(doc(db, "lojas", idLojaGlobal));
        if (snapLoja.exists()) {
            const dadosLoja = snapLoja.data();
            if (dadosLoja.logoUrl) promessasDelecaoStorage.push(deletarArquivoStoragePorUrl(dadosLoja.logoUrl));
            if (dadosLoja.bannerLoja) promessasDelecaoStorage.push(deletarArquivoStoragePorUrl(dadosLoja.bannerLoja));
        }

        // Executar remoção de fotos no Storage em paralelo
        await Promise.all(promessasDelecaoStorage);

        // 4. Deletar documento da loja e desvincular do usuário
        batch.update(doc(db, "usuarios", user.uid), { loja: null });
        batch.delete(doc(db, "lojas", idLojaGlobal));

        await batch.commit();

        mostrarNotificacao("Sua loja e todos os registros associados foram excluídos com sucesso.");
        setTimeout(() => { window.location.href = "../index.html"; }, 1500);

    } catch (error) {
        console.error("Erro crítico no fluxo de exclusão da loja:", error);
        mostrarNotificacao("Falha ao excluir o estabelecimento.", "error");
    }
};

/* ============================================================
   CARREGAMENTO DE REGIÕES E LOGÍSTICA
   ============================================================ */
async function carregarRegioesDoBanco() {
    try {
        const snap = await getDocs(collection(db, "regioes"));
        databaseRegionalLocal = {};
        snap.forEach(docSnap => { databaseRegionalLocal[docSnap.id] = docSnap.data().bairros || []; });
    } catch (err) { console.error("Erro ao carregar regiões:", err); }
}

function atualizarTextoCidadesSelecionadas() {
    const citiesAtivas = Object.keys(logisticaCidadesLocal).sort();
    const txtSpan = document.getElementById('texto-cidades-selecionadas');
    if (!txtSpan) return;
    
    if (citiesAtivas.length === 0) {
        txtSpan.innerText = "Selecionar cidades...";
        txtSpan.style.color = "#a4b0be";
    } else {
        txtSpan.innerText = citiesAtivas.join(", ");
        txtSpan.style.color = "#2f3542";
    }
}

function inicializerCheckboxesCidades() {
    const wrapper = document.getElementById('wrapper-checkboxes-cidades');
    if (!wrapper) return;
    wrapper.innerHTML = "";

    Object.keys(databaseRegionalLocal).forEach(cidade => {
        const checked = logisticaCidadesLocal[cidade] ? "checked" : "";
        const cidLimpa = cidade.replace(/\s+/g, '');
        const div = document.createElement('div');
        div.className = "checkbox-cidade-item";
        div.innerHTML = `
            <input type="checkbox" id="check-cidade-${cidLimpa}" value="${escaparHTML(cidade)}" ${checked}>
            <label for="check-cidade-${cidLimpa}">${escaparHTML(cidade)}</label>
        `;
        wrapper.appendChild(div);

        div.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) {
                logisticaCidadesLocal[cidade] = logisticaCidadesLocal[cidade] || { tempoMin: 40, tempoMax: 80, bairros: {} };
            } else {
                delete logisticaCidadesLocal[cidade];
            }
            renderizarPaineisCidadesAtivas();
            atualizarTextoCidadesSelecionadas();
        });
    });
    atualizarTextoCidadesSelecionadas();
}

function renderizarPaineisCidadesAtivas() {
    const container = document.getElementById('container-logistica-cidades-actives');
    if (!container) return;
    container.innerHTML = "";

    const citiesAtivas = Object.keys(logisticaCidadesLocal).sort();

    if (citiesAtivas.length === 0) {
        container.innerHTML = `<p class="logistica-vazia-text">Nenhuma cidade em rota logística.</p>`;
        return;
    }

    citiesAtivas.forEach(cidade => {
        const cidLimpa = cidade.replace(/\s+/g, '');
        const dadosCidade = logisticaCidadesLocal[cidade];
        const cardCidade = document.createElement('div');
        cardCidade.className = "card-logistica-cidade-painel";
        
        let html = `
            <div class="header-cidade-painel">
                <h4><i class="fa-solid fa-city"></i> ${escaparHTML(cidade)}</h4>
                <div class="inputs-tempo-entrega">
                    <i class="fa-solid fa-stopwatch"></i>
                    <input type="number" id="time-min-${cidLimpa}" value="${dadosCidade.tempoMin || 40}" min="1" placeholder="Min">
                    <span>a</span>
                    <input type="number" id="time-max-${cidLimpa}" value="${dadosCidade.tempoMax || 80}" min="1" placeholder="Max">
                    <span class="unidade-tempo">min</span>
                </div>
            </div>
            <div class="grade-bairros-logistica">
        `;

        const bairrosDaCidade = databaseRegionalLocal[cidade] || [];
        bairrosDaCidade.forEach(bairro => {
            const bairroLimpo = bairro.replace(/\s+/g, '');
            const dadosBairro = dadosCidade.bairros[bairro] || { ativo: false, taxa: 0 };
            const checkedBairro = dadosBairro.active || dadosBairro.ativo ? "checked" : "";
            
            html += `
                <div class="bairro-logistica-row">
                    <div class="bairro-check-block">
                        <input type="checkbox" id="check-bairro-${cidLimpa}-${bairroLimpo}" ${checkedBairro}>
                        <label for="check-bairro-${cidLimpa}-${bairroLimpo}">${escaparHTML(bairro)}</label>
                    </div>
                    <div class="bairro-taxa-block">
                        <span>R$</span>
                        <input type="number" id="taxa-bairro-${cidLimpa}-${bairroLimpo}" step="0.01" min="0" placeholder="0.00" value="${dadosBairro.taxa ? Math.max(0, dadosBairro.taxa).toFixed(2) : '0.00'}" ${dadosBairro.ativo || dadosBairro.active ? '' : 'disabled'}>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        cardCidade.innerHTML = html;
        container.appendChild(cardCidade);

        document.getElementById(`time-min-${cidLimpa}`).oninput = (e) => dadosCidade.tempoMin = Math.max(1, parseInt(e.target.value) || 0);
        document.getElementById(`time-max-${cidLimpa}`).oninput = (e) => dadosCidade.tempoMax = Math.max(1, parseInt(e.target.value) || 0);

        bairrosDaCidade.forEach(bairro => {
            const bairroLimpo = bairro.replace(/\s+/g, '');
            const checkBairro = document.getElementById(`check-bairro-${cidLimpa}-${bairroLimpo}`);
            const inputTaxa = document.getElementById(`taxa-bairro-${cidLimpa}-${bairroLimpo}`);

            if (checkBairro && inputTaxa) {
                checkBairro.addEventListener('change', (e) => {
                    inputTaxa.disabled = !e.target.checked;
                    if (!e.target.checked) inputTaxa.value = "0.00";
                    
                    logisticaCidadesLocal[cidade].bairros[bairro] = {
                        ativo: e.target.checked,
                        taxa: Math.max(0, parseFloat(inputTaxa.value) || 0)
                    };
                });

                inputTaxa.oninput = (e) => {
                    logisticaCidadesLocal[cidade].bairros[bairro] = {
                        ativo: checkBairro.checked,
                        taxa: Math.max(0, parseFloat(e.target.value) || 0)
                    };
                };
            }
        });
    });
}

document.getElementById('btn-salvar-frete').onclick = async () => {
    if (!idLojaGlobal) return;

    const inputFreteGratisMin = parseFloat(document.getElementById('edit-frete-gratis-min').value) || 0;
    if (inputFreteGratisMin < 0) {
        mostrarNotificacao("O valor para Frete Grátis não pode ser negativo!", "error");
        return;
    }

    const taxasBairrosAchatado = {};
    let menorTaxaGeral = 999;
    let possuiBairroAtivo = false;
    let encontrouTaxaNegativa = false;

    Object.keys(logisticaCidadesLocal).forEach(cidade => {
        const bairrosObj = logisticaCidadesLocal[cidade].bairros || {};
        Object.keys(bairrosObj).forEach(bairro => {
            if (bairrosObj[bairro].ativo || bairrosObj[bairro].active) {
                let taxa = parseFloat(bairrosObj[bairro].taxa) || 0;
                
                if (taxa < 0) {
                    encontrouTaxaNegativa = true;
                    taxa = 0; 
                }

                taxasBairrosAchatado[bairro] = taxa;
                bairrosObj[bairro].taxa = taxa; 
                possuiBairroAtivo = true;
                if (taxa < menorTaxaGeral) menorTaxaGeral = taxa;
            }
        });
    });

    if (encontrouTaxaNegativa) {
        mostrarNotificacao("Taxas de entrega não podem ter valores negativos!", "error");
        return;
    }

    const btn = document.getElementById('btn-salvar-frete');
    btn.disabled = true; btn.innerText = "Salvando Rota Logística...";

    const freteMinimoCalculado = possuiBairroAtivo ? Math.max(0, menorTaxaGeral) : 0;

    let tempoEntregaSincronizado = "20-30";
    const primeiraCidadeAtiva = Object.keys(logisticaCidadesLocal)[0];
    if (primeiraCidadeAtiva) {
        const cTime = logisticaCidadesLocal[primeiraCidadeAtiva];
        tempoEntregaSincronizado = `${cTime.tempoMin || 30}-${cTime.tempoMax || 50}`;
    }

    try {
        await updateDoc(doc(db, "lojas", idLojaGlobal), {
            logisticaCidades: logisticaCidadesLocal,
            taxasBairros: taxasBairrosAchatado,
            frete: freteMinimoCalculado,
            freteGratisMin: Math.max(0, inputFreteGratisMin),
            tempoRetirada: document.getElementById('edit-tempo-retirada').value.trim() || "15-20",
            tempoEntrega: tempoEntregaSincronizado
        });
        
        mostrarNotificacao("Configurações de frete e prazos atualizadas!");
        window.fecharModal('modal-frete');
        await carregarDadosLoja();
    } catch (err) { 
        mostrarNotificacao("Erro ao salvar dados logísticos.", "error"); 
    } finally { 
        btn.disabled = false; 
        btn.innerText = "Salvar Configurações de Logística"; 
    }
};

/* ============================================================
   GRADE DE HORÁRIOS DE FUNCIONAMENTO
   ============================================================ */
function gerarInputsGradeSemanal() {
    const wrapper = document.getElementById('wrapper-dias-semana-inputs');
    wrapper.innerHTML = "";

    diasDaSemanaChaves.forEach(dia => {
        const dadosDia = horariosFuncionamentoLocal[dia.id] || { aberto: false, inicio: "18:00", fim: "23:00" };
        
        const row = document.createElement('div');
        row.className = "dia-horario-row";
        row.innerHTML = `
            <div class="dia-checkbox-block">
                <input type="checkbox" id="check-aberto-${dia.id}" class="checkbox-dia-toggle" ${dadosDia.aberto ? 'checked' : ''}>
                <label for="check-aberto-${dia.id}" class="label-dia-nome">${dia.nome}</label>
            </div>
            <div class="dia-times-block" id="block-times-${dia.id}">
                <input type="time" id="time-inicio-${dia.id}" value="${dadosDia.inicio || '18:00'}" class="input-time-picker">
                <span>até</span>
                <input type="time" id="time-fim-${dia.id}" value="${dadosDia.fim || '23:00'}" class="input-time-picker">
            </div>
        `;
        wrapper.appendChild(row);

        const checkbox = row.querySelector(`#check-aberto-${dia.id}`);
        const blockTimes = row.querySelector(`#block-times-${dia.id}`);
        
        const alternarEstadoCampos = (ativo) => {
            blockTimes.style.opacity = ativo ? "1" : "0.3";
            blockTimes.querySelectorAll('input').forEach(i => i.disabled = !ativo);
        };
        
        checkbox.addEventListener('change', (e) => alternarEstadoCampos(e.target.checked));
        alternarEstadoCampos(dadosDia.aberto);
    });
}

document.getElementById('form-salvar-horarios').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-salvar-grade-horarios');
    btn.disabled = true; btn.innerText = "Salvando Horários...";

    const novaGrade = {};
    diasDaSemanaChaves.forEach(dia => {
        novaGrade[dia.id] = {
            aberto: document.getElementById(`check-aberto-${dia.id}`).checked,
            inicio: document.getElementById(`time-inicio-${dia.id}`).value,
            fim: document.getElementById(`time-fim-${dia.id}`).value
        };
    });

    try {
        await updateDoc(doc(db, "lojas", idLojaGlobal), {
            statusMaster: document.getElementById('edit-status-loja-master').value,
            horariosSemana: novaGrade
        });
        mostrarNotificacao("Grade de horários atualizada!");
        window.fecharModal('modal-horarios');
        await carregarDadosLoja();
    } catch (err) {
        mostrarNotificacao("Erro ao salvar horários.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = "Salvar Grade de Funcionamento";
    }
};

async function realizarUploadBase64(base64String, pasta, sufixo) {
    const refStorage = ref(storage, `lojas/${idLojaGlobal}/${pasta}/${Date.now()}_${sufixo}.webp`);
    await uploadString(refStorage, base64String, 'data_url');
    return await getDownloadURL(refStorage);
}

/* ============================================================
   EDIÇÃO DE DADOS DA LOJA
   ============================================================ */
document.getElementById('form-editar-loja').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');

    const telefoneVal = document.getElementById('edit-telefone')?.value.trim() || "";
    const emailVal = document.getElementById('edit-email')?.value.trim() || "";

    if (!telefoneVal) {
        mostrarNotificacao("O campo Telefone de Contato da loja é obrigatório!", "error");
        document.getElementById('edit-telefone')?.focus();
        return;
    }

    btn.disabled = true; 
    btn.innerText = "Processando...";

    try {
        const snapAtual = await getDoc(doc(db, "lojas", idLojaGlobal));
        const dadosAtuais = snapAtual.exists() ? snapAtual.data() : {};

        let urlLogo = dadosAtuais.logoUrl || document.getElementById('preview-logo').src;
        if (base64LogoCurrent) {
            if (dadosAtuais.logoUrl) await deletarArquivoStoragePorUrl(dadosAtuais.logoUrl);
            urlLogo = await realizarUploadBase64(base64LogoCurrent, 'perfil', 'logo');
        }

        let urlBanner = dadosAtuais.bannerLoja || "";
        if (base64BannerCurrent) {
            if (dadosAtuais.bannerLoja) await deletarArquivoStoragePorUrl(dadosAtuais.bannerLoja);
            urlBanner = await realizarUploadBase64(base64BannerCurrent, 'perfil', 'banner');
        }

        await updateDoc(doc(db, "lojas", idLojaGlobal), {
            nome: document.getElementById('edit-nome').value.trim(),
            descricao: document.getElementById('edit-descricao').value.trim(),
            categoria: document.getElementById('edit-categoria').value,
            telefone: telefoneVal,
            email: emailVal,
            cepLoja: document.getElementById('edit-cep').value,
            ruaLoja: document.getElementById('edit-rua')?.value.trim() || "",
            bairroLoja: document.getElementById('edit-bairro').value,
            numeroLoja: document.getElementById('edit-numero').value,
            temaLoja: document.getElementById('edit-tema').value,
            logoUrl: urlLogo,
            bannerLoja: urlBanner
        });

        mostrarNotificacao("Dados da loja atualizados com sucesso!");
        window.fecharModal('modal-info');
        base64LogoCurrent = null;
        base64BannerCurrent = null;
        await carregarDadosLoja();
    } catch (err) { 
        console.error("Erro ao salvar perfil da loja:", err);
        mostrarNotificacao("Erro ao salvar alterações.", "error"); 
    } finally { 
        btn.disabled = false; 
        btn.innerText = "Salvar Alterações"; 
    }
};

async function carregarDadosLoja() {
    const snap = await getDoc(doc(db, "lojas", idLojaGlobal));
    if (snap.exists()) {
        const d = snap.data();
        if (tituloLoja) tituloLoja.innerText = d.nome || "Minha Loja";
        document.getElementById('edit-nome').value = d.nome || "";
        document.getElementById('edit-descricao').value = d.descricao || "";
        document.getElementById('edit-categoria').value = d.categoria || "";
        
        const inputTelefone = document.getElementById('edit-telefone');
        if (inputTelefone) inputTelefone.value = d.telefone || "";

        const inputEmail = document.getElementById('edit-email');
        if (inputEmail) inputEmail.value = d.email || "";

        document.getElementById('edit-cep').value = d.cepLoja || "";
        
        const inputRua = document.getElementById('edit-rua');
        if (inputRua) inputRua.value = d.ruaLoja || d.rua || "";

        document.getElementById('edit-bairro').value = d.bairroLoja || "";
        document.getElementById('edit-numero').value = d.numeroLoja || "";
        document.getElementById('preview-logo').src = d.logoUrl || '../assets/images/default-loja.png';
        document.getElementById('edit-tema').value = d.temaLoja || "#ff6400";
        document.getElementById('valor-hex').innerText = (d.temaLoja || "#ff6400").toUpperCase();
        
        const bannerElem = document.getElementById('preview-banner');
        if (bannerElem) {
            if (d.bannerLoja && d.bannerLoja.trim() !== "") {
                bannerElem.style.backgroundImage = `url('${d.bannerLoja}')`;
                bannerElem.style.backgroundColor = 'transparent';
            } else {
                bannerElem.style.backgroundImage = 'none';
                bannerElem.style.backgroundColor = d.temaLoja || "#ff6400";
            }
        }

        document.getElementById('edit-frete-gratis-min').value = d.freteGratisMin || 0;
        document.getElementById('edit-tempo-retirada').value = d.tempoRetirada || "15-20";
        
        logisticaCidadesLocal = d.logisticaCidades || {};
        inicializerCheckboxesCidades();
        renderizarPaineisCidadesAtivas();

        horariosFuncionamentoLocal = d.horariosSemana || {};
        document.getElementById('edit-status-loja-master').value = d.statusMaster || "automatico";
        gerarInputsGradeSemanal();

        atualizarStatusCardMp(d);

        const btnVerLoja = document.getElementById('btn-ver-loja');
        if (btnVerLoja) {
            btnVerLoja.onclick = () => {
                window.location.href = `../html/loja.html?id=${idLojaGlobal}`;
            };
        }
    }
}

function obterImagemProduto(p) {
    if (p.imagem && p.imagem.trim() !== "" && !p.imagem.includes("placeholder.png")) {
        return p.imagem;
    }
    const cat = p.categoria;
    if (cat && fotosCategorias[cat]) {
        const arquivo = fotosCategorias[cat].split('/').pop();
        return `../assets/images/${arquivo}`;
    }
    return '../assets/images/placeholder.png';
}

/* ============================================================
   HANDLERS DE UPLOAD DE IMAGEM
   ============================================================ */
document.getElementById('edit-logo-file').onchange = async (e) => {
    if (e.target.files.length > 0) {
        try {
            mostrarNotificacao("Otimizando logo...", "info");
            base64LogoCurrent = await compactarEPadronizarImagem(e.target.files[0], 400, 0.8);
            document.getElementById('preview-logo').src = base64LogoCurrent;
        } catch (err) {
            console.error(err);
            mostrarNotificacao("Erro ao processar imagem da logo.", "error");
        }
    }
};

document.getElementById('edit-banner-file').onchange = async (e) => {
    if (e.target.files.length > 0) {
        try {
            mostrarNotificacao("Otimizando banner na proporção 5:1...", "info");
            base64BannerCurrent = await compactarBannerPanoramico5x1(e.target.files[0], 1800, 360, 0.8);
            const bannerElem = document.getElementById('preview-banner');
            if (bannerElem) {
                bannerElem.style.backgroundImage = `url('${base64BannerCurrent}')`;
                bannerElem.style.backgroundColor = 'transparent';
            }
        } catch (err) {
            console.error(err);
            mostrarNotificacao("Erro ao processar imagem do banner.", "error");
        }
    }
};

document.getElementById('edit-produto-file').onchange = async (e) => {
    if (e.target.files.length > 0) {
        try {
            mostrarNotificacao("Otimizando foto do produto...", "info");
            base64EditProdutoCurrent = await compactarEPadronizarImagem(e.target.files[0], 800, 0.8);
            document.getElementById('preview-produto-edit').src = base64EditProdutoCurrent;
        } catch (err) {
            console.error(err);
            mostrarNotificacao("Erro ao processar imagem do produto.", "error");
        }
    }
};

document.getElementById('add-produto-file').onchange = async (e) => {
    if (e.target.files.length > 0) {
        try {
            mostrarNotificacao("Otimizando foto do produto...", "info");
            base64AddProdutoCurrent = await compactarEPadronizarImagem(e.target.files[0], 800, 0.8);
            document.getElementById('preview-produto-add').src = base64AddProdutoCurrent;
        } catch (err) {
            console.error(err);
            mostrarNotificacao("Erro ao processar imagem do produto.", "error");
        }
    }
};

const selectAddCat = document.getElementById('add-produto-categoria-select');
if (selectAddCat) {
    selectAddCat.addEventListener('change', (e) => {
        if (!base64AddProdutoCurrent) {
            const cat = e.target.value;
            const imgPreview = document.getElementById('preview-produto-add');
            if (cat && fotosCategorias[cat]) {
                const arquivo = fotosCategorias[cat].split('/').pop();
                imgPreview.src = `../assets/images/${arquivo}`;
            } else {
                imgPreview.src = "../assets/images/placeholder.png";
            }
        }
    });
}

const selectEditCat = document.getElementById('edit-produto-categoria-select');
if (selectEditCat) {
    selectEditCat.addEventListener('change', (e) => {
        if (!base64EditProdutoCurrent) {
            const cat = e.target.value;
            const imgPreview = document.getElementById('preview-produto-edit');
            if (cat && fotosCategorias[cat]) {
                const arquivo = fotosCategorias[cat].split('/').pop();
                imgPreview.src = `../assets/images/${arquivo}`;
            }
        }
    });
}

/* ============================================================
   CONTROLE DE VARIAÇÕES E PREÇO BASE (CADASTRO E EDIÇÃO)
   ============================================================ */
const addCheckVariacao = document.getElementById('add-produto-com-variacao');
const addContainerVariacoes = document.getElementById('container-add-variacoes');
const btnAddGrupoNovo = document.getElementById('btn-add-grupo-novo');
const wrapperAddListaGrupos = document.getElementById('wrapper-add-lista-grupos');
const inputAddPreco = document.getElementById('add-produto-preco');

const editCheckVariacao = document.getElementById('edit-produto-com-variacao');
const editContainerVariacoes = document.getElementById('container-edit-variacoes');
const btnEditGrupoNovo = document.getElementById('btn-edit-grupo-novo');
const wrapperEditListaGrupos = document.getElementById('wrapper-edit-lista-grupos');
const inputEditPreco = document.getElementById('edit-produto-preco');

// Alternância no CADASTRO
addCheckVariacao?.addEventListener('change', (e) => {
    const comVariacao = e.target.checked;
    addContainerVariacoes.style.display = comVariacao ? 'block' : 'none';

    if (inputAddPreco) {
        inputAddPreco.disabled = comVariacao;
        if (comVariacao) {
            inputAddPreco.value = "";
            inputAddPreco.placeholder = "Calculado pelas variações (A partir de...)";
            inputAddPreco.removeAttribute('required');
        } else {
            inputAddPreco.placeholder = "0.00";
            inputAddPreco.setAttribute('required', 'required');
        }
    }

    if (comVariacao && wrapperAddListaGrupos.children.length === 0) {
        criarEstruturaGrupoNoDOM(wrapperAddListaGrupos);
    }
});

// Alternância na EDIÇÃO
editCheckVariacao?.addEventListener('change', (e) => {
    const comVariacao = e.target.checked;
    editContainerVariacoes.style.display = comVariacao ? 'block' : 'none';

    if (inputEditPreco) {
        inputEditPreco.disabled = comVariacao;
        if (comVariacao) {
            inputEditPreco.value = "";
            inputEditPreco.placeholder = "Calculado pelas variações (A partir de...)";
            inputEditPreco.removeAttribute('required');
        } else {
            inputEditPreco.placeholder = "0.00";
            inputEditPreco.setAttribute('required', 'required');
        }
    }

    if (comVariacao && wrapperEditListaGrupos.children.length === 0) {
        criarEstruturaGrupoNoDOM(wrapperEditListaGrupos);
    }
});

btnAddGrupoNovo?.addEventListener('click', () => criarEstruturaGrupoNoDOM(wrapperAddListaGrupos));
btnEditGrupoNovo?.addEventListener('click', () => criarEstruturaGrupoNoDOM(wrapperEditListaGrupos));

function criarEstruturaGrupoNoDOM(containerAlvo, dadosGrupoExistente = null) {
    const idGrupoUnico = dadosGrupoExistente ? dadosGrupoExistente.idGrupo : 'g_' + Date.now() + Math.random().toString(36).substr(2, 4);

    const divGrupo = document.createElement('div');
    divGrupo.className = 'card-cadastro-grupo-variacao';
    divGrupo.dataset.id = idGrupoUnico;

    const tituloVal = dadosGrupoExistente ? dadosGrupoExistente.titulo : '';
    const maxVal = dadosGrupoExistente ? dadosGrupoExistente.maxEscolhas : 1;
    const obrigatorioCheck = dadosGrupoExistente ? (dadosGrupoExistente.obrigatorio ? 'checked' : '') : 'checked';

    divGrupo.innerHTML = `
        <button type="button" class="btn-deletar-grupo"><i class="fa-solid fa-trash"></i></button>
        <div class="input-row align-end-row">
            <div class="input-group no-margin"><label>Título do Grupo</label><input type="text" placeholder="Ex: Escolha o tamanho" class="grupo-titulo-input" value="${escaparHTML(tituloVal)}" required></div>
            <div class="input-group no-margin"><label>Qtd Máxima</label><input type="number" value="${maxVal}" min="1" class="grupo-max-input"></div>
            <div class="input-group no-margin flex-inline-row-check"><input type="checkbox" ${obrigatorioCheck} class="grupo-obrigatorio-input"><label>Obrigatório</label></div>
        </div>
        <div class="container-subopcoes-itens"></div>
        <button type="button" class="btn-add-item-subopcao">+ Adicionar Opção</button>
    `;

    containerAlvo.appendChild(divGrupo);
    const containerSubOpcoes = divGrupo.querySelector('.container-subopcoes-itens');
    const btnAddItemSubopcao = divGrupo.querySelector('.btn-add-item-subopcao');

    divGrupo.querySelector('.btn-deletar-grupo').onclick = () => divGrupo.remove();

    if (dadosGrupoExistente && dadosGrupoExistente.opcoes) {
        dadosGrupoExistente.opcoes.forEach(opcao => criarLinhaSubOpcao(containerSubOpcoes, opcao));
    } else {
        criarLinhaSubOpcao(containerSubOpcoes);
    }
    btnAddItemSubopcao.onclick = () => criarLinhaSubOpcao(containerSubOpcoes);
}

function criarLinhaSubOpcao(container, dadosOpcaoExistente = null) {
    const divLinha = document.createElement('div');
    divLinha.className = 'linha-subopcao-item-grid';
    
    const nomeVal = dadosOpcaoExistente ? dadosOpcaoExistente.nome : '';
    const precoVal = dadosOpcaoExistente ? Math.max(0, dadosOpcaoExistente.precoAdicional).toFixed(2) : '0.00';

    divLinha.innerHTML = `
        <input type="text" placeholder="Nome (Ex: Pote 500ml)" class="subopcao-nome" value="${escaparHTML(nomeVal)}" required>
        <input type="number" placeholder="Preço + (R$)" min="0" step="0.01" value="${precoVal}" class="subopcao-preco" required>
        <button type="button" class="btn-remover-linha-opcao"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(divLinha);
    divLinha.querySelector('.btn-remover-linha-opcao').onclick = () => divLinha.remove();
}

function extrairPayloadGrupoDeOpcoes(containerWrapper) {
    const listaGruposPayload = [];
    const cardsGrupos = containerWrapper.querySelectorAll('.card-cadastro-grupo-variacao');
    
    cardsGrupos.forEach(card => {
        const titulo = card.querySelector('.grupo-titulo-input').value.trim();
        const maxChoices = Math.max(1, parseInt(card.querySelector('.grupo-max-input').value) || 1);
        const isObrigatorio = card.querySelector('.grupo-obrigatorio-input').checked;

        const subOpcoes = [];
        const linhasOpcoes = card.querySelectorAll('.container-subopcoes-itens > .linha-subopcao-item-grid');
        
        linhasOpcoes.forEach(linha => {
            const nomeOp = linha.querySelector('.subopcao-nome').value.trim();
            const precoOp = Math.max(0, parseFloat(linha.querySelector('.subopcao-preco').value) || 0);
            if (nomeOp !== "") {
                subOpcoes.push({ nome: nomeOp, precoAdicional: precoOp });
            }
        });

        if (titulo !== "" && subOpcoes.length > 0) {
            listaGruposPayload.push({
                idGrupo: card.dataset.id,
                titulo: titulo,
                obrigatorio: isObrigatorio,
                maxEscolhas: maxChoices,
                minEscolhas: isObrigatorio ? 1 : 0,
                opcoes: subOpcoes
            });
        }
    });
    return listaGruposPayload;
}

/* ============================================================
   GERENCIADOR E ABERTURA DE PRODUTOS
   ============================================================ */
window.abrirGerenciadorProdutos = async () => {
    window.abrirModal('modal-produtos');
    const lista = document.getElementById('lista-produtos-dashboard');
    lista.innerHTML = "<p class='loading-produtos-text'>Carregando...</p>";
    const q = query(collection(db, "produtos"), where("lojaId", "==", idLojaGlobal));
    const snap = await getDocs(q);
    lista.innerHTML = "";
    
    snap.forEach(docSnap => {
        const p = docSnap.data();
        const itemDiv = document.createElement('div');
        itemDiv.className = "produto-item-admin";
        
        // Exibição amigável do menor preço base
        const precoNum = Number(p.preco || 0);
        const precoExibirTexto = p.temVariacoes 
            ? `A partir de R$ ${precoNum.toFixed(2)}` 
            : `R$ ${precoNum.toFixed(2)}`;

        itemDiv.innerHTML = `<img src="${obterImagemProduto(p)}" class="img-prod-admin">
            <div class="info-prod-admin"><h4>${escaparHTML(p.nome)}</h4><p style="color:#2ed573; font-weight:600;">${precoExibirTexto}</p></div>
            <div class="actions-prod-admin">
                <button class="btn-action-prod btn-editar-prod" id="btn-edit-prod-${docSnap.id}"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn-action-prod btn-excluir-prod" id="btn-del-prod-${docSnap.id}"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        lista.appendChild(itemDiv);

        itemDiv.querySelector(`#btn-edit-prod-${docSnap.id}`).onclick = () => window.abrirEdicaoProduto(docSnap.id);
        itemDiv.querySelector(`#btn-del-prod-${docSnap.id}`).onclick = () => window.excluirProduto(docSnap.id);
    });
};

window.abrirEdicaoProduto = async (idProduto) => {
    try {
        const docSnap = await getDoc(doc(db, "produtos", idProduto));
        if (docSnap.exists()) {
            const p = docSnap.data();
            document.getElementById('edit-prod-id').value = idProduto;
            document.getElementById('edit-produto-nome').value = p.nome || "";
            document.getElementById('edit-produto-categoria-select').value = p.categoria || "";
            document.getElementById('edit-produto-descricao').value = p.descricao || "";
            document.getElementById('preview-produto-edit').src = obterImagemProduto(p);
            
            wrapperEditListaGrupos.innerHTML = "";
            
            if (p.temVariacoes) {
                editCheckVariacao.checked = true;
                editContainerVariacoes.style.display = 'block';
                
                if (inputEditPreco) {
                    inputEditPreco.value = "";
                    inputEditPreco.disabled = true;
                    inputEditPreco.placeholder = "Calculado pelas variações (A partir de...)";
                    inputEditPreco.removeAttribute('required');
                }

                const gruposBanco = p.grupoDeOpcoes || p.gruposDeOpcoes || [];
                gruposBanco.forEach(grupo => criarEstruturaGrupoNoDOM(wrapperEditListaGrupos, grupo));
            } else {
                editCheckVariacao.checked = false;
                editContainerVariacoes.style.display = 'none';

                if (inputEditPreco) {
                    inputEditPreco.disabled = false;
                    inputEditPreco.value = p.preco !== undefined ? p.preco : 0;
                    inputEditPreco.placeholder = "0.00";
                    inputEditPreco.setAttribute('required', 'required');
                }
            }
            
            base64EditProdutoCurrent = null; 
            window.abrirModal('modal-editar-produto');
        } else { 
            mostrarNotificacao("Produto não localizado.", "error"); 
        }
    } catch (err) { 
        console.error("Erro ao buscar produto:", err); 
    }
};

window.excluirProduto = async (idProduto) => {
    if (confirm("Tem certeza de que deseja excluir este item?")) {
        try {
            const docSnap = await getDoc(doc(db, "produtos", idProduto));
            if (docSnap.exists()) {
                const pData = docSnap.data();
                if (pData.imagem) await deletarArquivoStoragePorUrl(pData.imagem);
            }

            await deleteDoc(doc(db, "produtos", idProduto));
            mostrarNotificacao("Produto removido!");
            window.abrirGerenciadorProdutos();
        } catch (err) { mostrarNotificacao("Erro ao remover o produto.", "error"); }
    }
};

/* ============================================================
   CADASTRO E EDIÇÃO DE PRODUTOS
   ============================================================ */
document.getElementById('form-editar-produto').onsubmit = async (e) => {
    e.preventDefault();
    const idProd = document.getElementById('edit-prod-id').value;
    const isVariacaoAtiva = editCheckVariacao.checked;
    const arrayGruposPayload = isVariacaoAtiva ? extrairPayloadGrupoDeOpcoes(wrapperEditListaGrupos) : [];

    let precoFinal = 0;

    if (isVariacaoAtiva) {
        if (arrayGruposPayload.length === 0) {
            mostrarNotificacao("Adicione pelo menos 1 grupo de variações ou desmarque a opção.", "error");
            return;
        }
        // Calcula o menor preço base a partir dos grupos obrigatórios
        precoFinal = calcularMenorPrecoVariacoes(arrayGruposPayload);
    } else {
        const precoInput = parseFloat(inputEditPreco.value) || 0;
        if (precoInput < 0) {
            mostrarNotificacao("O preço do produto não pode ser negativo!", "error");
            return;
        }
        precoFinal = Math.max(0, precoInput);
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.innerText = "Atualizando...";

    try {
        const docSnap = await getDoc(doc(db, "produtos", idProd));
        const dadosAtuais = docSnap.exists() ? docSnap.data() : {};
        let imgUrl = dadosAtuais.imagem || "";

        if (base64EditProdutoCurrent) {
            if (dadosAtuais.imagem) await deletarArquivoStoragePorUrl(dadosAtuais.imagem);
            imgUrl = await realizarUploadBase64(base64EditProdutoCurrent, 'produtos', 'item');
        }

        await updateDoc(doc(db, "produtos", idProd), {
            nome: document.getElementById('edit-produto-nome').value.trim(),
            preco: precoFinal,
            categoria: document.getElementById('edit-produto-categoria-select').value,
            descricao: document.getElementById('edit-produto-descricao').value.trim(),
            imagem: imgUrl,
            temVariacoes: isVariacaoAtiva,
            grupoDeOpcoes: arrayGruposPayload
        });

        mostrarNotificacao("Item atualizado!");
        base64EditProdutoCurrent = null;
        window.fecharModal('modal-editar-produto');
        window.abrirGerenciadorProdutos();
    } catch (err) { 
        console.error("Erro ao atualizar produto:", err);
        mostrarNotificacao("Erro ao atualizar item.", "error");
    } finally { 
        btn.disabled = false; 
        btn.innerText = "Salvar Alterações"; 
    }
};

document.getElementById('form-add-produto').onsubmit = async (e) => {
    e.preventDefault();
    
    const isVariacaoAtiva = addCheckVariacao.checked;
    const arrayGruposPayload = isVariacaoAtiva ? extrairPayloadGrupoDeOpcoes(wrapperAddListaGrupos) : [];

    let precoFinal = 0;

    if (isVariacaoAtiva) {
        if (arrayGruposPayload.length === 0) {
            mostrarNotificacao("Adicione pelo menos 1 grupo de variações ou desmarque a opção.", "error");
            return;
        }
        // Calcula o menor preço base a partir dos grupos obrigatórios
        precoFinal = calcularMenorPrecoVariacoes(arrayGruposPayload);
    } else {
        const precoInput = parseFloat(inputAddPreco.value) || 0;
        if (precoInput < 0) {
            mostrarNotificacao("O preço do produto não pode ser negativo!", "error");
            return;
        }
        precoFinal = Math.max(0, precoInput);
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.innerText = "Cadastrando...";

    try {
        let imgUrl = "";
        if (base64AddProdutoCurrent) {
            imgUrl = await realizarUploadBase64(base64AddProdutoCurrent, 'produtos', 'item');
        }

        await addDoc(collection(db, "produtos"), {
            lojaId: idLojaGlobal,
            nomeLoja: tituloLoja?.innerText || "Loja",
            nome: document.getElementById('add-produto-nome').value.trim(),
            preco: precoFinal,
            categoria: document.getElementById('add-produto-categoria-select').value,
            descricao: document.getElementById('add-produto-descricao').value.trim(),
            imagem: imgUrl,
            dataCriacao: new Date().toISOString(),
            temVariacoes: isVariacaoAtiva,
            grupoDeOpcoes: arrayGruposPayload
        });

        mostrarNotificacao("Item cadastrado no cardápio!");
        e.target.reset();
        document.getElementById('preview-produto-add').src = "../assets/images/placeholder.png";
        base64AddProdutoCurrent = null;
        wrapperAddListaGrupos.innerHTML = "";
        addCheckVariacao.checked = false;
        addContainerVariacoes.style.display = 'none';

        if (inputAddPreco) {
            inputAddPreco.disabled = false;
            inputAddPreco.placeholder = "0.00";
            inputAddPreco.setAttribute('required', 'required');
        }

        window.fecharModal('modal-add-produto');
    } catch (err) { 
        mostrarNotificacao("Erro ao inserir produto.", "error"); 
    } finally { 
        btn.disabled = false; 
        btn.innerText = "Cadastrar Produto"; 
    }
};

async function carregarCategoriasSelects() {
    try {
        const snap = await getDocs(collection(db, "categorias"));
        const selects = [
            document.getElementById('edit-categoria'), 
            document.getElementById('add-produto-categoria-select'), 
            document.getElementById('edit-produto-categoria-select')
        ];
        
        selects.forEach(s => {
            if (s) s.innerHTML = '<option value="">Selecione...</option>';
        });
        
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.nome) {
                fotosCategorias[d.nome] = d.fotoArquivo || d.foto || "";
                selects.forEach(s => {
                    if (s) s.innerHTML += `<option value="${escaparHTML(d.nome)}">${escaparHTML(d.nome)}</option>`;
                });
            }
        });
    } catch (err) {
        console.error("Erro ao carregar categorias:", err);
    }
}

/* ============================================================
   GERENCIAMENTO DE CUPONS
   ============================================================ */
window.abrirGerenciadorCupons = async () => {
    window.abrirModal('modal-cupons');
    const lista = document.getElementById('lista-cupons-dashboard');
    lista.innerHTML = "<p class='loading-produtos-text'>Buscando cupons...</p>";
    
    try {
        const q = query(collection(db, "cupons"), where("lojaId", "==", idLojaGlobal));
        const snap = await getDocs(q);
        lista.innerHTML = "";

        if (snap.empty) {
            lista.innerHTML = "<p class='loading-produtos-text' style='color:#747d8c;'>Você não possui cupons ativos.</p>";
            return;
        }

        snap.forEach(docSnap => {
            const c = docSnap.data();
            
            const valorCupom = Number(c.valor || 0);
            const minPedido = Number(c.valorMinimo || c.usoMinimo || 0);
            const usos = c.usosAtuais || 0;
            const limite = c.limiteUsos || "∞";

            const expirado = c.dataExpiracao ? new Date(c.dataExpiracao) < new Date() : false;
            const esgotado = c.limiteUsos && (usos >= c.limiteUsos);
            
            const itemDiv = document.createElement('div');
            itemDiv.className = "produto-item-admin";
            
            itemDiv.innerHTML = `
                <div class="info-prod-admin" style="padding-left: 0.5rem;">
                    <h4 style="color:#ff6400; font-weight:600;">${escaparHTML(c.codigo || 'SEM CÓDIGO')}</h4>
                    <p>${c.tipo === 'porcentagem' ? `${valorCupom}% OFF` : `R$ ${valorCupom.toFixed(2)} de desconto`}</p>
                    <p style="font-size:0.8rem; color:#747d8c; margin: 2px 0;">Min. Pedido: R$ ${minPedido.toFixed(2)} | Usos: ${usos}/${limite}</p>
                    <small style="color:${expirado || esgotado ? '#ff6400' : '#2ed573'}; font-size:0.75rem; font-weight:600;">
                        ${expirado ? 'Expirado' : esgotado ? 'Esgotado' : `Válido até: ${c.dataExpiracao ? new Date(c.dataExpiracao).toLocaleString('pt-br') : 'Sem prazo'}`}
                    </small>
                </div>
                <div class="actions-prod-admin">
                    <button class="btn-action-prod btn-excluir-prod" id="btn-del-cupom-${docSnap.id}" title="Excluir Cupom"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            lista.appendChild(itemDiv);

            itemDiv.querySelector(`#btn-del-cupom-${docSnap.id}`).onclick = () => window.excluirCupom(docSnap.id);
        });
    } catch (err) { 
        lista.innerHTML = "<p class='loading-produtos-text'>Erro ao carregar cupons.</p>"; 
    }
};

window.excluirCupom = async (idCupom) => {
    if (confirm("Deseja apagar esse cupom?")) {
        try {
            await deleteDoc(doc(db, "cupons", idCupom));
            mostrarNotificacao("Cupom removido!");
            window.abrirGerenciadorCupons();
        } catch (err) { mostrarNotificacao("Falha ao remover cupom.", "error"); }
    }
};

document.getElementById('form-add-cupom').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const codigoInput = document.getElementById('add-cupom-codigo').value.trim().toUpperCase();
    const tipo = document.getElementById('add-cupom-tipo').value;
    const valor = parseFloat(document.getElementById('add-cupom-valor').value) || 0;
    const valorMinimo = parseFloat(document.getElementById('add-cupom-minimo').value) || 0;
    const limiteUsos = parseInt(document.getElementById('add-cupom-limite').value) || 0;
    const horasExpiracao = parseInt(document.getElementById('add-cupom-expiracao').value) || 0;

    if (tipo === 'fixo' && valor >= valorMinimo) {
        mostrarNotificacao("Proteção: Em cupons fixos, o desconto não pode ser maior ou igual ao Pedido Mínimo!", "error");
        return;
    }

    btn.disabled = true; btn.innerText = "Cadastrando Cupom...";
    const dataCriacao = new Date();
    const dataExpiracao = new Date(dataCriacao.getTime() + horasExpiracao * 60 * 60 * 1000);

    try {
        await addDoc(collection(db, "cupons"), {
            codigo: codigoInput,
            tipo: tipo,
            valor: valor,
            valorMinimo: valorMinimo,
            limiteUsos: limiteUsos, 
            escopo: "loja", 
            lojaId: idLojaGlobal, 
            nomeLoja: tituloLoja?.innerText || "Loja",
            validadeHoras: horasExpiracao,
            dataCriacao: dataCriacao.toISOString(),
            dataExpiracao: dataExpiracao.toISOString(),
            usosAtuais: 0,
            usuariosQueUsaram: [] 
        });

        mostrarNotificacao("Cupom próprio ativado!");
        e.target.reset();
        window.fecharModal('modal-add-cupom');
        window.abrirGerenciadorCupons();
    } catch (err) { mostrarNotificacao("Erro ao cadastrar cupom.", "error"); }
    finally { btn.disabled = false; btn.innerText = "Cadastrar Cupom"; }
};

/* ============================================================
   ROTINA DE CHECAGEM DE PEDIDOS PIX EXPIRADOS (DESACOPLADA)
   ============================================================ */
function verificarPedidosPixExpirados() {
    listaPedidosLocal.forEach(p => {
        const dataObjeto = converterTimestamp(p.dataCriacao || p.dataPedido);
        const tempoDecorridoMinutos = (new Date().getTime() - dataObjeto.getTime()) / (1000 * 60);

        if (p.formaPagamento && p.formaPagamento.toLowerCase() === "pix" && p.statusPagamento !== "pago" && p.status === "pendente" && tempoDecorridoMinutos > 5) {
            p.status = "cancelado";
            p.statusPagamento = "expirado";
            p.motivoCancelamento = "Tempo limite de 5 minutos do Pix esgotado sem confirmação.";

            updateDoc(doc(db, "pedidos", p.id), {
                status: "cancelado",
                statusPagamento: "expirado",
                motivoCancelamento: "Tempo limite de 5 minutos do Pix esgotado sem confirmação."
            }).catch(e => console.error("Erro ao auto-cancelar pedido na loja:", e));
        }
    });
}

/* ============================================================
   ESCUTA REALTIME DE PEDIDOS
   ============================================================ */
function initializeEscutaPedidosRealtime() {
    const q = query(collection(db, "pedidos"), where("lojaId", "==", idLojaGlobal));
    
    const selectPeriodo = document.getElementById('select-periodo-grafico');
    if (selectPeriodo) {
        selectPeriodo.onchange = () => {
            processarEAtualizarDadosDashboard();
        };
    }

    onSnapshot(q, (snapshot) => {
        let temNovoPedidoEmPreparo = false;

        listaPedidosLocal = [];
        snapshot.forEach(docSnap => {
            const p = docSnap.data();
            p.id = docSnap.id;
            listaPedidosLocal.push(p);

            if ((p.status === "preparo" || p.status === "pendente") && !idsPedidosAlertados.has(p.id)) {
                idsPedidosAlertados.add(p.id);
                if (!primeiraCargaRealtime) {
                    temNovoPedidoEmPreparo = true;
                }
            }
        });

        if (temNovoPedidoEmPreparo) {
            tocarSomNovoPedido();
            mostrarNotificacao("🔔 Novo pedido recebido! Verifique a cozinha.", "info");
        }

        primeiraCargaRealtime = false;
        verificarPedidosPixExpirados();
        processarEAtualizarDadosDashboard();

    }, (error) => { console.error("Erro realtime listener:", error); });
}

/* ============================================================
   ACERTO CONTÁBIL E REPASSES PARA A PLATAFORMA
   ============================================================ */
document.getElementById('btn-filtro-repasse-todos')?.addEventListener('click', (e) => {
    filtroAbaRepasses = "todos";
    atualizarEstiloBotoesFiltroRepasse(e.target);
    processarEAtualizarDadosDashboard();
});
document.getElementById('btn-filtro-repasse-pendentes')?.addEventListener('click', (e) => {
    filtroAbaRepasses = "pendentes";
    atualizarEstiloBotoesFiltroRepasse(e.target);
    processarEAtualizarDadosDashboard();
});
document.getElementById('btn-filtro-repasse-quitados')?.addEventListener('click', (e) => {
    filtroAbaRepasses = "quitados";
    atualizarEstiloBotoesFiltroRepasse(e.target);
    processarEAtualizarDadosDashboard();
});

function atualizarEstiloBotoesFiltroRepasse(btnAtivo) {
    const btns = [
        document.getElementById('btn-filtro-repasse-todos'),
        document.getElementById('btn-filtro-repasse-pendentes'),
        document.getElementById('btn-filtro-repasse-quitados')
    ];
    btns.forEach(b => {
        if (b) b.style.background = "#747d8c";
    });
    if (btnAtivo) btnAtivo.style.background = "#ff6400";
}

document.getElementById('btn-abrir-pagamento-repasse-pix')?.addEventListener('click', async () => {
    let totalPendente = 0;
    let taxaPlataformaPadraoPct = 2.0;

    try {
        const configSnap = await getDoc(doc(db, "configuracoes", "plataforma"));
        if (configSnap.exists() && configSnap.data().taxaPorcentagem !== undefined) {
            taxaPlataformaPadraoPct = parseFloat(configSnap.data().taxaPorcentagem);
        }
    } catch (err) {
        console.warn("Erro ao buscar taxa:", err);
    }

    listaPedidosLocal.forEach(p => {
        if (p.status === "concluido") {
            const formaPagamentoTexto = (p.formaPagamento || 'Pix').toLowerCase();
            const ehPagamentoOnline = formaPagamentoTexto.includes('pix') || formaPagamentoTexto.includes('cartão de crédito (app)') || formaPagamentoTexto.includes('online');
            
            if (!ehPagamentoOnline) {
                const statusRepasse = p.statusRepasse || "pendente";
                if (statusRepasse === "pendente") {
                    const valorBruto = parseFloat(p.total) || 0;
                    const taxaPct = (p.taxaPlataformaAplicada !== undefined && p.taxaPlataformaAplicada !== null) 
                        ? parseFloat(p.taxaPlataformaAplicada) 
                        : taxaPlataformaPadraoPct;
                    
                    totalPendente += valorBruto * (taxaPct / 100);
                }
            }
        }
    });

    if (totalPendente < 0.50) {
        mostrarNotificacao("O valor acumulado de comissões precisa ser de no mínimo R$ 0,50 para gerar a cobrança Pix.", "info");
        return;
    }

    try {
        mostrarNotificacao("Gerando cobrança Pix de repasse...", "info");
        const functions = getFunctions();
        const criarCobrancaRepassePix = httpsCallable(functions, "criarCobrancaRepassePix");

        const res = await criarCobrancaRepassePix({
            lojaId: idLojaGlobal,
            valor: parseFloat(totalPendente.toFixed(2))
        });

        if (res.data && res.data.sucesso) {
            document.getElementById('img-qr-code-repasse').src = `data:image/png;base64,${res.data.qrCodeBase64}`;
            document.getElementById('input-pix-copia-cola-repasse').value = res.data.qrCodeCopiaECola;

            document.getElementById('btn-copiar-pix-repasse').onclick = () => {
                navigator.clipboard.writeText(res.data.qrCodeCopiaECola);
                mostrarNotificacao("Código Pix Copia e Cola copiado com sucesso!");
            };

            window.abrirModal('modal-pagar-repasse-pix');

            if (unsubscribeMonitorPixRepasse) unsubscribeMonitorPixRepasse();

            const qRepassePending = query(
                collection(db, "pedidos"),
                where("lojaId", "==", idLojaGlobal),
                where("statusRepasse", "==", "pendente")
            );

            unsubscribeMonitorPixRepasse = onSnapshot(qRepassePending, (snapshot) => {
                if (snapshot.empty) {
                    mostrarNotificacao("🎉 Pagamento de repasse confirmado com sucesso!", "success");
                    tocarSomNovoPedido();
                    
                    window.fecharModal('modal-pagar-repasse-pix');
                    
                    if (unsubscribeMonitorPixRepasse) {
                        unsubscribeMonitorPixRepasse();
                        unsubscribeMonitorPixRepasse = null;
                    }
                }
            });

        } else {
            mostrarNotificacao("Erro ao gerar QR Code Pix. Tente novamente.", "error");
        }
    } catch (err) {
        console.error("Erro ao gerar Pix de repasse:", err);
        mostrarNotificacao(`Erro: ${err.message || 'Falha ao conectar com o serviço de pagamento'}`, "error");
    }
});

async function processarEAtualizarDadosDashboard() {
    let contagemPendentes = 0;
    let faturamentoDiaAcumulado = 0;
    let totalPedidosConcluidosDia = 0;
    let totalPedidosCanceladosDia = 0;

    let totalRepassePendente = 0;
    let totalRepasseQuitado = 0;
    let totalRepasseSplit = 0;
    
    let taxaPlataformaPadraoPct = 2.0; 
    try {
        const configSnap = await getDoc(doc(db, "configuracoes", "plataforma"));
        if (configSnap.exists() && configSnap.data().taxaPorcentagem !== undefined) {
            taxaPlataformaPadraoPct = parseFloat(configSnap.data().taxaPorcentagem);
        }
    } catch (err) {
        console.warn("Falha ao carregar taxa global da plataforma, aplicando 2.0% padrão de fallback:", err);
    }

    const TARIFA_MP_DECIMAL = 0.01;

    const hoje = new Date();
    const hojeStr = hoje.toLocaleDateString('pt-br');

    const selectPeriodo = document.getElementById('select-periodo-grafico');
    const diasFiltro = selectPeriodo ? parseInt(selectPeriodo.value) : 7;

    const mapaCronologicoPeriodo = {};
    for (let i = diasFiltro - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(hoje.getDate() - i);
        mapaCronologicoPeriodo[d.toLocaleDateString('pt-br')] = 0;
    }

    const tabelaRepassesCorpo = document.getElementById('lista-linhas-repasses-financeiros');
    if (tabelaRepassesCorpo) tabelaRepassesCorpo.innerHTML = "";

    listaPedidosLocal.forEach(p => {
        const objetoData = converterTimestamp(p.dataCriacao || p.dataPedido);
        const dataFormatada = objetoData.toLocaleDateString('pt-br');

        if (p.status === "pendente" || p.status === "preparo" || p.status === "entrega") {
            contagemPendentes++;
        }

        if (p.status === "concluido") {
            totalPedidosConcluidosDia++;
            const valorBrutoPedido = parseFloat(p.total) || 0;
            
            if (mapaCronologicoPeriodo[dataFormatada] !== undefined) {
                mapaCronologicoPeriodo[dataFormatada] += valorBrutoPedido;
            }

            if (dataFormatada === hojeStr) {
                faturamentoDiaAcumulado += valorBrutoPedido;
            }

            const taxaAplicadaPct = (p.taxaPlataformaAplicada !== undefined && p.taxaPlataformaAplicada !== null) 
                ? parseFloat(p.taxaPlataformaAplicada) 
                : (p.taxaPlataforma !== undefined ? parseFloat(p.taxaPlataforma) : taxaPlataformaPadraoPct);

            const taxaAplicadaDecimal = taxaAplicadaPct / 100;
            const formaPagamentoTexto = (p.formaPagamento || 'Pix').toLowerCase();
            const ehPagamentoOnline = formaPagamentoTexto.includes('pix') || formaPagamentoTexto.includes('cartão de crédito (app)') || formaPagamentoTexto.includes('online');

            let taxaRetidaPlataforma = 0;
            let tagDetalhePagamento = "";
            let statusRepasseTexto = "";
            let statusRepasseClasse = "";

            if (ehPagamentoOnline) {
                const taxaLiquidaSplit = Math.max(0, taxaAplicadaDecimal - TARIFA_MP_DECIMAL);
                taxaRetidaPlataforma = valorBrutoPedido * taxaLiquidaSplit;
                totalRepasseSplit += taxaRetidaPlataforma;
                
                tagDetalhePagamento = `<span style="background:#e1f5fe; color:#0288d1; padding:2px 6px; border-radius:4px; font-weight:600;">App On-line</span>`;
                statusRepasseTexto = "Retido via Split";
                statusRepasseClasse = "color:#0288d1; background:#e1f5fe;";
            } else {
                taxaRetidaPlataforma = valorBrutoPedido * taxaAplicadaDecimal;
                tagDetalhePagamento = `<span style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:4px; font-weight:600;">Presencial</span>`;

                const stRepasse = p.statusRepasse || "pendente";
                if (stRepasse === "pago") {
                    totalRepasseQuitado += taxaRetidaPlataforma;
                    statusRepasseTexto = "Quitado ✓";
                    statusRepasseClasse = "color:#2ed573; background:#e8f8f5;";
                } else {
                    totalRepassePendente += taxaRetidaPlataforma;
                    statusRepasseTexto = "Pendente ⚠️";
                    statusRepasseClasse = "color:#ff4757; background:#ffe0e0;";
                }
            }

            let exibirNaTabela = true;
            const stRepasse = p.statusRepasse || "pendente";
            if (filtroAbaRepasses === "pendentes" && (ehPagamentoOnline || stRepasse === "pago")) exibirNaTabela = false;
            if (filtroAbaRepasses === "quitados" && (!ehPagamentoOnline && stRepasse !== "pago")) exibirNaTabela = false;

            if (tabelaRepassesCorpo && exibirNaTabela) {
                const tr = document.createElement('tr');
                tr.style.borderBottom = "1px solid #e4e7eb";
                tr.innerHTML = `
                    <td style="padding:10px 12px; color:#57606f;">${objetoData.toLocaleString('pt-br', {dateStyle:'short', timeStyle:'short'})}</td>
                    <td style="padding:10px 12px; font-weight:600; color:#2f3542;">#${escaparHTML(p.id.slice(0,7).toUpperCase())}</td>
                    <td style="padding:10px 12px; font-size:0.75rem;">${tagDetalhePagamento}</td>
                    <td style="padding:10px 12px; color:#2f3542; font-weight:600;">R$ ${valorBrutoPedido.toFixed(2)}</td>
                    <td style="padding:10px 12px; color:#ff6400; font-weight:600;">R$ ${taxaRetidaPlataforma.toFixed(2)} (${taxaAplicadaPct.toFixed(1)}%)</td>
                    <td style="padding:10px 12px;"><span style="padding:3px 8px; border-radius:12px; font-size:0.75rem; font-weight:600; ${statusRepasseClasse}">${statusRepasseTexto}</span></td>
                `;
                tabelaRepassesCorpo.appendChild(tr);
            }
        } else if (p.status === "cancelado") {
            totalPedidosCanceladosDia++;
        }
    });

    const txtPendente = document.getElementById('txt-total-repasse-pendente');
    const txtQuitado = document.getElementById('txt-total-repasse-quitado');
    const txtSplit = document.getElementById('txt-total-repasse-split');

    if (txtPendente) txtPendente.innerText = totalRepassePendente.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
    if (txtQuitado) txtQuitado.innerText = totalRepasseQuitado.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
    if (txtSplit) txtSplit.innerText = totalRepasseSplit.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });

    const ticketMedioCalculado = totalPedidosConcluidosDia > 0 ? (faturamentoDiaAcumulado / totalPedidosConcluidosDia) : 0;
    const totalPedidosGeralDenominador = (totalPedidosConcluidosDia + totalPedidosCanceladosDia);
    const taxaCancelamentoCalculada = totalPedidosGeralDenominador > 0 ? Math.round((totalPedidosCanceladosDia / totalPedidosGeralDenominador) * 100) : 0;

    document.getElementById('metric-faturamento').innerText = faturamentoDiaAcumulado.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
    document.getElementById('metric-pedidos-qtd').innerText = totalPedidosConcluidosDia;
    document.getElementById('metric-ticket-medio').innerText = ticketMedioCalculado.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
    document.getElementById('metric-taxa-cancelamento').innerText = `${taxaCancelamentoCalculada}%`;

    if (tabelaRepassesCorpo && tabelaRepassesCorpo.children.length === 0) {
        tabelaRepassesCorpo.innerHTML = `<tr><td colspan="6" style="padding:30px; text-align:center; color:#747d8c;">Nenhum repasse ou pedido registrado no filtro selecionado.</td></tr>`;
    }

    const badgeContador = document.getElementById('txt-contador-pedidos-badge');
    if (badgeContador) badgeContador.innerText = contagemPendentes;
    
    renderizarListaPedidosModal();
    sincronizarGraficoFaturamento(mapaCronologicoPeriodo);
}

function sincronizarGraficoFaturamento(dadosMapaCronologico) {
    const ctxCanvas = document.getElementById('graficoFaturamentoLoja');
    if (!ctxCanvas) return;

    const labelsDias = Object.keys(dadosMapaCronologico);
    const valoresFaturamento = Object.values(dadosMapaCronologico);

    if (instanciaGraficoFaturamento) {
        instanciaGraficoFaturamento.data.labels = labelsDias;
        instanciaGraficoFaturamento.data.datasets[0].data = valoresFaturamento;
        instanciaGraficoFaturamento.data.datasets[0].pointRadius = labelsDias.length > 30 ? 1 : 4;
        instanciaGraficoFaturamento.update();
    } else {
        instanciaGraficoFaturamento = new Chart(ctxCanvas, {
            type: 'line',
            data: {
                labels: labelsDias,
                datasets: [{
                    label: 'Faturamento Bruto (R$)',
                    data: valoresFaturamento,
                    borderColor: '#ff6400',
                    backgroundColor: 'rgba(255, 100, 0, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#ff6400',
                    pointRadius: labelsDias.length > 30 ? 1 : 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) { return 'R$ ' + value.toFixed(2); },
                            font: { family: 'Poppins', size: 10 }
                        }
                    },
                    x: {
                        ticks: { 
                            font: { family: 'Poppins', size: 10 },
                            maxTicksLimit: 12
                        }
                    }
                }
            }
        });
    }
}

document.getElementById('btn-exportar-csv').onclick = () => {
    const linesTabela = document.querySelectorAll('#lista-linhas-repasses-financeiros tr');
    if (linesTabela.length === 0 || linesTabela[0].innerText.includes("Nenhum repasse")) {
        mostrarNotificacao("Não há dados consolidados para exportar.", "error");
        return;
    }

    let csvConteudo = "\uFEFF"; 
    csvConteudo += "Data Lancamento;ID Pedido;Modalidade;Valor Venda (R$);Comissao App (R$);Status Repasse\n";

    linesTabela.forEach(tr => {
        const colunas = tr.querySelectorAll('td');
        if (colunas.length === 6) {
            const data = colunas[0].innerText.trim();
            const id = colunas[1].innerText.trim().replace('#', '');
            const modalidade = colunas[2].innerText.trim();
            const bruto = colunas[3].innerText.trim().replace('R$', '').trim();
            const comissao = colunas[4].innerText.trim().replace('R$', '').trim();
            const statusRep = colunas[5].innerText.trim();

            csvConteudo += `${data};${id};${modalidade};${bruto};${comissao};${statusRep}\n`;
        }
    });

    const blobArquivo = new Blob([csvConteudo], { type: 'text/csv;charset=utf-8;' });
    const urlDownload = URL.createObjectURL(blobArquivo);
    const linkGatilho = document.createElement("a");
    
    linkGatilho.setAttribute("href", urlDownload);
    linkGatilho.setAttribute("download", `Fechamento_Repasses_Loja_${idLojaGlobal.slice(0,5)}.csv`);
    linkGatilho.style.visibility = 'hidden';
    
    document.body.appendChild(linkGatilho);
    linkGatilho.click();
    document.body.removeChild(linkGatilho);
    mostrarNotificacao("Relatório CSV baixado com sucesso!");
};

document.getElementById('tab-pedidos-ativos').onclick = (e) => {
    filtroAbaPedidos = "ativos";
    e.target.style.background = "#ff6400";
    document.getElementById('tab-pedidos-historico').style.background = "#747d8c";
    renderizarListaPedidosModal();
};
document.getElementById('tab-pedidos-historico').onclick = (e) => {
    filtroAbaPedidos = "historico";
    e.target.style.background = "#ff6400";
    document.getElementById('tab-pedidos-ativos').style.background = "#747d8c";
    renderizarListaPedidosModal();
};

function renderizarListaPedidosModal() {
    const container = document.getElementById('lista-pedidos-dashboard');
    if (!container) return;
    container.innerHTML = "";

    const pedidosFiltrados = listaPedidosLocal.filter(p => {
        if (filtroAbaPedidos === "ativos") return p.status === "pendente" || p.status === "preparo" || p.status === "entrega";
        return p.status === "concluido" || p.status === "cancelado";
    });

    if (pedidosFiltrados.length === 0) {
        container.innerHTML = `<p style='text-align:center; padding:2rem; color:#747d8c;'>Nenhum pedido nesta seção.</p>`;
        return;
    }

    pedidosFiltrados.sort((a, b) => converterTimestamp(b.dataCriacao || b.dataPedido).getTime() - converterTimestamp(a.dataCriacao || a.dataPedido).getTime());

    pedidosFiltrados.forEach(p => {
        const dataObjeto = converterTimestamp(p.dataCriacao || p.dataPedido);
        const itemDiv = document.createElement('div');
        itemDiv.className = "card-pedido-item";

        let strItens = (p.itens || []).map(i => `<span class="item-qtd">${i.quantidade}x</span> ${escaparHTML(i.nome)}`).join('<br>');
        
        const isPixExpirado = p.status === "cancelado" && (p.statusPagamento === "expirado" || (p.motivoCancelamento && p.motivoCancelamento.toLowerCase().includes("tempo")));
        
        let corStatus = "#ffa502"; 
        let txtStatusBadge = p.status;

        if (isPixExpirado) {
            corStatus = "#e74c3c";
            txtStatusBadge = "Pix Expirado";
        } else if (p.status === "preparo") {
            corStatus = "#1e90ff";
        } else if (p.status === "entrega") {
            corStatus = "#9b59b6";
        } else if (p.status === "concluido") {
            corStatus = "#2ed573";
        } else if (p.status === "cancelado") {
            corStatus = "#c0392b";
            txtStatusBadge = "Cancelado";
        }

        let strEntrega = "";
        if (p.tipoEntrega === "retirada" || p.enderecoEntrega === "Retirada no Balcão") {
            strEntrega = `<span class="texto-retirada"><i class="fa-solid fa-store"></i> Retirada no Balcão</span>`;
        } else if (p.enderecoEntrega && typeof p.enderecoEntrega === 'object') {
            const end = p.enderecoEntrega;
            strEntrega = `<strong>Delivery:</strong> ${escaparHTML(end.rua)}, Nº ${escaparHTML(end.numero)} - ${escaparHTML(end.bairro)}`;
        } else if (typeof p.enderecoEntrega === 'string') {
            strEntrega = `<strong>Delivery:</strong> ${escaparHTML(p.enderecoEntrega)}`;
        }

        let htmlBotoesAcao = "";

        const pixPendente = (p.formaPagamento && p.formaPagamento.toLowerCase() === "pix") && p.statusPagamento !== "pago" && p.status !== "cancelado";
        const jaEstaPago = p.statusPagamento === "pago";

        if (pixPendente && p.status === "pendente") {
            htmlBotoesAcao = `
                <button class="btn-salvar btn-aguardando-pix-ped" id="btn-aguardando-${p.id}">
                    <i class="fa-solid fa-clock-rotate-left"></i> Aguardando Pix
                </button>
                <button class="btn-salvar btn-recusar-ped" id="btn-recusar-${p.id}" title="Cancelar Pedido"><i class="fa-solid fa-xmark"></i> Recusar</button>
            `;
        } else if (p.status === "pendente") {
            htmlBotoesAcao = `
                <button class="btn-salvar btn-aceitar-ped" id="btn-aceitar-${p.id}"><i class="fa-solid fa-utensils"></i> Aceitar</button>
                <button class="btn-salvar btn-recusar-ped" id="btn-recusar-${p.id}" title="Cancelar Pedido"><i class="fa-solid fa-xmark"></i> Recusar</button>
            `;
        } else if (p.status === "preparo") {
            const txtBotao = (p.tipoEntrega === "retirada" || p.enderecoEntrega === "Retirada no Balcão") ? "Pronto" : "Despachar";
            htmlBotoesAcao = `
                <button class="btn-salvar btn-despachar-ped" id="btn-despachar-${p.id}"><i class="fa-solid fa-motorcycle"></i> ${txtBotao}</button>
                <button class="btn-salvar btn-recusar-ped" id="btn-recusar-${p.id}" title="Cancelar Pedido em Preparo"><i class="fa-solid fa-xmark"></i> Cancelar</button>
            `;
        } else if (p.status === "entrega") {
            htmlBotoesAcao = `
                <button class="btn-salvar btn-finalizar-ped" id="btn-finalizar-${p.id}"><i class="fa-solid fa-circle-check"></i> Finalizar</button>
                <button class="btn-salvar btn-recusar-ped" id="btn-recusar-${p.id}" title="Cancelar Pedido a Caminho"><i class="fa-solid fa-xmark"></i> Cancelar</button>
            `;
        }

        let htmlMotivoExibicao = "";
        if (p.status === "cancelado" && p.motivoCancelamento) {
            htmlMotivoExibicao = `<p class="box-motivo-recusa">Recusa: "${escaparHTML(p.motivoCancelamento)}"</p>`;
        }

        const dataHoraPedido = dataObjeto.getTime() !== 0 
            ? dataObjeto.toLocaleString('pt-br', { dateStyle: 'short', timeStyle: 'short' }) 
            : '--/-- --:--';

        itemDiv.innerHTML = `
            <div class="card-pedido-header-linha">
                <div>
                    <span class="card-pedido-id-txt">ID: #${escaparHTML(p.id.slice(0,6).toUpperCase())} • <i class="fa-regular fa-clock"></i> ${dataHoraPedido}</span>
                    <h4 class="card-pedido-cliente-nome"><i class="fa-regular fa-user"></i> ${escaparHTML(p.clientNome || "Cliente")}</h4>
                </div>
                <span class="badge-status-materia" style="background:${corStatus};">${escaparHTML(txtStatusBadge)}</span>
            </div>
            <div class="card-pedido-corpo-conteudo">
                <div class="box-itens-detalhe">${strItens}</div>
                <p class="txt-entrega-detalhe">${strEntrega}</p>
                <p class="txt-pagamento-detalhe"><strong>Pagamento:</strong> ${escaparHTML(p.formaPagamento || 'Pix')} ${jaEstaPago ? ' <span class="tag-pago-sucesso">(Pago)</span>' : ''} ${p.troco && p.troco !== 'Não se aplica' ? ` (Troco: ${escaparHTML(p.troco)})` : ''}</p>
                ${htmlMotivoExibicao}
            </div>
            <div class="card-pedido-footer-linha">
                <span class="txt-valor-total-pedido">R$ ${parseFloat(p.total || 0).toFixed(2)}</span>
                <div class="wrapper-botoes-acoes">${htmlBotoesAcao}</div>
            </div>
        `;
        container.appendChild(itemDiv);

        if (p.status === "pendente") {
            if (!pixPendente) {
                const btnAceitar = itemDiv.querySelector(`#btn-aceitar-${p.id}`);
                if (btnAceitar) btnAceitar.onclick = () => window.alterarStatusPedido(p.id, 'preparo');
            }
            const btnRecusar = itemDiv.querySelector(`#btn-recusar-${p.id}`);
            if (btnRecusar) btnRecusar.onclick = () => window.abrirModalRecusa(p.id);

        } else if (p.status === "preparo") {
            const btnDespachar = itemDiv.querySelector(`#btn-despachar-${p.id}`);
            if (btnDespachar) btnDespachar.onclick = () => window.alterarStatusPedido(p.id, 'entrega');

            const btnRecusar = itemDiv.querySelector(`#btn-recusar-${p.id}`);
            if (btnRecusar) btnRecusar.onclick = () => window.abrirModalRecusa(p.id);

        } else if (p.status === "entrega") {
            const btnFinalizar = itemDiv.querySelector(`#btn-finalizar-${p.id}`);
            if (btnFinalizar) btnFinalizar.onclick = () => window.alterarStatusPedido(p.id, 'concluido');

            const btnRecusar = itemDiv.querySelector(`#btn-recusar-${p.id}`);
            if (btnRecusar) btnRecusar.onclick = () => window.abrirModalRecusa(p.id);
        }
    });
}

/* ============================================================
   IMPRESSÃO TÉRMICA DA NOTINHA DO PEDIDO (80mm / 58mm)
   ============================================================ */
function imprimirNotinhaPedido(pedido) {
    if (!pedido) return;

    const dataObj = converterTimestamp(pedido.dataCriacao || pedido.dataPedido);
    const dataFormatada = dataObj.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    let linhasItens = '';
    (pedido.itens || []).forEach(item => {
        const totalItem = ((parseFloat(item.preco) || 0) * (item.quantidade || 1)).toFixed(2);
        linhasItens += `
            <div class="linha-item">
                <span>${item.quantidade}x ${escaparHTML(item.nome)}</span>
                <span class="preco-item">R$ ${totalItem}</span>
            </div>
        `;
        if (item.observacoes || item.obs) {
            linhasItens += `<div class="obs-item">Obs: ${escaparHTML(item.observacoes || item.obs)}</div>`;
        }
    });

    let dadosEntregaHtml = '';
    if (pedido.tipoEntrega === 'retirada' || pedido.enderecoEntrega === 'Retirada no Balcão') {
        dadosEntregaHtml = `<strong>RETIRADA NO BALCÃO</strong>`;
    } else if (pedido.enderecoEntrega && typeof pedido.enderecoEntrega === 'object') {
        const end = pedido.enderecoEntrega;
        dadosEntregaHtml = `
            <strong>ENTREGA (DELIVERY)</strong><br>
            ${escaparHTML(end.rua)}, Nº ${escaparHTML(end.numero)} - ${escaparHTML(end.bairro)}<br>
            ${end.complemento ? `Compl: ${escaparHTML(end.complemento)}<br>` : ''}
            ${end.referencia ? `Ref: ${escaparHTML(end.referencia)}<br>` : ''}
        `;
    } else if (typeof pedido.enderecoEntrega === 'string') {
        dadosEntregaHtml = `<strong>ENTREGA (DELIVERY)</strong><br>${escaparHTML(pedido.enderecoEntrega)}`;
    }

    const nomeLojaLimpo = escaparHTML(pedido.nomeLoja || tituloLoja?.innerText || 'NORDGO FOOD');
    const idPedidoLimpo = escaparHTML(pedido.id.slice(0, 6).toUpperCase());

    const conteudoHtml = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Imprimir Pedido #${idPedidoLimpo}</title>
            <style>
                @page { margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 13px;
                    width: 72mm;
                    margin: 0 auto;
                    padding: 8px 4px;
                    color: #000;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .bold { font-weight: bold; }
                .divisor { border-top: 1px dashed #000; margin: 6px 0; }
                .titulo-loja { font-size: 16px; font-weight: bold; margin-bottom: 2px; }
                .id-pedido { font-size: 18px; font-weight: bold; margin: 4px 0; }
                .linha-item { display: flex; justify-content: space-between; margin: 4px 0; }
                .preco-item { white-space: nowrap; margin-left: 4px; }
                .obs-item { font-size: 11px; padding-left: 10px; font-style: italic; }
                .totais-linha { display: flex; justify-content: space-between; margin: 3px 0; }
                .total-destaque { font-size: 15px; font-weight: bold; margin-top: 4px; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <div class="titulo-loja">${nomeLojaLimpo}</div>
                <div>Data: ${dataFormatada}</div>
                <div class="id-pedido">PEDIDO #${idPedidoLimpo}</div>
            </div>

            <div class="divisor"></div>

            <div class="cliente-info">
                <strong>Cliente:</strong> ${escaparHTML(pedido.clientNome || 'Não informado')}<br>
                ${pedido.telefoneCliente ? `<strong>Tel:</strong> ${escaparHTML(pedido.telefoneCliente)}<br>` : ''}
                ${dadosEntregaHtml}
            </div>

            <div class="divisor"></div>

            <div class="bold text-center">ITENS DO PEDIDO</div>
            ${linhasItens}

            <div class="divisor"></div>

            <div class="totais-bloco">
                <div class="totais-linha">
                    <span>Subtotal:</span>
                    <span>R$ ${(parseFloat(pedido.subtotal) || parseFloat(pedido.total) || 0).toFixed(2)}</span>
                </div>
                ${pedido.taxaEntrega ? `
                <div class="totais-linha">
                    <span>Taxa de Entrega:</span>
                    <span>R$ ${parseFloat(pedido.taxaEntrega).toFixed(2)}</span>
                </div>` : ''}
                ${pedido.desconto ? `
                <div class="totais-linha">
                    <span>Desconto:</span>
                    <span>- R$ ${parseFloat(pedido.desconto).toFixed(2)}</span>
                </div>` : ''}
                <div class="totais-linha total-destaque">
                    <span>TOTAL:</span>
                    <span>R$ ${parseFloat(pedido.total || 0).toFixed(2)}</span>
                </div>
            </div>

            <div class="divisor"></div>

            <div class="pagamento-info">
                <strong>Forma de Pagamento:</strong> ${escaparHTML(pedido.formaPagamento || 'Pix')}<br>
                ${pedido.troco && pedido.troco !== 'Não se aplica' ? `<strong>Troco para:</strong> ${escaparHTML(pedido.troco)}<br>` : ''}
                ${pedido.statusPagamento === 'pago' ? '<strong>STATUS: PAGO ONLINE</strong>' : '<strong>STATUS: PAGAR NA ENTREGA</strong>'}
            </div>

            <div class="divisor"></div>
            <div class="text-center" style="font-size: 11px; margin-top: 8px;">
                Obrigado pela preferência!<br>
                NordGo Delivery
            </div>

            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(() => window.close(), 500);
                };
            </script>
        </body>
        </html>
    `;

    const janelaImpressao = window.open('', '_blank', 'width=350,height=600');
    if (janelaImpressao) {
        janelaImpressao.document.open();
        janelaImpressao.document.write(conteudoHtml);
        janelaImpressao.document.close();
    } else {
        mostrarNotificacao("Permita pop-ups no navegador para imprimir automaticamente.", "info");
    }
}

/* ============================================================
   MUDANÇA DE STATUS DE PEDIDO COM BATCH
   ============================================================ */
window.alterarStatusPedido = async (idPedido, novoStatus) => {
    try {
        await updateDoc(doc(db, "pedidos", idPedido), { status: novoStatus });
        
        if (novoStatus === 'preparo') {
            const pedidoData = listaPedidosLocal.find(p => p.id === idPedido);
            if (pedidoData) {
                imprimirNotinhaPedido(pedidoData);
            }
        }

        if (novoStatus === 'concluido') {
            const pedidoData = listaPedidosLocal.find(p => p.id === idPedido);
            
            if (pedidoData && pedidoData.itens && pedidoData.itens.length > 0) {
                const batchVendas = writeBatch(db);
                
                pedidoData.itens.forEach(item => {
                    if (item.id) {
                        const realProdutoId = item.id.includes('_v_') ? item.id.split('_v_')[0] : item.id;
                        const produtoRef = doc(db, "produtos", realProdutoId);
                        batchVendas.update(produtoRef, {
                            vendas: increment(Number(item.quantidade) || 1)
                        });
                    }
                });

                await batchVendas.commit();
            }
        }
        
        mostrarNotificacao(`Pedido alterado para "${novoStatus}" com sucesso!`);
    } catch (err) { 
        console.error("Erro ao atualizar status:", err);
        mostrarNotificacao("Permissão negada ou falha ao alterar status.", "error"); 
    }
};

window.abrirModalRecusa = (idPedido) => {
    const pedidoObj = listaPedidosLocal.find(p => p.id === idPedido);
    document.getElementById('cancelar-pedido-id').value = idPedido;
    document.getElementById('txt-motivo-recusa').value = "";

    if (pedidoObj && pedidoObj.statusPagamento === "pago") {
        mostrarNotificacao("Atenção: Este pedido já consta como PAGO. O cancelamento registrará a solicitação de estorno.", "info");
    }

    window.abrirModal('modal-motivo-cancelamento');
};

document.getElementById('form-motivo-cancelamento').onsubmit = async (e) => {
    e.preventDefault();
    const idPedido = document.getElementById('cancelar-pedido-id').value;
    const motivoTexto = document.getElementById('txt-motivo-recusa').value.trim();
    const btnSubmit = e.target.querySelector('button[type="submit"]');

    btnSubmit.disabled = true; btnSubmit.innerText = "Processando...";
    try {
        const pedidoObj = listaPedidosLocal.find(p => p.id === idPedido);
        const jaPago = pedidoObj ? (pedidoObj.statusPagamento === "pago") : false;

        await updateDoc(doc(db, "pedidos", idPedido), { 
            status: "cancelado", 
            motivoCancelamento: motivoTexto,
            solicitacaoEstornoPendente: jaPago 
        });

        mostrarNotificacao(jaPago ? "Pedido cancelado! Reembolso registrado." : "Pedido recusado e cliente notificado.");
        window.fecharModal('modal-motivo-cancelamento');
    } catch (err) { 
        mostrarNotificacao("Falha ao salvar recusa.", "error"); 
    } finally { 
        btnSubmit.disabled = false; 
        btnSubmit.innerText = "Confirmar Recusa"; 
    }
};

/* ============================================================
   AUTENTICAÇÃO E INICIALIZAÇÃO DO PAINEL
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const snap = await getDoc(doc(db, "usuarios", user.uid));
            if (snap.exists() && snap.data().loja) { 
                idLojaGlobal = snap.data().loja; 
                await carregarRegioesDoBanco(); 
                await carregarCategoriasSelects();
                await carregarDadosLoja(); 
                renderizarDashboard(); 
                initializeEscutaPedidosRealtime(); 
                
                inicializarEventosMercadoPago();
                await checarRetornoOAuthMercadoPago();
            } else {
                window.location.href = 'login-loja.html';
            }
        } catch (err) {
            console.error("Erro na validação de usuário:", err);
            mostrarNotificacao("Erro ao carregar os dados de acesso.", "error");
        }
    } else {
        window.location.href = 'login.html';
    }
});

/* ============================================================
   DROPDOWN DE SELEÇÃO DE CIDADES
   ============================================================ */
const btnDropdown = document.getElementById('btn-dropdown-cidades');
const listaDropdown = document.getElementById('wrapper-checkboxes-cidades');

if (btnDropdown && listaDropdown) {
    btnDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        listaDropdown.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        if (!btnDropdown.contains(e.target) && !listaDropdown.contains(e.target)) {
            listaDropdown.classList.remove('active');
        }
    });
}
