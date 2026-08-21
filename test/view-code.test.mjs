// A tela Programar roda no navegador, mas duas peças dela são texto puro e
// valem o teste aqui: a tradução do evento que chega pelo stream — que é o
// contrato combinado com o adaptador de CLI — e a montagem da árvore de
// arquivos, que recebe caminho plano e devolve pasta dentro de pasta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traduzirEvento, pastasDaLista, htmlDaPasta } from '../web/view-code.js';

test('o evento de trabalho é reconhecido dentro de `evento`', () => {
  const ev = traduzirEvento({
    evento: { tipo: 'ferramenta', id: 't1', acao: 'rodar', titulo: 'rodou npm test', comando: 'npm test' }
  });
  assert.equal(ev.tipo, 'ferramenta');
  assert.equal(ev.comando, 'npm test');
  assert.equal(ev.id, 't1');
});

test('o evento também é reconhecido quando o tipo vem na raiz', () => {
  // O servidor pode repassar o evento achatado (`{ type: 'saida', ... }`) em vez
  // de embrulhado. Nas duas formas a tela precisa entender, senão a fila de
  // trabalho fica vazia sem ninguém reclamar.
  const raiz = traduzirEvento({ type: 'saida', id: 't1', texto: 'ok', ok: true });
  assert.equal(raiz.tipo, 'saida');
  assert.equal(raiz.texto, 'ok');
  assert.equal(traduzirEvento({ tipo: 'fim', ms: 1200, turnos: 2 }).tipo, 'fim');
});

test('evento de conversa não vira passo de trabalho', () => {
  assert.equal(traduzirEvento({ type: 'delta', text: 'oi' }), null);
  assert.equal(traduzirEvento({ type: 'done', message: {} }), null);
  assert.equal(traduzirEvento(null), null);
  assert.equal(traduzirEvento('ferramenta'), null);
});

test('caminho plano vira pasta dentro de pasta', () => {
  const raiz = pastasDaLista([
    { caminho: 'web/app.js', bytes: 10 },
    { caminho: 'web/idiomas/en.json', bytes: 20 },
    { caminho: 'README.md', bytes: 30 }
  ]);
  assert.deepEqual(
    raiz.arquivos.map((a) => a.caminho),
    ['README.md'],
    'arquivo da raiz não entra em pasta nenhuma'
  );
  const web = raiz.pastas.get('web');
  assert.deepEqual(web.arquivos.map((a) => a.caminho), ['web/app.js']);
  assert.deepEqual(web.pastas.get('idiomas').arquivos.map((a) => a.caminho), ['web/idiomas/en.json']);
});

test('caminho torto não derruba a árvore', () => {
  // Barra dobrada e caminho vazio chegaram do servidor durante o desenvolvimento
  // e viravam uma pasta de nome vazio, com o resto do projeto pendurado dentro.
  const raiz = pastasDaLista([{ caminho: 'web//core.js', bytes: 1 }, { caminho: '', bytes: 0 }, {}]);
  assert.deepEqual([...raiz.pastas.keys()], ['web']);
  assert.equal(raiz.pastas.get('web').arquivos.length, 1);
  assert.equal(raiz.arquivos.length, 2, 'o que não tem caminho fica na raiz, e não some');
});

test('a pasta de anexos nasce aberta, e só ela', () => {
  // O servidor abre exceção pra `.nuvo` na varredura exatamente pra que o
  // arquivo recém-anexado apareça. Fechada no segundo andar, a árvore mostrava
  // `.nuvo` → `anexos` e mais nada — o anexo ficava invisível logo depois de
  // anexado, que é o único momento em que alguém procura por ele.
  const html = htmlDaPasta(
    pastasDaLista([
      { caminho: '.nuvo/anexos/contrato.txt', bytes: 18 },
      { caminho: 'src/fundo/util.mjs', bytes: 40 }
    ])
  );
  const abertas = [...html.matchAll(/<details class="cd-pasta"( open)?>[\s\S]*?<span class="cd-nome">([^<]+)</g)]
    .filter((m) => m[1])
    .map((m) => m[2]);
  assert.ok(abertas.includes('anexos'), 'a pasta de anexos abre sozinha');
  assert.ok(abertas.includes('.nuvo'), 'e o caminho até ela também');
  assert.ok(!abertas.includes('fundo'), 'pasta funda de projeto continua fechada');
  assert.ok(html.includes('contrato.txt'), 'o anexo está desenhado na árvore');
});

test('árvore comum continua abrindo só o primeiro andar', () => {
  const html = htmlDaPasta(pastasDaLista([{ caminho: 'web/idiomas/en.json', bytes: 20 }]));
  assert.match(html, /<details class="cd-pasta" open>[\s\S]*?web/, 'a pasta da raiz abre');
  assert.ok(
    html.split('idiomas')[0].lastIndexOf('<details class="cd-pasta">') >
      html.split('idiomas')[0].lastIndexOf('<details class="cd-pasta" open>'),
    'a pasta de dentro fica fechada'
  );
});
