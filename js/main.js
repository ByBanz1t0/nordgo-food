import { auth, db } from './firebase-config.js';
import { 
    collection, 
    getDocs, 
    query, 
    orderBy, 
    where, 
    doc, 
    getDoc, 
    limit, 
    startAfter,
    enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { atualizarCarrinhoFlutuante } from './cart-helper.js';

// ATIVAÇÃO DO CACHE OFFLINE LOCAL
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

// Configurações de Paginação (Infinite Scroll)
const TAMANHO_PAGINA_LOJAS = 12;
let ultimoDocLojaCarregado = null;
let carregandoMaisLojas = false;
let possuiMaisLojasParaCarregar = true;

// Cache local acumulativo das lojas carregadas
let listaLojasGlobal = [];

function normalizarTexto(txt) {
    if (!txt) return '';
    return txt.toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/-/g, " ")
              .trim();
}

// Cálculo progressivo de proximidade por precisão de dígitos do CEP
function calcularIndicadorProximidade(cepUsuario, cepLoja) {
    if (!cepLoja) return "Distância indisponível";
    
    const u = cepUsuario.replace(/\D/g, '');
    const l = cepLoja.replace(/\D/g, '');
    
    if (u === l) return "Muito próximo (Mesmo CEP)";
    if (u.substring(0, 5) === l.substring(0, 5)) return "No seu bairro (Muito Próximo)";
    if (u.substring(0, 4) === l.substring(0, 4)) return "Próximo (Bairro Vizinho)";
    if (u.substring(0, 3) === l.substring(0, 3)) return "Mesma Cidade";
    
    return "Outra Região";
}

// Lógica de Busca por Texto
const inputBusca = document.getElementById('input-busca');
if (inputBusca) {
    inputBusca.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const valor = inputBusca.value.trim();
            if (valor !== "") {
                window.location.href = `./html/pesquisa.html?busca=${encodeURIComponent(valor)}`;
            }
        }
    });
}

// INICIALIZAÇÃO PARALELA RÁPIDA (Categorias + Lojas simultaneamente)
async function inicializarPaginaInicial() {
    atualizarCarrinhoFlutuante();
    habilitarScrollHorizontalMouse();

    await Promise.all([
        renderizarCategorias(),
        inicializarLojasPaginadas()
    ]);
}

inicializarPaginaInicial();

window.addEventListener('pageshow', (event) => {
    const veioDoHistorico = event.persisted || 
        (performance.getEntriesByType("navigation")[0]?.type === "back_forward");

    if (veioDoHistorico) {
        atualizarCarrinhoFlutuante();
    }
});

window.addEventListener('storage', (event) => {
    if (event.key && (event.key.includes('carrinho') || event.key.includes('cart'))) {
        atualizarCarrinhoFlutuante();
    }
});

// AUTOMAÇÃO GEOGRÁFICA CONTROLADA POR ESTADO DE LOGIN
onAuthStateChanged(auth, async (user) => {
    const inputCEP = document.getElementById('input-cep-cliente');
    const userArea = document.getElementById('user-area');

    if (user) {
        if (userArea) {
            userArea.innerHTML = `
                <div class="pill-badge" style="cursor: pointer;" onclick="window.location.href='./html/perfil.html'">
                    <i class="fa-regular fa-user"></i>
                    <span class="user-name-text">${user.displayName ? user.displayName.split(' ')[0] : 'Minha Conta'}</span>
                </div>
            `;
        }

        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                let cepPerfil = null;
                
                if (userData.enderecoCliente && Array.isArray(userData.enderecoCliente)) {
                    const enderecoPadrao = userData.enderecoCliente.find(end => end.padrao === true) || userData.enderecoCliente[0];
                    if (enderecoPadrao && enderecoPadrao.cep) {
                        cepPerfil = enderecoPadrao.cep;
                    }
                }
                
                if (cepPerfil) {
                    localStorage.setItem('nordgo_cep_usuario', cepPerfil);
                    if (inputCEP) inputCEP.value = cepPerfil;
                    filtrarEEstabalecerPorCEP(cepPerfil, false);
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

        localStorage.removeItem('nordgo_cep_usuario');
        if (inputCEP) inputCEP.value = '';
        exibirLojasNaTela(listaLojasGlobal, null);
    }
});

// LOGOUT
export async function fazerLogout() {
    try {
        localStorage.removeItem('nordgo_cep_usuario');
        localStorage.removeItem('nordgo_render_pix');
        await signOut(auth);
        window.location.reload();
    } catch (err) {
        console.error("Erro ao realizar logout:", err);
    }
}

const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.addEventListener('click', fazerLogout);
}

// BUSCAR CIDADE NO VIACEP
async function obterCidadePorCEP(cep) {
    try {
        const cepLimpo = cep.replace(/\D/g, '');
        if (cepLimpo.length !== 8) return null;

        const resp = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
        const data = await resp.json();
        
        if (data.erro) return null;
        return data.localidade;
    } catch (err) {
        console.error("Erro ao buscar ViaCEP:", err);
        return null;
    }
}

// VALIDA SE A LOJA ATENDE A CIDADE DO USUÁRIO
function lojaAtendeCidade(loja, cidadeUsuarioNorm) {
    if (!cidadeUsuarioNorm) return true;

    if (loja.logisticaCidades && typeof loja.logisticaCidades === 'object') {
        const cidadesAtendidas = Object.keys(loja.logisticaCidades);
        const atendeLogistica = cidadesAtendidas.some(cidadeLoja => {
            const cidadeLojaNorm = normalizarTexto(cidadeLoja);
            return cidadeLojaNorm.includes(cidadeUsuarioNorm) || cidadeUsuarioNorm.includes(cidadeLojaNorm);
        });
        if (atendeLogistica) return true;
    }

    const cidadeSedeNorm = normalizarTexto(
        loja.cidadeLoja || loja.cidade || loja.endereco?.cidade || loja.municipio || ''
    );

    if (cidadeSedeNorm) {
        return cidadeSedeNorm.includes(cidadeUsuarioNorm) || cidadeUsuarioNorm.includes(cidadeSedeNorm);
    }

    return false;
}

// FILTRAGEM GEOGRÁFICA
async function filtrarEEstabalecerPorCEP(cepValue, foiCliqueBotao = false) {
    if (!cepValue || cepValue.trim() === "") {
        if (foiCliqueBotao) {
            alert("Por favor, digite o seu CEP no campo de localização para buscar as lojas.");
            const inputCEP = document.getElementById('input-cep-cliente');
            if (inputCEP) inputCEP.focus();
            return;
        }
        localStorage.removeItem('nordgo_cep_usuario');
        exibirLojasNaTela(listaLojasGlobal, null); 
        return;
    }

    const cepLimpo = cepValue.replace(/\D/g, '');
    if (cepLimpo.length < 8) {
        alert("Por favor, informe um CEP válido com 8 dígitos.");
        const inputCEP = document.getElementById('input-cep-cliente');
        if (inputCEP) inputCEP.focus();
        return;
    }

    localStorage.setItem('nordgo_cep_usuario', cepValue);

    const cidadeUsuario = await obterCidadePorCEP(cepValue);
    let lojasFiltradas = [];

    if (cidadeUsuario) {
        const cidadeUserNorm = normalizarTexto(cidadeUsuario);
        lojasFiltradas = listaLojasGlobal.filter(loja => lojaAtendeCidade(loja, cidadeUserNorm));
    } else {
        lojasFiltradas = listaLojasGlobal;
    }

    exibirLojasNaTela(lojasFiltradas, cepValue);
}

function ejecutarFiltroCEP() {
    const inputCEP = document.getElementById('input-cep-cliente');
    const cepValue = inputCEP ? inputCEP.value.trim() : '';
    filtrarEEstabalecerPorCEP(cepValue, true);
}

const btnBuscarCEP = document.getElementById('btn-buscar-cep');
if (btnBuscarCEP) {
    btnBuscarCEP.addEventListener('click', ejecutarFiltroCEP);
}

const inputCEPCliente = document.getElementById('input-cep-cliente');
if (inputCEPCliente) {
    inputCEPCliente.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') ejecutarFiltroCEP();
    });
}

// RENDERIZAR CATEGORIAS
async function renderizarCategorias() {
    const container = document.getElementById('categorias-container');
    if (!container) return;

    try {
        const q = query(collection(db, "categorias"), orderBy("nome", "asc"));
        const querySnapshot = await getDocs(q);
        container.innerHTML = ""; 

        const fragment = document.createDocumentFragment();

        querySnapshot.forEach((docSnap) => {
            const cat = docSnap.data();
            const div = document.createElement('div');
            div.className = 'cat-item';
            div.innerText = cat.nome;

            div.onclick = () => {
                div.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });

                setTimeout(() => {
                    window.location.href = `./html/pesquisa.html?categoria=${encodeURIComponent(cat.slug || cat.nome)}`;
                }, 150);
            };

            fragment.appendChild(div);
        });

        container.appendChild(fragment);
    } catch (e) { 
        console.error("Erro ao carregar categorias:", e);
        container.innerHTML = "Erro ao carregar categorias."; 
    }
}

function habilitarScrollHorizontalMouse() {
    const container = document.getElementById('categorias-container');
    if (!container) return;

    container.addEventListener('wheel', (event) => {
        if (event.deltaY !== 0) {
            event.preventDefault();
            container.scrollBy({
                left: event.deltaY * 1.8,
                behavior: 'smooth'
            });
        }
    }, { passive: false });
}

// INICIALIZAR LOJAS PAGINADAS
async function inicializarLojasPaginadas() {
    listaLojasGlobal = [];
    ultimoDocLojaCarregado = null;
    possuiMaisLojasParaCarregar = true;
    
    await carregarProximoLoteLojas();
    configurarObservadorInfiniteScroll();
}

async function carregarProximoLoteLojas() {
    if (carregandoMaisLojas || !possuiMaisLojasParaCarregar) return;

    carregandoMaisLojas = true;
    mostrarIndicadorCarregamentoLojas(true);

    try {
        let consultaLojas;

        if (ultimoDocLojaCarregado) {
            consultaLojas = query(
                collection(db, "lojas"),
                where("status", "==", "aprovado"),
                startAfter(ultimoDocLojaCarregado),
                limit(TAMANHO_PAGINA_LOJAS)
            );
        } else {
            consultaLojas = query(
                collection(db, "lojas"),
                where("status", "==", "aprovado"),
                limit(TAMANHO_PAGINA_LOJAS)
            );
        }

        const snap = await getDocs(consultaLojas);

        if (snap.empty) {
            possuiMaisLojasParaCarregar = false;
        } else {
            ultimoDocLojaCarregado = snap.docs[snap.docs.length - 1];

            snap.forEach(docSnap => {
                const lojaData = { id: docSnap.id, ...docSnap.data() };
                if (!listaLojasGlobal.some(l => l.id === lojaData.id)) {
                    listaLojasGlobal.push(lojaData);
                }
            });

            if (snap.docs.length < TAMANHO_PAGINA_LOJAS) {
                possuiMaisLojasParaCarregar = false;
            }
        }

        const cepExistente = localStorage.getItem('nordgo_cep_usuario');
        if (cepExistente && auth.currentUser) {
            const inputCEP = document.getElementById('input-cep-cliente');
            if (inputCEP) inputCEP.value = cepExistente;
            filtrarEEstabalecerPorCEP(cepExistente, false);
        } else {
            exibirLojasNaTela(listaLojasGlobal, null);
        }

    } catch (err) {
        console.error("Erro ao carregar lote de lojas:", err);
        const lista = document.getElementById('lista-lojas');
        if (lista && listaLojasGlobal.length === 0) {
            lista.innerHTML = "<p style='grid-column: 1/-1; text-align: center;'>Erro ao carregar estabelecimentos.</p>";
        }
    } finally {
        carregandoMaisLojas = false;
        mostrarIndicadorCarregamentoLojas(false);
    }
}

function mostrarIndicadorCarregamentoLojas(exibir) {
    let loader = document.getElementById('indicador-loader-lojas');
    const containerMain = document.querySelector('main.container');

    if (!loader && containerMain) {
        loader = document.createElement('div');
        loader.id = 'indicador-loader-lojas';
        loader.style.cssText = 'text-align: center; padding: 20px; color: #ff6400; font-weight: 600; font-size: 0.9rem;';
        loader.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Carregando mais estabelecimentos...';
        containerMain.appendChild(loader);
    }

    if (loader) {
        loader.style.display = (exibir && possuiMaisLojasParaCarregar) ? 'block' : 'none';
    }
}

function configurarObservadorInfiniteScroll() {
    let gatilho = document.getElementById('gatilho-infinite-scroll');
    if (!gatilho) {
        gatilho = document.createElement('div');
        gatilho.id = 'gatilho-infinite-scroll';
        gatilho.style.height = '20px';
        document.querySelector('main.container')?.appendChild(gatilho);
    }

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && possuiMaisLojasParaCarregar && !carregandoMaisLojas) {
            carregarProximoLoteLojas();
        }
    }, { rootMargin: '200px' });

    observer.observe(gatilho);
}

// RENDERIZAÇÃO OTIMIZADA COM DOCUMENTFRAGMENT E PRIORIZAÇÃO VISUAL
function exibirLojasNaTela(lojas, cepUsuario = null) {
    const lista = document.getElementById('lista-lojas');
    if (!lista) return;

    lista.innerHTML = "";

    if (lojas.length === 0) {
        const mensagemZeroLojas = cepUsuario 
            ? "Nenhum estabelecimento atende no CEP/cidade informado no momento." 
            : "Nenhum estabelecimento disponível no momento.";

        lista.innerHTML = `<p style='grid-column: 1/-1; text-align: center; color: #747d8c; padding: 30px 10px; font-weight: 500;'>${mensagemZeroLojas}</p>`;
        return;
    }

    let lojasProcessadas = [...lojas];

    if (cepUsuario) {
        const uFull = parseInt(cepUsuario.replace(/\D/g, '')) || 0;
        
        lojasProcessadas.sort((a, b) => {
            if (!a.cepLoja) return 1;
            if (!b.cepLoja) return -1;
            
            const aFull = parseInt(a.cepLoja.replace(/\D/g, '')) || 0;
            const bFull = parseInt(b.cepLoja.replace(/\D/g, '')) || 0;
            
            const diffA = Math.abs(uFull - aFull);
            const diffB = Math.abs(uFull - bFull);
            
            return diffA - diffB;
        });
    }

    const fragment = document.createDocumentFragment();

    lojasProcessadas.forEach((loja, index) => {
        const fotoExibir = loja.logoUrl || './assets/images/default-loja.png';
        
        const estiloBanner = loja.bannerLoja && loja.bannerLoja.trim() !== ""
            ? `background-image: url('${loja.bannerLoja}'); background-size: cover; background-position: center;`
            : `background-color: ${loja.temaLoja || '#ff6400'};`;

        let indicadorProximidadeHtml = "";
        if (cepUsuario && loja.cepLoja) {
            const proximidadeTexto = calcularIndicadorProximidade(cepUsuario, loja.cepLoja);
            indicadorProximidadeHtml = `<span class="badge-proximidade"><i class="fa-solid fa-person-biking"></i> ${proximidadeTexto}</span>`;
        } else {
            indicadorProximidadeHtml = `<span class="badge-proximidade" style="color: #a0a8b5;"><i class="fa-solid fa-location-crosshairs"></i> Informe seu CEP para calcular</span>`;
        }

        const cardDiv = document.createElement('div');
        cardDiv.className = 'card-loja';
        cardDiv.onclick = () => window.location.href = `./html/loja.html?loja=${loja.id}`;

        // Os 2 primeiros cards na tela carregam imediatamente (eager), os seguintes em lazy
        const loadingStrategy = index < 2 ? 'eager' : 'lazy';

        cardDiv.innerHTML = `
            <div class="banner-loja" style="${estiloBanner}">
                <img src="${fotoExibir}" 
                     class="logo-loja" 
                     alt="Logo ${loja.nome}"
                     loading="${loadingStrategy}"
                     onerror="if (this.src !== window.location.origin + '/assets/images/default-loja.png') { this.src='./assets/images/default-loja.png'; }">
            </div>
            <div class="info-loja">
                <h3>${loja.nome}</h3>
                <p>${loja.categoria} • ${loja.bairroLoja || 'Centro'}</p>
                ${indicadorProximidadeHtml}
            </div>`;

        fragment.appendChild(cardDiv);
    });

    lista.appendChild(fragment);
}