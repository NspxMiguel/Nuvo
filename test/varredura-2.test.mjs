// A segunda varredura: os subsistemas que a primeira não leu. Um teste por
// defeito confirmado, cobrando o cenário concreto que estava errado.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { readPage } = await import('../server/web.mjs');
const { lerAceitos } = await import('../server/idioma.mjs');
const { parseExport } = await import('../server/importers.mjs');
const { renderMarkdown } = await import('../web/md.js');

after(() => home.cleanup());

async function servir(status, tipo, corpo) {
  const srv = createServer((req, res) => {
    res.writeHead(status, { 'content-type': tipo });
    res.end(corpo);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}/`, fechar: () => new Promise((ok) => srv.close(ok)) };
}

test('página que mente o content-type é limpa mesmo assim', async () => {
  // Servidor mal configurado, bucket estático e página de erro mandam HTML
  // dizendo `text/plain`. Acreditar no cabeçalho entregava a página com as tags
  // todas pro modelo — o contrário do que a limpeza existe pra fazer.
  const s = await servir(200, 'text/plain; charset=utf-8', '<html><body><p>o texto que importa</p><script>x()</script></body></html>');
  try {
    const p = await readPage(s.url);
    assert.match(p.text, /o texto que importa/);
    assert.doesNotMatch(p.text, /<p>|<script>/);
  } finally {
    await s.fechar();
  }
});

test('texto de verdade continua passando cru', async () => {
  const s = await servir(200, 'text/plain', 'a < b e c > d, sem tag nenhuma');
  try {
    assert.equal((await readPage(s.url)).text, 'a < b e c > d, sem tag nenhuma');
  } finally {
    await s.fechar();
  }
});

test('q fora da escala do RFC não fura a fila', () => {
  // `q` vai de 0 a 1. Um `q=9` — escrito à mão ou por cliente torto — valia 9 e
  // passava na frente de um idioma escolhido com q=1. Agora ele vale o mesmo
  // que não ter q nenhum, e quem desempata é a ordem da lista.
  assert.deepEqual(lerAceitos('pt-BR;q=1, en;q=9'), ['pt-BR', 'en'], 'q=9 não passa na frente de q=1');
  assert.deepEqual(lerAceitos('pt-BR;q=1, en;q=0'), ['pt-BR'], 'q=0 quer dizer "não quero este"');

  // O que é válido continua mandando.
  assert.deepEqual(lerAceitos('en;q=0.5, pt-BR;q=0.9'), ['pt-BR', 'en']);
  assert.deepEqual(lerAceitos('es, en;q=0.8'), ['es', 'en']);
});

test('export do Claude com campo torto não derruba a importação', () => {
  // `chat_messages` como texto e `content` como texto acontecem em export
  // remontado à mão, e os dois davam TypeError que matava o arquivo inteiro.
  const tortos = JSON.stringify([
    { name: 'quebrada', chat_messages: 'isto devia ser uma lista' },
    {
      name: 'meio quebrada',
      chat_messages: [
        { sender: 'human', content: 'texto direto em vez de lista' },
        { sender: 'assistant', text: 'esta tem texto', content: [] }
      ]
    }
  ]);
  const conversas = parseExport(tortos, 'claude.json');
  assert.ok(Array.isArray(conversas), 'a importação sobrevive');
  const comTexto = conversas.flatMap((c) => c.turns || []);
  assert.ok(
    comTexto.some((t) => /esta tem texto/.test(t.text)),
    'e o que dava pra ler foi lido'
  );
});

test('tabela de markdown segue o cabeçalho, não a linha', () => {
  // Modelo escreve tabela com uma célula a mais numa linha e a menos noutra o
  // tempo todo; sem seguir o cabeçalho, a coluna extra empurrava o resto.
  const html = renderMarkdown(['| a | b |', '| --- | --- |', '| 1 | 2 | 3 |', '| 4 |'].join('\n'));
  const linhas = [...html.matchAll(/<tr>(?:(?!<\/tr>).)*<\/tr>/gs)].map((m) => m[0]);
  const corpo = linhas.slice(1);
  assert.equal(corpo.length, 2, 'as duas linhas entraram');
  for (const l of corpo) {
    assert.equal([...l.matchAll(/<td>/g)].length, 2, 'toda linha tem o número de colunas do cabeçalho');
  }
  assert.match(corpo[0], /<td>1<\/td><td>2<\/td>/, 'a célula sobrando é descartada');
  assert.match(corpo[1], /<td>4<\/td><td><\/td>/, 'a célula faltando vira vazia');
});

test('o systemd recebe o comando entre aspas quando o caminho tem espaço', () => {
  // `ExecStart` separa por espaço em branco: sem aspas, `/home/eu/My Project/`
  // virava dois argumentos e o serviço não subia. launchd e Agendador de
  // Tarefas já citavam; só o systemd não.
  const fonte = readFileSync(new URL('../server/service.mjs', import.meta.url), 'utf8');
  assert.match(fonte, /ExecStart=\$\{COMANDO\.map\(paraSystemd\)\.join\(' '\)\}/);
  assert.match(fonte, /function paraSystemd\(pedaco\)/);
});

test('cédula com nota faltando é anulada, não meio contada', () => {
  // Jurado que devolve uma nota para três candidatas deixava duas com um voto a
  // menos: a média saía enviesada sem ninguém ver.
  const fonte = readFileSync(new URL('../server/council.mjs', import.meta.url), 'utf8');
  assert.match(fonte, /return Number\.isFinite\(grade\) && grade >= 0 && grade <= 10;/);
  assert.doesNotMatch(fonte, /!Number\.isFinite\(grade\) \|\|/);
});
