// Chamada avulsa a um modelo, sem conversa por trás.
//
// Quem precisa disso: o extrator de memória, o pesquisador, o conselho e o
// título automático. Todos querem "manda esse prompt nesse modelo e me devolve
// o texto", sem histórico, sem gravar mensagem e sem tocar na memória.

import { adapterFor, contextFor, getProvider, parseRef } from './providers/index.mjs';
import { erroTraduzivel } from './erro-traduzivel.mjs';

/**
 * Quanto tempo ainda vale esperar por uma cota que se renova sozinha.
 *
 * Cota por minuto é o caso comum: o provedor devolve 429 dizendo "tente em 27
 * segundos", e uma espera curta salva um trabalho que já custou minutos. Passar
 * de um minuto de espera é outra coisa — cota diária, cartão vencido —, e aí
 * insistir só empurra o erro pra frente.
 */
const TETO_DE_ESPERA = 60;
const TENTATIVAS = 3;
const PODE_ESPERAR = new Set([429, 500, 502, 503, 504]);

const dormir = (ms, signal) =>
  new Promise((ok, falha) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        falha(signal.reason ?? new Error('cancelado'));
      },
      { once: true }
    );
  });

/** @returns {Promise<{text: string, reasoning: string, usage: object|null, ms: number}>} */
export async function complete(ref, { system, messages, prompt, temperature, maxTokens, signal } = {}) {
  const { providerId, modelId } = parseRef(ref);
  const provider = getProvider(providerId);
  if (!provider) throw erroTraduzivel('provedor sumiu: {id}', { id: providerId });
  const adapter = adapterFor(provider.kind);

  const started = Date.now();
  for (let tentativa = 1; ; tentativa += 1) {
    let text = '';
    let reasoning = '';
    let usage = null;
    try {
      for await (const chunk of adapter.stream(contextFor(provider), {
        model: modelId,
        system: system || null,
        messages: messages || [{ role: 'user', content: prompt || '' }],
        temperature: temperature ?? null,
        maxTokens: maxTokens ?? null,
        signal
      })) {
        if (chunk.delta) text += chunk.delta;
        if (chunk.reasoning) reasoning += chunk.reasoning;
        if (chunk.usage) usage = chunk.usage;
      }
      return { text: text.trim(), reasoning, usage, ms: Date.now() - started };
    } catch (err) {
      // Cancelar é decisão de quem chamou, não falha de rede: sai na hora.
      if (signal?.aborted) throw err;
      const espera = quantoEsperar(err, tentativa);
      if (tentativa >= TENTATIVAS || !espera) throw err;
      await dormir(espera * 1000, signal);
    }
  }
}

/** Segundos até a próxima tentativa, ou 0 quando não vale tentar. */
function quantoEsperar(err, tentativa) {
  if (!PODE_ESPERAR.has(err?.httpStatus)) return 0;
  // O provedor manda quanto esperar quando sabe; quando não manda, dobra a cada
  // tentativa a partir de dois segundos.
  const pedido = Number(err.retryAfter) || 2 ** tentativa;
  return pedido > TETO_DE_ESPERA ? 0 : Math.ceil(pedido) + 1;
}

/** Nome legível do modelo, pra aparecer na tela sem o id interno. */
export function describeModel(ref) {
  try {
    const { providerId, modelId } = parseRef(ref);
    const provider = getProvider(providerId);
    return provider ? `${provider.name} · ${modelId}` : ref;
  } catch {
    return ref;
  }
}

/**
 * Extrai o primeiro objeto JSON de uma resposta que veio com conversa em volta.
 *
 * A varredura fecha chaves em vez de casar a primeira com a última: modelo que
 * escreve `{...}` e emenda um parágrafo com outra chave depois entregava um
 * pedaço maior do que o objeto, e o JSON.parse morria.
 */
export function parseJsonObject(text) {
  const bruto = String(text);
  const inicio = bruto.indexOf('{');
  if (inicio < 0) return null;
  let nivel = 0;
  let dentroDeTexto = false;
  let escapado = false;
  for (let i = inicio; i < bruto.length; i += 1) {
    const c = bruto[i];
    if (dentroDeTexto) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') dentroDeTexto = false;
      continue;
    }
    if (c === '"') dentroDeTexto = true;
    else if (c === '{') nivel += 1;
    else if (c === '}') {
      nivel -= 1;
      if (nivel === 0) {
        try {
          const lido = JSON.parse(bruto.slice(inicio, i + 1));
          return lido && typeof lido === 'object' && !Array.isArray(lido) ? lido : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Extrai o primeiro array JSON de uma resposta que veio com conversa em volta. */
export function parseJsonArray(text) {
  const match = String(text).match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
