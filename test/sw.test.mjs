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

test('a casca não pede arquivo que o servidor tranca com token', () => {
  // `/manifest.webmanifest` carrega o token no `start_url`, então o servidor
  // exige token pra devolvê-lo — e o service worker pede sem token. Com ele na
  // lista, o `addAll` inteiro era recusado por causa de um 401: a instalação
  // falhava, e o app nunca chegava a funcionar sem rede. Calado.
  assert.ok(
    !shell().includes('/manifest.webmanifest'),
    'o manifest exige token e não pode estar na casca'
  );
});

test('um arquivo que falta não derruba a casca inteira', () => {
  const fonte = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
  assert.ok(
    !/\.addAll\(/.test(fonte),
    'addAll é tudo ou nada: um arquivo recusado deixava o app sem versão offline'
  );
  assert.match(fonte, /\.add\([^)]*\)[\s\S]{0,80}\.catch\(/, 'cada arquivo precisa do próprio catch');
});
