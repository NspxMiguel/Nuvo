// Toda frase que a interface escreve tem tradução nos dois idiomas.
//
// `t()` cai no próprio português quando falta tradução. É a escolha certa — a
// tela fica legível em vez de mostrar identificador —, mas ela esconde a falta:
// ninguém percebe olhando o app em inglês que aquela frase nunca foi traduzida.
// Foi assim que a tela Programar inteira nasceu em português nos três idiomas,
// com 39 frases fora dos dicionários e todos os testes passando.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync, readdirSync } from 'node:fs';

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

/**
 * As frases marcadas no HTML: o texto de `data-i18n` e o valor de cada atributo
 * listado em `data-i18n-attr`.
 *
 * Os atributos entram aqui porque foi por eles que a falta escapou: o
 * `placeholder` do campo de escrever não estava marcado, e o app em inglês
 * abria com "Fale com qualquer IA" no meio da tela — a primeira coisa que
 * qualquer pessoa lê.
 */
function frasesDoHtml() {
  const html = readFileSync(new URL('index.html', web), 'utf8');
  const chaves = new Set();
  for (const [, texto] of html.matchAll(/data-i18n(?![-\w])[^>]*>([^<]*)</g)) {
    const limpo = texto.trim();
    if (limpo) chaves.add(limpo);
  }
  for (const [tag, attrs] of html.matchAll(/<[^>]*data-i18n-attr="([^"]+)"[^>]*>/g)) {
    for (const attr of attrs.split(',').map((a) => a.trim())) {
      const m = tag.match(new RegExp(`\\s${attr}="([^"]*)"`));
      if (m && m[1].trim()) chaves.add(m[1].trim());
    }
  }
  return chaves;
}

/**
 * Atributo de texto que aparece pra quem usa e ficou sem `data-i18n-attr`.
 *
 * A cobertura sozinha não pega isto: um `placeholder` não marcado nunca entra
 * na lista de chaves, então ele não "falta no dicionário" — ele simplesmente
 * nunca é traduzido, em silêncio.
 */
function atributosSemMarcacao() {
  const html = readFileSync(new URL('index.html', web), 'utf8');
  const soltos = [];
  for (const [tag] of html.matchAll(/<[^>]+>/g)) {
    const marcados = new Set(
      (tag.match(/data-i18n-attr="([^"]+)"/)?.[1] || '').split(',').map((a) => a.trim())
    );
    for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
      const valor = tag.match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1];
      if (valor && valor.trim() && !marcados.has(attr)) soltos.push(`${attr}="${valor}"`);
    }
  }
  return soltos;
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

test('nenhum atributo de texto do HTML fica sem marcação de tradução', () => {
  const soltos = atributosSemMarcacao();
  assert.deepEqual(soltos, [], `sem data-i18n-attr:\n  ${soltos.join('\n  ')}`);
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

test('nenhuma frase resolve plural com "(s)"', () => {
  // `plural(n, um, muitos)` existe justamente pra isso, e escolhe a forma certa
  // em cada língua. Escrever "{n} modelo(s)" pula esse mecanismo, e o texto sai
  // errado nas duas pontas: "1 modelo(s)" no singular, e no inglês a tradução
  // herda o parêntese porque o dicionário copia a forma da chave.
  const marcadas = [...frasesDoCodigo(), ...frasesDoServidor(), ...Object.keys(en)].filter((k) =>
    /\w\(s\)/.test(k)
  );
  assert.deepEqual(marcadas, [], `plural entre parênteses:\n  ${marcadas.join('\n  ')}`);
});

test('reticências são sempre o caractere …, nunca três pontos', () => {
  // Misturar "…" e "..." nas mensagens de progresso deixa a tela irregular e
  // duplica a chave no dicionário: quem traduz recebe as duas e traduz duas.
  const tres = [...frasesDoCodigo(), ...Object.keys(en)].filter((k) => k.includes('...'));
  assert.deepEqual(tres, [], `com três pontos:\n  ${tres.join('\n  ')}`);
});

test('nenhuma frase existe em duas versões que só diferem no ponto final', () => {
  // Aconteceu com quatro mensagens de "refazer o índice": a mesma frase entrou
  // no dicionário com e sem ponto porque uma ia pro toast e outra pra caixa de
  // status. Duas chaves, duas traduções, uma tela inconsistente.
  const chaves = new Set([...frasesDoCodigo(), ...Object.keys(en)]);
  const pares = [...chaves].filter((k) => k.endsWith('.') && chaves.has(k.slice(0, -1)));
  assert.deepEqual(pares, [], `frase duplicada só pelo ponto:\n  ${pares.join('\n  ')}`);
});

/**
 * As frases que o servidor escreve. Ele só sabe português — é a língua em que
 * as mensagens nascem —, então quem traduz é o cliente, em
 * `traduzirDoServidor()`. Quatro formas de escrever, quatro varreduras:
 * `throw new Error('...')` e `error: '...'` pra frase inteira; `erroTraduzivel`
 * e `textoTraduzivel` pro molde com variável; e o campo `molde:` das regras de
 * `errors.mjs`, que guardam o molde numa tabela em vez de numa chamada.
 */
function frasesDoServidor() {
  const servidor = new URL('../server/', import.meta.url);
  const frases = new Set();
  const PADROES = [
    /throw new Error\(\s*'((?:\\.|[^'])+)'\s*\)/g,
    /\berror:\s*'((?:\\.|[^'])+)'/g,
    /erroTraduzivel\(\s*'((?:\\.|[^'])+)'/g,
    // `erroHttp(404, 'frase')`: o código vem antes, então o molde é o segundo
    // argumento. Sem esta linha as frases dele saíam do dicionário caladas.
    /erroHttp\(\s*\d+,\s*'((?:\\.|[^'])+)'/g,
    // `exigir(condicao, 'frase')` e `exigirExiste(linha, 'frase')`: os atalhos do
    // `estudos.mjs` pra levantar 400 e 404. A frase mora no segundo argumento e
    // some da varredura se não for procurada aqui.
    /\bexigir(?:Existe)?\([^,)]+,\s*'((?:\\.|[^'])+)'/g,
    /textoTraduzivel\(\s*'\w+',\s*'((?:\\.|[^'])+)'/g,
    /^\s*molde:\s*\n?\s*'((?:\\.|[^'])+)'/gm
  ];
  for (const arq of globSync('**/*.mjs', { cwd: servidor })) {
    const fonte = readFileSync(new URL(arq, servidor), 'utf8');
    for (const padrao of PADROES) {
      for (const [, texto] of fonte.matchAll(padrao)) frases.add(texto.replace(/\\(['"])/g, '$1'));
    }
  }
  return frases;
}

test('as mensagens do servidor estão nos dois dicionários', () => {
  // O `t()` cai no próprio português quando falta tradução, sem reclamar. Sem
  // esta varredura, mudar o texto de um `throw` no servidor apaga a tradução em
  // silêncio e o inglês volta a mostrar português no meio da tela.
  const frases = frasesDoServidor();
  assert.ok(frases.size > 90, `varredura achou só ${frases.size} mensagens do servidor`);
  const faltando = [...frases].filter((f) => !(f in en) || !(f in es)).sort();
  assert.deepEqual(faltando, [], `fora do dicionário:\n  ${faltando.join('\n  ')}`);
});

test('as frases do catálogo de modelos locais estão nos dois dicionários', () => {
  // Estas não passam pela varredura de `t('...')`: elas vivem numa tabela em
  // `server/machine.mjs`, viajam como dado até a tela e só ali são traduzidas.
  // Sem este teste, um modelo novo entra no catálogo e a tela em inglês volta a
  // mostrar duas frases em português no meio da lista — que foi exatamente o que
  // apareceu ao refazer a captura da tela "IAs ligadas".
  const maquina = readFileSync(new URL('../server/machine.mjs', import.meta.url), 'utf8');
  const frases = [...maquina.matchAll(/(?:pra_que|compara):\s*\n?\s*'((?:\\.|[^'\\])*)'/g)]
    .map(([, texto]) => texto.replace(/\\(['"])/g, '$1'));

  assert.ok(frases.length >= 20, `o catálogo encolheu demais: ${frases.length} frases`);
  const faltando = frases.filter((f) => !(f in en) || !(f in es));
  assert.deepEqual(faltando, [], `sem tradução:\n  ${faltando.join('\n  ')}`);
});

test('a tradução preserva os nomes das variáveis da frase', () => {
  // A frase montada chega com `{pasta}`, `{status}`, `{causa}`. Se a tradução
  // renomear, escrever errado ou perder um deles, o `t()` não substitui e o
  // usuário lê a chave crua no meio da mensagem — "no encontré la carpeta
  // {carpeta}". Não é erro de sintaxe e nenhum outro teste pega.
  const errado = [];
  const nomes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [lg, dic] of [['en', en], ['es', es]]) {
    for (const [chave, valor] of Object.entries(dic)) {
      if (chave.startsWith('@') || typeof valor !== 'string') continue;
      const a = nomes(chave).join(',');
      const b = nomes(valor).join(',');
      if (a !== b) errado.push(`[${lg}] ${chave} -> ${valor}  (${a || '—'} vs ${b || '—'})`);
    }
  }
  assert.deepEqual(errado, [], `variável trocada na tradução:\n  ${errado.join('\n  ')}`);
});
