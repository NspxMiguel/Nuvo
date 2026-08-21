// A loja: MCPs e skills que existem no GitHub, listados sozinhos.
//
// O servidor traz a lista inteira de uma vez, já com a nota de recomendação
// calculada (`server/loja.mjs`). Aqui não se vai à rede pra trocar de filtro:
// são trezentos e poucos itens, cabem na memória sem esforço, e assim alternar
// entre "recomendado" e "mais novo" é instantâneo em vez de gastar um dos dez
// pedidos por minuto que o GitHub dá a quem não faz cadastro.

import { api, escapeHtml, toast } from './core.js';
import { icon } from './icons.js';
import { t, formatarNumero, plural } from './i18n.js';

/** Quantas linhas nascem visíveis. O resto entra em blocos, a pedido. */
const PAGINA = 15;

const GUARDADO = 'nuvo.loja';

/**
 * As ordens possíveis.
 *
 * "Recomendado" não é "mais estrelas" com outro nome: a nota vem do servidor e
 * mistura popularidade que satura, projeto vivo e projeto que é de fato a coisa
 * que diz ser. A explicação está em `server/loja.mjs`.
 */
const ORDENS = {
  recomendado: { rotulo: () => t('Recomendado'), por: (a, b) => b.nota - a.nota },
  estrelas: { rotulo: () => t('Mais estrelas'), por: (a, b) => b.estrelas - a.estrelas },
  novo: { rotulo: () => t('Mais novo'), por: (a, b) => Date.parse(b.criado || 0) - Date.parse(a.criado || 0) }
};

/**
 * O nome de cada categoria, na língua da tela.
 *
 * O servidor manda o rótulo dele junto, mas em português: ele não sabe em que
 * idioma a tela está, e um rótulo montado lá não passaria pela varredura que
 * cobra tradução. Categoria que o servidor inventar e esta tabela não conhecer
 * cai no rótulo dele — em português, mas visível, que é melhor que sumir.
 */
const ROTULOS = {
  tudo: () => t('Tudo'),
  mcp: () => t('Servidores MCP'),
  skill: () => t('Skills')
};

const estado = {
  itens: [],
  categorias: [],
  categoria: 'tudo',
  ordem: 'recomendado',
  busca: '',
  mostrando: PAGINA,
  de: null,
  quando: null,
  erro: null
};

/** 24 300 vira "24,3 mil" — o número exato não muda decisão nenhuma. */
function estrelas(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return t('{n} mil', { n: formatarNumero(Math.round(v / 100) / 10) });
  return formatarNumero(v);
}

/** "há 3 dias", "há 5 meses" — a idade importa, a data exata não. */
function idade(iso) {
  const quando = Date.parse(iso || '');
  if (!Number.isFinite(quando)) return '';
  const dias = Math.max(0, Math.floor((Date.now() - quando) / 86400000));
  if (dias === 0) return t('hoje');
  if (dias < 30) return plural(dias, 'há 1 dia', 'há {n} dias');
  const meses = Math.floor(dias / 30);
  if (meses < 12) return plural(meses, 'há 1 mês', 'há {n} meses');
  return plural(Math.floor(meses / 12), 'há 1 ano', 'há {n} anos');
}

function guardar() {
  try {
    localStorage.setItem(GUARDADO, JSON.stringify({ categoria: estado.categoria, ordem: estado.ordem }));
  } catch {
    /* navegador com armazenamento bloqueado: a loja funciona sem lembrar */
  }
}

function recuperar() {
  try {
    const g = JSON.parse(localStorage.getItem(GUARDADO) || '{}');
    if (typeof g.ordem === 'string' && g.ordem in ORDENS) estado.ordem = g.ordem;
    if (typeof g.categoria === 'string') estado.categoria = g.categoria;
  } catch {
    /* o padrão já é o certo */
  }
}

/** A lista depois de categoria, busca e ordem. */
function visiveis() {
  const busca = estado.busca.trim().toLowerCase();
  return estado.itens
    .filter((i) => estado.categoria === 'tudo' || i.categoria === estado.categoria)
    .filter((i) => {
      if (!busca) return true;
      // Tópico entra na busca de propósito: quem procura "postgres" quer o
      // servidor de Postgres mesmo que o nome dele seja outra coisa.
      return `${i.id} ${i.descricao} ${i.topicos.join(' ')}`.toLowerCase().includes(busca);
    })
    .sort(ORDENS[estado.ordem].por);
}

function cartao(i) {
  const marcas = [
    `<span class="loja-estrela">${icon('spark', 13)} ${escapeHtml(estrelas(i.estrelas))}</span>`,
    i.linguagem ? `<span>${escapeHtml(i.linguagem)}</span>` : '',
    i.licenca ? `<span>${escapeHtml(i.licenca)}</span>` : '',
    i.mexido ? `<span>${escapeHtml(t('mexido {quando}', { quando: idade(i.mexido) }))}</span>` : '',
    i.arquivado ? `<span class="loja-parado">${escapeHtml(t('parado'))}</span>` : ''
  ].filter(Boolean);

  return `<article class="loja-item">
      <div class="loja-txt">
        <h3>${escapeHtml(i.nome)} <small>${escapeHtml(i.dono)}</small></h3>
        ${i.descricao ? `<p>${escapeHtml(i.descricao)}</p>` : ''}
        <div class="loja-marcas">${marcas.join('')}</div>
      </div>
      <a class="ghost" href="${escapeHtml(i.url)}" target="_blank" rel="noopener noreferrer">
        ${icon('external', 15)} ${t('Abrir')}
      </a>
    </article>`;
}

function pintarLista(el) {
  const lista = visiveis();
  const alvo = el.querySelector('#loja-lista');
  const rodape = el.querySelector('#loja-mais');

  if (!lista.length) {
    alvo.innerHTML = `<p class="hint">${escapeHtml(
      estado.itens.length ? t('nada com esse nome') : t('a loja não carregou — veja a internet e tente de novo')
    )}</p>`;
    rodape.hidden = true;
    return;
  }

  alvo.innerHTML = lista.slice(0, estado.mostrando).map(cartao).join('');
  const faltam = lista.length - estado.mostrando;
  rodape.hidden = faltam <= 0;
  if (faltam > 0) {
    rodape.querySelector('button').textContent = plural(faltam, 'Mostrar mais 1', 'Mostrar mais {n}');
  }
  el.querySelector('#loja-conta').textContent = plural(lista.length, '1 item', '{n} itens');
}

/**
 * De onde veio a lista e quando. Importa: uma vitrine de ontem servida do disco
 * não é a mesma coisa que uma vitrine de agora, e sem dizer isso quem abre sem
 * internet acha que o GitHub parou de publicar coisas.
 */
function procedencia() {
  if (estado.de === 'rede') return t('lista de agora, direto do GitHub');
  if (estado.de === 'cache') {
    const quando = idade(estado.quando);
    return estado.erro
      ? t('lista guardada {quando} — não deu pra atualizar: {causa}', { quando, causa: estado.erro })
      : t('lista guardada {quando}', { quando });
  }
  return estado.erro || t('sem lista: não deu pra falar com o GitHub');
}

export async function viewLoja(el) {
  recuperar();

  el.className = `view panel${el.classList.contains('entra') ? ' entra' : ''}`;
  el.innerHTML = `<div class="panel-inner">
      <h2><span class="ico">${icon('layers', 19)}</span> ${t('Loja')}</h2>
      <p class="hint">${t(
        'MCPs e skills publicados no GitHub, listados sozinhos por tópico. Abrem no GitHub, onde estão as instruções de instalar.'
      )}</p>
      <div class="loja-filtros">
        <div class="loja-abas" id="loja-abas" role="tablist"></div>
        <div class="loja-linha2">
          <label class="loja-busca">
            ${icon('search', 16)}
            <input id="loja-q" type="search" placeholder="${t('nome, assunto ou tópico')}"
                   aria-label="${t('procurar na loja')}" />
          </label>
          <select id="loja-ordem" aria-label="${t('ordem da lista')}">
            ${Object.entries(ORDENS)
              .map(([id, o]) => `<option value="${id}">${o.rotulo()}</option>`)
              .join('')}
          </select>
        </div>
      </div>
      <p class="hint loja-fonte" id="loja-fonte">${t('carregando…')}</p>
      <div id="loja-lista" class="loja-lista"></div>
      <div id="loja-mais" class="loja-mais" hidden><button class="ghost" type="button"></button></div>
      <p class="hint" id="loja-conta"></p>
    </div>`;

  const abas = el.querySelector('#loja-abas');
  const ordem = el.querySelector('#loja-ordem');
  const q = el.querySelector('#loja-q');
  ordem.value = estado.ordem;

  // Os controles são ligados ANTES da busca: quando ela falhava, o `return` do
  // catch deixava busca, ordem e abas sem ouvinte nenhum até a tela ser
  // redesenhada — a barra continuava lá, aceitando digitação e não filtrando
  // nada.
  ligarControles(el, abas, ordem, q);

  let dados;
  try {
    dados = await api('/loja');
  } catch (err) {
    // Falha aqui não é tela de erro: a loja é uma vitrine, e o resto do app
    // continua inteiro sem ela.
    estado.erro = err.message;
    el.querySelector('#loja-fonte').textContent = procedencia();
    pintarLista(el);
    return;
  }

  estado.itens = Array.isArray(dados?.itens) ? dados.itens : [];
  estado.categorias = Array.isArray(dados?.categorias) ? dados.categorias : [];
  estado.de = dados?.de || null;
  estado.quando = dados?.quando || null;
  estado.erro = dados?.erro || null;

  const conta = (id) => estado.itens.filter((i) => id === 'tudo' || i.categoria === id).length;
  const todas = [{ id: 'tudo', rotulo: 'Tudo' }, ...estado.categorias];
  // Categoria guardada que sumiu do servidor deixaria a tela vazia sem dizer
  // por quê — voltar pra "Tudo" é o único jeito que mostra alguma coisa.
  if (!todas.some((c) => c.id === estado.categoria)) estado.categoria = 'tudo';

  abas.innerHTML = todas
    .map(
      (c) => `<button type="button" role="tab" data-cat="${escapeHtml(c.id)}"
        aria-selected="${c.id === estado.categoria}"
        class="loja-aba${c.id === estado.categoria ? ' ativa' : ''}">
        ${escapeHtml(ROTULOS[c.id]?.() ?? c.rotulo)} <small>${formatarNumero(conta(c.id))}</small>
      </button>`
    )
    .join('');

  el.querySelector('#loja-fonte').textContent = procedencia();
  pintarLista(el);
}

/** Busca, ordem, abas e "ver mais" — tudo o que a tela responde sem servidor. */
function ligarControles(el, abas, ordem, q) {
  abas.onclick = (ev) => {
    const btn = ev.target.closest('[data-cat]');
    if (!btn) return;
    estado.categoria = btn.dataset.cat;
    estado.mostrando = PAGINA;
    for (const b of abas.querySelectorAll('[data-cat]')) {
      const ativa = b.dataset.cat === estado.categoria;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-selected', String(ativa));
    }
    guardar();
    pintarLista(el);
  };

  ordem.onchange = () => {
    estado.ordem = ordem.value in ORDENS ? ordem.value : 'recomendado';
    estado.mostrando = PAGINA;
    guardar();
    pintarLista(el);
  };

  let atraso = null;
  q.oninput = () => {
    // Filtrar a cada tecla em trezentos itens é rápido, mas repintar a lista
    // inteira a cada tecla não é: o respiro tira o engasgo de quem digita
    // depressa sem que a busca pareça atrasada.
    clearTimeout(atraso);
    atraso = setTimeout(() => {
      estado.busca = q.value;
      estado.mostrando = PAGINA;
      pintarLista(el);
    }, 120);
  };

  el.querySelector('#loja-mais button').onclick = () => {
    estado.mostrando += PAGINA;
    pintarLista(el);
  };

  el.querySelector('#loja-lista').addEventListener('click', (ev) => {
    // Só pra avisar que sai do app: o link já leva pro GitHub sozinho.
    if (ev.target.closest('a[target="_blank"]')) toast(t('abrindo no GitHub'), 'ok');
  });
}
