import { db } from './firebase-config.js';
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const transacaoId = urlParams.get('transacaoId');

// 1. Puxa os dados dinâmicos do Pix salvos no localStorage
const dadosPixSalvos = JSON.parse(localStorage.getItem('nordgo_render_pix'));

if (!transacaoId || !dadosPixSalvos) {
    alert("Identificador de transação inválido ou dados ausentes.");
    window.location.href = "/index.html";
}

// 2. Extrai os dados do Pix e o Valor Total com fallbacks
let codigoPixCopiaColaGlobal = dadosPixSalvos.qr_code || dadosPixSalvos.qrCodeCopyPaste || dadosPixSalvos.pixCopiaECola || "";
let base64Image = dadosPixSalvos.qr_code_base64 || dadosPixSalvos.qrCodeBase64 || dadosPixSalvos.pixQrCodeBase64 || "";

// Resgata o valor vindo diretamente do retorno da Cloud Function
let valorInicial = parseFloat(dadosPixSalvos.valorTotal || dadosPixSalvos.totalGeral || 0);

// Preenche o valor IMEDIATAMENTE na tela (evita mostrar R$ 0,00 enquanto o Firestore carrega)
const elemValor = document.getElementById('display-valor');
if (elemValor && valorInicial > 0) {
    elemValor.innerText = `R$ ${valorInicial.toFixed(2).replace('.', ',')}`;
}

// Alimenta o código de cópia na tela
const elemDisplayCopia = document.getElementById('display-copia-cola');
if (elemDisplayCopia) {
    elemDisplayCopia.innerText = codigoPixCopiaColaGlobal || "Erro ao carregar código Pix";
}

// Trata a imagem Base64
if (base64Image) {
    const srcFinal = base64Image.startsWith('data:image') 
        ? base64Image 
        : `data:image/png;base64,${base64Image}`;
    const elemQrCode = document.getElementById('display-qrcode');
    if (elemQrCode) elemQrCode.src = srcFinal;
}

// 3. Ação de clique para cópia da chave
const btnCopiar = document.getElementById('btn-copiar-chave');
if (btnCopiar) {
    btnCopiar.onclick = () => {
        if (!codigoPixCopiaColaGlobal) return;
        
        navigator.clipboard.writeText(codigoPixCopiaColaGlobal).then(() => {
            const lbl = document.getElementById('lbl-copiar-status');
            if (lbl) {
                lbl.innerHTML = '<span style="color: #32bcad; font-weight: 600;">Código Pix Copiado! <i class="fa-solid fa-check"></i></span>';
                setTimeout(() => {
                    lbl.innerHTML = 'Clique para copiar o código Pix <i class="fa-regular fa-copy"></i>';
                }, 2500);
            }
        }).catch(err => console.error("Erro ao copiar", err));
    };
}

/* ============================================================
   4. TEMPORIZADOR ABSOLUTO E CANCELAMENTO
   ============================================================ */
let intervaloCronometroPix = null;
let idsDocumentosPedidos = [];

function iniciarCronometroAbsoluto(dataExpiracaoIso) {
    const elemCronometro = document.getElementById('cronometro-pix-tempo');
    if (!elemCronometro) return;

    const timestampLimite = new Date(dataExpiracaoIso).getTime();

    if (intervaloCronometroPix) clearInterval(intervaloCronometroPix);

    intervaloCronometroPix = setInterval(async () => {
        const agora = new Date().getTime();
        const tempoRestanteSegundos = Math.floor((timestampLimite - agora) / 1000);

        if (tempoRestanteSegundos <= 0) {
            clearInterval(intervaloCronometroPix);
            elemCronometro.textContent = "EXPIRADO";
            elemCronometro.style.color = '#e74c3c';
            await cancelarPedidosPorExpiracaoFrontend();
            return;
        }

        const min = Math.floor(tempoRestanteSegundos / 60);
        const seg = tempoRestanteSegundos % 60;
        const textoFormatado = `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;

        elemCronometro.textContent = textoFormatado;

        if (tempoRestanteSegundos <= 60) {
            elemCronometro.style.color = '#e74c3c';
        }
    }, 1000);
}

async function cancelarPedidosPorExpiracaoFrontend() {
    // Não alteramos o banco de dados aqui pelo Frontend (bloqueado pelas regras de segurança).
    // A Cloud Function CRON Job "verificarPedidosPixExpirados" fará o cancelamento oficial no Firestore.
    
    if (intervaloCronometroPix) clearInterval(intervaloCronometroPix);
    localStorage.removeItem('nordgo_render_pix');

    alert("O tempo para pagamento do Pix expirou. O pedido será cancelado.");
    window.location.href = "/index.html";
}

// Inicia o cronômetro
const dataLimitePix = dadosPixSalvos.pixExpiracaoEm || new Date(Date.now() + 5 * 60 * 1000).toISOString();
iniciarCronometroAbsoluto(dataLimitePix);

/* ============================================================
   5. ESCUTA EM TEMPO REAL DOS PEDIDOS NO FIRESTORE (REFORÇADA)
   ============================================================ */

const idPagamentoMP = dadosPixSalvos?.idPagamentoMP ? String(dadosPixSalvos.idPagamentoMP) : null;

// Tenta consultar por transacaoId ou por idPagamentoMP
let q = query(
    collection(db, "pedidos"), 
    where("transacaoId", "==", transacaoId)
);

if (!transacaoId && idPagamentoMP) {
    q = query(
        collection(db, "pedidos"), 
        where("idPagamentoMP", "==", idPagamentoMP)
    );
}

const unsubscribe = onSnapshot(q, (querySnapshot) => {
    if (!querySnapshot.empty) {
        let valorTotalGeral = 0;
        let todosEmPreparo = false;
        let algumCancelado = false;
        let motivoCancelado = "";

        idsDocumentosPedidos = [];

        querySnapshot.forEach((docSnap) => {
            idsDocumentosPedidos.push(docSnap.id);
            const dadosPedido = docSnap.data();
            valorTotalGeral += dadosPedido.total || 0;

            // Checa se o status foi alterado pelo Webhook do Mercado Pago
            if (dadosPedido.status === 'preparo' || dadosPedido.statusPagamento === 'pago') {
                todosEmPreparo = true;
            }

            if (dadosPedido.status === 'cancelado') {
                algumCancelado = true;
                motivoCancelado = dadosPedido.motivoCancelamento || "Pagamento cancelado ou expirado.";
            }
        });
        
        const elemValor = document.getElementById('display-valor');
        if (elemValor && valorTotalGeral > 0) {
            elemValor.innerText = `R$ ${valorTotalGeral.toFixed(2).replace('.', ',')}`;
        }

        // REDIRECIONAMENTO AUTOMÁTICO APÓS CONFIRMAÇÃO DO PIX
        if (todosEmPreparo) {
            if (intervaloCronometroPix) clearInterval(intervaloCronometroPix);

            const blocoProc = document.getElementById('bloco-processamento-pix');
            const blocoSucesso = document.getElementById('bloco-sucesso-pix');

            if (blocoProc) blocoProc.classList.add('hidden');
            if (blocoSucesso) blocoSucesso.classList.remove('hidden');

            localStorage.removeItem('nordgo_render_pix');
            unsubscribe();

            setTimeout(() => {
                window.location.href = "/index.html";
            }, 3000);
        }

        if (algumCancelado) {
            if (intervaloCronometroPix) clearInterval(intervaloCronometroPix);
            localStorage.removeItem('nordgo_render_pix');
            unsubscribe();

            alert(`Aviso do Pedido: ${motivoCancelado}`);
            window.location.href = "/index.html";
        }
    }
}, (error) => {
    console.error("Erro no listener do Pix:", error);
});