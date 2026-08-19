// Toda frase que a interface escreve tem tradução nos dois idiomas.
//
// `t()` cai no próprio português quando falta tradução. É a escolha certa — a
// tela fica legível em vez de mostrar identificador —, mas ela esconde a falta:
// ninguém percebe olhando o app em inglês que aquela frase nunca foi traduzida.
// Foi assim que a tela Programar inteira nasceu em português nos três idiomas,
// com 39 frases fora dos dicionários e todos os testes passando.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const web = new URL('../web/', import.meta.url);
const en = JSON.parse(readFileSync(new URL('idiomas/en.json', web), 'utf8'));
const es = JSON.parse(readFileSync(new URL('idiomas/es.json', web), 'utf8'));

/**
 * As frases escritas direto no código: `t('...')` e os dois lados de
 * `plural(n, '...', '...')`.
 *
 * Chamada com variável (`t(POR_QUE[motivo])`) não aparece aqui e não tem como
 * aparecer — por isso o código escreve `() => t('a frase')` em tabela de
 * mensagem, pra frase ficar dentro do alcance desta varredura.
 */
function frasesDoCodigo() {
  const chaves = new Set();
  for (const nome of readdirSync(web).filter((f) => f.endsWith('.js'))) {
    const fonte = readFileSync(new URL(nome, web), 'utf8');
    for (const [, , texto] of fonte.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      chaves.add(texto.replace(/\\(['"])/g, '$1'));
    }
    for (const m of fonte.matchAll(
      /\bplural\(\s*[^,]+,\s*(['"])((?:\\.|(?!\1).)*)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3/g
    )) {
      chaves.add(m[2].replace(/\\(['"])/g, '$1'));
      chaves.add(m[4].replace(/\\(['"])/g, '$1'));
    }
  }
  return chaves;
}

/** As frases marcadas no HTML com `data-i18n`. */
function frasesDoHtml() {
  const html = readFileSync(new URL('index.html', web), 'utf8');
  const chaves = new Set();
  for (const [, texto] of html.matchAll(/data-i18n(?![-\w])[^>]*>([^<]*)</g)) {
    const limpo = texto.trim();
    if (limpo) chaves.add(limpo);
  }
  return chaves;
}

test('cada frase da interface está nos dois dicionários', () => {
  const chaves = [...frasesDoCodigo(), ...frasesDoHtml()];
  assert.ok(chaves.length > 400, `varredura achou pouca coisa: ${chaves.length}`);

  for (const [lingua, dic] of [
    ['en', en],
    ['es', es]
  ]) {
    const faltando = chaves.filter((c) => !(c in dic)).sort();
    assert.deepEqual(
      faltando,
      [],
      `${faltando.length} sem tradução em ${lingua}:\n  ${faltando.join('\n  ')}`
    );
  }
});

test('os dois idiomas têm as mesmas chaves', () => {
  const soEn = Object.keys(en).filter((k) => !(k in es));
  const soEs = Object.keys(es).filter((k) => !(k in en));
  assert.deepEqual(soEn, [], `só em inglês: ${soEn.join(' | ')}`);
  assert.deepEqual(soEs, [], `só em espanhol: ${soEs.join(' | ')}`);
});

test('nenhuma tradução é o próprio português copiado', () => {
  // Copiar a frase em português pro dicionário passa neste teste de cobertura e
  // não traduz nada. As exceções são as que já são iguais nas duas línguas —
  // unidade, nome próprio e as poucas palavras idênticas em espanhol.
  const iguais = (dic) => Object.entries(dic).filter(([k, v]) => k === v).map(([k]) => k);
  // O inglês não compartilha palavra com o português quase nunca: cinco é
  // folga pra unidade ("{n} kB") e nome de produto.
  assert.ok(iguais(en).length < 12, `inglês com ${iguais(en).length} frases não traduzidas`);
  // O espanhol compartilha muito mais ("Modo agente", "Programar"), então o
  // limite aqui é sobre a proporção, não sobre o número solto.
  assert.ok(
    iguais(es).length < Object.keys(es).length * 0.2,
    `espanhol com ${iguais(es).length} frases iguais ao português`
  );
});
