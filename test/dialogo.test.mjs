// Diálogo nativo do JavaScript bloqueia toda a janela do app. Esta guarda
// mantém as três chamadas fora da interface sem confundir nossas funções.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const web = new URL('../web/', import.meta.url);
const CHAMADA_NATIVA = /(^|[^\w$.])(prompt|confirm|alert)\s*\(/gm;

test('a interface não usa diálogos que bloqueiam o navegador', () => {
  const encontradas = [];
  for (const nome of readdirSync(web).filter((arquivo) => arquivo.endsWith('.js'))) {
    const fonte = readFileSync(new URL(nome, web), 'utf8');
    for (const chamada of fonte.matchAll(CHAMADA_NATIVA)) {
      const indice = chamada.index + chamada[1].length;
      const linha = fonte.slice(0, indice).split('\n').length;
      encontradas.push(`${nome}:${linha} ${chamada[2]}()`);
    }
  }
  assert.deepEqual(encontradas, [], `diálogos nativos encontrados:\n  ${encontradas.join('\n  ')}`);
});

test('a guarda distingue a API do app de métodos com o mesmo nome', () => {
  const permitidas = 'confirmar(); perguntar(); objeto.alert();';
  assert.deepEqual([...permitidas.matchAll(CHAMADA_NATIVA)], []);
  assert.equal([...'confirm();'.matchAll(CHAMADA_NATIVA)].length, 1);
});
