// Trocar o modelo de embedding não pode apagar a busca por significado sem
// avisar. Vetor de modelo A não conversa com pergunta vetorizada pelo modelo B:
// os números existem, a distância entre eles é que não quer dizer nada. Então
// cada linha carrega o carimbo de quem a gerou, e o que ficou pra trás aparece
// como número na tela até ser recalculado.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, stubFetch } from './helpers.mjs';

const home = useTempHome();
const { patchConfig } = await import('../server/config.mjs');
const { createProvider, refOf } = await import('../server/providers/index.mjs');
const { addMemory, recall, reindexPending, reindexEmbeddings } = await import('../server/memory.mjs');
const { all } = await import('../server/db.mjs');

after(() => home.cleanup());

// Vetor determinístico por texto: mesma frase sai igual, frases diferentes
// saem em direções diferentes. É tudo o que o cosseno precisa pra ordenar.
function vetor(texto, semente) {
  const v = new Array(8).fill(0);
  for (let i = 0; i < texto.length; i++) v[(texto.charCodeAt(i) + semente) % 8] += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

let semente = 0;
const provedor = createProvider({
  name: 'fake-embed',
  kind: 'openai',
  baseUrl: 'http://fake.local/v1'
});
const rede = stubFetch(async (url, options) => {
  if (!url.endsWith('/embeddings')) return undefined;
  const { input } = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async json() {
      return { data: input.map((t) => ({ embedding: vetor(t, semente) })) };
    }
  };
});
after(() => rede.restore());

const MODELO_A = refOf(provedor.id, 'embed-v1');
const MODELO_B = refOf(provedor.id, 'embed-v2');

test('memória gravada com um modelo some da busca por significado quando o modelo troca', async () => {
  patchConfig({ memory: { embeddingModel: MODELO_A } });
  await addMemory({ text: 'O servidor de casa do Miguel se chama pinguim.', kind: 'fact' });

  const antes = await recall('como se chama o servidor de casa', { limit: 5 });
  assert.ok(
    antes.some((m) => m.text.includes('pinguim')),
    'com o modelo certo o fato tinha que voltar'
  );

  // Troca de modelo: o vetor guardado continua no banco, mas passa a ser lixo
  // pra qualquer pergunta nova. Melhor ignorá-lo do que ordenar por ruído.
  semente = 3;
  patchConfig({ memory: { embeddingModel: MODELO_B } });

  const guardados = all('SELECT embedding_model FROM memories WHERE active = 1');
  assert.ok(
    guardados.every((r) => r.embedding_model === MODELO_A),
    'o carimbo tinha que ter ficado no modelo antigo'
  );
});

test('o que ficou pra trás é contável', () => {
  const pendente = reindexPending();
  assert.equal(pendente.model, MODELO_B);
  assert.ok(pendente.memories >= 1, 'o fato do modelo antigo tinha que estar na conta');
  assert.equal(pendente.total, pendente.memories + pendente.chunks);
});

test('reindexar recarimba tudo e devolve a busca por significado', async () => {
  const resultado = await reindexEmbeddings();
  assert.equal(resultado.done, true);
  assert.ok(resultado.updated >= 1);
  assert.equal(resultado.remaining, 0);
  assert.equal(reindexPending().total, 0);

  const guardados = all('SELECT embedding_model FROM memories WHERE active = 1');
  assert.ok(guardados.every((r) => r.embedding_model === MODELO_B));

  const depois = await recall('como se chama o servidor de casa', { limit: 5 });
  assert.ok(
    depois.some((m) => m.text.includes('pinguim')),
    'depois de recalcular o fato tinha que voltar a aparecer'
  );
});

test('sem modelo de embedding não há o que reindexar', async () => {
  patchConfig({ memory: { embeddingModel: null } });
  assert.deepEqual(reindexPending(), { model: null, memories: 0, chunks: 0, total: 0 });

  const resultado = await reindexEmbeddings();
  assert.equal(resultado.done, true);
  assert.equal(resultado.updated, 0);
});
