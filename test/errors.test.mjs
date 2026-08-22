// A tradução de erro do provedor. Cada caso aqui é um defeito que aparece de
// verdade em uso de casa, e o teste cobra que a mensagem diga o que fazer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainProviderError } from '../server/errors.mjs';

// `explainProviderError` devolve um Error com o molde junto, pra frase chegar
// na tela no idioma dela. O que se cobra aqui é o texto em português, que é o
// que o Error já traz pronto em `message`.
const frase = (...args) => explainProviderError(...args).message;

const ollama = { name: 'Ollama', kind: 'ollama', base_url: 'http://localhost:11434' };
const openai = { name: 'OpenAI', kind: 'openai', base_url: 'https://api.openai.com/v1' };

test('Ollama desligado manda abrir o Ollama', () => {
  const texto = frase(new Error('fetch failed'), ollama);
  assert.match(texto, /ollama serve|app do Ollama/i);
  assert.match(texto, /11434/, 'o endereço tentado ajuda a achar o erro');
});

test('LM Studio desligado aponta a aba certa', () => {
  const texto = frase(new Error('connect ECONNREFUSED 127.0.0.1:1234'), {
    name: 'LM Studio',
    kind: 'lmstudio',
    base_url: 'http://localhost:1234/v1'
  });
  assert.match(texto, /Developer/);
});

test('chave recusada manda gerar outra', () => {
  const texto = frase(new Error('openai: HTTP 401 — invalid_api_key'), openai);
  assert.match(texto, /chave de OpenAI/);
  assert.match(texto, /nova/i);
});

test('limite de uso manda esperar ou trocar de modelo', () => {
  const texto = frase(new Error('HTTP 429 rate_limit_exceeded'), openai);
  assert.match(texto, /esper/i);
  assert.match(texto, /outro modelo|troque de modelo/i);
});

test('sem crédito sugere o modelo local', () => {
  const texto = frase(new Error('insufficient_quota: you exceeded your quota'), openai);
  assert.match(texto, /crédito/);
  assert.match(texto, /local/);
});

test('modelo que sumiu manda atualizar a lista', () => {
  const texto = frase(new Error('HTTP 404 model_not_found'), openai);
  assert.match(texto, /atualizar/i);
});

test('conversa longa demais sugere conversa nova', () => {
  const texto = frase(new Error('maximum context length is 8192 tokens'), openai);
  assert.match(texto, /conversa nova|contexto maior/);
});

test('CLI sem executável aponta a configuração do provedor', () => {
  const texto = frase(new Error('spawn claude ENOENT'), { name: 'Claude CLI', kind: 'cli' });
  assert.match(texto, /caminho do executável/);
});

test('a mensagem original vai junto, entre parênteses', () => {
  const texto = frase(new Error('HTTP 401 invalid_api_key'), openai);
  assert.match(texto, /\(HTTP 401 invalid_api_key\)$/);
});

test('erro que não se encaixa em regra nenhuma passa inteiro', () => {
  const texto = frase(new Error('coisa esquisita que nunca vi'), openai);
  assert.equal(texto, 'coisa esquisita que nunca vi');
});

test('erro vazio não vira string vazia na tela', () => {
  assert.match(frase(new Error('')), /sem dizer o motivo/);
  assert.match(frase(null), /sem dizer o motivo/);
});

test('a frase vai com o molde, pra tela poder traduzir', () => {
  // Sem isso a mensagem chega em português numa tela em inglês, que foi
  // exatamente o defeito visto na captura em espanhol: "claude saiu com
  // código 1" no meio de uma interface toda traduzida.
  const err = explainProviderError(new Error('spawn claude ENOENT'), { name: 'Claude CLI', kind: 'cli' });
  assert.equal(err.i18n.molde, 'o programa do terminal não rodou{ia}. Confira o caminho do executável em "IAs ligadas", no campo Ajuste do programa do terminal. ({cru})');
  assert.deepEqual(err.i18n.valores, { ia: ' (Claude CLI)', cru: 'spawn claude ENOENT' });
  // O miolo entre parênteses costuma ser frase do próprio servidor, e a tela
  // tem que passá-lo pelo dicionário em vez de deixá-lo em português.
  assert.deepEqual(err.i18n.traduzir, ['cru']);
});

test('resposta cortada no meio não vira zero — o que veio inteiro é aproveitado', async () => {
  // Resposta longa cortada pelo teto de saída do modelo: trinta e sete cartões
  // viravam nenhum por causa do trigésimo oitavo, que veio pela metade.
  const { parseJsonObject } = await import('../server/complete.mjs');

  assert.deepEqual(
    parseJsonObject('{"cartoes":[{"frente":"a","verso":"b"},{"frente":"c","verso":"d"},{"frente":"e","ver'),
    { cartoes: [{ frente: 'a', verso: 'b' }, { frente: 'c', verso: 'd' }, { frente: 'e' }] }
  );
  assert.deepEqual(parseJsonObject('{"cartoes":[{"frente":"a","verso":"b"},'), {
    cartoes: [{ frente: 'a', verso: 'b' }]
  });
  assert.deepEqual(parseJsonObject('{"questoes":[{"n":1}],"faltou":["a","b'), {
    questoes: [{ n: 1 }],
    faltou: ['a']
  });

  // O que já era inteiro continua igual, e o que não dá pra salvar continua nulo.
  assert.deepEqual(parseJsonObject('```json\n{"a":[1,2,3]}\n```'), { a: [1, 2, 3] });
  assert.equal(parseJsonObject('não é json nenhum'), null);
  assert.equal(parseJsonObject('{"cartoes":[{"frente":"a'), null, 'sem um item inteiro, não há o que salvar');
});
