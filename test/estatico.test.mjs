// O caminho da URL vira a chave do arquivo dentro do executável. A chave é
// sempre com barra pra frente; no Windows o `path.normalize` devolve barra
// invertida, e foi assim que os dicionários de idioma sumiram lá.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminhoDaInterface, enderecoDoPedido } from '../server/index.mjs';

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

test('endereço que o `URL` recusa vira `null` em vez de derrubar o servidor', () => {
  // O construtor de `URL` levantava de dentro do `createServer`, onde ninguém
  // pega: o processo fechava e todas as conversas abertas caíam junto.
  // Aconteceu aqui, num teste que montou o caminho errado — e qualquer
  // visitante consegue o mesmo digitando duas barras.
  assert.equal(enderecoDoPedido('//', '127.0.0.1:4747'), null);
  assert.equal(enderecoDoPedido('//?token=x', '127.0.0.1:4747'), null);
  assert.equal(enderecoDoPedido('//x', '127.0.0.1:4747')?.host, 'x');

  // O que é endereço continua sendo endereço.
  assert.equal(enderecoDoPedido('/', 'localhost').pathname, '/');
  assert.equal(enderecoDoPedido('/api/settings?a=1', 'localhost').pathname, '/api/settings');
  assert.equal(enderecoDoPedido('/idiomas/en.json', 'localhost').pathname, '/idiomas/en.json');
  // Host vazio (pedido HTTP/1.0 sem cabeçalho) cai no `localhost` e não levanta.
  assert.equal(enderecoDoPedido('/', '').pathname, '/');
});
