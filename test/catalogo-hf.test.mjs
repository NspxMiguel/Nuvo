// Catálogo do Hugging Face: montagem da lista, o que o manifesto responde e o
// cache de 24h. Nada aqui sai pra rede — o `fetch` é encenado do começo ao fim,
// inclusive o 429, que na rede de verdade custaria minutos de espera.

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome, stubFetch, fakeResponse } from './helpers.mjs';

const home = useTempHome();
const { buscarCatalogo, medirModelo, catalogoEmCache } = await import('../server/catalogo-hf.mjs');

after(() => home.cleanup());

const CACHE = join(home.dir, 'catalogo-hf.json');

beforeEach(() => {
  rmSync(CACHE, { force: true });
});

/** Um item da listagem, no formato exato que a API devolve. */
function item(extra = {}) {
  return {
    _id: '688b451a53e70a07b0669a7c',
    id: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
    gated: false,
    lastModified: '2026-01-30T06:29:38.000Z',
    likes: 905,
    downloads: 11047071,
    tags: ['transformers', 'gguf', 'GGUF', 'qwen3', 'text-generation', 'arxiv:2505.09388', 'license:apache-2.0'],
    ...extra
  };
}

/** Manifesto do registro do Ollama, com as três camadas de sempre. */
function manifesto(bytes) {
  return JSON.stringify({
    schemaVersion: 2,
    layers: [
      { mediaType: 'application/vnd.ollama.image.model', size: bytes },
      { mediaType: 'application/vnd.ollama.image.template', size: 1482 },
      { mediaType: 'application/vnd.ollama.image.params', size: 178 }
    ]
  });
}

/** Responde a listagem com os itens dados. */
function listaDe(itens) {
  return stubFetch(async () => fakeResponse(JSON.stringify(itens)));
}

// ------------------------------------------------------------ a listagem

test('a lista sai no formato da tela, com id, nome legível e data', async () => {
  const stub = listaDe([item()]);
  try {
    const modelos = await buscarCatalogo();
    assert.equal(modelos.length, 1);
    const [m] = modelos;
    assert.equal(m.id, 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF');
    assert.equal(m.nome_legivel, 'Qwen3 Coder 30B A3B Instruct');
    assert.equal(m.downloads, 11047071);
    assert.equal(m.likes, 905);
    assert.equal(m.atualizado, '2026-01-30T06:29:38.000Z');
  } finally {
    stub.restore();
  }
});

test('o pedido leva os filtros que fazem o resultado ser o certo', async () => {
  const stub = listaDe([item()]);
  try {
    await buscarCatalogo({ limite: 100 });
    const url = new URL(stub.calls[0].url);
    assert.equal(url.searchParams.get('apps'), 'ollama');
    assert.equal(url.searchParams.get('pipeline_tag'), 'text-generation');
    assert.equal(url.searchParams.get('gated'), 'false');
    assert.equal(url.searchParams.get('sort'), 'downloads');
    assert.equal(url.searchParams.get('direction'), '-1');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.deepEqual(url.searchParams.getAll('expand[]'), [
      'gated', 'downloads', 'likes', 'tags', 'lastModified'
    ]);
    // `expand[]=gguf` arrasta o chat_template inteiro e infla a resposta de
    // 22 KB pra 521 KB. Se alguém adicionar isso "pra pegar mais dado", o teste
    // tem que reclamar.
    assert.ok(!url.searchParams.getAll('expand[]').includes('gguf'));
    // `library=gguf` é ignorado calado pelo Hugging Face e devolve BERT.
    assert.equal(url.searchParams.get('library'), null);
  } finally {
    stub.restore();
  }
});

test('a família sai das etiquetas, e não do palpite sobre o nome', async () => {
  const stub = listaDe([
    item({ id: 'a/QualquerCoisa-GGUF', tags: ['gguf', 'qwen3'] }),
    item({ id: 'b/Sem-Etiqueta-De-Arquitetura-GGUF', tags: ['gguf', 'base_model:meta-llama/Llama-3.1-8B'] }),
    item({ id: 'c/gemma-4-12B-coder-GGUF', tags: ['gguf', 'text-generation'] }),
    item({ id: 'd/Mistral-Small-GGUF', tags: ['mistral'] }),
    item({ id: 'e/phi4-mini-GGUF', tags: ['gguf'] }),
    item({ id: 'f/Coisa-Nova-Sem-Nome-Conhecido', tags: ['gguf', 'roleplaying'] })
  ]);
  try {
    const familias = (await buscarCatalogo()).map((m) => m.familia);
    assert.deepEqual(familias, ['qwen', 'llama', 'gemma', 'mistral', 'phi', 'outros']);
  } finally {
    stub.restore();
  }
});

test('família não é confundida por palavra que só contém o nome', async () => {
  // `codellama` e `tinyllama` contêm `llama`; `roleplaying` contém `yi`. Sem a
  // trava de começo e fim de palavra, os três caíam na família errada.
  const stub = listaDe([
    item({ id: 'a/CodeLlama-7B-GGUF', tags: ['codellama'] }),
    item({ id: 'b/TinyLlama-1.1B-GGUF', tags: ['tinyllama'] })
  ]);
  try {
    assert.deepEqual((await buscarCatalogo()).map((m) => m.familia), ['codellama', 'tinyllama']);
  } finally {
    stub.restore();
  }
});

test('o nome da ferramenta não vira família', async () => {
  // Um em cada cinco repositórios da lista de verdade traz `llama.cpp`, que é o
  // programa que converteu o arquivo. Contar isso como arquitetura fazia Qwen
  // virar Llama — a maior fatia do catálogo saía com a família errada.
  const stub = listaDe([
    item({ id: 'x/Qwen3.8-27B-Uncensored-GGUF', tags: ['llama.cpp', 'gguf', 'qwen3.8', 'base_model:Qwen/Qwen3.8-27B'] }),
    item({ id: 'y/Bonsai-27B-gguf', tags: ['llama.cpp', 'llama-cpp', 'gguf', 'base_model:quantized:Qwen/Qwen3.6-27B'] })
  ]);
  try {
    assert.deepEqual((await buscarCatalogo()).map((m) => m.familia), ['qwen', 'qwen']);
  } finally {
    stub.restore();
  }
});

test('a arquitetura ganha do base_model quando as duas discordam', async () => {
  const stub = listaDe([
    item({ id: 'z/Coisa-GGUF', tags: ['gguf', 'qwen3', 'base_model:meta-llama/Llama-3.1-8B'] })
  ]);
  try {
    assert.equal((await buscarCatalogo())[0].familia, 'qwen');
  } finally {
    stub.restore();
  }
});

test('o nome legível tira o dono, o GGUF e arruma o tamanho', async () => {
  const stub = listaDe([
    item({ id: 'unsloth/gpt-oss-20b-GGUF' }),
    item({ id: 'antirez/deepseek-v4-gguf' }),
    item({ id: 'TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF' }),
    item({ id: 'sem-dono-nenhum' })
  ]);
  try {
    const nomes = (await buscarCatalogo()).map((m) => m.nome_legivel);
    assert.deepEqual(nomes, [
      'GPT OSS 20B',
      'Deepseek v4',
      'Mixtral 8X7B Instruct v0.1',
      'Sem dono nenhum'
    ]);
  } finally {
    stub.restore();
  }
});

test('etiqueta de máquina não vira crachá, e a repetida entra uma vez só', async () => {
  const stub = listaDe([item()]);
  try {
    const [m] = await buscarCatalogo();
    assert.ok(m.tags.includes('gguf'));
    assert.equal(m.tags.filter((t) => t === 'gguf').length, 1, 'GGUF e gguf são a mesma etiqueta');
    assert.ok(!m.tags.some((t) => t.startsWith('arxiv:')));
    assert.ok(!m.tags.some((t) => t.startsWith('license:')));
  } finally {
    stub.restore();
  }
});

test('item torto é descartado sem derrubar o resto da lista', async () => {
  const stub = listaDe([
    item(),
    { id: '' },
    null,
    // O filtro `gated=false` já deveria ter tirado este; se escapar, ele é um
    // botão de baixar que não baixa.
    item({ id: 'meta-llama/Llama-3.1-8B-Instruct', gated: 'manual' }),
    item({ id: 'x/Sem-Numeros-GGUF', downloads: null, likes: undefined, lastModified: 12345 })
  ]);
  try {
    const modelos = await buscarCatalogo();
    assert.deepEqual(modelos.map((m) => m.id), [
      'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
      'x/Sem-Numeros-GGUF'
    ]);
    assert.equal(modelos[1].downloads, 0);
    assert.equal(modelos[1].likes, 0);
    assert.equal(modelos[1].atualizado, null);
  } finally {
    stub.restore();
  }
});

test('resposta que não é lista vira erro em vez de lista vazia calada', async () => {
  const stub = stubFetch(async () => fakeResponse(JSON.stringify({ error: 'sei lá' })));
  try {
    await assert.rejects(() => buscarCatalogo(), /fora do formato/);
  } finally {
    stub.restore();
  }
});

// -------------------------------------------------------------- medição

test('modelo que dá pra baixar devolve o tamanho em GB', async () => {
  const stub = stubFetch(async (url) => {
    assert.ok(url.includes('/v2/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/manifests/latest'));
    return fakeResponse(manifesto(18556689568));
  });
  try {
    const medida = await medirModelo('unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF');
    assert.equal(medida.estado, 'ok');
    // 18556689568 / 1024³ = 17,28 — GB binário, o mesmo que o machine.mjs usa.
    assert.equal(medida.gb, 17.3);
  } finally {
    stub.restore();
  }
});

test('repositório que não é GGUF é descartado', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(JSON.stringify({ error: 'Repository is not GGUF or is not compatible with llama.cpp' }), {
      ok: false,
      status: 400
    })
  );
  try {
    const medida = await medirModelo('Qwen/Qwen3-8B');
    assert.equal(medida.estado, 'sem_gguf');
    assert.equal(medida.gb, null);
    assert.match(medida.motivo, /not GGUF/);
  } finally {
    stub.restore();
  }
});

test('GGUF partido em vários arquivos é descartado com motivo próprio', async () => {
  // O `apps=ollama` da listagem NÃO tira esses: só o manifesto revela.
  const stub = stubFetch(async () =>
    fakeResponse(
      JSON.stringify({
        error:
          'This repository only contains sharded GGUF files. Ollama does not yet support pulling sharded GGUF via the registry'
      }),
      { ok: false, status: 400 }
    )
  );
  try {
    const medida = await medirModelo('unsloth/DeepSeek-R1-GGUF');
    assert.equal(medida.estado, 'fragmentado');
    assert.match(medida.motivo, /partido em vários arquivos/);
  } finally {
    stub.restore();
  }
});

test('modelo com licença pra aceitar diz o que a pessoa tem que fazer', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(JSON.stringify({ error: 'Access to model meta-llama/Llama-3.1-8B-Instruct is restricted.' }), {
      ok: false,
      status: 401
    })
  );
  try {
    const medida = await medirModelo('meta-llama/Llama-3.1-8B-Instruct');
    assert.equal(medida.estado, 'gated');
    assert.match(medida.motivo, /aceitar a licença no site do modelo/);
  } finally {
    stub.restore();
  }
});

test('rede fora vira erro descrito, não exceção solta', async () => {
  const stub = stubFetch(async () => {
    throw new Error('fetch failed');
  });
  try {
    const medida = await medirModelo('qualquer/coisa');
    assert.equal(medida.estado, 'erro');
    assert.equal(medida.gb, null);
    assert.match(medida.motivo, /fetch failed/);
  } finally {
    stub.restore();
  }
});

test('manifesto sem a camada do modelo não vira tamanho inventado', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(JSON.stringify({ schemaVersion: 2, layers: [{ mediaType: 'application/vnd.ollama.image.params', size: 178 }] }))
  );
  try {
    const medida = await medirModelo('a/b');
    assert.equal(medida.estado, 'erro');
    assert.equal(medida.gb, null);
  } finally {
    stub.restore();
  }
});

test('429 espera o que o cabeçalho manda e tenta de novo', async () => {
  let vezes = 0;
  const stub = stubFetch(async () => {
    vezes += 1;
    if (vezes === 1) {
      return fakeResponse(JSON.stringify({ error: 'rate limited' }), {
        ok: false,
        status: 429,
        headers: { ratelimit: '"api";r=0;t=0' }
      });
    }
    return fakeResponse(manifesto(2 * 1024 ** 3));
  });
  try {
    const medida = await medirModelo('a/b', { esperaMaxMs: 20 });
    assert.equal(vezes, 2, 'o 429 tinha que ter sido repetido');
    assert.equal(medida.estado, 'ok');
    assert.equal(medida.gb, 2);
  } finally {
    stub.restore();
  }
});

test('429 que não passa desiste em vez de ficar tentando pra sempre', async () => {
  let vezes = 0;
  const stub = stubFetch(async () => {
    vezes += 1;
    return fakeResponse(JSON.stringify({ error: 'rate limited' }), {
      ok: false,
      status: 429,
      headers: { ratelimit: '"api";r=0;t=300' }
    });
  });
  try {
    const medida = await medirModelo('a/b', { tentativas: 3, esperaMaxMs: 5 });
    assert.equal(vezes, 3);
    assert.equal(medida.estado, 'erro');
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------- cache

test('primeira vez busca na rede e deixa o catálogo no disco', async () => {
  const stub = listaDe([item()]);
  try {
    const r = await catalogoEmCache();
    assert.equal(r.de, 'rede');
    assert.equal(r.modelos.length, 1);
    assert.ok(Number.isFinite(Date.parse(r.quando)));
    const gravado = JSON.parse(readFileSync(CACHE, 'utf8'));
    assert.equal(gravado.modelos[0].id, 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF');
  } finally {
    stub.restore();
  }
});

test('cache dentro das 24h não gasta pedido nenhum', async () => {
  const stub = listaDe([item()]);
  try {
    await catalogoEmCache();
    const pedidosDaPrimeira = stub.calls.length;
    const r = await catalogoEmCache();
    assert.equal(r.de, 'cache');
    assert.equal(r.modelos.length, 1);
    assert.equal(stub.calls.length, pedidosDaPrimeira, 'não podia ter ido na rede de novo');
  } finally {
    stub.restore();
  }
});

test('cache vencido busca de novo e reescreve a data', async () => {
  writeFileSync(
    CACHE,
    JSON.stringify({
      versao: 1,
      quando: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      modelos: [{ id: 'velho/Modelo-GGUF', nome_legivel: 'Modelo velho' }]
    })
  );
  const stub = listaDe([item()]);
  try {
    const r = await catalogoEmCache();
    assert.equal(r.de, 'rede');
    assert.equal(r.modelos[0].id, 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF');
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('rede fora com cache vencido devolve o catálogo velho', async () => {
  const quando = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    CACHE,
    JSON.stringify({ versao: 1, quando, modelos: [{ id: 'velho/Modelo-GGUF', nome_legivel: 'Modelo velho' }] })
  );
  const stub = stubFetch(async () => {
    throw new Error('fetch failed');
  });
  try {
    const r = await catalogoEmCache();
    assert.equal(r.de, 'cache');
    assert.equal(r.quando, quando);
    assert.equal(r.modelos[0].id, 'velho/Modelo-GGUF');
  } finally {
    stub.restore();
  }
});

test('resposta torta cai no cache velho em vez de apagar a tela', async () => {
  const quando = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  writeFileSync(CACHE, JSON.stringify({ versao: 1, quando, modelos: [{ id: 'velho/Modelo-GGUF' }] }));
  const stub = stubFetch(async () => fakeResponse('{isso não é json'));
  try {
    const r = await catalogoEmCache();
    assert.equal(r.de, 'cache');
    assert.equal(r.modelos[0].id, 'velho/Modelo-GGUF');
  } finally {
    stub.restore();
  }
});

test('rede fora e sem cache devolve vazio, sem levantar nada', async () => {
  const stub = stubFetch(async () => {
    throw new Error('fetch failed');
  });
  try {
    const r = await catalogoEmCache();
    assert.deepEqual(r, { modelos: [], de: 'vazio', quando: null });
  } finally {
    stub.restore();
  }
});

test('arquivo de cache corrompido é tratado como cache nenhum', async () => {
  writeFileSync(CACHE, 'metade de um json {');
  const stub = stubFetch(async () => {
    throw new Error('fetch failed');
  });
  try {
    const r = await catalogoEmCache();
    assert.equal(r.de, 'vazio');
    assert.deepEqual(r.modelos, []);
  } finally {
    stub.restore();
  }
});

test('lista vazia da rede não substitui o cache que já existe', async () => {
  const quando = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  writeFileSync(CACHE, JSON.stringify({ versao: 1, quando, modelos: [{ id: 'velho/Modelo-GGUF' }] }));
  const stub = listaDe([]);
  try {
    const r = await catalogoEmCache();
    assert.equal(r.de, 'cache');
    assert.equal(r.modelos[0].id, 'velho/Modelo-GGUF');
    assert.equal(JSON.parse(readFileSync(CACHE, 'utf8')).quando, quando, 'o cache bom não podia ter sido sobrescrito');
  } finally {
    stub.restore();
  }
});

test('429 na listagem também é respeitado e a segunda tentativa vale', async () => {
  let vezes = 0;
  const stub = stubFetch(async () => {
    vezes += 1;
    if (vezes === 1) {
      return fakeResponse('', { ok: false, status: 429, headers: { ratelimit: '"api";r=0;t=0' } });
    }
    return fakeResponse(JSON.stringify([item()]));
  });
  try {
    const r = await catalogoEmCache({ esperaMaxMs: 20 });
    assert.equal(r.de, 'rede');
    assert.equal(vezes, 2);
  } finally {
    stub.restore();
  }
});
