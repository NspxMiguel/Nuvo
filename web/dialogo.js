// Perguntas e avisos sem interromper o renderizador. Um único diálogo é
// criado quando aparece pela primeira vez e atende as chamadas em sequência.

import { t } from './i18n.js';
import { icon } from './icons.js';

let elemento;
let fila = Promise.resolve();

function criar() {
  if (elemento?.isConnected) return elemento;

  elemento = document.createElement('dialog');
  elemento.className = 'dialogo';
  elemento.setAttribute('aria-labelledby', 'dialogo-titulo');
  elemento.innerHTML = `
    <form class="card dialogo-card" method="dialog">
      <div class="dialogo-cabecalho">
        <span class="ico" data-dialogo-icone></span>
        <h2 id="dialogo-titulo" data-dialogo-titulo></h2>
      </div>
      <p class="dialogo-texto" data-dialogo-texto hidden></p>
      <label class="field dialogo-field" data-dialogo-field hidden>
        <span data-dialogo-rotulo></span>
        <input data-dialogo-input />
        <textarea data-dialogo-textarea rows="5" hidden></textarea>
      </label>
      <div class="row dialogo-acoes">
        <button class="ghost" type="button" data-dialogo-cancelar></button>
        <button class="primary dialogo-acao" type="submit" data-dialogo-acao></button>
      </div>
    </form>`;
  document.body.appendChild(elemento);
  return elemento;
}

function mostrar({ tipo, titulo, texto, rotulo, valor = '', placeholder = '', multilinha = false, acao, perigo }) {
  const dialogo = criar();
  const formulario = dialogo.querySelector('form');
  const campo = dialogo.querySelector('[data-dialogo-field]');
  const input = dialogo.querySelector('[data-dialogo-input]');
  const textarea = dialogo.querySelector('[data-dialogo-textarea]');
  const botaoCancelar = dialogo.querySelector('[data-dialogo-cancelar]');
  const botaoAcao = dialogo.querySelector('[data-dialogo-acao]');
  const cancelado = tipo === 'pergunta' ? null : tipo === 'confirmacao' ? false : undefined;
  let resolver;
  let comecouNoFundo = false;

  dialogo.querySelector('[data-dialogo-icone]').innerHTML = icon(
    perigo ? 'alert' : tipo === 'pergunta' ? 'edit' : 'check',
    20
  );
  dialogo.querySelector('[data-dialogo-titulo]').textContent = titulo;

  const textoEl = dialogo.querySelector('[data-dialogo-texto]');
  textoEl.textContent = texto || '';
  textoEl.hidden = !texto;
  if (texto) textoEl.id = 'dialogo-texto';
  else textoEl.removeAttribute('id');
  if (texto) dialogo.setAttribute('aria-describedby', 'dialogo-texto');
  else dialogo.removeAttribute('aria-describedby');

  campo.hidden = tipo !== 'pergunta';
  dialogo.querySelector('[data-dialogo-rotulo]').textContent = rotulo || '';
  input.hidden = multilinha;
  textarea.hidden = !multilinha;
  const entrada = multilinha ? textarea : input;
  entrada.value = valor ?? '';
  entrada.placeholder = placeholder || '';

  botaoCancelar.textContent = t('Cancelar');
  botaoCancelar.hidden = tipo === 'aviso';
  botaoAcao.textContent = acao || (tipo === 'aviso' ? t('Entendi') : t('Continuar'));
  botaoAcao.className = `dialogo-acao ${perigo ? 'danger' : 'primary'}`;
  dialogo.classList.toggle('perigo', Boolean(perigo));

  return new Promise((resolve) => {
    resolver = resolve;

    const terminar = (resultado) => {
      if (!resolver) return;
      const concluir = resolver;
      resolver = null;
      limpar();
      dialogo.close();
      concluir(resultado);
    };
    const desistir = () => terminar(cancelado);
    const enviar = (evento) => {
      evento.preventDefault();
      terminar(tipo === 'pergunta' ? entrada.value : tipo === 'confirmacao' ? true : undefined);
    };
    const cancelar = (evento) => {
      evento.preventDefault();
      desistir();
    };
    const apontarFundo = (evento) => {
      comecouNoFundo = evento.target === dialogo;
    };
    const clicarFundo = (evento) => {
      if (comecouNoFundo && evento.target === dialogo) desistir();
      comecouNoFundo = false;
    };
    const fecharPorFora = () => {
      if (!resolver) return;
      const concluir = resolver;
      resolver = null;
      limpar();
      concluir(cancelado);
    };
    const limpar = () => {
      formulario.removeEventListener('submit', enviar);
      botaoCancelar.removeEventListener('click', desistir);
      dialogo.removeEventListener('cancel', cancelar);
      dialogo.removeEventListener('pointerdown', apontarFundo);
      dialogo.removeEventListener('click', clicarFundo);
      dialogo.removeEventListener('close', fecharPorFora);
    };

    formulario.addEventListener('submit', enviar);
    botaoCancelar.addEventListener('click', desistir);
    dialogo.addEventListener('cancel', cancelar);
    dialogo.addEventListener('pointerdown', apontarFundo);
    dialogo.addEventListener('click', clicarFundo);
    dialogo.addEventListener('close', fecharPorFora);
    dialogo.showModal();
    botaoAcao.focus();
  });
}

function enfileirar(opcoes) {
  const proxima = fila.then(() => mostrar(opcoes));
  fila = proxima.catch(() => undefined);
  return proxima;
}

export function perguntar({ titulo, rotulo, valor, placeholder, multilinha } = {}) {
  return enfileirar({ tipo: 'pergunta', titulo, rotulo, valor, placeholder, multilinha });
}

export function confirmar({ titulo, texto, acao, perigo } = {}) {
  return enfileirar({ tipo: 'confirmacao', titulo, texto, acao, perigo });
}

export async function avisar({ titulo, texto } = {}) {
  await enfileirar({ tipo: 'aviso', titulo, texto });
}
