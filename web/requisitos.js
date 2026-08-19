// O que falta pro app funcionar, e o botão que resolve.
//
// Nada aqui explica um problema sem oferecer a saída dele. Quem abre o app pela
// primeira vez não sabe o que é Ollama, e não precisa saber: a tela diz que
// falta o programa que roda IA nesta máquina e mostra um botão. O download, a
// instalação e o "ligar" acontecem daqui, com barra de progresso.
//
// O plano B é o comando manual, que só aparece quando a instalação automática
// falha — mostrá-lo antes seria pedir terminal a quem nunca abriu um.

import { api, stream, escapeHtml, toast } from './core.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

/**
 * O que falta, medido no servidor.
 *
 * Não levanta: a checagem é um enfeite útil, e tela que some porque o enfeite
 * falhou é pior do que tela sem ele.
 *
 * @returns {Promise<object|null>}
 */
export async function lerRequisitos() {
  try {
    return await api('/requisitos');
  } catch {
    return null;
  }
}

/** Falta alguma coisa que o app resolve sozinho? */
export const faltaAlgo = (req) => Boolean(req?.ollama?.acao);

/**
 * O cartão do que falta: uma frase e um botão.
 *
 * @param {object|null} req  a resposta de `GET /requisitos`
 * @returns {string} HTML, ou vazio quando não falta nada
 */
export function cartaoRequisitos(req) {
  if (!faltaAlgo(req)) return '';
  const instalar = req.ollama.acao === 'instalar';
  return `<div class="card falta" id="cartao-falta">
      <div class="falta-txt">
        <h3><span class="ico">${icon('alert', 18)}</span> ${
          instalar
            ? t('Falta o programa que roda IA nesta máquina')
            : t('O programa que roda IA aqui está parado')
        }</h3>
        <p>${
          instalar
            ? t(
                'Ele se chama Ollama, é grátis e roda tudo na sua máquina. Eu instalo daqui: baixo do site oficial, ponho no lugar e ligo. Sem cadastro e sem senha.'
              )
            : t('Ele já está instalado nesta máquina. Falta ligar, e isso é um clique.')
        }</p>
      </div>
      <button id="btn-falta" class="primary" type="button">${icon(
        instalar ? 'download' : 'play',
        17
      )} ${instalar ? t('Instalar') : t('Ligar')}</button>
      <div class="falta-passo" hidden>
        <span class="passo-txt"></span>
        <div class="progress"><span style="width:0%"></span></div>
      </div>
      <div class="falta-manual" hidden></div>
    </div>`;
}

/** O comando pra copiar, quando a instalação automática não deu conta. */
function pintarManual(caixa, manual, erro, aoResolver) {
  if (!manual) {
    caixa.hidden = false;
    caixa.innerHTML = `<div class="aviso err"><div>${escapeHtml(erro || t('não deu certo'))}</div></div>`;
    return;
  }
  caixa.hidden = false;
  caixa.innerHTML = `<div class="aviso err">
      <div>
        <b>${t('A instalação automática não foi.')}</b> ${escapeHtml(erro || '')}
        <p>${escapeHtml(manual.explicacao || '')}</p>
        <pre class="comando"><code>${escapeHtml(manual.comando || '')}</code></pre>
      </div>
    </div>
    <div class="row">
      <button class="ghost" type="button" data-copiar>${icon('copy', 16)} ${t('Copiar o comando')}</button>
      <button class="primary" type="button" data-conferir>${icon('check', 16)} ${t('Já instalei, conferir')}</button>
    </div>`;

  caixa.querySelector('[data-copiar]').onclick = async (ev) => {
    try {
      await navigator.clipboard.writeText(manual.comando || '');
      toast(t('comando copiado'), 'ok');
    } catch {
      // Sem permissão de área de transferência o comando continua na tela pra
      // ser selecionado na mão; dizer isso é melhor que um botão que não faz nada.
      ev.currentTarget.textContent = t('selecione o texto acima e copie');
    }
  };
  caixa.querySelector('[data-conferir]').onclick = () => aoResolver?.();
}

/**
 * Liga o botão do cartão.
 *
 * @param {ParentNode} raiz  onde o cartão foi desenhado
 * @param {object} req  a resposta de `GET /requisitos`
 * @param {() => void} aoResolver  chamado quando o que faltava passou a existir
 */
export function ligarRequisitos(raiz, req, aoResolver) {
  const cartao = raiz.querySelector('#cartao-falta');
  if (!cartao) return;
  const botao = cartao.querySelector('#btn-falta');
  const passo = cartao.querySelector('.falta-passo');
  const texto = cartao.querySelector('.passo-txt');
  const barra = cartao.querySelector('.progress span');
  const manual = cartao.querySelector('.falta-manual');

  const trabalhando = (ligado, frase) => {
    botao.disabled = ligado;
    passo.hidden = !ligado;
    if (frase) texto.textContent = frase;
  };

  botao.onclick = async () => {
    manual.hidden = true;
    manual.innerHTML = '';

    if (req.ollama.acao === 'ligar') {
      trabalhando(true, t('ligando…'));
      try {
        const r = await api('/requisitos/ollama/ligar', { method: 'POST' });
        if (r.estado === 'no_ar') {
          toast(t('pronto, já está no ar'), 'ok');
          return aoResolver?.();
        }
        pintarManual(manual, r.manual, r.error, aoResolver);
      } catch (err) {
        pintarManual(manual, null, err.message, aoResolver);
      }
      trabalhando(false);
      return;
    }

    trabalhando(true, t('começando…'));
    try {
      await stream('/requisitos/ollama/instalar', {}, (ev) => {
        if (ev.type === 'phase') texto.textContent = t(ev.text);
        else if (ev.type === 'progresso' && ev.pct != null) barra.style.width = `${ev.pct}%`;
        else if (ev.type === 'error') pintarManual(manual, ev.manual, ev.error, aoResolver);
        else if (ev.type === 'pronto' && ev.estado === 'no_ar') {
          barra.style.width = '100%';
          texto.textContent = t('pronto');
          toast(t('o Ollama está no ar'), 'ok');
          aoResolver?.();
        }
      });
    } catch (err) {
      pintarManual(manual, null, err.message, aoResolver);
    }
    trabalhando(false);
  };
}
