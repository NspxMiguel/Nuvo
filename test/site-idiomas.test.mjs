// A página de apresentação em três idiomas.
//
// A tradução dela é marcada no HTML com `data-i18n`, e a chave é o próprio
// texto em português. Isso deixa a página cair no português quando falta
// tradução — sem tela quebrada, sem identificador aparecendo pro visitante —,
// mas também deixa a falta passar despercebida: ninguém vê diferença entre
// "não traduzimos ainda" e "está em português de propósito". Este teste é
// quem vê.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const raiz = new URL('../docs/', import.meta.url);
const html = readFileSync(new URL('index.html', raiz), 'utf8');

// O script da página também contém a palavra `data-i18n` (é ele quem procura os
// elementos marcados). Sem tirar os blocos de código antes, a busca por chaves
// pega o próprio JavaScript e acusa uma frase que não existe.
const marcacao = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');

/** Os dicionários, lidos do mesmo arquivo que o navegador carrega. */
function carregarIdiomas() {
  const ctx = createContext({ window: {} });
  runInContext(readFileSync(new URL('idiomas.js', raiz), 'utf8'), ctx);
  return ctx.window.IDIOMAS;
}

/**
 * As chaves marcadas no HTML: o texto de quem tem `data-i18n` e o valor do
 * atributo de quem tem `data-i18n-attr`.
 */
function chavesDoHtml() {
  const chaves = new Set();
  for (const [, texto] of marcacao.matchAll(/data-i18n(?![-\w])[^>]*>([^<]*)</g)) {
    const limpo = texto.trim();
    if (limpo) chaves.add(limpo);
  }
  for (const [tag, attrs] of marcacao.matchAll(/<[^>]*data-i18n-attr="([^"]+)"[^>]*>/g)) {
    for (const attr of attrs.split(',').map((a) => a.trim())) {
      const m = tag.match(new RegExp(`\\s${attr}="([^"]*)"`));
      if (m && m[1].trim()) chaves.add(m[1].trim());
    }
  }
  return chaves;
}

test('o dicionário cobre tudo que o HTML manda traduzir', () => {
  const idiomas = carregarIdiomas();
  const chaves = chavesDoHtml();
  assert.ok(chaves.size > 40, `poucas chaves marcadas: ${chaves.size}`);

  for (const [lingua, dic] of Object.entries(idiomas)) {
    const faltando = [...chaves].filter((c) => !(c in dic));
    assert.deepEqual(faltando, [], `sem tradução em ${lingua}: ${faltando.join(' | ')}`);
  }
});

test('o título e a descrição também são traduzidos', () => {
  const idiomas = carregarIdiomas();
  const titulo = html.match(/<title>([^<]+)<\/title>/)[1];
  const descricao = html.match(/<meta name="description" content="([^"]+)"/)[1];
  for (const [lingua, dic] of Object.entries(idiomas)) {
    assert.ok(dic[titulo], `título sem tradução em ${lingua}`);
    assert.ok(dic[descricao], `descrição sem tradução em ${lingua}`);
  }
});

test('nenhum idioma traduz frase que o HTML não usa mais', () => {
  const idiomas = carregarIdiomas();
  const chaves = chavesDoHtml();
  // O que não está marcado no HTML mas é usado pelo script da primeira tela ou
  // pelos metadados: sem esta lista, o teste acusaria sobra onde não há.
  const fora = new Set([
    '@nomes',
    'Você conta uma vez.',
    'E todas elas lembram.',
    html.match(/<title>([^<]+)<\/title>/)[1],
    html.match(/<meta name="description" content="([^"]+)"/)[1]
  ]);
  for (const [lingua, dic] of Object.entries(idiomas)) {
    const sobrando = Object.keys(dic).filter((k) => !chaves.has(k) && !fora.has(k));
    assert.deepEqual(sobrando, [], `tradução órfã em ${lingua}: ${sobrando.join(' | ')}`);
  }
});

test('os idiomas têm exatamente as mesmas chaves', () => {
  const [a, b] = Object.values(carregarIdiomas());
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
});

test('a lista de nomes da saudação existe em todo idioma e termina no convite', () => {
  for (const [lingua, dic] of Object.entries(carregarIdiomas())) {
    const nomes = dic['@nomes'];
    assert.ok(Array.isArray(nomes) && nomes.length === 8, `@nomes torto em ${lingua}`);
    // O último é o convite ("SEU NOME"), escrito em maiúscula pra fechar a
    // sequência apontando pra quem está lendo.
    assert.equal(nomes.at(-1), nomes.at(-1).toUpperCase(), `convite em minúscula em ${lingua}`);
  }
});
