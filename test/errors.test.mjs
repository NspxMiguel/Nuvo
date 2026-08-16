// A tradução de erro do provedor. Cada caso aqui é um defeito que aparece de
// verdade em uso de casa, e o teste cobra que a mensagem diga o que fazer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainProviderError } from '../server/errors.mjs';

const ollama = { name: 'Ollama', kind: 'ollama', base_url: 'http://localhost:11434' };
const openai = { name: 'OpenAI', kind: 'openai', base_url: 'https://api.openai.com/v1' };

test('Ollama desligado manda abrir o Ollama', () => {
  const texto = explainProviderError(new Error('fetch failed'), ollama);
  assert.match(texto, /ollama serve|app do Ollama/i);
  assert.match(texto, /11434/, 'o endereço tentado ajuda a achar o erro');
});

test('LM Studio desligado aponta a aba certa', () => {
  const texto = explainProviderError(new Error('connect ECONNREFUSED 127.0.0.1:1234'), {
    name: 'LM Studio',
    kind: 'lmstudio',
    base_url: 'http://localhost:1234/v1'
  });
  assert.match(texto, /Developer/);
});

test('chave recusada manda gerar outra', () => {
  const texto = explainProviderError(new Error('openai: HTTP 401 — invalid_api_key'), openai);
  assert.match(texto, /chave de OpenAI/);
  assert.match(texto, /nova/i);
});

test('limite de uso manda esperar ou trocar de modelo', () => {
  const texto = explainProviderError(new Error('HTTP 429 rate_limit_exceeded'), openai);
  assert.match(texto, /esper/i);
  assert.match(texto, /outro modelo|troque de modelo/i);
});

test('sem crédito sugere o modelo local', () => {
  const texto = explainProviderError(new Error('insufficient_quota: you exceeded your quota'), openai);
  assert.match(texto, /crédito/);
  assert.match(texto, /local/);
});

test('modelo que sumiu manda atualizar a lista', () => {
  const texto = explainProviderError(new Error('HTTP 404 model_not_found'), openai);
  assert.match(texto, /atualizar/i);
});

test('conversa longa demais sugere conversa nova', () => {
  const texto = explainProviderError(new Error('maximum context length is 8192 tokens'), openai);
  assert.match(texto, /conversa nova|contexto maior/);
});

test('CLI sem executável aponta a configuração do provedor', () => {
  const texto = explainProviderError(new Error('spawn claude ENOENT'), { name: 'Claude CLI', kind: 'cli' });
  assert.match(texto, /caminho do executável/);
});

test('a mensagem original vai junto, entre parênteses', () => {
  const texto = explainProviderError(new Error('HTTP 401 invalid_api_key'), openai);
  assert.match(texto, /\(HTTP 401 invalid_api_key\)$/);
});

test('erro que não se encaixa em regra nenhuma passa inteiro', () => {
  const texto = explainProviderError(new Error('coisa esquisita que nunca vi'), openai);
  assert.equal(texto, 'coisa esquisita que nunca vi');
});

test('erro vazio não vira string vazia na tela', () => {
  assert.match(explainProviderError(new Error('')), /sem dizer o motivo/);
  assert.match(explainProviderError(null), /sem dizer o motivo/);
});
