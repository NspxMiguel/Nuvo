// Busca na web, conselho de IAs e pesquisa profunda. Nada aqui sai pra
// internet: a rede é encenada e o modelo é falso.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, stubFetch, fakeResponse, collect } from './helpers.mjs';

const home = useTempHome();
const web = await import('../server/web.mjs');
const { runCouncil } = await import('../server/council.mjs');
const { runResearch } = await import('../server/research.mjs');
const { run, now, uid } = await import('../server/db.mjs');

after(() => home.cleanup());

// -------------------------------------------------------------------- web

const RESULTADO_HTML = `
<html><body>
<div class="result results_links">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexemplo.com%2Fum">Primeiro <b>resultado</b></a>
  <a class="result__snippet" href="#">Resumo do primeiro resultado com detalhes.</a>
</div>
<div class="result results_links">
  <a class="result__a" href="https://outro.org/dois">Segundo resultado</a>
  <a class="result__snippet" href="#">Resumo do segundo.</a>
</div>
</body></html>`;

test('busca extrai título, endereço desembrulhado e resumo', async () => {
  const stub = stubFetch(async (url) => {
    assert.match(url, /duckduckgo/);
    return fakeResponse(RESULTADO_HTML);
  });
  try {
    const hits = await web.search('qualquer coisa', { limit: 5 });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].url, 'https://exemplo.com/um', 'o endereço tinha que sair do embrulho do buscador');
    assert.equal(hits[0].host, 'exemplo.com');
    assert.match(hits[0].title, /Primeiro resultado/);
    assert.match(hits[0].snippet, /Resumo do primeiro/);
  } finally {
    stub.restore();
  }
});

test('busca respeita o limite pedido', async () => {
  const stub = stubFetch(async () => fakeResponse(RESULTADO_HTML));
  try {
    assert.equal((await web.search('x', { limit: 1 })).length, 1);
  } finally {
    stub.restore();
  }
});

test('busca com HTTP de erro reclama em vez de devolver lista vazia', async () => {
  const stub = stubFetch(async () => fakeResponse('', { ok: false, status: 503 }));
  try {
    await assert.rejects(web.search('x'), /503/);
  } finally {
    stub.restore();
  }
});

test('leitura de página derruba script e navegação', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(
      `<html><head><title>Título da página</title></head><body>
       <nav>menu que não interessa</nav>
       <script>var roubo = 1;</script>
       <style>.x{color:red}</style>
       <article><p>Conteúdo de verdade.</p><p>Segunda frase &amp; escape.</p></article>
       <footer>rodapé</footer></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    )
  );
  try {
    const page = await web.readPage('https://exemplo.com/a');
    assert.equal(page.title, 'Título da página');
    assert.match(page.text, /Conteúdo de verdade/);
    assert.match(page.text, /Segunda frase & escape/);
    assert.ok(!/roubo/.test(page.text), 'script não pode entrar no texto');
    assert.ok(!/color:red/.test(page.text), 'estilo não pode entrar no texto');
    assert.ok(!/menu que não interessa/.test(page.text), 'o <article> tinha que ter sido preferido');
  } finally {
    stub.restore();
  }
});

test('leitura corta no tamanho pedido', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(`<html><body><p>${'a'.repeat(50_000)}</p></body></html>`, {
      headers: { 'content-type': 'text/html' }
    })
  );
  try {
    const page = await web.readPage('https://exemplo.com/grande', { maxChars: 1000 });
    assert.ok(page.text.length <= 1000);
  } finally {
    stub.restore();
  }
});

test('bloco da web numera as fontes e marca a que não abriu', () => {
  const bloco = web.renderWebBlock([
    { title: 'Um', url: 'https://a.com', text: 'texto da primeira' },
    { title: 'Dois', url: 'https://b.com', text: '', error: 'HTTP 403' }
  ]);
  assert.match(bloco, /\[1\] Um/);
  assert.match(bloco, /\[2\] Dois/);
  assert.match(bloco, /não abriu: HTTP 403/);
});

// --------------------------------------------------------------- conselho

/** Provedor falso no banco, com um modelo — o fetch é encenado depois. */
function criarProvedor(nome) {
  const id = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, ?, 'openai', ?, NULL, '{}', 1, 0, ?)`,
    id, nome, `http://${nome}.invalido/v1`, now()
  );
  run(
    'INSERT INTO models (id, provider_id, model_id, label, kind, seen_at) VALUES (?,?,?,?,?,?)',
    uid(), id, 'm', 'm', 'chat', now()
  );
  return `${id}:m`;
}

const refA = criarProvedor('alfa');
const refB = criarProvedor('beta');

function respostaDe(texto) {
  return fakeResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: texto } }] })}\n\n`,
    'data: [DONE]\n\n'
  ]);
}

test('conselho: dois modelos respondem e um sintetiza', async () => {
  const stub = stubFetch(async (url) => {
    if (url.includes('alfa')) return respostaDe('resposta do alfa');
    if (url.includes('beta')) return respostaDe('resposta do beta');
    return fakeResponse('', { ok: false, status: 404 });
  });
  try {
    const eventos = await collect(
      runCouncil({ prompt: 'pergunta', refs: [refA, refB], mode: 'council', judge: refA })
    );
    const tipos = eventos.map((e) => e.type);
    assert.equal(tipos[0], 'start');
    assert.equal(eventos.filter((e) => e.type === 'answer').length, 2);
    assert.ok(tipos.includes('synthesis'));
    assert.equal(tipos.at(-1), 'done');
  } finally {
    stub.restore();
  }
});

test('conselho: modo comparar não chama o juiz', async () => {
  const stub = stubFetch(async () => respostaDe('resposta qualquer'));
  try {
    const eventos = await collect(
      runCouncil({ prompt: 'p', refs: [refA, refB], mode: 'compare' })
    );
    assert.equal(stub.calls.length, 2, 'só as duas respostas, sem síntese');
    assert.ok(!eventos.some((e) => e.type === 'synthesis'));
  } finally {
    stub.restore();
  }
});

test('conselho: modelo que falha não derruba os outros', async () => {
  const stub = stubFetch(async (url) => {
    if (url.includes('alfa')) return respostaDe('só o alfa respondeu');
    throw new Error('beta caiu');
  });
  try {
    const eventos = await collect(runCouncil({ prompt: 'p', refs: [refA, refB], mode: 'compare' }));
    const respostas = eventos.filter((e) => e.type === 'answer');
    assert.equal(respostas.length, 2);
    assert.equal(respostas.filter((r) => r.error).length, 1);
    assert.ok(respostas.some((r) => r.text === 'só o alfa respondeu'));
  } finally {
    stub.restore();
  }
});

test('conselho: votação devolve nota média e vencedor', async () => {
  const stub = stubFetch(async (url, options) => {
    const corpo = JSON.parse(options.body);
    const ehJulgamento = /avalia respostas candidatas/i.test(corpo.messages[0]?.content || '');
    if (ehJulgamento) {
      return respostaDe('[{"nota": 9, "porque": "boa"}, {"nota": 5, "porque": "fraca"}]');
    }
    return respostaDe(url.includes('alfa') ? 'resposta do alfa' : 'resposta do beta');
  });
  try {
    const eventos = await collect(runCouncil({ prompt: 'p', refs: [refA, refB], mode: 'vote' }));
    const votos = eventos.find((e) => e.type === 'votes');
    assert.ok(votos, 'faltou o evento de notas');
    assert.equal(votos.ranked.length, 2);
    assert.ok(votos.ranked[0].average >= votos.ranked[1].average, 'a lista tem que vir ordenada');
    assert.ok(eventos.some((e) => e.type === 'winner'));
  } finally {
    stub.restore();
  }
});

test('votação: a nota volta pro dono, mesmo com a ordem embaralhada', async () => {
  // Cada jurado vê as candidatas em ordem diferente. Se o rodízio não for
  // desfeito na volta, a nota que um jurado deu à candidata 1 é creditada ao
  // modelo errado — e o placar fica plausível, só que trocado.
  const refC = criarProvedor('gama');
  const nomes = ['alfa', 'beta', 'gama'];
  const stub = stubFetch(async (url, options) => {
    const corpo = JSON.parse(options.body);
    if (/avalia respostas candidatas/i.test(corpo.messages[0]?.content || '')) {
      // O jurado reconhece pelo texto, não pela posição: alfa 10, beta 5, gama 1.
      const notas = corpo.messages[1].content
        .split('### Candidata')
        .slice(1)
        .map((bloco) => ({ nota: bloco.includes('do alfa') ? 10 : bloco.includes('do beta') ? 5 : 1, porque: 'x' }));
      return respostaDe(JSON.stringify(notas));
    }
    return respostaDe(`resposta do ${nomes.find((n) => url.includes(n))}`);
  });
  try {
    const eventos = await collect(runCouncil({ prompt: 'p', refs: [refA, refB, refC], mode: 'vote' }));
    const { ranked } = eventos.find((e) => e.type === 'votes');
    assert.deepEqual(
      ranked.map((r) => r.average),
      [10, 5, 1],
      JSON.stringify(ranked.map((r) => [r.label, r.average]))
    );
    assert.equal(eventos.find((e) => e.type === 'winner').text, 'resposta do alfa');
  } finally {
    stub.restore();
  }
});

test('votação: jurado que responde fora da escala é anulado, não vira vencedor', async () => {
  // Modelo local ignorando "nota de 0 a 10" e devolvendo de 0 a 100 é comum. O
  // 80 dele sozinho enterrava o 10 de todos os outros: vencia a resposta que a
  // maioria tinha posto em último lugar.
  const refC = criarProvedor('delta');
  const nomes = ['alfa', 'beta', 'delta'];
  let primeiroJurado = true;
  const stub = stubFetch(async (url, options) => {
    const corpo = JSON.parse(options.body);
    if (/avalia respostas candidatas/i.test(corpo.messages[0]?.content || '')) {
      const blocos = corpo.messages[1].content.split('### Candidata').slice(1);
      if (primeiroJurado) {
        primeiroJurado = false;
        return respostaDe(
          JSON.stringify(blocos.map((b) => ({ nota: b.includes('do delta') ? 80 : 20, porque: 'x' })))
        );
      }
      return respostaDe(
        JSON.stringify(blocos.map((b) => ({ nota: b.includes('do alfa') ? 10 : 2, porque: 'x' })))
      );
    }
    return respostaDe(`resposta do ${nomes.find((n) => url.includes(n))}`);
  });
  try {
    const eventos = await collect(runCouncil({ prompt: 'p', refs: [refA, refB, refC], mode: 'vote' }));
    const votos = eventos.find((e) => e.type === 'votes');
    assert.equal(votos.anuladas, 1, 'a cédula fora da escala tinha que ter sido anulada');
    assert.ok(
      votos.ranked.every((r) => r.votes.every((v) => v.nota <= 10)),
      'nota fora da escala entrou no placar'
    );
    assert.equal(eventos.find((e) => e.type === 'winner').text, 'resposta do alfa');
  } finally {
    stub.restore();
  }
});

test('conselho: um modelo só é recusado', async () => {
  await assert.rejects(collect(runCouncil({ prompt: 'p', refs: [refA] })), /pelo menos dois/);
});

// --------------------------------------------------------------- pesquisa

test('pesquisa: planeja, busca, lê e escreve relatório com fontes', async () => {
  const stub = stubFetch(async (url, options) => {
    if (url.includes('duckduckgo')) return fakeResponse(RESULTADO_HTML);
    if (url.startsWith('https://exemplo.com') || url.startsWith('https://outro.org')) {
      return fakeResponse(
        `<html><head><title>Fonte</title></head><body><article>${'conteúdo relevante da página. '.repeat(30)}</article></body></html>`,
        { headers: { 'content-type': 'text/html' } }
      );
    }
    const corpo = JSON.parse(options.body);
    const sistema = corpo.messages[0]?.content || '';
    if (/planeja uma pesquisa/i.test(sistema)) {
      return respostaDe('["consulta um", "consulta dois"]');
    }
    return respostaDe('# Relatório\n\nAchado importante [1].\n\n## Fontes\n1. Fonte — https://exemplo.com/um');
  });
  try {
    const eventos = await collect(runResearch({ question: 'o que é X', ref: refA, breadth: 2, depth: 1 }));
    const plano = eventos.find((e) => e.type === 'plan');
    assert.deepEqual(plano.queries, ['consulta um', 'consulta dois']);
    assert.ok(eventos.some((e) => e.type === 'read'));

    const relatorio = eventos.find((e) => e.type === 'report');
    assert.ok(relatorio, 'faltou o relatório');
    assert.match(relatorio.text, /Achado importante \[1\]/);
    assert.ok(relatorio.sources.length > 0, 'o relatório tem que vir com a lista de fontes lidas');
  } finally {
    stub.restore();
  }
});

test('pesquisa: sem resultado de busca, não inventa relatório', async () => {
  const stub = stubFetch(async (url) => {
    if (url.includes('duckduckgo')) return fakeResponse('<html><body>nada aqui</body></html>');
    return respostaDe('["consulta"]');
  });
  try {
    const eventos = await collect(runResearch({ question: 'x', ref: refA, breadth: 1, depth: 1 }));
    assert.ok(!eventos.some((e) => e.type === 'report'), 'não pode escrever relatório sem fonte');
    assert.match(eventos.find((e) => e.type === 'error').message, /nenhum resultado/);
  } finally {
    stub.restore();
  }
});

test('pesquisa: página que não abre é relatada, e a pesquisa segue', async () => {
  const stub = stubFetch(async (url, options) => {
    if (url.includes('duckduckgo')) return fakeResponse(RESULTADO_HTML);
    if (url.startsWith('https://exemplo.com')) return fakeResponse('', { ok: false, status: 403 });
    if (url.startsWith('https://outro.org')) {
      return fakeResponse(
        `<html><body><article>${'texto suficiente para valer como fonte. '.repeat(20)}</article></body></html>`,
        { headers: { 'content-type': 'text/html' } }
      );
    }
    const corpo = JSON.parse(options.body);
    if (/planeja uma pesquisa/i.test(corpo.messages[0]?.content || '')) return respostaDe('["consulta"]');
    return respostaDe('Relatório com uma fonte só.');
  });
  try {
    const eventos = await collect(runResearch({ question: 'x', ref: refA, breadth: 1, depth: 2 }));
    const falha = eventos.find((e) => e.type === 'read' && e.error);
    assert.ok(falha, 'a página recusada tinha que aparecer como não lida');
    assert.match(falha.error, /403/);
    assert.ok(eventos.some((e) => e.type === 'report'), 'a pesquisa continua com a fonte que abriu');
  } finally {
    stub.restore();
  }
});

test('pesquisa: modelo que não planeja cai na pergunta direta', async () => {
  const stub = stubFetch(async (url, options) => {
    if (url.includes('duckduckgo')) return fakeResponse(RESULTADO_HTML);
    if (url.startsWith('https://')) {
      return fakeResponse(`<html><body><article>${'conteúdo. '.repeat(60)}</article></body></html>`, {
        headers: { 'content-type': 'text/html' }
      });
    }
    const corpo = JSON.parse(options.body);
    if (/planeja uma pesquisa/i.test(corpo.messages[0]?.content || '')) {
      return respostaDe('não sei fazer isso'); // sem JSON
    }
    return respostaDe('Relatório mesmo assim.');
  });
  try {
    const eventos = await collect(runResearch({ question: 'pergunta original', ref: refA, breadth: 2, depth: 1 }));
    const plano = eventos.find((e) => e.type === 'plan');
    assert.deepEqual(plano.queries, ['pergunta original'], 'sem plano, busca a pergunta como veio');
  } finally {
    stub.restore();
  }
});

test('página com vários artigos entrega todos, não só o primeiro', async () => {
  // Índice de blog e página de notícias põem cada item num <article>. Casar o
  // primeiro que aparecesse entregava um item de uma lista de dez, e o modelo
  // respondia como se o resto não existisse.
  const stub = stubFetch(async () =>
    fakeResponse(
      `<html><head><title>Blog</title></head><body><main>
       <article><h2>Primeiro</h2><p>conteudo um</p></article>
       <article><h2>Segundo</h2><p>conteudo dois</p></article>
       <article><h2>Terceiro</h2><p>conteudo tres</p></article>
       </main></body></html>`,
      { headers: { 'content-type': 'text/html' } }
    )
  );
  try {
    const page = await web.readPage('https://exemplo.com/blog');
    for (const item of ['conteudo um', 'conteudo dois', 'conteudo tres']) {
      assert.match(page.text, new RegExp(item), `faltou "${item}"`);
    }
  } finally {
    stub.restore();
  }
});

test('entidade numérica impossível não derruba a leitura da página', async () => {
  // `&#99999999;` não é caractere nenhum, e converter isso responde com
  // exceção. Numa pesquisa profunda, uma página torta derrubava a leitura.
  const stub = stubFetch(async () =>
    fakeResponse(
      '<html><head><title>t</title></head><body><p>antes &#99999999; depois &#233;</p></body></html>',
      { headers: { 'content-type': 'text/html' } }
    )
  );
  try {
    const page = await web.readPage('https://exemplo.com/torta');
    assert.match(page.text, /antes/);
    assert.match(page.text, /depois é/);
  } finally {
    stub.restore();
  }
});

test('página montada por JavaScript diz que está vazia, em vez de sair calada', async () => {
  // HTML grande sem uma letra de texto é aplicação de página única. Entregar
  // vazio sem motivo faz o modelo concluir que o assunto não existe.
  const stub = stubFetch(async () =>
    fakeResponse(`<html><head></head><body><div id="root"></div></body></html>${' '.repeat(600)}`, {
      headers: { 'content-type': 'text/html' }
    })
  );
  try {
    const page = await web.readPage('https://exemplo.com/app');
    assert.equal(page.text, '');
    assert.match(page.note, /JavaScript/);
  } finally {
    stub.restore();
  }
});
