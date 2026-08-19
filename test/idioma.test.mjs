// A escolha de idioma: o que a pessoa marcou ganha do navegador, e o navegador
// ganha do padrão.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerAceitos, escolherIdioma, IDIOMAS, PADRAO } from '../server/idioma.mjs';

test('a lista do navegador sai em ordem de preferência', () => {
  assert.deepEqual(lerAceitos('pt-BR,pt;q=0.9,en;q=0.8'), ['pt-BR', 'pt', 'en']);
  // Peso maior na frente, mesmo vindo depois no cabeçalho.
  assert.deepEqual(lerAceitos('en;q=0.3,es;q=0.9'), ['es', 'en']);
  // Empate: vale a ordem que a pessoa configurou.
  assert.deepEqual(lerAceitos('de;q=0.5,fr;q=0.5'), ['de', 'fr']);
  // `q=0` quer dizer "esse não", e some.
  assert.deepEqual(lerAceitos('en,fr;q=0'), ['en']);
  assert.deepEqual(lerAceitos(''), []);
  assert.deepEqual(lerAceitos(undefined), []);
});

test('cabeçalho torto não derruba a escolha', () => {
  // `q` ilegível é tratado como ausente, e o idioma fica. Descartar seria
  // perder uma língua que a pessoa configurou por causa de um caractere.
  assert.deepEqual(lerAceitos('pt-BR;q=abc'), ['pt-BR']);
  assert.deepEqual(lerAceitos(',,,'), []);
  assert.deepEqual(lerAceitos('  pt-BR  ,  en  '), ['pt-BR', 'en']);
});

test('o navegador escolhe quando a pessoa não escolheu', () => {
  assert.equal(escolherIdioma({ aceito: 'en-US,en;q=0.9' }), 'en');
  assert.equal(escolherIdioma({ aceito: 'es-AR,es;q=0.9' }), 'es');
  assert.equal(escolherIdioma({ aceito: 'pt-PT,pt;q=0.9' }), 'pt-BR');
});

test('só a língua basta: `pt` cai no português que o app tem', () => {
  assert.equal(escolherIdioma({ aceito: 'pt' }), 'pt-BR');
  assert.equal(escolherIdioma({ aceito: 'PT_br' }), 'pt-BR');
});

test('a escolha da pessoa ganha do navegador', () => {
  assert.equal(escolherIdioma({ escolhido: 'en', aceito: 'pt-BR' }), 'en');
  // Escolha que o app não fala é ignorada, não vira erro.
  assert.equal(escolherIdioma({ escolhido: 'tlh', aceito: 'es' }), 'es');
});

test('idioma que o app não fala cai no padrão', () => {
  assert.equal(escolherIdioma({ aceito: 'ja,ko;q=0.9' }), PADRAO);
  assert.equal(escolherIdioma({}), PADRAO);
  assert.equal(escolherIdioma({ aceito: '*' }), PADRAO);
});

test('a lista de idiomas do app é respeitada', () => {
  assert.equal(escolherIdioma({ aceito: 'pt-BR', disponiveis: ['en', 'es'] }), 'en');
  assert.equal(escolherIdioma({ aceito: 'es-MX', disponiveis: ['en', 'es'] }), 'es');
});

test('o padrão está entre os idiomas que o app tem', () => {
  assert.ok(IDIOMAS.includes(PADRAO));
});
