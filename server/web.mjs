// Busca e leitura de página, sem chave de API.
//
// A busca sai pelo endpoint HTML do DuckDuckGo, que não pede chave nem cadastro.
// A leitura de página derruba script, style e navegação antes de virar texto —
// o que sobra é o que um leitor veria.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'"
};

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    const key = code.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return whole;
  });
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

async function get(url, { signal, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resultados de busca.
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
export async function search(query, { limit = 6, signal } = {}) {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await get(target, { signal });
  if (!res.ok) throw new Error(`busca falhou: HTTP ${res.status}`);
  const html = await res.text();

  const out = [];
  const seen = new Set();
  // O trecho depois do link vai até o próximo resultado — ou até o fim do
  // documento, no caso do último. Fechar em `</div></div></div>` dependia do
  // aninhamento exato do buscador e engolia o último resultado quando ele mudava.
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/gi;

  for (const match of html.matchAll(re)) {
    let url = decodeEntities(match[1]);
    // O DuckDuckGo embrulha o destino em /l/?uddg=<url>.
    const wrapped = url.match(/[?&]uddg=([^&]+)/);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:\/\//.test(url)) continue;

    const host = new URL(url).host;
    if (seen.has(url)) continue;
    seen.add(url);

    // Só o começo do trecho: no último resultado ele vai até o fim da página.
    const snippetMatch = match[3]
      .slice(0, 4000)
      .match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    out.push({
      title: stripTags(match[2]).slice(0, 200),
      url,
      host,
      snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 400) : ''
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Texto legível de uma página.
 * @returns {Promise<{url: string, title: string, text: string}>}
 */
export async function readPage(url, { maxChars = 12000, signal } = {}) {
  const res = await get(url, { signal, timeout: 20000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const type = res.headers.get('content-type') || '';
  const body = await res.text();

  if (!type.includes('html')) {
    return { url, title: url, text: body.slice(0, maxChars) };
  }

  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim();

  // Prefere <article> ou <main>; sem eles, o corpo inteiro.
  const main =
    body.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    body.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    body;

  const text = main
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|br)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');

  return {
    url,
    title: decodeEntities(title).slice(0, 200),
    text: decodeEntities(text)
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim()
      .slice(0, maxChars)
  };
}

/** Busca + leitura das primeiras páginas, formatado pra entrar no prompt. */
export async function searchAndRead(query, { results = 4, read = 3, signal } = {}) {
  const hits = await search(query, { limit: results, signal });
  const pages = [];
  await Promise.all(
    hits.slice(0, read).map(async (hit) => {
      try {
        const page = await readPage(hit.url, { maxChars: 6000, signal });
        pages.push({ ...hit, text: page.text });
      } catch (err) {
        pages.push({ ...hit, text: '', error: err.message });
      }
    })
  );
  // Promise.all não preserva ordem de push; reordena pelo ranking da busca.
  pages.sort((a, b) => hits.findIndex((h) => h.url === a.url) - hits.findIndex((h) => h.url === b.url));
  return { hits, pages };
}

export function renderWebBlock(pages) {
  if (!pages.length) return '';
  const parts = pages.map((page, i) => {
    const body = page.text ? page.text.slice(0, 5000) : `(não abriu: ${page.error || 'sem conteúdo'})`;
    return `## [${i + 1}] ${page.title}\n${page.url}\n\n${body}`;
  });
  return [
    '# Resultado da busca na web',
    'Cite a fonte pelo número entre colchetes quando usar. Se as páginas não',
    'responderem a pergunta, diga isso em vez de completar com suposição.',
    '',
    parts.join('\n\n')
  ].join('\n');
}
