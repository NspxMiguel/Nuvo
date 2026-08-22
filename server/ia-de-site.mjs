// As IAs pelo site delas, dirigindo o navegador.
//
// Nem toda IA tem API, e a que tem cobra à parte da assinatura que ele já paga.
// O que já está pago é a conta no site: ChatGPT, Claude, Gemini, DeepSeek, Kimi
// e companhia respondem ali de graça pra quem está logado. Este módulo usa a
// tela delas do mesmo jeito que uma pessoa usa — abre, digita, espera e lê.
//
// **Entrar é dele.** O app nunca digita senha nem código: o Chrome tem perfil
// próprio e persistente, então a sessão que ele abriu uma vez continua valendo.
// Sem sessão, a resposta é uma recusa explícita dizendo pra entrar no site.
//
// Por que um motor só e não um por site: seletor de CSS de app de chat muda toda
// semana, e dez integrações com seletor fixo seriam dez quebras por mês. Aqui a
// tela é lida como uma pessoa leria — a caixa de texto é a maior área editável
// visível, o botão de enviar é o que está habilitado ao lado dela — e a resposta
// não é lida do DOM: ela vem entre marcas que o próprio modelo escreve.

import { abrirNavegador } from './navegador.mjs';
import { erroHttp } from './erro-traduzivel.mjs';

/** As marcas que cercam a resposta. Ler o DOM seria depender do desenho do site. */
const INICIO = '<<<NUVO_R_INICIO>>>';
const FIM = '<<<NUVO_R_FIM>>>';
// A terceira marca fecha o pedido. Sem ela, a própria instrução — que precisa
// citar as duas outras pra pedir o formato — vira uma resposta encontrável: a
// leitura devolvia o pedaço de frase que fica entre elas dentro da instrução.
const FIM_DO_PEDIDO = '<<<NUVO_PEDIDO_FIM>>>';

/**
 * Os sites. Cada um precisa de nome, endereço e nada mais — o resto é do motor.
 *
 * `enter: false` fica pra site onde Enter quebra linha em vez de enviar; nesses,
 * o motor procura o botão. `espera` é o teto de segundos de uma resposta: modelo
 * de raciocínio demora mais, e cortar cedo é jogar fora resposta boa.
 */
export const SITES = [
  { id: 'chatgpt', nome: 'ChatGPT', endereco: 'https://chatgpt.com/', espera: 180 },
  { id: 'claude', nome: 'Claude', endereco: 'https://claude.ai/new', espera: 180 },
  { id: 'gemini', nome: 'Gemini', endereco: 'https://gemini.google.com/app', espera: 180 },
  { id: 'deepseek', nome: 'DeepSeek', endereco: 'https://chat.deepseek.com/', espera: 240 },
  { id: 'glm', nome: 'GLM (Z.ai)', endereco: 'https://chat.z.ai/', espera: 180 },
  { id: 'kimi', nome: 'Kimi', endereco: 'https://www.kimi.com/', espera: 240 },
  { id: 'qwen', nome: 'Qwen', endereco: 'https://chat.qwen.ai/', espera: 180 },
  { id: 'grok', nome: 'Grok', endereco: 'https://grok.com/', espera: 180 },
  { id: 'mistral', nome: 'Le Chat (Mistral)', endereco: 'https://chat.mistral.ai/chat', espera: 180 },
  { id: 'copilot', nome: 'Copilot', endereco: 'https://copilot.microsoft.com/', espera: 180 },
  { id: 'perplexity', nome: 'Perplexity', endereco: 'https://www.perplexity.ai/', espera: 180 }
];

export const acharSite = (id) => SITES.find((s) => s.id === id) || null;

const FALHA = 'a tela mudou ou você não está logado neste site — entre nele no navegador do app e tente de novo';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function pararSePreciso(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('cancelado', 'AbortError');
}

const ehCancelamento = (err, signal) => Boolean(signal?.aborted || err?.name === 'AbortError');

/** Qualquer quebra da tela vira a única falha segura desta integração. */
async function naTela(signal, trabalho) {
  pararSePreciso(signal);
  try {
    return await trabalho();
  } catch (err) {
    if (ehCancelamento(err, signal) || err?.status) throw err;
    throw erroHttp(503, FALHA);
  }
}

// --------------------------------------------------------------- a tela

/**
 * Acha a caixa de texto: a maior área editável visível da página.
 *
 * É assim que uma pessoa acha — a caixa grande no rodapé. Procurar por
 * `#prompt-textarea` funcionaria hoje no ChatGPT e em mais nenhum lugar, nem no
 * ChatGPT do mês que vem.
 */
const ACHAR_CAIXA = `(() => {
  const cand = [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 120 && r.height > 18 && s.visibility !== 'hidden' && s.display !== 'none' && !e.disabled && !e.readOnly;
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
  const alvo = cand[0];
  if (!alvo) return { achou: false, senha: !!document.querySelector('input[type=password]') };
  alvo.setAttribute('data-nuvo-caixa', '1');
  return { achou: true, tag: alvo.tagName.toLowerCase(), senha: !!document.querySelector('input[type=password]') };
})()`;

/**
 * Escreve na caixa disparando os eventos que um framework escuta.
 *
 * `value = texto` sozinho não avisa React nem Vue, e o site manda a mensagem
 * vazia — o setter nativo com `input` por cima é o que faz o estado acompanhar.
 */
const escrever = (texto) => `(() => {
  const e = document.querySelector('[data-nuvo-caixa]');
  if (!e) return { ok: false };
  const t = ${JSON.stringify(texto)};
  e.focus();
  if (e.tagName === 'TEXTAREA' || e.tagName === 'INPUT') {
    const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, t);
  } else {
    e.textContent = t;
  }
  e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, tem: (e.value ?? e.textContent ?? '').length };
})()`;

/** Clica no botão de enviar: o habilitado mais próximo da caixa, à direita/abaixo. */
const CLICAR_ENVIAR = `(() => {
  const caixa = document.querySelector('[data-nuvo-caixa]');
  if (!caixa) return { ok: false };
  const r = caixa.getBoundingClientRect();
  const perto = [...document.querySelectorAll('button, [role=button]')]
    .filter((b) => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      const rb = b.getBoundingClientRect();
      if (rb.width < 12 || rb.height < 12) return false;
      return rb.top > r.top - 120 && rb.bottom < r.bottom + 160 && rb.left > r.left - 80;
    })
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
  const alvo = perto[0];
  if (!alvo) return { ok: false };
  alvo.click();
  return { ok: true, nome: (alvo.getAttribute('aria-label') || alvo.textContent || '').trim().slice(0, 40) };
})()`;

const CORPO = `(() => (document.body ? document.body.innerText : ''))()`;

/**
 * O pedido, com as marcas que cercam a resposta.
 *
 * A resposta não é lida do DOM porque o DOM é deles e muda. Ela é lida do texto
 * da página, entre duas marcas que o próprio modelo escreve — o que funciona em
 * qualquer site sem saber nada sobre ele.
 */
export function comMarcas(pergunta) {
  return [
    pergunta,
    '',
    `Formato obrigatório da sua resposta: escreva ${INICIO} numa linha, depois a resposta, depois ${FIM} numa linha.`,
    'Nada fora dessas marcas.',
    FIM_DO_PEDIDO
  ].join('\n');
}

/**
 * Só o que veio depois do pedido.
 *
 * O pedido aparece na tela — ele foi digitado ali — e precisa citar as duas
 * marcas pra pedir o formato. Procurar a resposta na página inteira encontrava a
 * instrução e devolvia um pedaço dela como se fosse a resposta.
 */
function depoisDoPedido(corpo) {
  const texto = String(corpo || '');
  const fim = texto.lastIndexOf(FIM_DO_PEDIDO);
  return fim < 0 ? texto : texto.slice(fim + FIM_DO_PEDIDO.length);
}

/** A resposta entre as marcas, ou null enquanto ela não terminou. */
export function lerEntreMarcas(corpo) {
  const texto = depoisDoPedido(corpo);
  const i = texto.lastIndexOf(INICIO);
  if (i < 0) return null;
  const j = texto.indexOf(FIM, i + INICIO.length);
  if (j < 0) return null;
  const resposta = texto.slice(i + INICIO.length, j).trim();
  return resposta || null;
}

// --------------------------------------------------------------- o motor

/**
 * Pergunta a uma IA pelo site dela. Vai contando o que está fazendo.
 *
 * @param {{site: string, pergunta: string, signal?: AbortSignal, sessao?: object}} entrada
 */
export async function* perguntarNoSite({ site, pergunta, signal, sessao: sessaoInjetada } = {}) {
  const alvo = acharSite(site);
  if (!alvo) throw erroHttp(400, 'não conheço esse site de IA');
  if (!String(pergunta || '').trim()) throw erroHttp(400, 'sem pergunta não há o que perguntar');

  let aberto = null;
  try {
    yield { passo: `abrindo ${alvo.nome}` };
    aberto = sessaoInjetada ? null : await naTela(signal, () => abrirNavegador({ janela: false, signal }));
    const sessao = sessaoInjetada || aberto.sessao;

    await naTela(signal, async () => {
      await sessao.cmd('Page.navigate', { url: alvo.endereco });
    });

    yield { passo: `procurando a caixa de texto` };
    const caixa = await esperarCaixa(sessao, signal);
    if (!caixa.achou) {
      throw erroHttp(
        503,
        caixa.senha
          ? 'este site está pedindo login — entre nele no navegador do app; o app não digita senha'
          : FALHA
      );
    }

    yield { passo: 'escrevendo a pergunta' };
    const escrito = await naTela(signal, () => sessao.avaliar(escrever(comMarcas(pergunta))));
    if (!escrito?.ok || !escrito.tem) throw erroHttp(503, FALHA);

    yield { passo: 'enviando' };
    await enviar(sessao, alvo, signal);

    yield { passo: `esperando ${alvo.nome} responder` };
    const texto = await esperarResposta(sessao, alvo, signal);
    return { texto, site: alvo.id, nome: alvo.nome };
  } catch (err) {
    if (ehCancelamento(err, signal) || err?.status) throw err;
    throw erroHttp(503, FALHA);
  } finally {
    await aberto?.encerrar();
  }
}

async function esperarCaixa(sessao, signal, limite = 25_000) {
  const fim = Date.now() + limite;
  let ultimo = { achou: false, senha: false };
  while (Date.now() < fim) {
    pararSePreciso(signal);
    await dormir(500);
    try {
      ultimo = await sessao.avaliar(ACHAR_CAIXA);
    } catch {
      continue; // a página ainda está trocando de contexto
    }
    if (ultimo?.achou) return ultimo;
  }
  return ultimo || { achou: false, senha: false };
}

async function enviar(sessao, alvo, signal) {
  if (alvo.enter !== false) {
    await naTela(signal, async () => {
      for (const type of ['keyDown', 'keyUp']) {
        await sessao.cmd('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        });
      }
    });
    await dormir(700);
    // Enter que não enviou deixa o texto na caixa: aí o botão é o caminho.
    const sobrou = await naTela(signal, () =>
      sessao.avaliar(`(() => { const e = document.querySelector('[data-nuvo-caixa]'); return e ? (e.value ?? e.textContent ?? '').length : 0 })()`)
    );
    if (!sobrou) return;
  }
  const clicou = await naTela(signal, () => sessao.avaliar(CLICAR_ENVIAR));
  if (!clicou?.ok) throw erroHttp(503, FALHA);
}

/**
 * Espera a resposta fechar.
 *
 * Duas condições: a marca de fim apareceu, ou o texto da página parou de crescer
 * por tempo suficiente — a segunda existe porque modelo às vezes esquece a marca,
 * e devolver o que ele escreveu é melhor do que estourar o prazo com a mão vazia.
 */
async function esperarResposta(sessao, alvo, signal) {
  const teto = Date.now() + (alvo.espera || 180) * 1000;
  let anterior = -1;
  let parado = 0;
  let ultimoCorpo = '';
  while (Date.now() < teto) {
    pararSePreciso(signal);
    await dormir(1200);
    let corpo;
    try {
      corpo = await sessao.avaliar(CORPO);
    } catch {
      continue;
    }
    ultimoCorpo = String(corpo || '');
    const pronta = lerEntreMarcas(ultimoCorpo);
    if (pronta) return pronta;
    if (ultimoCorpo.length === anterior) parado += 1;
    else {
      parado = 0;
      anterior = ultimoCorpo.length;
    }
    // Quinze segundos sem uma letra nova: ou acabou sem a marca, ou travou.
    if (parado >= 12) break;
  }
  const solto = semMarcaDeFim(ultimoCorpo);
  if (solto) return solto;
  throw erroHttp(504, 'o site não terminou de responder a tempo');
}

/** O que veio depois da marca de início, quando a de fim nunca chegou. */
export function semMarcaDeFim(corpo) {
  const texto = depoisDoPedido(corpo);
  const i = texto.lastIndexOf(INICIO);
  if (i < 0) return null;
  const resto = texto.slice(i + INICIO.length).trim();
  return resto || null;
}

/** A sessão serve? Usado pelo botão "testar" do provedor. */
export async function disponivel({ site, signal, sessao: sessaoInjetada } = {}) {
  const alvo = acharSite(site);
  if (!alvo) return { ok: false, porque: 'não conheço esse site de IA' };
  let aberto = null;
  try {
    aberto = sessaoInjetada ? null : await abrirNavegador({ janela: false, signal });
    const sessao = sessaoInjetada || aberto.sessao;
    await sessao.cmd('Page.navigate', { url: alvo.endereco });
    const caixa = await esperarCaixa(sessao, signal);
    if (caixa?.achou) return { ok: true, porque: null };
    return {
      ok: false,
      porque: caixa?.senha
        ? 'este site está pedindo login — entre nele no navegador do app'
        : FALHA
    };
  } catch (err) {
    if (ehCancelamento(err, signal)) throw err;
    return { ok: false, porque: err?.message || FALHA };
  } finally {
    await aberto?.encerrar();
  }
}
