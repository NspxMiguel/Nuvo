// NotebookLM como motor opcional do Estudos.
//
// Isto não é uma API: é uma tela de terceiro dirigida pelo mesmo Chrome que o
// agente web usa. Por isso cada passo procura uma coisa explícita e para se ela
// não estiver lá. Tentar "um botão parecido" seria pior do que falhar: poderia
// criar, enviar ou perguntar no lugar errado sem a pessoa perceber.

import { resolve } from 'node:path';
import { abrirNavegador } from './navegador.mjs';
import { erroHttp } from './erro-traduzivel.mjs';

const ENDERECO = 'https://notebook.google.com/';
// A frase mora numa constante porque é levantada de vários pontos, e a varredura
// de tradução só enxerga literal dentro do `erroHttp(` — então ela entra no
// dicionário na mão. Sem isso o inglês mostraria português no meio da tela.
const FALHA =
  'o NotebookLM mudou de tela ou você não está logado — o Estudos continua funcionando sem ele';

const INICIO = '<<<NUVO_RESPOSTA_INICIO>>>';
const FIM = '<<<NUVO_RESPOSTA_FIM>>>';
const FIM_DO_PEDIDO = '<<<NUVO_PEDIDO_FIM>>>';

// O Chrome pede pt-BR, mas a língua da conta Google pode continuar em inglês.
// Só aceitamos os dois rótulos conhecidos; língua ou tela diferente falha
// fechada, como deve acontecer em automação de uma página que não controlamos.
const ROTULOS = {
  criar: ['Criar novo notebook', 'Novo notebook', 'Create new notebook', 'Create new'],
  upload: ['Fazer upload de fontes', 'Fazer upload', 'Upload sources', 'Upload'],
  enviar: ['Enviar mensagem', 'Enviar', 'Send message', 'Send', 'Submit']
};

const PEDIDOS = {
  simulado: 'um simulado completo, com questões, alternativas quando couber e gabarito comentado',
  guia: 'um guia de estudo priorizado, com os temas, o que saber e como revisar cada tema',
  flashcards: 'um conjunto de flashcards, com uma pergunta e uma resposta curta por cartão',
  resumo: 'um resumo de estudo estruturado em seções, com conceitos-chave e glossário',
  mapa: 'um mapa mental em texto, com assunto central, ramos e folhas',
  linha: 'uma linha do tempo em ordem, com cada marco e por que ele importa',
  podcast: 'um roteiro de conversa didática entre duas pessoas, pronto para ser lido em voz alta',
  quiz: 'um quiz de múltipla escolha, com gabarito e explicação de cada resposta',
  infografico: 'o conteúdo textual de um infográfico, com título, blocos curtos, números e sequência',
  slides: 'uma sequência de slides, com título, pontos e nota de apresentação em cada slide'
};

const espera = (ms) => new Promise((resolveEspera) => setTimeout(resolveEspera, ms));

function erroDeTela() {
  return erroHttp(503, FALHA);
}

function interromperSePreciso(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('cancelado', 'AbortError');
}

function ehCancelamento(err, signal) {
  return Boolean(signal?.aborted || err?.name === 'AbortError');
}

/** Converte qualquer quebra da tela na única falha segura desta integração. */
async function naTela(signal, trabalho) {
  interromperSePreciso(signal);
  try {
    return await trabalho();
  } catch (err) {
    if (ehCancelamento(err, signal) || err?.status) throw err;
    throw erroDeTela();
  }
}

/**
 * Espera uma transição curta da SPA. `decidir` devolve `undefined` enquanto a
 * tela ainda está mudando e qualquer outro valor quando já há uma resposta.
 */
async function ate(sessao, ler, decidir, { signal, limite = 20_000 } = {}) {
  const fim = Date.now() + limite;
  do {
    interromperSePreciso(signal);
    const lido = await naTela(signal, () => ler(sessao));
    const decidido = decidir(lido);
    if (decidido !== undefined) return decidido;
    await espera(250);
  } while (Date.now() < fim);
  throw erroDeTela();
}

const NORMALIZAR_NA_PAGINA = `
  const normalizar = (valor) => String(valor || '').normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const visivel = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width >= 2 && r.height >= 2 && s.display !== 'none' &&
      s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
  };
  const rotulo = (e) => e.getAttribute('aria-label') || e.innerText ||
    e.getAttribute('title') || e.getAttribute('placeholder') || '';
`;

const normalizados = (rotulos) =>
  rotulos.map((r) => r.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());

async function estadoDaConta(sessao) {
  return sessao.avaliar(`(() => { /* nuvo:notebooklm:conta */
    ${NORMALIZAR_NA_PAGINA}
    const nomes = ${JSON.stringify(normalizados(ROTULOS.criar))};
    const botoes = [...document.querySelectorAll('button, [role="button"], a[href]')]
      .filter((e) => visivel(e) && nomes.includes(normalizar(rotulo(e))));
    const url = location.href;
    const fora = location.hostname === 'accounts.google.com' || /\\/login(?:[/?#]|$)/i.test(location.pathname) ||
      Boolean(document.querySelector('input[type="email"], input[type="password"]'));
    return { url, fora, criar: botoes.length, pronta: document.readyState === 'complete' };
  })()`);
}

async function conferirConta(sessao, signal) {
  return ate(
    sessao,
    estadoDaConta,
    (estado) => {
      if (estado?.fora) return false;
      if (estado?.criar === 1) return true;
      // Mais de um alvo é tão ambíguo quanto nenhum: não escolhemos por conta.
      if (estado?.criar > 1) throw erroDeTela();
      return undefined;
    },
    { signal }
  );
}

async function navegar(sessao, signal) {
  await naTela(signal, async () => {
    const resposta = await sessao.cmd('Page.navigate', { url: ENDERECO });
    if (resposta?.errorText) throw new Error(resposta.errorText);
  });
}

async function clicarRotulo(sessao, rotulos, signal) {
  const resultado = await naTela(signal, () =>
    sessao.avaliar(`(() => { /* nuvo:notebooklm:clicar */
      ${NORMALIZAR_NA_PAGINA}
      const nomes = ${JSON.stringify(normalizados(rotulos))};
      const achados = [...document.querySelectorAll('button, [role="button"], a[href]')]
        .filter((e) => visivel(e) && !e.disabled && nomes.includes(normalizar(rotulo(e))));
      if (achados.length !== 1) return { ok: false, quantos: achados.length };
      const nome = rotulo(achados[0]).replace(/\\s+/g, ' ').trim();
      achados[0].click();
      return { ok: true, nome };
    })()`)
  );
  if (!resultado?.ok) throw erroDeTela();
  return resultado.nome;
}

async function estadoDoUpload(sessao) {
  return sessao.avaliar(`(() => { /* nuvo:notebooklm:upload */
    ${NORMALIZAR_NA_PAGINA}
    const nomes = ${JSON.stringify(normalizados(ROTULOS.upload))};
    const botoes = [...document.querySelectorAll('button, [role="button"], a[href]')]
      .filter((e) => visivel(e) && !e.disabled && nomes.includes(normalizar(rotulo(e))));
    return { arquivos: document.querySelectorAll('input[type="file"]').length, botoes: botoes.length };
  })()`);
}

async function prepararUpload(sessao, signal) {
  const primeiro = await ate(
    sessao,
    estadoDoUpload,
    (estado) => {
      if (estado?.arquivos === 1) return 'pronto';
      if (estado?.arquivos > 1 || estado?.botoes > 1) throw erroDeTela();
      if (estado?.botoes === 1) return 'abrir';
      return undefined;
    },
    { signal }
  );

  if (primeiro === 'abrir') {
    await clicarRotulo(sessao, ROTULOS.upload, signal);
    await ate(
      sessao,
      estadoDoUpload,
      (estado) => {
        if (estado?.arquivos === 1) return true;
        if (estado?.arquivos > 1) throw erroDeTela();
        return undefined;
      },
      { signal }
    );
  }
}

async function subirArquivos(sessao, caminhos, signal) {
  await prepararUpload(sessao, signal);
  await naTela(signal, async () => {
    await sessao.cmd('DOM.enable');
    const documento = await sessao.cmd('DOM.getDocument', { depth: -1, pierce: true });
    const encontrados = await sessao.cmd('DOM.querySelectorAll', {
      nodeId: documento?.root?.nodeId,
      selector: 'input[type="file"]'
    });
    if (encontrados?.nodeIds?.length !== 1) throw erroDeTela();
    await sessao.cmd('DOM.setFileInputFiles', {
      files: caminhos,
      nodeId: encontrados.nodeIds[0]
    });
  });
}

async function estadoDoNotebook(sessao, nomes) {
  return sessao.avaliar(`(() => { /* nuvo:notebooklm:notebook */
    ${NORMALIZAR_NA_PAGINA}
    const esperados = ${JSON.stringify(nomes.map((n) => String(n).toLowerCase()))};
    const corpo = String(document.body?.innerText || '').toLowerCase();
    const fontes = esperados.every((nome) => corpo.includes(nome));
    const campos = [...document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]')]
      .filter((e) => visivel(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    const fora = location.hostname === 'accounts.google.com' || /\\/login(?:[/?#]|$)/i.test(location.pathname) ||
      Boolean(document.querySelector('input[type="email"], input[type="password"]'));
    return { fontes, campos: campos.length, fora };
  })()`);
}

async function esperarNotebook(sessao, nomes, signal) {
  return ate(
    sessao,
    (s) => estadoDoNotebook(s, nomes),
    (estado) => {
      if (estado?.fora || estado?.campos > 1) throw erroDeTela();
      if (estado?.fontes && estado?.campos === 1) return true;
      return undefined;
    },
    { signal, limite: 60_000 }
  );
}

function montarPedido(tipo) {
  const pedido = PEDIDOS[tipo];
  if (!pedido) throw erroHttp(400, 'não sei gerar isso');
  return `Produza ${pedido}, em português do Brasil, usando exclusivamente as fontes deste notebook.

Não invente fatos. Mantenha no texto as citações que o NotebookLM criar. Entregue
o conteúdo completo entre os dois marcadores abaixo, sem bloco de código e sem
nenhuma frase antes ou depois deles:

${INICIO}
[conteúdo pedido]
${FIM}

A última linha abaixo só separa este pedido da resposta; não a copie.
${FIM_DO_PEDIDO}`;
}

async function preencherChat(sessao, pedido, signal) {
  const resultado = await naTela(signal, () =>
    sessao.avaliar(`(() => { /* nuvo:notebooklm:preencher */
      ${NORMALIZAR_NA_PAGINA}
      const campos = [...document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]')]
        .filter((e) => visivel(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
      if (campos.length !== 1) return false;
      const e = campos[0];
      // Nunca escrevemos em login. O seletor já exclui inputs, e esta trava
      // torna a intenção explícita caso a página mude o elemento por baixo.
      if ((e.getAttribute('type') || '').toLowerCase() === 'password') return false;
      const valor = ${JSON.stringify(pedido)};
      e.focus();
      if (e.isContentEditable) e.textContent = valor;
      else {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!set) return false;
        set.call(e, valor);
      }
      e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: valor }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
  );
  if (resultado !== true) throw erroDeTela();
}

async function enviarPedido(sessao, pedido, signal) {
  await preencherChat(sessao, pedido, signal);
  // React habilita o botão no ciclo seguinte ao evento de input.
  const pronto = await ate(
    sessao,
    async (s) => {
      try {
        return await clicarRotulo(s, ROTULOS.enviar, signal);
      } catch (err) {
        if (err?.status !== 503) throw err;
        return null;
      }
    },
    (nome) => (nome ? true : undefined),
    { signal, limite: 5_000 }
  );
  if (!pronto) throw erroDeTela();
}

async function lerCorpo(sessao) {
  return sessao.avaliar(`(() => { /* nuvo:notebooklm:corpo */
    return document.body ? document.body.innerText : '';
  })()`);
}

/** Lê só a resposta posterior ao pedido — os marcadores também aparecem no balão do usuário. */
function lerResposta(corpo) {
  const bruto = String(corpo || '');
  const pedido = bruto.indexOf(FIM_DO_PEDIDO);
  if (pedido < 0) return null;
  const inicio = bruto.indexOf(INICIO, pedido + FIM_DO_PEDIDO.length);
  if (inicio < 0) return null;
  const fim = bruto.indexOf(FIM, inicio + INICIO.length);
  if (fim < 0) return null;
  const texto = bruto.slice(inicio + INICIO.length, fim).trim();
  return texto || null;
}

async function esperarResposta(sessao, signal) {
  return ate(sessao, lerCorpo, lerResposta, { signal, limite: 120_000 });
}

/**
 * Diz se o perfil separado do navegador já tem uma sessão utilizável.
 * Nunca abre janela de login e nunca preenche credencial.
 *
 * `sessao` é deliberadamente opcional e só existe para teste sem rede.
 * @param {{signal?: AbortSignal, sessao?: object}} opcoes
 */
export async function disponivel({ signal, sessao: sessaoInjetada } = {}) {
  let aberto = null;
  try {
    aberto = sessaoInjetada ? null : await abrirNavegador({ janela: false, signal });
    const sessao = sessaoInjetada || aberto.sessao;
    await navegar(sessao, signal);
    const logada = await conferirConta(sessao, signal);
    return logada ? { ok: true, porque: null } : { ok: false, porque: FALHA };
  } catch (err) {
    if (ehCancelamento(err, signal) || err?.status === 503) throw err;
    return { ok: false, porque: err?.message || String(err) };
  } finally {
    await aberto?.encerrar();
  }
}

/**
 * A mesma tela, com a pergunta que quem chamou quiser.
 *
 * É o que permite usar o NotebookLM como uma IA do app, e não só como gerador do
 * Estudos: a conversa manda as fontes e a pergunta, e a resposta volta pra cá.
 *
 * NotebookLM sem fonte nenhuma não é o NotebookLM — ele responde a partir do que
 * você subiu, e sem isso não há o que responder. Por isso a recusa é explícita
 * em vez de virar uma resposta genérica que pareceria uma IA comum.
 *
 * @param {{arquivos: Array<{id:string,nome:string,caminho:string}>, pergunta: string,
 *          signal?: AbortSignal, sessao?: object}} entrada
 */
export async function* perguntarNoNotebookLM({ arquivos, pergunta, signal, sessao: sessaoInjetada } = {}) {
  const lista = Array.isArray(arquivos) ? arquivos : [];
  if (!lista.length || lista.some((a) => !a?.caminho || !a?.nome)) {
    throw erroHttp(400, 'o NotebookLM responde a partir de arquivos — anexe pelo menos um');
  }
  const texto = String(pergunta || '').trim();
  if (!texto) throw erroHttp(400, 'sem pergunta não há o que perguntar');

  const pedido = [
    texto,
    '',
    'Responda em português do Brasil, a partir apenas das fontes deste notebook.',
    `Escreva a resposta entre ${INICIO} e ${FIM}.`,
    FIM_DO_PEDIDO
  ].join('\n');

  yield* conversarNaTela({
    arquivos: lista,
    pedido,
    signal,
    sessao: sessaoInjetada,
    oQuePede: 'mandando a pergunta'
  });
}

/**
 * O caminho comum das duas: abre, confere a conta, cria o notebook, sobe os
 * arquivos, manda o pedido e lê a resposta. O valor final é `{texto, fontes}`.
 */
async function* conversarNaTela({ arquivos, pedido, signal, sessao: sessaoInjetada, oQuePede }) {
  const caminhos = arquivos.map((a) => resolve(String(a.caminho)));
  const fontes = arquivos.map((a) => ({ id: a.id, nome: a.nome }));

  let aberto = null;
  try {
    yield { type: 'passo', o_que: 'abrindo o NotebookLM' };
    aberto = sessaoInjetada ? null : await naTela(signal, () => abrirNavegador({ janela: false, signal }));
    const sessao = sessaoInjetada || aberto.sessao;

    await navegar(sessao, signal);
    yield { type: 'passo', o_que: 'conferindo a sessão do NotebookLM' };
    if (!(await conferirConta(sessao, signal))) throw erroDeTela();

    yield { type: 'passo', o_que: 'criando um notebook' };
    await clicarRotulo(sessao, ROTULOS.criar, signal);

    yield {
      type: 'passo',
      o_que: `enviando ${arquivos.length} arquivo${arquivos.length === 1 ? '' : 's'}`
    };
    await subirArquivos(sessao, caminhos, signal);

    yield { type: 'passo', o_que: 'esperando o NotebookLM ler as fontes' };
    await esperarNotebook(sessao, arquivos.map((a) => a.nome), signal);

    yield { type: 'passo', o_que: oQuePede };
    await enviarPedido(sessao, pedido, signal);

    yield { type: 'passo', o_que: 'esperando a resposta do NotebookLM' };
    return { texto: await esperarResposta(sessao, signal), fontes };
  } catch (err) {
    if (ehCancelamento(err, signal) || err?.status === 400 || err?.status === 503) throw err;
    throw erroDeTela();
  } finally {
    await aberto?.encerrar();
  }
}

/**
 * Cria um notebook descartável, envia as fontes e pede a saída no chat.
 *
 * O valor final do gerador é `{texto, fontes}`; antes dele saem apenas eventos
 * `{type:'passo', o_que:'...'}`. `sessao` é injeção para o teste offline.
 *
 * @param {{arquivos: Array<{id:string,nome:string,caminho:string}>, tipo:string,
 *          signal?:AbortSignal, sessao?:object}} entrada
 * @returns {AsyncGenerator<{type:'passo',o_que:string}, {texto:string,fontes:Array}>}
 */
export async function* gerarNoNotebookLM({ arquivos, tipo, signal, sessao: sessaoInjetada } = {}) {
  const lista = Array.isArray(arquivos) ? arquivos : [];
  if (!lista.length || lista.some((a) => !a?.caminho || !a?.nome)) {
    throw erroHttp(400, 'não há material pra enviar ao NotebookLM');
  }
  const pedido = montarPedido(tipo);
  const caminhos = lista.map((a) => resolve(String(a.caminho)));
  const fontes = lista.map((a) => ({ id: a.id, nome: a.nome }));

  let aberto = null;
  try {
    yield { type: 'passo', o_que: 'abrindo o NotebookLM' };
    aberto = sessaoInjetada ? null : await naTela(signal, () => abrirNavegador({ janela: false, signal }));
    const sessao = sessaoInjetada || aberto.sessao;

    await navegar(sessao, signal);
    yield { type: 'passo', o_que: 'conferindo a sessão do NotebookLM' };
    if (!(await conferirConta(sessao, signal))) throw erroDeTela();

    yield { type: 'passo', o_que: 'criando um notebook' };
    await clicarRotulo(sessao, ROTULOS.criar, signal);

    yield { type: 'passo', o_que: `enviando ${lista.length} arquivo${lista.length === 1 ? '' : 's'}` };
    await subirArquivos(sessao, caminhos, signal);

    yield { type: 'passo', o_que: 'esperando o NotebookLM ler as fontes' };
    await esperarNotebook(sessao, lista.map((a) => a.nome), signal);

    yield { type: 'passo', o_que: `pedindo a saída ${tipo}` };
    await enviarPedido(sessao, pedido, signal);

    yield { type: 'passo', o_que: 'esperando a resposta do NotebookLM' };
    const texto = await esperarResposta(sessao, signal);
    return { texto, fontes };
  } catch (err) {
    if (ehCancelamento(err, signal) || err?.status === 400 || err?.status === 503) throw err;
    throw erroDeTela();
  } finally {
    await aberto?.encerrar();
  }
}
