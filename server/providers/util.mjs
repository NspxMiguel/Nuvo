// Utilitários compartilhados pelos adaptadores.

import { erroTraduzivel } from '../erro-traduzivel.mjs';

/** Quebra um ReadableStream de bytes em linhas de texto. */
export async function* lines(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        yield line;
      }
    }
    if (buffer.trim()) yield buffer;
  } finally {
    // Qualquer saída antecipada — o `[DONE]` do SSE, um erro no meio, o usuário
    // apertando parar — precisa fechar o corpo. Sem isto o soquete fica preso e
    // o provedor continua gerando do outro lado, cobrando por texto que ninguém
    // vai ler.
    reader.cancel?.()?.catch?.(() => {});
  }
}

/** Eventos `data:` de um stream SSE, já sem o prefixo e ignorando comentários. */
export async function* sseData(res) {
  for await (const line of lines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      if (payload === '[DONE]') return;
      continue;
    }
    yield payload;
  }
}

export async function ensureOk(res, label) {
  if (res.ok) return res;
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 600);
  } catch {
    /* corpo ilegível */
  }
  const err = erroTraduzivel('{ia}: HTTP {status} {texto}{detalhe}', {
    ia: label,
    status: res.status,
    texto: res.statusText,
    detalhe: detail ? ` — ${detail}` : ''
  });
  // O código e o tempo de espera viajam junto com o erro: quem chamou precisa
  // saber se vale tentar de novo, e daqui a quanto. Sem isso, um 429 de cota
  // por minuto — que passa sozinho em segundos — derrubava trabalho de minutos.
  err.httpStatus = res.status;
  const espera = quantoEsperar(res.headers.get('retry-after'), detail);
  if (espera) err.retryAfter = espera;
  throw err;
}

/**
 * Quantos segundos esperar antes de tentar de novo.
 *
 * O cabeçalho `retry-after` é o jeito certo e nem todo mundo manda. A Groq, por
 * exemplo, põe o número só na frase do corpo ("try again in 27.5175s"), então
 * vale ler os dois.
 */
function quantoEsperar(cabecalho, corpo) {
  const doCabecalho = Number(cabecalho);
  if (Number.isFinite(doCabecalho) && doCabecalho > 0) return doCabecalho;
  // A frase vem em duas formas: "27.5175s" quando é cota por minuto e
  // "1h16m39.504s" quando é a do dia. Ler só a primeira dava 0 na segunda, e o
  // recuo exponencial entrava achando que valia insistir numa cota diária.
  const naFrase = /try again in ((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?)/i.exec(String(corpo || ''));
  if (!naFrase?.[1]) return 0;
  const [, horas = 0] = /(\d+)h/.exec(naFrase[1]) || [];
  const [, minutos = 0] = /(\d+)m/.exec(naFrase[1]) || [];
  const [, segundos = 0] = /([\d.]+)s/.exec(naFrase[1]) || [];
  return Number(horas) * 3600 + Number(minutos) * 60 + Number(segundos);
}

export function trimUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}
