// Pesquisa profunda: várias buscas, leitura das páginas e um relatório com
// fontes numeradas.
//
// O modelo decide o que pesquisar, o servidor executa a busca e devolve o texto
// das páginas. Nenhuma etapa inventa fonte: o relatório só pode citar o que foi
// lido de verdade, e o que não foi encontrado sai escrito como não encontrado.

import { complete, parseJsonArray } from './complete.mjs';
import { search, readPage } from './web.mjs';
import { corpoDoErro, textoTraduzivel } from './erro-traduzivel.mjs';

const PLAN_PROMPT = `Você planeja uma pesquisa na web.

Devolva SOMENTE um array JSON de strings: as consultas de busca que respondem à
pergunta do usuário. Entre 3 e 6 consultas, cada uma num ângulo diferente
(definição, dado atual, comparação, crítica, fonte primária).
Escreva as consultas como se digitasse num buscador, sem numeração e sem aspas
internas. Use o idioma que mais provavelmente tem boas fontes para o assunto.`;

const REPORT_PROMPT = `Você escreve um relatório de pesquisa a partir de páginas que já foram lidas.

Regras:
- cite a fonte pelo número entre colchetes, assim: [3]. Todo dado que veio das
  páginas precisa de citação;
- não invente fato, número ou citação que não esteja nas páginas;
- quando as fontes divergirem, diga que divergem e mostre os dois lados;
- quando a pergunta não for respondida pelas páginas, escreva isso claramente;
- estrutura: resumo de duas ou três linhas, seções com subtítulo, e uma lista
  final "Fontes" numerada com título e endereço;
- português do Brasil, direto, sem enrolação.`;

/**
 * Gerador assíncrono: emite o andamento pra interface e termina com o relatório.
 * @param {{question: string, ref: string, rounds?: number, signal?: AbortSignal}} input
 */
export async function* runResearch({ question, ref, breadth = 4, depth = 3, signal }) {
  yield { type: 'phase', phase: 'plano', text: 'planejando as buscas' };

  let queries = [];
  try {
    const planned = await complete(ref, {
      system: PLAN_PROMPT,
      prompt: question,
      temperature: 0,
      maxTokens: 500,
      signal
    });
    queries = (parseJsonArray(planned.text) || [])
      .filter((q) => typeof q === 'string' && q.trim().length > 2)
      .slice(0, breadth);
  } catch (err) {
    yield {
      type: 'note',
      ...textoTraduzivel('text', 'o modelo não planejou ({causa}); busco a pergunta direto', { causa: err.message })
    };
  }
  if (!queries.length) queries = [question];

  yield { type: 'plan', queries };

  // Busca: cada consulta traz seus resultados, e o conjunto é desduplicado por
  // endereço antes de gastar tempo lendo página repetida.
  const found = new Map();
  for (const query of queries) {
    if (signal?.aborted) return;
    yield { type: 'phase', phase: 'busca', ...textoTraduzivel('text', 'buscando: {busca}', { busca: query }) };
    try {
      for (const hit of await search(query, { limit: 6, signal })) {
        if (!found.has(hit.url)) found.set(hit.url, { ...hit, query });
      }
    } catch (err) {
      yield {
        type: 'note',
        ...textoTraduzivel('text', 'busca falhou em "{busca}": {causa}', { busca: query, causa: err.message })
      };
    }
  }

  // Rodízio entre as consultas: o primeiro resultado de cada uma antes do
  // segundo de qualquer outra.
  //
  // O plano quebra a pergunta em ângulos diferentes de propósito — definição,
  // dado atual, comparação, crítica. Lendo na ordem em que as buscas voltaram,
  // a cota de páginas acabava nos dois primeiros ângulos: com 4 consultas de 6
  // resultados e teto de 12 páginas, o terceiro e o quarto nunca eram lidos, e
  // o relatório saía com metade da pesquisa que ele mesmo planejou.
  const porConsulta = new Map(queries.map((q) => [q, []]));
  for (const hit of found.values()) porConsulta.get(hit.query)?.push(hit);

  const hits = [];
  for (let i = 0; hits.length < found.size; i++) {
    let avancou = false;
    for (const lista of porConsulta.values()) {
      if (lista[i]) {
        hits.push(lista[i]);
        avancou = true;
      }
    }
    if (!avancou) break;
  }

  yield { type: 'hits', hits: hits.map((h) => ({ title: h.title, url: h.url, host: h.host })) };
  if (!hits.length) {
    yield { type: 'error', message: 'nenhum resultado de busca — sem fonte não escrevo relatório' };
    return;
  }

  // Leitura: as primeiras `depth * queries` páginas, em paralelo limitado.
  const toRead = hits.slice(0, Math.min(hits.length, depth * queries.length, 12));
  const pages = [];
  for (let i = 0; i < toRead.length; i += 4) {
    if (signal?.aborted) return;
    const batch = toRead.slice(i, i + 4);
    yield {
      type: 'phase',
      phase: 'leitura',
      ...textoTraduzivel('text', 'lendo {de}–{ate} de {total}', {
        de: i + 1,
        ate: i + batch.length,
        total: toRead.length
      })
    };
    const read = await Promise.all(
      batch.map(async (hit) => {
        try {
          const page = await readPage(hit.url, { maxChars: 7000, signal });
          // A explicação de "monta o conteúdo por JavaScript" vinha e era
          // jogada fora aqui: a tela dizia "0 caracteres" sem dizer por quê.
          return { ...hit, text: page.text, title: page.title || hit.title, error: page.note || null };
        } catch (err) {
          return { ...hit, text: '', ...corpoDoErro(err) };
        }
      })
    );
    for (const page of read) {
      pages.push(page);
      yield {
        type: 'read',
        url: page.url,
        title: page.title,
        chars: page.text.length,
        error: page.error || null
      };
    }
  }

  const usable = pages.filter((p) => p.text.length > 200);
  if (!usable.length) {
    // Dois motivos diferentes davam a mesma frase. Página que abriu com texto
    // curto — o "404" que responde 200, por exemplo — não é página que não
    // abriu, e dizer que não abriu manda procurar o problema no lugar errado.
    const abriuAlguma = pages.some((p) => !p.error && p.text.length);
    yield {
      type: 'error',
      message: abriuAlguma
        ? 'as páginas abriram, mas trouxeram texto de menos — sem fonte não escrevo relatório'
        : 'as páginas não abriram ou vieram vazias — sem fonte não escrevo relatório'
    };
    return;
  }

  // Português, inglês e espanhol cortam o plural no mesmo lugar, então a
  // escolha aqui vale pras três; o dicionário guarda as duas formas.
  yield {
    type: 'phase',
    phase: 'relatório',
    ...textoTraduzivel(
      'text',
      usable.length === 1 ? 'escrevendo a partir de 1 fonte' : 'escrevendo a partir de {n} fontes',
      { n: usable.length }
    )
  };

  const corpus = usable
    .map((page, i) => `[${i + 1}] ${page.title}\n${page.url}\n\n${page.text}`)
    .join('\n\n---\n\n');

  const report = await complete(ref, {
    system: REPORT_PROMPT,
    prompt: `Pergunta: ${question}\n\nConsultas feitas: ${queries.join(' | ')}\n\nPáginas lidas:\n\n${corpus}`,
    maxTokens: 4000,
    signal
  });

  yield {
    type: 'report',
    text: report.text,
    sources: usable.map((p, i) => ({ n: i + 1, title: p.title, url: p.url })),
    ms: report.ms
  };
}
