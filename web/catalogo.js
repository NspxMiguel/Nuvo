// As IAs que dá pra baixar, tiradas do Hugging Face na hora.
//
// A lista de recomendados é curada e pequena de propósito. Esta é a outra
// metade: as cem mais baixadas do mundo, atualizadas sozinhas, sem ninguém
// precisar mexer no código quando um modelo novo aparece.
//
// O tamanho não vem na lista. Medir os cem custa cem pedidos ao Hugging Face e
// encosta no teto de quem não usa conta, então cada linha mede o seu quando
// chega perto da tela — e o servidor devolve, junto, se aquilo cabe aqui.

import { api, stream, escapeHtml, toast, state, refreshState } from './core.js';
import { icon } from './icons.js';
import { t, formatarNumero } from './i18n.js';

/** Quantas linhas nascem abertas. O resto entra em blocos, a pedido. */
const PAGINA = 12;

const CABE_ROT = { folga: 'cabe com folga', aperto: 'cabe apertado', nao: 'não cabe aqui' };

/** Por que uma linha não pode ser baixada, na língua de quem lê. */
const RECUSA = {
  sem_gguf: 'não está no formato que roda aqui',
  fragmentado: 'está partido em vários arquivos, e o Ollama não junta',
  gated: 'o autor exige aceitar os termos no site antes de baixar',
  erro: 'não deu pra medir agora'
};

/** 11.047.071 vira "11 mi" — o número exato não muda decisão nenhuma. */
function baixadas(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return t('{n} mi de downloads', { n: formatarNumero(Math.round(v / 1e5) / 10) });
  if (v >= 1e3) return t('{n} mil downloads', { n: formatarNumero(Math.round(v / 1e3)) });
  return t('{n} downloads', { n: formatarNumero(v) });
}

/**
 * O catálogo, do cache do servidor.
 *
 * Não levanta: sem internet a seção simplesmente não aparece, e o resto da
 * tela — que é o que já está instalado — continua de pé.
 */
export async function lerCatalogo() {
  try {
    const r = await api('/catalogo');
    return Array.isArray(r?.modelos) && r.modelos.length ? r : null;
  } catch {
    return null;
  }
}

function linha(m) {
  return `<div class="cat-linha" data-id="${escapeHtml(m.id)}">
      <div class="cat-txt">
        <div class="cat-nome">${escapeHtml(m.nome_legivel || m.id)}</div>
        <div class="cat-meta">${escapeHtml(m.id)} · ${baixadas(m.downloads)}</div>
      </div>
      <div class="cat-tam" aria-live="polite"></div>
      <button class="ghost" type="button" data-baixar>${icon('download', 16)} ${t('Baixar')}</button>
      <div class="progress" hidden><span style="width:0%"></span></div>
    </div>`;
}

/**
 * A seção inteira: busca, lista e o botão de mostrar mais.
 *
 * @param {{modelos: object[], quando?: string}|null} cat
 */
export function secaoCatalogo(cat) {
  if (!cat) return '';
  return `<h3 class="sec">${t('Mais IAs pra baixar')}</h3>
    <div class="card catalogo" id="catalogo">
      <p class="meta">${t(
        'As mais baixadas do mundo, direto do Hugging Face. A lista se atualiza sozinha — todas rodam na sua máquina, de graça.'
      )}</p>
      <label class="field">${t('Procurar')}
        <input id="cat-busca" type="search" placeholder="${t('nome do modelo, ex.: qwen, llama, phi')}" />
      </label>
      <div id="cat-lista">${cat.modelos.slice(0, PAGINA).map(linha).join('')}</div>
      <div class="row">
        <button id="cat-mais" class="ghost" type="button" ${
          cat.modelos.length <= PAGINA ? 'hidden' : ''
        }>${t('Mostrar mais')}</button>
        <span id="cat-conta" class="meta"></span>
      </div>
    </div>`;
}

/**
 * Liga a seção: busca, medição sob demanda e download.
 *
 * @param {ParentNode} raiz
 * @param {{modelos: object[]}|null} cat
 * @param {() => void} aoBaixar  redesenho depois que um modelo entrou no disco
 */
export function ligarCatalogo(raiz, cat, aoBaixar) {
  const caixa = raiz.querySelector('#catalogo');
  if (!caixa || !cat) return;
  const lista = caixa.querySelector('#cat-lista');
  const busca = caixa.querySelector('#cat-busca');
  const mais = caixa.querySelector('#cat-mais');
  const conta = caixa.querySelector('#cat-conta');

  // A IA que roda aqui. Sem ela não há pra onde baixar, e o cartão do que falta
  // — na mesma tela, logo acima — é quem resolve isso.
  const local =
    state.providers.find((p) => p.manageable && p.enabled) ||
    state.providers.find((p) => p.manageable);

  const medidos = new Map();
  let filtrados = cat.modelos;
  let mostrando = PAGINA;

  /** Mede o tamanho de uma linha só quando ela chega perto da tela. */
  const olheiro =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entradas) => {
            for (const e of entradas) {
              if (!e.isIntersecting) continue;
              olheiro.unobserve(e.target);
              medir(e.target);
            }
          },
          { rootMargin: '160px' }
        )
      : null;

  async function medir(el) {
    const id = el.dataset.id;
    const alvo = el.querySelector('.cat-tam');
    const botao = el.querySelector('[data-baixar]');
    if (!alvo || medidos.has(id)) return pintarMedida(el, medidos.get(id));
    alvo.textContent = t('medindo…');
    try {
      const m = await api(`/catalogo/tamanho?id=${encodeURIComponent(id)}`);
      medidos.set(id, m);
      pintarMedida(el, m);
    } catch {
      alvo.textContent = '';
      botao.disabled = false;
    }
  }

  function pintarMedida(el, m) {
    if (!m) return;
    const alvo = el.querySelector('.cat-tam');
    const botao = el.querySelector('[data-baixar]');
    if (m.estado !== 'ok') {
      alvo.innerHTML = `<span class="cat-nao">${escapeHtml(t(RECUSA[m.estado] || RECUSA.erro))}</span>`;
      botao.disabled = true;
      return;
    }
    const gb = `${formatarNumero(m.gb, { maximumFractionDigits: 1 })} GB`;
    const cabe = CABE_ROT[m.cabe] ? m.cabe : null;
    alvo.innerHTML = `<span class="cat-gb">${gb}</span>${
      cabe ? `<span class="cabe ${cabe}">${t(CABE_ROT[cabe])}</span>` : ''
    }`;
    // Não cabe continua clicável: quem tem disco e paciência pode querer, e o
    // aviso já está do lado. Travar seria decidir pela pessoa.
    botao.disabled = false;
  }

  function pintar() {
    lista.innerHTML = filtrados.slice(0, mostrando).map(linha).join('');
    conta.textContent = t('{quantos} de {total}', {
      quantos: formatarNumero(Math.min(mostrando, filtrados.length)),
      total: formatarNumero(filtrados.length)
    });
    mais.hidden = filtrados.length <= mostrando;
    for (const el of lista.querySelectorAll('.cat-linha')) {
      const guardado = medidos.get(el.dataset.id);
      if (guardado) pintarMedida(el, guardado);
      else olheiro?.observe(el);
      ligarBotao(el);
    }
    if (!olheiro) for (const el of lista.querySelectorAll('.cat-linha')) medir(el);
  }

  function ligarBotao(el) {
    const botao = el.querySelector('[data-baixar]');
    botao.onclick = async () => {
      if (!local) {
        return toast(t('primeiro o programa que roda IA aqui — o botão está logo acima'), 'err');
      }
      // O Ollama busca do Hugging Face por este prefixo; o id sozinho ele
      // procuraria na biblioteca dele, onde a maioria destes não existe.
      const referencia = `hf.co/${el.dataset.id}`;
      const barra = el.querySelector('.progress');
      const fill = barra.querySelector('span');
      barra.hidden = false;
      botao.disabled = true;
      try {
        await stream(`/providers/${local.id}/pull`, { model: referencia }, (ev) => {
          if (ev.type === 'progress') fill.style.width = `${ev.percent || 0}%`;
          else if (ev.type === 'error') toast(ev.message, 'err');
        });
        fill.style.width = '100%';
        toast(t('{nome} baixado', { nome: el.querySelector('.cat-nome').textContent }), 'ok');
        await refreshState();
        aoBaixar?.();
      } catch (err) {
        toast(err.message, 'err');
        botao.disabled = false;
        barra.hidden = true;
      }
    };
  }

  busca.oninput = () => {
    const q = busca.value.trim().toLowerCase();
    filtrados = q
      ? cat.modelos.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            String(m.nome_legivel || '').toLowerCase().includes(q) ||
            String(m.familia || '').toLowerCase().includes(q)
        )
      : cat.modelos;
    mostrando = PAGINA;
    pintar();
  };

  mais.onclick = () => {
    mostrando += PAGINA;
    pintar();
  };

  pintar();
}
