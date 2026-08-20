// A frase montada com variável, atravessando servidor → rede → tela.
//
// O que se protege aqui é o contrato entre os dois lados: o servidor manda a
// frase pronta em português mais o molde e os valores; o cliente reconhece qual
// campo carrega essa frase justamente por ela ser igual ao molde preenchido. Se
// as duas substituições deixarem de bater, o cliente para de trocar o texto e a
// mensagem volta a aparecer em português — sem erro nenhum no console.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corpoDoErro, erroTraduzivel, preencher } from '../server/erro-traduzivel.mjs';

test('a mensagem sai em português, com os valores no lugar', () => {
  const err = erroTraduzivel('não achei a pasta {pasta} neste computador', { pasta: '/Users/eu/x' });
  assert.equal(err.message, 'não achei a pasta /Users/eu/x neste computador');
  assert.ok(err instanceof Error);
});

test('o erro carrega o molde e os valores separados', () => {
  const err = erroTraduzivel('{comando} saiu com código {codigo}', { comando: 'claude', codigo: 1 });
  assert.deepEqual(err.i18n, { molde: '{comando} saiu com código {codigo}', valores: { comando: 'claude', codigo: 1 } });
});

test('preencher o molde reproduz exatamente a mensagem', () => {
  // É esta igualdade que o cliente usa pra saber qual campo traduzir.
  const valores = { segundos: 30, causa: ': alvo sumiu' };
  const molde = 'o navegador não respondeu em {segundos}s{causa}';
  assert.equal(preencher(molde, valores), erroTraduzivel(molde, valores).message);
});

test('variável que ninguém mandou fica como está, em vez de virar "undefined"', () => {
  assert.equal(preencher('faltou {isto} aqui', {}), 'faltou {isto} aqui');
});

test('o corpo do erro leva o molde junto', () => {
  const corpo = corpoDoErro(erroTraduzivel('provedor sumiu: {id}', { id: 'ol' }));
  assert.equal(corpo.error, 'provedor sumiu: ol');
  assert.deepEqual(corpo.i18n, { molde: 'provedor sumiu: {id}', valores: { id: 'ol' } });
});

test('erro comum passa sem molde, e o cliente cai no dicionário de frase inteira', () => {
  const corpo = corpoDoErro(new Error('conversa não encontrada'));
  assert.deepEqual(corpo, { error: 'conversa não encontrada' });
});

test('os campos extras entram sem sobrescrever a mensagem', () => {
  const corpo = corpoDoErro(new Error('deu ruim'), { ok: false, manual: { passos: [] } });
  assert.deepEqual(corpo, { error: 'deu ruim', ok: false, manual: { passos: [] } });
});

test('erro sem message não derruba a serialização', () => {
  assert.equal(corpoDoErro('só um texto').error, 'só um texto');
  assert.equal(corpoDoErro(null).error, 'null');
});

test('o campo é escolhível, porque o servidor usa dois nomes', () => {
  // Evento de stream manda `message`; resposta de rota manda `error`. Trocar um
  // pelo outro deixa a tela sem texto nenhum e não levanta erro.
  const err = erroTraduzivel('a síntese falhou: {causa}', { causa: 'sem modelo' });
  assert.deepEqual(Object.keys(corpoDoErro(err, undefined, 'message')).sort(), ['i18n', 'message']);
  assert.deepEqual(Object.keys(corpoDoErro(err)).sort(), ['error', 'i18n']);
  assert.equal(corpoDoErro(err, undefined, 'message').message, 'a síntese falhou: sem modelo');
});
