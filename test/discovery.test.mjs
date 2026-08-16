// Descoberta automática: é o que faz o app funcionar sem configuração no
// primeiro start. As portas são encenadas; nada aqui sai pra rede.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, stubFetch, fakeResponse } from './helpers.mjs';

const home = useTempHome();
const { discover, providerCount } = await import('../server/discovery.mjs');
const { listProviders } = await import('../server/providers/index.mjs');
const { run, all } = await import('../server/db.mjs');

after(() => home.cleanup());

/** Zera os provedores entre um teste e outro. */
function limpar() {
  run('DELETE FROM providers');
}

/** Responde só nas portas listadas; o resto é conexão recusada. */
function apenas(portas, corpo = { models: [{ id: 'algum-modelo' }] }) {
  return stubFetch(
    async (url) => {
      const porta = new URL(url).port;
      if (!portas.includes(porta)) throw new Error('connect ECONNREFUSED');
      return fakeResponse(JSON.stringify(corpo));
    },
    // A varredura procura justamente no 127.0.0.1: aqui o localhost precisa
    // ser encenado, não deixado passar.
    { passthroughLocalhost: false }
  );
}

test('acha o que responde e ignora o que não responde', async () => {
  limpar();
  const stub = apenas(['1234']); // só o LM Studio
  try {
    const achados = await discover({ includeCli: false });
    assert.equal(achados.length, 1);
    assert.equal(achados[0].name, 'LM Studio');
    assert.equal(achados[0].url, 'http://127.0.0.1:1234/v1');
  } finally {
    stub.restore();
  }
});

test('provedor descoberto entra ligado e marcado como automático', async () => {
  limpar();
  const stub = apenas(['1234']);
  try {
    await discover({ includeCli: false });
    const [p] = listProviders();
    assert.equal(p.enabled, 1);
    assert.equal(p.auto, 1);
    assert.equal(p.kind, 'openai');
  } finally {
    stub.restore();
  }
});

test('rodar duas vezes não duplica provedor', async () => {
  limpar();
  const stub = apenas(['1234', '11434']);
  try {
    const primeira = await discover({ includeCli: false });
    assert.equal(primeira.length, 2);
    const segunda = await discover({ includeCli: false });
    assert.equal(segunda.length, 0, 'a segunda varredura não pode achar o que já está lá');
    assert.equal(providerCount(), 2);
  } finally {
    stub.restore();
  }
});

test('Ollama é cadastrado com o adaptador dele, não como openai', async () => {
  limpar();
  const stub = stubFetch(
    async (url) => {
      if (!url.includes('11434')) throw new Error('connect ECONNREFUSED');
      return fakeResponse(JSON.stringify({ models: [{ name: 'llama3:8b', size: 4e9 }] }));
    },
    { passthroughLocalhost: false }
  );
  try {
    await discover({ includeCli: false });
    const [p] = listProviders();
    assert.equal(p.kind, 'ollama');
    assert.equal(p.base_url, 'http://127.0.0.1:11434');
    const modelos = all('SELECT model_id FROM models WHERE provider_id = ?', p.id);
    assert.ok(
      modelos.some((m) => m.model_id === 'llama3:8b'),
      'o catálogo tinha que ter sido carregado junto'
    );
  } finally {
    stub.restore();
  }
});

test('porta no ar mas sem modelo carregado ainda vira provedor', async () => {
  limpar();
  // Sonda responde, listagem de modelos explode: é o LM Studio aberto sem
  // nenhum modelo carregado, que acontece o tempo todo.
  let primeira = true;
  const stub = stubFetch(
    async (url) => {
      const porta = new URL(url).port;
      if (porta !== '1234') throw new Error('connect ECONNREFUSED');
      if (primeira) {
        primeira = false;
        return fakeResponse('{}');
      }
      return fakeResponse('erro interno', { ok: false, status: 500 });
    },
    { passthroughLocalhost: false }
  );
  try {
    const achados = await discover({ includeCli: false });
    assert.equal(achados.length, 1, 'a falha ao listar modelo não pode descartar a descoberta');
    assert.equal(providerCount(), 1);
  } finally {
    stub.restore();
  }
});

test('porta que aceita conexão mas devolve erro não vira provedor', async () => {
  limpar();
  const stub = stubFetch(async () => fakeResponse('não é aqui', { ok: false, status: 404 }), {
    passthroughLocalhost: false
  });
  try {
    const achados = await discover({ includeCli: false });
    assert.equal(achados.length, 0);
    assert.equal(providerCount(), 0);
  } finally {
    stub.restore();
  }
});

test('CLI já cadastrado à mão não é descoberto de novo', async () => {
  limpar();
  const { createProvider } = await import('../server/providers/index.mjs');
  // Todos os comandos que a varredura procura, já cadastrados: nada de novo
  // pode aparecer, mesmo que os binários existam nesta máquina.
  for (const comando of ['claude', 'codex', 'gemini', 'opencode']) {
    createProvider({
      name: `${comando} meu`,
      kind: 'cli',
      config: { command: comando, args: [], stdin: true, models: ['default'] }
    });
  }
  const antes = providerCount();
  const stub = stubFetch(
    async () => {
      throw new Error('connect ECONNREFUSED');
    },
    { passthroughLocalhost: false }
  );
  try {
    const achados = await discover();
    assert.equal(achados.length, 0);
    assert.equal(providerCount(), antes);
  } finally {
    stub.restore();
  }
});

test('nada no ar devolve lista vazia sem quebrar', async () => {
  limpar();
  const stub = stubFetch(
    async () => {
      throw new Error('connect ECONNREFUSED');
    },
    { passthroughLocalhost: false }
  );
  try {
    assert.deepEqual(await discover({ includeCli: false }), []);
    assert.equal(providerCount(), 0);
  } finally {
    stub.restore();
  }
});
