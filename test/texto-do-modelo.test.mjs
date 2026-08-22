// O que o modelo escreve nem sempre é texto: às vezes vem com HTML no meio.
// A tela escapa tudo — é o certo —, então a marcação aparecia literal pra quem
// lê: "<i>Escherichia coli</i>" numa questão de simulado.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cortarNaPalavra, semMarcacao } from '../server/texto-do-modelo.mjs';

test('marca inventada pelo modelo sai; o texto fica', () => {
  assert.equal(
    semMarcacao('expresso em <i>Escherichia coli</i>.'),
    'expresso em Escherichia coli.'
  );
  assert.equal(semMarcacao('<strong>Atenção:</strong> leia tudo'), 'Atenção: leia tudo');
  assert.equal(semMarcacao('<span class="x" data-y="1">oi</span>'), 'oi');
});

test('sinal de menor que não é marca continua onde estava', () => {
  // Biologia e química estão cheias disso: pH < 7, [H+] < 10^-7, a < b.
  assert.equal(semMarcacao('pH < 7 e a < b'), 'pH < 7 e a < b');
  assert.equal(semMarcacao('x <= y => z'), 'x <= y => z');
  assert.equal(semMarcacao('2 < 3 > 1'), '2 < 3 > 1');
});

test('quebra de linha disfarçada de marca vira quebra de linha', () => {
  assert.equal(semMarcacao('um<br>dois'), 'um\ndois');
  assert.equal(semMarcacao('um<br />dois'), 'um\ndois');
  assert.equal(semMarcacao('<p>a</p><p>b</p>'), 'a\nb\n');
});

test('entidade vira o caractere que ela representa', () => {
  assert.equal(semMarcacao('gene &amp; proteína'), 'gene & proteína');
  assert.equal(semMarcacao('a &lt; b'), 'a < b');
  assert.equal(semMarcacao('espaço&nbsp;duro'), 'espaço duro');
  // Entidade que a gente não conhece fica como está, em vez de virar lixo.
  assert.equal(semMarcacao('&alpha; e &beta;'), '&alpha; e &beta;');
});

test('texto limpo passa intacto', () => {
  const limpo = 'Explique a diferença entre fermentação e respiração aeróbica. Justifique.';
  assert.equal(semMarcacao(limpo), limpo);
  assert.equal(semMarcacao(''), '');
  assert.equal(semMarcacao(null), '');
  assert.equal(semMarcacao(undefined), '');
});

test('corte longo termina em palavra inteira, com reticências', () => {
  // Citação cortada no caractere exato terminava em "com a estrutura do c", que
  // a pessoa lê como defeito de tela em vez de "tinha mais".
  assert.equal(
    cortarNaPalavra('As provas apresentam questões que solicitam a integração dos conceitos', 40),
    'As provas apresentam questões que…'
  );
  assert.equal(cortarNaPalavra('curto', 40), 'curto');
  assert.equal(cortarNaPalavra('', 40), '');
  // Palavra única maior que o limite não tem onde quebrar: corta no seco.
  assert.equal(cortarNaPalavra('palavramuitolongasemespaco', 12), 'palavramuit…');
});
