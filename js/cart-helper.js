import { auth, mostrarNotificacao } from './firebase-config.js';

/**
 * LÓGICA GLOBAL DO CARRINHO - NORDGO FOOD
 * Gerencia o localStorage e o Carrinho Flutuante (Modelo Retangular Compacto)
 * Suporta nativamente produtos simples e produtos customizados/variáveis.
 */

// 1. Função global para adicionar produtos ao carrinho
window.adicionarAoCarrinho = function(id, nome, preco, imagem, lojaId, nomeLoja) {
    let carrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    
    // Trava de segurança: Verifica se já existe um item de OUTRA loja no carrinho
    if (carrinho.length > 0 && carrinho[0].lojaId !== lojaId) {
        if (confirm("Seu carrinho possui itens de outra loja. Deseja limpar o carrinho atual para adicionar este produto?")) {
            carrinho = [];
        } else {
            return; // Cancela a inserção se o cliente recusar limpar
        }
    }

    // Busca o item no carrinho. 
    // Itens simples repetidos vão somar quantidade. Itens customizados novos criam uma nova linha devido ao ID Virtual único.
    const index = carrinho.findIndex(item => item.id === id);

    if (index > -1) {
        carrinho[index].quantidade += 1;
    } else {
        carrinho.push({ 
            id: id, 
            nome: nome, 
            preco: parseFloat(preco) || 0, 
            imagem: imagem, 
            lojaId: lojaId, 
            nomeLoja: nomeLoja || 'Loja', 
            quantidade: 1 
        });
    }

    // Salva o estado atualizado no armazenamento local
    localStorage.setItem('nordgo_carrinho', JSON.stringify(carrinho));
    
    mostrarNotificacao(`${nome} adicionado ao carrinho!`, 'success');
    
    // Updates the widget flutuante na tela do cliente
    atualizarCarrinhoFlutuante();
};

// 2. Atualiza a interface do Carrinho Flutuante (Preço sobre Itens)
export function atualizarCarrinhoFlutuante() {
    const carrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    const flutuante = document.getElementById('floating-cart');
    const contador = document.getElementById('cart-count');
    const totalTxt = document.getElementById('cart-float-total');

    if (!flutuante) return;

    if (carrinho.length > 0) {
        flutuante.classList.remove('hidden');
        
        // Calcula os totais com base no array atual do localStorage
        const qtdTotal = carrinho.reduce((acc, item) => acc + item.quantidade, 0);
        const valorTotal = carrinho.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

        if (contador) contador.innerText = qtdTotal;
        if (totalTxt) totalTxt.innerText = `R$ ${valorTotal.toLocaleString('pt-br', {minimumFractionDigits: 2})}`;
    } else {
        flutuante.classList.add('hidden');
    }
}

// 3. Inicialização e Injeção automática do Widget Flutuante no DOM
document.addEventListener('DOMContentLoaded', () => {
    // Se o carrinho flutuante ainda não existir na página, injeta o HTML padrão estruturado
    if (!document.getElementById('floating-cart')) {
        const cartHTML = `
            <div id="floating-cart" class="carrinho-flutuante hidden" onclick="redirecionarParaCarrinho()">
                <div class="cart-icon-container">
                    <i class="fa-solid fa-cart-shopping"></i>
                </div>
                <div class="cart-stack-info">
                    <span id="cart-float-total" class="carrinho-valor-total">R$ 0,00</span>
                    <span class="cart-count-label"><span id="cart-count">0</span> itens</span>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', cartHTML);
    }
    atualizarCarrinhoFlutuante();
});

// ==========================================================================
// 🔥 AUTOMATIZAÇÃO GLOBAL DE SINCRONIZAÇÃO E CURA DE SESSÕES CONGELADAS (Bfcache)
// ==========================================================================

// A. Resolve o bug do botão "Voltar" do navegador desatualizado
window.addEventListener('pageshow', (event) => {
    const veioDoHistorico = event.persisted || 
        (performance.getEntriesByType("navigation")[0]?.type === "back_forward");
    
    if (veioDoHistorico) {
        console.log("[NordGo Cart] Página reexibida via histórico. Sincronizando pílula...");
        atualizarCarrinhoFlutuante();
    }
});

// B. Resolve o bug de sincronização cruzada de abas/telas em tempo real
window.addEventListener('storage', (event) => {
    if (event.key === 'nordgo_carrinho') {
        console.log("[NordGo Cart] Mudança detectada no LocalStorage. Sincronizando pílula...");
        atualizarCarrinhoFlutuante();
    }
});

// ==========================================================================

// 4. Função auxiliar de navegação (Resolve rotas de forma dinâmica da Home e Subpastas)
window.redirecionarParaCarrinho = function() {
    const isRoot = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    const pathPrefix = isRoot ? 'html/' : '';
    window.location.href = `${pathPrefix}carrinho.html`;
};
