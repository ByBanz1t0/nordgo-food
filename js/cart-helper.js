import { auth, mostrarNotificacao } from './firebase-config.js';

/**
 * LÓGICA GLOBAL DO CARRINHO - NORDGO FOOD
 * Gerencia o localStorage, validação de estabelecimento único e Widget Flutuante.
 */

/**
 * 1. Adiciona produtos ao carrinho (COM TRAVA DE ESTABELECIMENTO ÚNICO E SUPORTE A VARIAÇÕES)
 * @param {string} id - ID único ou Virtual do item (ex: prod123_v_abc)
 * @param {string} nome - Nome do produto
 * @param {string} imagem - URL da imagem
 * @param {string} lojaId - ID da loja no Firestore
 * @param {string} nomeLoja - Nome fantasia da loja
 * @param {number} preco - Preço unitário (já somado com acréscimos se houver)
 * @param {number} quantidade - Quantidade a adicionar (padrão 1)
 * @param {Array} variacoes - Lista de variações/opcionais escolhidos
 * @param {string} observacao - Observação do item (ex: "Sem cebola")
 */
export function adicionarAoCarrinho(
    id, 
    nome, 
    imagem, 
    lojaId, 
    nomeLoja, 
    preco = 0, 
    quantidade = 1, 
    variacoes = [], 
    observacao = ""
) {
    let carrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    const qtdAdicionar = Math.max(1, parseInt(quantidade) || 1);
    const precoNum = Math.max(0, parseFloat(preco) || 0);

    // TRAVA DE ESTABELECIMENTO ÚNICO: Bloqueia itens de lojas diferentes no mesmo carrinho
    if (carrinho.length > 0) {
        const lojaIdCarrinho = carrinho[0].lojaId;
        
        if (lojaId && lojaIdCarrinho && lojaId !== lojaIdCarrinho) {
            const lojaNomeCarrinho = carrinho[0].nomeLoja || "outro estabelecimento";
            const desejaLimpar = confirm(
                `Seu carrinho já contém itens de "${lojaNomeCarrinho}".\n\nDeseja esvaziar o carrinho atual para adicionar itens de "${nomeLoja || 'novo estabelecimento'}"?`
            );
            
            if (desejaLimpar) {
                carrinho = [];
                localStorage.removeItem('nordgo_cupom_global');
                localStorage.removeItem('nordgo_cupons_locais');
            } else {
                return false;
            }
        }
    }

    // Busca item idêntico (mesmo ID e mesma observação)
    const index = carrinho.findIndex(item => item.id === id && (item.observacao || "") === observacao);

    if (index > -1) {
        carrinho[index].quantidade += qtdAdicionar;
    } else {
        carrinho.push({ 
            id: id, 
            nome: nome, 
            imagem: imagem || '../assets/images/placeholder.png', 
            lojaId: lojaId, 
            nomeLoja: nomeLoja || 'Estabelecimento', 
            preco: precoNum, 
            quantidade: qtdAdicionar,
            variacoes: Array.isArray(variacoes) ? variacoes : [],
            observacao: observacao || ""
        });
    }

    localStorage.setItem('nordgo_carrinho', JSON.stringify(carrinho));
    
    mostrarNotificacao(`${nome} adicionado ao carrinho!`, 'success');
    atualizarCarrinhoFlutuante();
    return true;
}
window.adicionarAoCarrinho = adicionarAoCarrinho;

/**
 * 2. Atualiza os dados visuais do Carrinho Flutuante (Quantidade e Subtotal)
 */
export function atualizarCarrinhoFlutuante() {
    const carrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    const flutuante = document.getElementById('floating-cart');
    const contador = document.getElementById('cart-count');
    const totalElemento = document.getElementById('cart-total-flutuante');

    if (!flutuante) return;

    if (carrinho.length > 0) {
        flutuante.classList.remove('hidden');
        
        let qtdTotal = 0;
        let subtotalTotal = 0;

        carrinho.forEach(item => {
            const q = item.quantidade || 1;
            const p = parseFloat(item.preco) || 0;
            qtdTotal += q;
            subtotalTotal += p * q;
        });

        if (contador) contador.innerText = qtdTotal;
        if (totalElemento) {
            totalElemento.innerText = subtotalTotal.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' });
        }
    } else {
        flutuante.classList.add('hidden');
    }
}
window.atualizarCarrinhoFlutuante = atualizarCarrinhoFlutuante;

/**
 * 3. Injeção dinâmica do Widget Flutuante no DOM
 */
document.addEventListener('DOMContentLoaded', () => {
    // Não renderiza o carrinho flutuante na própria página de carrinho ou checkout
    const path = window.location.pathname.toLowerCase();
    if (path.includes('carrinho.html') || path.includes('checkout.html') || path.includes('pagamento.html')) {
        return;
    }

    if (!document.getElementById('floating-cart')) {
        const cartHTML = `
            <div id="floating-cart" class="carrinho-flutuante hidden" onclick="redirecionarParaCarrinho()">
                <div class="cart-icon-container">
                    <i class="fa-solid fa-bag-shopping"></i>
                    <span class="badge-cart-flutuante" id="cart-count">0</span>
                </div>
                <div class="cart-stack-info">
                    <span class="cart-label-ver">Ver Carrinho</span>
                    <span class="cart-total-preco" id="cart-total-flutuante">R$ 0,00</span>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', cartHTML);
    }
    atualizarCarrinhoFlutuante();
});

// ==========================================================================
// SINCRONIZAÇÃO ENTRE ABAS E RECUPERAÇÃO DE SESSÃO (Bfcache)
// ==========================================================================

// A. Sincronização ao voltar no histórico do navegador
window.addEventListener('pageshow', (event) => {
    const veioDoHistorico = event.persisted || 
        (performance.getEntriesByType("navigation")[0]?.type === "back_forward");
    
    if (veioDoHistorico) {
        atualizarCarrinhoFlutuante();
    }
});

// B. Sincronização simultânea entre abas
window.addEventListener('storage', (event) => {
    if (event.key === 'nordgo_carrinho') {
        atualizarCarrinhoFlutuante();
    }
});

// ==========================================================================
// 4. Redirecionamento Determinístico para o Carrinho
// ==========================================================================
window.redirecionarParaCarrinho = function() {
    const path = window.location.pathname;
    
    // Se já estiver dentro de /html/, navega diretamente para carrinho.html
    if (path.includes('/html/')) {
        window.location.href = 'carrinho.html';
    } else {
        // Se estiver na raiz ou qualquer outro diretório
        window.location.href = 'html/carrinho.html';
    }
};