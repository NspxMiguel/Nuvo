// O renderizador de Markdown roda no navegador, mas é um módulo puro: dá pra
// testar aqui. O que mais importa é que ele não deixe HTML de resposta de
// modelo virar HTML de verdade na página.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from '../web/md.js';

test('HTML dentro da resposta é escapado, não executado', () => {
  const out = renderMarkdown('olha isso <img src=x onerror=alert(1)> e <script>roubar()</script>');
  assert.ok(!out.includes('<img'), 'a tag img não pode sair crua');
  assert.ok(!out.includes('<script'), 'a tag script não pode sair crua');
  assert.match(out, /&lt;img/);
});

test('HTML dentro de bloco de código também é escapado', () => {
  const out = renderMarkdown('```html\n<script>alert(1)</script>\n```');
  assert.ok(!out.includes('<script>alert'), 'script dentro do bloco não pode escapar');
  assert.match(out, /&lt;script&gt;/);
});

test('título vira heading, começando em h2 pra não competir com a página', () => {
  assert.match(renderMarkdown('# Um título'), /<h2>Um título<\/h2>/);
  assert.match(renderMarkdown('### Menor'), /<h4>Menor<\/h4>/);
});

test('lista com marcador e lista numerada saem certas', () => {
  const bullets = renderMarkdown('- um\n- dois');
  assert.match(bullets, /<ul><li>um<\/li><li>dois<\/li><\/ul>/);
  const numbered = renderMarkdown('1. um\n2. dois');
  assert.match(numbered, /<ol><li>um<\/li><li>dois<\/li><\/ol>/);
});

test('tabela vira table com cabeçalho', () => {
  const out = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(out, /<th>a<\/th>/);
  assert.match(out, /<td>1<\/td>/);
  assert.match(out, /table-wrap/, 'a tabela precisa do container que rola de lado');
});

test('bloco de código guarda a linguagem e o botão de copiar', () => {
  const out = renderMarkdown('```js\nconst a = 1;\n```');
  assert.match(out, /class="code"/);
  assert.match(out, />js</);
  assert.match(out, /code-copy/);
  assert.match(out, /data-code="const%20a%20%3D%201%3B"/);
});

test('negrito, itálico, riscado e código inline', () => {
  const out = renderMarkdown('**forte** e *torto* e ~~riscado~~ e `codigo`');
  assert.match(out, /<strong>forte<\/strong>/);
  assert.match(out, /<em>torto<\/em>/);
  assert.match(out, /<del>riscado<\/del>/);
  assert.match(out, /<code>codigo<\/code>/);
});

test('link em markdown e endereço solto viram links com rel de segurança', () => {
  const out = renderMarkdown('veja [aqui](https://exemplo.com/a) e https://outro.com/b');
  assert.match(out, /<a href="https:\/\/exemplo\.com\/a" target="_blank" rel="noopener noreferrer">aqui<\/a>/);
  assert.match(out, /href="https:\/\/outro\.com\/b"/);
});

test('link javascript: não vira link', () => {
  const out = renderMarkdown('[clica](javascript:alert(1))');
  assert.ok(!/href="javascript:/.test(out), 'javascript: não pode virar href');
});

test('citação e régua', () => {
  assert.match(renderMarkdown('> citado'), /<blockquote>/);
  assert.match(renderMarkdown('---'), /<hr \/>/);
});

test('parágrafos separados não grudam', () => {
  const out = renderMarkdown('primeiro\n\nsegundo');
  assert.match(out, /<p>primeiro<\/p>/);
  assert.match(out, /<p>segundo<\/p>/);
});

test('texto vazio não quebra', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});

test('escapeHtml cobre as cinco entidades', () => {
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('endereço com parêntese não estoura as aspas do href', () => {
  // O `(` era aceito dentro da URL do link de markdown, e aí a passada do
  // endereço solto reescrevia por dentro do href já emitido: o resto do texto
  // virava atributo de verdade na tag do link.
  const out = renderMarkdown('[t](https://a.com/(https://b.com/x)');
  for (const href of out.matchAll(/href="([^"]*)"/g)) {
    assert.ok(!href[1].includes('<'), `href com tag dentro: ${href[1]}`);
  }
  assert.equal((out.match(/<a /g) || []).length, (out.match(/<\/a>/g) || []).length);
});

test('parêntese em par continua dentro do endereço', () => {
  const out = renderMarkdown('olha https://pt.wikipedia.org/wiki/Ruby_(linguagem) ali');
  assert.match(out, /href="https:\/\/pt\.wikipedia\.org\/wiki\/Ruby_\(linguagem\)"/);
});

test('ponto final da frase não entra no endereço', () => {
  const out = renderMarkdown('fonte: https://exemplo.com/pagina.');
  assert.match(out, /href="https:\/\/exemplo\.com\/pagina"/);
  assert.match(out, /<\/a>\.<\/p>/);
});

test('dentro de crase não vira link nem negrito', () => {
  assert.equal(renderMarkdown('`a**b**c`'), '<p><code>a**b**c</code></p>');
  assert.match(renderMarkdown('veja `https://x.com/a` aqui'), /<code>https:\/\/x\.com\/a<\/code>/);
});

test('rótulo do link ainda aceita negrito', () => {
  assert.match(renderMarkdown('[**forte**](https://x.com)'), /<strong>forte<\/strong><\/a>/);
});

test('número dentro de comentário não engole o comentário', () => {
  // O marcador do trecho já pintado era ` N `, e a passada de número comia o
  // próprio N: o comentário inteiro sumia da tela.
  const out = renderMarkdown('```js\n// espera 30 segundos\n```');
  assert.match(out, /<span class="tok com">\/\/ espera 30 segundos<\/span>/);
});
