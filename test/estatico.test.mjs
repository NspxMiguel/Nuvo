// O caminho da URL vira a chave do arquivo dentro do executável. A chave é
// sempre com barra pra frente; no Windows o `path.normalize` devolve barra
// invertida, e foi assim que os dicionários de idioma sumiram lá.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminhoDaInterface } from '../server/index.mjs';

test('a raiz é a página', () => {
  assert.equal(caminhoDaInterface('/'), 'index.html');
  assert.equal(caminhoDaInterface(''), 'index.html');
});

test('arquivo em subpasta mantém a barra pra frente', () => {
  assert.equal(caminhoDaInterface('/idiomas/en.json'), 'idiomas/en.json');
  // O que o `normalize` do Windows devolve. Sem esta conversão, `getAsset`
  // não achava a chave e o app respondia 404 pro dicionário — a interface
  // caía calada no português em toda máquina com Windows.
  assert.equal(caminhoDaInterface('\\idiomas\\en.json'), 'idiomas/en.json');
  assert.equal(caminhoDaInterface('/idiomas\\es.json'), 'idiomas/es.json');
});

test('barra e ponto no começo não viram caminho pra fora', () => {
  assert.equal(caminhoDaInterface('/../../etc/passwd'), 'etc/passwd');
  assert.equal(caminhoDaInterface('//app.js'), 'app.js');
  assert.equal(caminhoDaInterface('/./sw.js'), 'sw.js');
  assert.ok(!caminhoDaInterface('/../../etc/passwd').startsWith('.'));
});
