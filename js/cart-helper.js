import { auth, mostrarNotificacao } from './firebase-config.js';

/**
 * LÓGICA GLOBAL DO CARRINHO - NORDGO FOOD
 * Gerencia o localStorage e o Carrinho Flutuante (Modelo Retangular Compacto)
 */

// 1. Função para adicionar produtos
window.adicionarAoCarrinho = function(id, nome, preco, imagem, lojaId, nomeLoja) {
    let carrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    
    // Verifica se já existe um item de OUTRA loja
    if (carrinho.length > 0 && carrinho[0].lojaId !== lojaId) {
        if (confirm("Seu carrinho possui itens de outra loja. Deseja limpar o carrinho atual para adicionar este produto?")) {
            carrinho = [];
        } else {
            return;
        }
    }

    const index = carrinho.findIndex(item => item.id === id);

    if (index > -1) {
        carrinho[index].quantidade += 1;
    } else {
        carrinho.push({ 
            id, 
            nome, 
            preco: parseFloat(preco), 
            imagem, 
            lojaId, 
            nomeLoja: nomeLoja || 'Loja', 
            quantidade: 1 
        });
    }

    localStorage.setItem('nordgo_carrinho', JSON.stringify(carrinho));
    
    mostrarNotificacao(`${nome} adicionado ao carrinho!`, 'success');
    
    atualizarCarrinhoFlutuante();
};

// 2. Atualiza a interface do Carrinho Flutuante
export function atualizarCarrinhoFlutuante() {
    const carrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    const flutuante = document.getElementById('floating-cart');
    const contador = document.getElementById('cart-count');
    const totalTxt = document.getElementById('cart-float-total');

    if (!flutuante) return;

    if (carrinho.length > 0) {
        flutuante.classList.remove('hidden');
        
        const qtdTotal = carrinho.reduce((acc, item) => acc + item.quantidade, 0);
        const valorTotal = carrinho.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

        if (contador) contador.innerText = qtdTotal;
        if (totalTxt) totalTxt.innerText = `R$ ${valorTotal.toLocaleString('pt-br', {minimumFractionDigits: 2})}`;
    } else {
        flutuante.classList.add('hidden');
    }
}

// 3. Inicialização automática com o NOVO LAYOUT (Preço sobre Itens)
document.addEventListener('DOMContentLoaded', () => {
    // Se o carrinho ainda não existir no HTML, injetamos o modelo padrão
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

// Função auxiliar de navegação (Lida com caminhos diferentes da Root e Subpastas)
window.redirecionarParaCarrinho = function() {
    const isRoot = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    const pathPrefix = isRoot ? 'html/' : '';
    window.location.href = `${pathPrefix}carrinho.html`;
};