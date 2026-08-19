import { db, auth, mostrarNotificacao } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    doc, 
    addDoc, 
    getDoc, 
    updateDoc, 
    serverTimestamp,
    limit,
    enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

// ATIVAÇÃO DO CACHE PERSISTENTE LOCAL (REDUÇÃO DE LATÊNCIA)
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

const containerLista = document.getElementById('lista-pedidos-usuario');
const containerVazio = document.getElementById('pedidos-vazio');

// Cache local para armazenar endereços das lojas já consultadas e evitar consultas repetidas
const cacheEnderecosLojas = {};

// Elementos do Modal de Avaliação
const modalAvaliacao = document.getElementById('modal-avaliacao');
const starsSelector = document.getElementById('stars-selector');
const txtComentario = document.getElementById('txt-comentario-aval');
const charCounter = document.getElementById('char-counter');
const btnEnviarAvaliacao = document.getElementById('btn-enviar-avaliacao');
const btnFecharModalAval = document.getElementById('btn-fechar-modal-aval');

// Elementos do Modal de Reembolso
const modalReembolso = document.getElementById('modal-solicitar-reembolso');
const btnFecharModalReembolso = document.getElementById('btn-fechar-modal-reembolso');
const btnCancelarReembolsoModal = document.getElementById('btn-cancelar-reembolso-modal');
const btnConfirmarEnvioReembolso = document.getElementById('btn-confirmar-envio-reembolso');

let pedidoEmAvaliacao = null;
let notaSelecionada = 5;
let pedidoEmReembolsoId = null;

// CONVERSOR SEGURO DE TIMESTAMPS
const converterTimestamp = (campo) => {
    if (!campo) return new Date(0);
    if (typeof campo.toDate === 'function') return campo.toDate();
    if (campo.seconds) return new Date(campo.seconds * 1000);
    const d = new Date(campo);
    return isNaN(d.getTime()) ? new Date(0) : d;
};

// BUSCA ENDEREÇO DA LOJA COM CACHE
async function obterEnderecoLoja(lojaId) {
    if (!lojaId) return "Endereço indisponível";
    if (cacheEnderecosLojas[lojaId]) return cacheEnderecosLojas[lojaId];

    try {
        const docSnap = await getDoc(doc(db, "lojas", lojaId));
        if (docSnap.exists()) {
            const l = docSnap.data();
            const rua = l.ruaLoja || l.rua || "";
            const numero = l.numeroLoja || l.numero || "";
            const bairro = l.bairroLoja || l.bairro || "";
            const cidade = l.cidadeLoja || l.cidade || "";

            let partes = [];
            if (rua) partes.push(rua);
            if (numero) partes.push(`Nº ${numero}`);
            if (bairro) partes.push(bairro);
            if (cidade) partes.push(cidade);

            const enderecoFormatado = partes.length > 0 ? partes.join(', ') : "Endereço não cadastrado";
            cacheEnderecosLojas[lojaId] = enderecoFormatado;
            return enderecoFormatado;
        }
    } catch (err) {
        console.warn("Erro ao buscar endereço da loja:", err);
    }

    cacheEnderecosLojas[lojaId] = "Endereço indisponível";
    return cacheEnderecosLojas[lojaId];
}

// AUTENTICAÇÃO E ESCUTA DOS PEDIDOS (LIMITADO AOS 15 MAIS RECENTES)
onAuthStateChanged(auth, (user) => {
    if (user) {
        inicializarEscutaPedidos(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

function inicializarEscutaPedidos(clientUid) {
    const q = query(
        collection(db, "pedidos"), 
        where("clientId", "==", clientUid),
        limit(15)
    );

    onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
            if (containerVazio) containerVazio.classList.remove('hidden');
            if (containerLista) containerLista.innerHTML = "";
            return;
        }

        if (containerVazio) containerVazio.classList.add('hidden');
        let dadosPedidos = [];

        snapshot.forEach(docSnap => {
            const p = docSnap.data();
            p.id = docSnap.id;
            dadosPedidos.push(p);
        });

        // Ordenação: Mais novo no topo
        dadosPedidos.sort((a, b) => {
            return converterTimestamp(b.dataCriacao || b.dataPedido).getTime() - converterTimestamp(a.dataCriacao || a.dataPedido).getTime();
        });

        await renderizarPedidos(dadosPedidos);
    });
}

// RENDERIZA A BARRA DE PROGRESSO DO PEDIDO
function gerarBarraProgressoHTML(status, formaPagamento, statusPagamento) {
    if (status === "cancelado" || status === "reembolsado" || status === "reembolso_solicitado") return "";

    const isPixPendente = (formaPagamento && formaPagamento.toLowerCase() === "pix") && statusPagamento !== "pago";

    let nivelAtual = 1;
    if (status === "preparo") nivelAtual = 2;
    if (status === "entrega") nivelAtual = 3;
    if (status === "concluido") nivelAtual = 4;

    const getClassStep = (step) => {
        if (nivelAtual > step) return "step-completed";
        if (nivelAtual === step) return "step-active";
        return "";
    };

    const labelEtapa1 = isPixPendente ? "Aguardando Pix" : "Pendente";

    return `
        <div class="stepper-progress-wrapper">
            <div class="stepper-line-bg"></div>
            <div class="stepper-step ${getClassStep(1)}">
                <div class="step-circle"><i class="fa-solid ${isPixPendente ? 'fa-clock' : 'fa-receipt'}"></i></div>
                <span class="step-label">${labelEtapa1}</span>
            </div>
            <div class="stepper-step ${getClassStep(2)}">
                <div class="step-circle"><i class="fa-solid fa-utensils"></i></div>
                <span class="step-label">Na Cozinha</span>
            </div>
            <div class="stepper-step ${getClassStep(3)}">
                <div class="step-circle"><i class="fa-solid fa-motorcycle"></i></div>
                <span class="step-label">A Caminho</span>
            </div>
            <div class="stepper-step ${getClassStep(4)}">
                <div class="step-circle"><i class="fa-solid fa-house-circle-check"></i></div>
                <span class="step-label">Entregue</span>
            </div>
        </div>
    `;
}

async function renderizarPedidos(pedidos) {
    if (!containerLista) return;
    containerLista.innerHTML = "";
    
    const agora = new Date();
    const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
    const fragment = document.createDocumentFragment();

    for (const p of pedidos) {
        const dataObjeto = converterTimestamp(p.dataCriacao || p.dataPedido);
        const tempoDecorridoMinutos = (agora.getTime() - dataObjeto.getTime()) / (1000 * 60);

        if (p.formaPagamento && p.formaPagamento.toLowerCase() === "pix" && p.statusPagamento !== "pago" && p.status === "pendente" && tempoDecorridoMinutos > 5) {
            p.status = "cancelado";
            p.statusPagamento = "expirado";
            p.motivoCancelamento = "Tempo limite de 5 minutos do Pix esgotado sem confirmação.";

            updateDoc(doc(db, "pedidos", p.id), {
                status: "cancelado",
                statusPagamento: "expirado",
                motivoCancelamento: "Tempo limite de 5 minutos do Pix esgotado sem confirmação."
            }).catch(e => console.error("Erro ao sincronizar cancelamento do Pix expirado no banco:", e));
        }

        const card = document.createElement('div');
        card.className = "card-pedido-cliente";

        const isPixPendente = (p.formaPagamento && p.formaPagamento.toLowerCase() === "pix") && p.statusPagamento !== "pago" && p.status !== "cancelado";
        const isPixExpirado = p.status === "cancelado" && (p.statusPagamento === "expirado" || (p.motivoCancelamento && p.motivoCancelamento.toLowerCase().includes("tempo")));

        let corStatus = "#ffa502"; 
        let textoStatus = "Aguardando Confirmação";
        
        if (p.status === "reembolsado") {
            corStatus = "#2e86de";
            textoStatus = "Reembolso Concluído";
        }
        else if (p.status === "reembolso_solicitado") {
            corStatus = "#e67e22";
            textoStatus = "Reembolso em Análise";
        }
        else if (isPixExpirado) { 
            corStatus = "#e74c3c"; 
            textoStatus = "Pix Expirado (Tempo Esgotado)"; 
        }
        else if (p.status === "cancelado") { 
            corStatus = "#c0392b"; 
            textoStatus = "Pedido Cancelado / Recusado"; 
        }
        else if (isPixPendente) { 
            corStatus = "#e67e22"; 
            textoStatus = "Aguardando Pix"; 
        }
        else if (p.status === "preparo") { 
            corStatus = "#1e90ff"; 
            textoStatus = "Na Cozinha / Em Preparo"; 
        }
        else if (p.status === "entrega") { 
            corStatus = "#9b59b6"; 
            textoStatus = p.tipoEntrega === "retirada" ? "Pronto para Retirada!" : "Saiu para Entrega"; 
        }
        else if (p.status === "concluido") { 
            corStatus = "#2ed573"; 
            textoStatus = "Entregue / Concluído"; 
        }

        let dataExibicao = dataObjeto.getTime() !== 0 
            ? dataObjeto.toLocaleString('pt-br', { dateStyle: 'short', timeStyle: 'short' }) 
            : "--/-- --:--";

        // MONTAGEM DO CAMPO DE LOGÍSTICA (DELIVERY OU RETIRADA COM ENDEREÇO DA LOJA)
        let htmlInfoEntregaOuRetirada = "";
        const ehRetirada = p.tipoEntrega === "retirada" || p.enderecoEntrega === "Retirada no Balcão";

        if (ehRetirada) {
            const enderecoLoja = await obterEnderecoLoja(p.lojaId);
            htmlInfoEntregaOuRetirada = `
                <div class="pedido-item-linha" style="margin-top: 0.5rem; background: #f8f9fa; padding: 8px 10px; border-radius: 6px; border-left: 3px solid #ff6400;">
                    <span style="font-size: 0.85rem; color: #2f3542;">
                        <i class="fa-solid fa-store" style="color: #ff6400; margin-right: 4px;"></i> 
                        <strong>Retirada no Balcão:</strong> ${enderecoLoja}
                    </span>
                </div>
            `;
        } else if (p.enderecoEntrega && typeof p.enderecoEntrega === 'object') {
            const end = p.enderecoEntrega;
            htmlInfoEntregaOuRetirada = `
                <div class="pedido-item-linha" style="margin-top: 0.5rem; color: #57606f; font-size: 0.85rem;">
                    <span><i class="fa-solid fa-location-dot" style="color: #2ed573;"></i> <strong>Entregar em:</strong> ${end.rua || ''}, ${end.numero || ''} - ${end.bairro || ''}</span>
                </div>
            `;
        }

        let htmlItens = p.itens.map(i => `
            <div class="pedido-item-linha">
                <span><strong class="pedido-item-qtd">${i.quantidade}x</strong> ${i.nome}</span>
                <span>R$ ${(i.preco * i.quantidade).toFixed(2)}</span>
            </div>
        `).join('');

        let htmlFreteLinha = `
            <div class="pedido-item-linha" style="margin-top: 0.5rem; color: #747d8c;">
                <span><i class="fa-solid fa-truck"></i> Taxa de Entrega:</span>
                <span>${p.frete > 0 ? `R$ ${parseFloat(p.frete).toFixed(2)}` : 'Grátis'}</span>
            </div>
        `;

        let htmlDescontoLinha = "";
        if (p.desconto && parseFloat(p.desconto) > 0) {
            htmlDescontoLinha = `
                <div class="pedido-item-linha" style="color: #2ed573; font-weight: 600; font-size: 0.85rem; margin-top: 0.25rem;">
                    <span><i class="fa-solid fa-ticket"></i> Desconto Aplicado:</span>
                    <span>- R$ ${parseFloat(p.desconto).toFixed(2)}</span>
                </div>
            `;
        }

        let htmlCancelamento = p.status === "cancelado" ? `
            <div class="box-cancelamento" style="background: #fff0f0; border-left: 4px solid ${corStatus}; padding: 10px 12px; margin-top: 10px; border-radius: 4px; font-size: 0.88rem; color: #c0392b; display: flex; align-items: flex-start; gap: 8px;">
                <i class="fa-solid fa-circle-exclamation" style="margin-top: 2px;"></i>
                <div><strong>Motivo:</strong> ${p.motivoCancelamento || "O pagamento via Pix não foi concluído dentro do tempo limite de 5 minutos."}</div>
            </div>
        ` : "";

        let htmlBoxReembolso = "";
        if (p.solicitacaoReembolso) {
            const sol = p.solicitacaoReembolso;
            if (sol.status === "em_analise") {
                htmlBoxReembolso = `
                    <div style="background: #fff8e1; border-left: 4px solid #ffb300; padding: 10px 12px; margin-top: 10px; border-radius: 4px; font-size: 0.88rem; color: #8c6d00;">
                        <strong><i class="fa-solid fa-hourglass-half"></i> Reembolso em Análise:</strong> "<em>${sol.motivo}</em>". O lojista/plataforma está analisando seu pedido.
                    </div>
                `;
            } else if (sol.status === "aprovado") {
                htmlBoxReembolso = `
                    <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 10px 12px; margin-top: 10px; border-radius: 4px; font-size: 0.88rem; color: #0d47a1;">
                        <strong><i class="fa-solid fa-circle-check"></i> Reembolso Aprovado:</strong> O valor total foi estornado e devolvido para a sua conta.
                    </div>
                `;
            } else if (sol.status === "recusado") {
                htmlBoxReembolso = `
                    <div style="background: #ffebee; border-left: 4px solid #f44336; padding: 10px 12px; margin-top: 10px; border-radius: 4px; font-size: 0.88rem; color: #b71c1c;">
                        <strong><i class="fa-solid fa-circle-xmark"></i> Reembolso Recusado:</strong> ${sol.justificativaAnalise || "Solicitação não atendeu aos critérios."}
                    </div>
                `;
            }
        }

        let htmlBotaoResgatarPix = "";
        if (isPixPendente && p.transacaoId) {
            htmlBotaoResgatarPix = `
                <div style="margin-top: 0.8rem;">
                    <button style="width: 100%; background: #32bcad; color: #ffffff; border: none; padding: 10px; border-radius: 8px; font-weight: 600; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;"
                            onclick="window.location.href='pagamento.html?transacaoId=${p.transacaoId}'">
                        <i class="fa-solid fa-qrcode"></i> Abrir QR Code do Pix (Pendente)
                    </button>
                </div>
            `;
        }

        let htmlAcaoAvaliacao = "";
        let htmlBotaoReembolso = "";

        if ((p.status === "concluido" || p.statusPagamento === "pago") && p.status !== "reembolsado" && p.status !== "reembolso_solicitado" && !p.solicitacaoReembolso) {
            htmlBotaoReembolso = `
                <button class="btn-solicitar-reembolso" 
                        style="background: transparent; color: #e74c3c; border: 1px solid #e74c3c; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 0.8rem; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;"
                        onclick="window.abrirModalSolicitarReembolso('${p.id}', '${p.nomeLoja.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-rotate-left"></i> Solicitar Reembolso
                </button>
            `;
        }

        if (p.status === "concluido") {
            const tempoDecorrido = agora.getTime() - dataObjeto.getTime();
            const prazoExpirado = tempoDecorrido > SETE_DIAS_MS;

            if (p.avaliado) {
                htmlAcaoAvaliacao = `
                    <span style="font-size: 0.8rem; color: #2ed573; font-weight: 600; background: rgba(46, 213, 115, 0.1); padding: 4px 10px; border-radius: 20px;">
                        <i class="fa-solid fa-check"></i> Pedido Avaliado
                    </span>
                `;
            } else if (prazoExpirado) {
                htmlAcaoAvaliacao = `
                    <span style="font-size: 0.8rem; color: #747d8c; font-weight: 500; background: #f1f2f6; padding: 4px 10px; border-radius: 20px;">
                        <i class="fa-regular fa-clock"></i> Prazo de avaliação expirado
                    </span>
                `;
            } else {
                htmlAcaoAvaliacao = `
                    <button class="btn-avaliar-card" 
                            style="background: #ffa502; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 600; font-size: 0.85rem; cursor: pointer;"
                            onclick="window.abrirModalAvaliacao('${p.id}', '${p.lojaId}', '${p.nomeLoja.replace(/'/g, "\\'")}')">
                        <i class="fa-solid fa-star"></i> Avaliar Pedido
                    </button>
                `;
            }
        }

        card.innerHTML = `
            <div class="pedido-header">
                <div>
                    <h3 class="pedido-loja-titulo"><i class="fa-solid fa-store pedido-loja-icon"></i> ${p.nomeLoja}</h3>
                    <div class="pedido-meta"><i class="fa-regular fa-clock"></i> ${dataExibicao} • ID: ...${p.id.slice(-6).toUpperCase()}</div>
                </div>
                <span class="badge-status" style="background: ${corStatus}">${textoStatus}</span>
            </div>

            ${gerarBarraProgressoHTML(p.status, p.formaPagamento, p.statusPagamento)}

            <div class="pedido-corpo-itens">
                ${htmlItens}
                ${htmlInfoEntregaOuRetirada}
                ${htmlFreteLinha}
                ${htmlDescontoLinha}
            </div>
            ${htmlCancelamento}
            ${htmlBoxReembolso}
            <div class="pedido-footer">
                <span>Pagamento: <strong>${p.formaPagamento}</strong></span>
                <span class="pedido-total-texto">Total: R$ ${p.total.toFixed(2)}</span>
            </div>
            ${htmlBotaoResgatarPix}
            <div style="margin-top: 0.8rem; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                ${htmlBotaoReembolso}
                <div style="margin-left: auto;">${htmlAcaoAvaliacao}</div>
            </div>
        `;
        fragment.appendChild(card);
    }

    containerLista.appendChild(fragment);
}

// LÓGICA DAS ESTRELAS
if (starsSelector) {
    const stars = starsSelector.querySelectorAll('.star-btn');
    
    function atualizarEstrelasVisual(valor) {
        stars.forEach(star => {
            const starValue = parseInt(star.dataset.value);
            star.style.color = starValue <= valor ? '#ffa502' : '#dcdde1';
        });
    }

    stars.forEach(star => {
        star.addEventListener('click', (e) => {
            notaSelecionada = parseInt(e.currentTarget.dataset.value);
            atualizarEstrelasVisual(notaSelecionada);
        });
    });

    atualizarEstrelasVisual(5);
}

// CONTADOR DE CARACTERES
if (txtComentario && charCounter) {
    txtComentario.addEventListener('input', () => {
        charCounter.innerText = `${txtComentario.value.length} / 100`;
    });
}

// ABRIR MODAL DE AVALIAÇÃO
window.abrirModalAvaliacao = (pedidoId, lojaId, lojaNome) => {
    pedidoEmAvaliacao = { id: pedidoId, lojaId: lojaId, lojaNome: lojaNome };
    notaSelecionada = 5;
    
    if (txtComentario) txtComentario.value = '';
    if (charCounter) charCounter.innerText = '0 / 100';
    if (starsSelector) {
        const stars = starsSelector.querySelectorAll('.star-btn');
        stars.forEach(s => s.style.color = '#ffa502');
    }

    const sub = document.getElementById('modal-aval-subtitulo');
    if (sub) sub.innerText = `Avaliando pedido em: ${lojaNome}`;
    
    if (modalAvaliacao) modalAvaliacao.classList.add('active');
};

// FECHAR MODAL DE AVALIAÇÃO
if (btnFecharModalAval) {
    btnFecharModalAval.onclick = () => {
        if (modalAvaliacao) modalAvaliacao.classList.remove('active');
        pedidoEmAvaliacao = null;
    };
}

if (modalAvaliacao) {
    modalAvaliacao.addEventListener('click', (e) => {
        if (e.target === modalAvaliacao) {
            modalAvaliacao.classList.remove('active');
            pedidoEmAvaliacao = null;
        }
    });
}

// ENVIAR AVALIAÇÃO PARA O FIRESTORE
if (btnEnviarAvaliacao) {
    btnEnviarAvaliacao.onclick = async () => {
        if (!pedidoEmAvaliacao) return;

        const comentario = txtComentario ? txtComentario.value.trim() : '';
        const user = auth.currentUser;

        if (!user) {
            alert("Você precisa estar logado para enviar uma avaliação.");
            return;
        }

        try {
            btnEnviarAvaliacao.disabled = true;
            btnEnviarAvaliacao.innerText = "Enviando...";

            await addDoc(collection(db, "avaliacoes"), {
                pedidoId: pedidoEmAvaliacao.id,
                lojaId: pedidoEmAvaliacao.lojaId,
                clienteUid: user.uid,
                clienteNome: user.displayName || 'Cliente',
                nota: notaSelecionada,
                comentario: comentario,
                criadoEm: serverTimestamp()
            });

            await updateDoc(doc(db, "pedidos", pedidoEmAvaliacao.id), {
                avaliado: true
            });

            if (typeof mostrarNotificacao === "function") {
                mostrarNotificacao("Sua avaliação foi enviada com sucesso!", "sucesso");
            } else {
                alert("Sua avaliação foi enviada com sucesso!");
            }

            if (modalAvaliacao) modalAvaliacao.classList.remove('active');
            pedidoEmAvaliacao = null;

        } catch (err) {
            console.error("Erro ao salvar avaliação:", err);
            alert("Erro ao salvar avaliação. Tente novamente.");
        } finally {
            btnEnviarAvaliacao.disabled = false;
            btnEnviarAvaliacao.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviar Avaliação`;
        }
    };
}

/* ============================================================
   LÓGICA DO MODAL DE SOLICITAÇÃO DE REEMBOLSO
   ============================================================ */

async function carregarMotivosCancelamentoBanco() {
    const selectMotivo = document.getElementById('select-motivo-reembolso');
    if (!selectMotivo) return;

    try {
        const docRef = doc(db, "configuracoes", "motivos_cancelamento");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && Array.isArray(docSnap.data().lista) && docSnap.data().lista.length > 0) {
            selectMotivo.innerHTML = docSnap.data().lista.map(m => `<option value="${m}">${m}</option>`).join('');
        } else {
            selectMotivo.innerHTML = `
                <option value="Pedido veio incompleto ou faltando itens">Pedido veio incompleto ou faltando itens</option>
                <option value="Produto com problemas de qualidade">Produto com problemas de qualidade</option>
                <option value="Atraso excessivo na entrega">Atraso excessivo na entrega</option>
                <option value="Pedido incorreto / trocado por outro">Pedido incorreto / trocado por outro</option>
                <option value="Outro motivo">Outro motivo</option>
            `;
        }
    } catch (e) {
        console.warn("Erro ao buscar motivos no banco:", e);
        selectMotivo.innerHTML = `<option value="Outro motivo">Outro motivo</option>`;
    }
}

// Função global para acionamento nos cards
window.abrirModalSolicitarReembolso = async (pedidoId, lojaNome) => {
    pedidoEmReembolsoId = pedidoId;

    const modalReembolsoElem = document.getElementById('modal-solicitar-reembolso');
    const sub = document.getElementById('txt-reembolso-subtitulo');
    const txtDetalhes = document.getElementById('txt-detalhes-reembolso');

    if (sub) sub.innerText = `Solicitando reembolso para: ${lojaNome}`;
    if (txtDetalhes) txtDetalhes.value = '';

    await carregarMotivosCancelamentoBanco();

    if (modalReembolsoElem) {
        modalReembolsoElem.classList.add('active');
    } else {
        console.error("Elemento #modal-solicitar-reembolso não foi encontrado no DOM.");
    }
};

function fecharModalReembolso() {
    const modalReembolsoElem = document.getElementById('modal-solicitar-reembolso');
    if (modalReembolsoElem) modalReembolsoElem.classList.remove('active');
    pedidoEmReembolsoId = null;
}

// Vincula os eventos após a montagem do documento
document.addEventListener('DOMContentLoaded', () => {
    const modalReembolsoElem = document.getElementById('modal-solicitar-reembolso');
    const btnFechar = document.getElementById('btn-fechar-modal-reembolso');
    const btnCancelar = document.getElementById('btn-cancelar-reembolso-modal');
    const btnConfirmar = document.getElementById('btn-confirmar-envio-reembolso');

    if (btnFechar) btnFechar.onclick = fecharModalReembolso;
    if (btnCancelar) btnCancelar.onclick = fecharModalReembolso;

    if (modalReembolsoElem) {
        modalReembolsoElem.addEventListener('click', (e) => {
            if (e.target === modalReembolsoElem) fecharModalReembolso();
        });
    }

    if (btnConfirmar) {
        btnConfirmar.onclick = async () => {
            if (!pedidoEmReembolsoId) return;

            const selectMotivo = document.getElementById('select-motivo-reembolso');
            const txtDetalhes = document.getElementById('txt-detalhes-reembolso');

            const motivo = selectMotivo ? selectMotivo.value : "Outro motivo";
            const detalhes = txtDetalhes ? txtDetalhes.value.trim() : "";

            try {
                btnConfirmar.disabled = true;
                btnConfirmar.innerText = "Enviando...";

                const docRef = doc(db, "pedidos", pedidoEmReembolsoId);

                await updateDoc(docRef, {
                    statusAnteriorReembolso: "concluido",
                    status: "reembolso_solicitado",
                    solicitacaoReembolso: {
                        motivo: motivo,
                        detalhes: detalhes,
                        dataSolicitacao: serverTimestamp(),
                        status: "em_analise"
                    }
                });

                if (typeof mostrarNotificacao === "function") {
                    mostrarNotificacao("Solicitação enviada com sucesso!", "sucesso");
                } else {
                    alert("Solicitação enviada com sucesso!");
                }

                fecharModalReembolso();

            } catch (err) {
                console.error("Erro ao enviar reembolso:", err);
                alert("Erro ao enviar solicitação. Tente novamente.");
            } finally {
                btnConfirmar.disabled = false;
                btnConfirmar.innerText = "Enviar Solicitação";
            }
        };
    }
});