// O rodapé de estatística roda no navegador, mas é texto puro: testa aqui.
// Os dois casos que apareceram numa resposta real de uma palavra só, vinda de
// CLI: o plural forçado e a velocidade arredondada pra zero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statsLine } from '../web/format.js';

test('resposta de uma palavra-token não sai no plural', () => {
  assert.match(statsLine({ tokens: 1 }), /\b1 palavra-token\b/);
  assert.doesNotMatch(statsLine({ tokens: 1 }), /palavras-token/);
  assert.match(statsLine({ tokens: 2 }), /\b2 palavras-token\b/);
});

test('velocidade abaixo de 1 não vira "0 por segundo"', () => {
  // 1 token em 7,4 s — o caso que apareceu de verdade.
  const linha = statsLine({ ms: 7400, tokens: 1, tps: 1 / 7.4, estimated: true });
  assert.doesNotMatch(linha, /\b0 por segundo\b/);
  assert.match(linha, /0,1 por segundo/);
});

test('velocidade que arredondaria pra zero some em vez de mentir', () => {
  const linha = statsLine({ ms: 60_000, tokens: 1, tps: 0.02 });
  assert.doesNotMatch(linha, /por segundo/);
  assert.match(linha, /60,0 s/);
});

test('velocidade alta vai inteira, sem casa decimal', () => {
  assert.match(statsLine({ tokens: 900, tps: 42.4 }), /\b42 por segundo\b/);
  assert.match(statsLine({ tokens: 900, tps: 9.44 }), /9,4 por segundo/);
});

test('parte sem número não vira texto', () => {
  assert.equal(statsLine({}), '');
  assert.equal(statsLine({ tokens: 0, tps: 0 }), '');
  assert.equal(statsLine({ ms: 1500 }), '1,5 s');
});

test('a estimativa só aparece quando é estimativa', () => {
  assert.match(statsLine({ tokens: 40, estimated: true }), /\(estimativa\)/);
  assert.doesNotMatch(statsLine({ tokens: 40 }), /estimativa/);
});

test('milhar sai com separador de português', () => {
  assert.match(statsLine({ tokens: 12_345 }), /12\.345 palavras-token/);
});
