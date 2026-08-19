// A casca guardada pelo service worker é o que faz o app abrir sem rede. Módulo
// novo que não entra na lista só falta quando a rede cai — o glow.js e o
// format.js entraram assim. Este teste compara a lista com o que existe em web/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const sw = readFileSync(`${web}sw.js`, 'utf8');

/** Os caminhos literais dentro do array SHELL. */
function shell() {
  const bloco = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  return [...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('todo módulo de web/ está na casca do service worker', () => {
  const lista = shell();
  const modulos = readdirSync(web)
    .filter((f) => f.endsWith('.js') && f !== 'sw.js')
    .map((f) => `/${f}`);
  const faltando = modulos.filter((m) => !lista.includes(m));
  assert.deepEqual(faltando, [], `fora da casca: ${faltando.join(', ')}`);
});

test('a casca não promete arquivo que não existe', () => {
  // `web/` tem subpasta desde os dicionários de idioma: uma leitura rasa não
  // enxergaria `/idiomas/en.json` e acusaria arquivo inventado.
  const andar = (dir, prefixo = '') =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? andar(join(dir, e.name), `${prefixo}/${e.name}`) : [`${prefixo}/${e.name}`]
    );
  const existentes = new Set(andar(web));
  // '/' é a própria raiz servida pelo index.html.
  const inventados = shell().filter((p) => p !== '/' && !existentes.has(p));
  assert.deepEqual(inventados, [], `na casca mas sem arquivo: ${inventados.join(', ')}`);
});

test('a versão do cache muda quando a casca muda', () => {
  // `addAll` só reescreve o cache num nome novo; ficar em v2 deixaria quem já
  // instalou com a lista velha pra sempre.
  const m = sw.match(/const CACHE = 'iaunifier-v(\d+)'/);
  assert.ok(m, 'o nome do cache tem que ser versionado');
  assert.ok(Number(m[1]) >= 3, `a casca cresceu depois da v2, está em v${m[1]}`);
});
