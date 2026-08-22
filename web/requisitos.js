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

// --------------------------------------------------- qual navegador o agente usa

/** Já foi perguntado alguma vez? `fonte` guarda a resposta pra sempre. */
export const faltaEscolherNavegador = (settings) => settings?.navegador?.fonte == null;

/**
 * A pergunta que aparece na primeira vez que alguém liga o modo agente: usar o
 * navegador que já existe na máquina, ou baixar um só pro app.
 *
 * As duas opções abrem uma janela separada da sessão pessoal. O Chrome recusa
 * depuração remota no perfil padrão desde a versão 136, e copiar o perfil não
 * traz login junto — a chave que cifra cookie e senha é presa à pasta de
 * origem. Dizer isso na tela evita a decepção de escolher "o meu" esperando as
 * abas e os logins de sempre.
 *
 * @returns {Promise<'instalado'|'proprio'|null>} `null` quando a pessoa desiste
 */
export async function perguntarNavegador() {
  const req = await lerRequisitos();
  // Sem resposta do servidor não dá pra dizer nada sobre navegador: seguir
  // adiante com tudo `null` desenhava a mesma tela de "não tem navegador
  // nenhum" que aparece quando de fato não tem, e mandava a pessoa baixar um
  // Chrome que ela talvez já tenha.
  if (!req) {
    toast(t('não deu pra conferir o navegador agora — tente de novo'), 'err');
    return null;
  }
  const instalado = req?.navegador?.instalado || null;
  const proprio = req?.navegador?.proprio || null;
  const podeBaixar = Boolean(req?.navegador?.plataforma);

  // Já existe um baixado: não há o que perguntar, e perguntar de novo seria
  // oferecer um download que já está no disco.
  if (!instalado && proprio) {
    await api('/settings', { method: 'PATCH', body: { navegador: { fonte: 'proprio' } } }).catch(() => {});
    return 'proprio';
  }

  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'escolha';
    fundo.innerHTML = `<div class="escolha-box" role="dialog" aria-modal="true" aria-label="${t(
      'Qual navegador o modo agente vai usar'
    )}">
        <h2>${t('Qual navegador o agente vai dirigir?')}</h2>
        <p class="hint">${t(
          'Ele abre uma janela separada em qualquer um dos dois: não usa suas abas nem seus logins, e não mexe no navegador que você está usando agora.'
        )}</p>
        <div class="escolha-ops">
          ${
            instalado
              ? `<button class="op" type="button" data-op="instalado">
                   <b>${t('Usar o que já está aqui')}</b>
                   <span>${escapeHtml(instalado.split(/[\\/]/).pop())} · ${t('nada pra baixar')}</span>
                 </button>`
              : ''
          }
          ${
            podeBaixar
              ? `<button class="op" type="button" data-op="proprio">
                   <b>${proprio ? t('Usar o navegador do app') : t('Baixar um navegador só pro app')}</b>
                   <span>${
                     proprio
                       ? t('já está baixado')
                       : t('cerca de 180 MB, fica dentro do app e não altera nada do seu')
                   }</span>
                 </button>`
              : ''
          }
        </div>
        ${
          !instalado && !podeBaixar
            ? `<div class="aviso err"><div>${t(
                'Esta máquina não tem navegador compatível e não existe download pronto pra ela. O modo agente vai continuar como busca simples.'
              )}</div></div>`
            : ''
        }
        <div class="escolha-passo" hidden>
          <span class="passo-txt"></span>
          <div class="progress"><span style="width:0%"></span></div>
        </div>
        <div class="row"><button class="ghost" type="button" data-op="">${t('Agora não')}</button></div>
      </div>`;
    document.body.appendChild(fundo);

    const passo = fundo.querySelector('.escolha-passo');
    const texto = fundo.querySelector('.passo-txt');
    const barra = fundo.querySelector('.progress span');

    const fechar = (valor) => {
      fundo.remove();
      document.removeEventListener('keydown', naTecla);
      resolve(valor);
    };
    const naTecla = (ev) => {
      if (ev.key === 'Escape') fechar(null);
    };
    document.addEventListener('keydown', naTecla);
    fundo.onclick = (ev) => {
      if (ev.target === fundo) fechar(null);
    };

    for (const botao of fundo.querySelectorAll('[data-op]')) {
      botao.onclick = async () => {
        const op = botao.dataset.op;
        if (!op) return fechar(null);

        if (op === 'proprio' && !proprio) {
          for (const b of fundo.querySelectorAll('button')) b.disabled = true;
          passo.hidden = false;
          texto.textContent = t('baixando…');
          try {
            await stream('/requisitos/navegador/baixar', {}, (ev) => {
              if (ev.type === 'phase') texto.textContent = t(ev.text);
              else if (ev.pct != null) barra.style.width = `${ev.pct}%`;
              else if (ev.type === 'error') toast(ev.error || t('não deu certo'), 'err');
            });
          } catch (err) {
            toast(err.message, 'err');
            for (const b of fundo.querySelectorAll('button')) b.disabled = false;
            passo.hidden = true;
            return;
          }
          // A rota já grava `fonte` e o caminho do que baixou.
          toast(t('navegador pronto'), 'ok');
          return fechar('proprio');
        }

        await api('/settings', { method: 'PATCH', body: { navegador: { fonte: op } } }).catch(() => {});
        fechar(op);
      };
    }
  });
}
