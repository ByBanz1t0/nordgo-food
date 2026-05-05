import { auth, mostrarNotificacao } from './firebase-config.js';

/**
 * LÓGICA GLOBAL DO CARRINHO - NORDGO FOOD
 * Gerencia o localStorage e o Carrinho Flutuante
 */

// 1. Função para adicionar produtos (Chamada no onclick dos botões no index e loja)
window.adicionarAoCarrinho = function(id, nome, preco, imagem, lojaId) {
    let carrinho = JSON.parse(localStorage.getItem('nordgo_carrinho')) || [];
    
    // Verifica se já existe um item de OUTRA loja (opcional: limpar ou avisar)
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
            quantidade: 1 
        });
    }

    localStorage.setItem('nordgo_carrinho', JSON.stringify(carrinho));
    
    // Usa a função que você já tem no seu firebase-config.js
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

// 3. Inicialização automática ao carregar qualquer página
document.addEventListener('DOMContentLoaded', () => {
    // Insere o HTML do carrinho flutuante dinamicamente se não existir
    if (!document.getElementById('floating-cart')) {
        const cartHTML = `
            <div id="floating-cart" class="floating-cart hidden">
                <div class="cart-info" onclick="redirecionarParaCarrinho()">
                    <span id="cart-count">0</span>
                    <i class="fa-solid fa-cart-shopping"></i>
                </div>
                <div class="cart-total" onclick="redirecionarParaCarrinho()">
                    <span id="cart-float-total">R$ 0,00</span>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', cartHTML);
    }
    atualizarCarrinhoFlutuante();
});

// Função auxiliar de navegação
window.redirecionarParaCarrinho = function() {
    const isRoot = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    const pathPrefix = isRoot ? 'html/' : '';
    window.location.href = `${pathPrefix}carrinho.html`;
};
