// Guardas do que a tela promete e o código tinha deixado sem ligar.
//
// Cada teste aqui nasceu de um clique que não fez nada: o seletor de idioma que
// não existia, a lista de conversas espremida em 54px, o botão de chave numa IA
// que não tem chave. São regras baratas de conferir e caras de descobrir na mão.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (caminho) => readFileSync(join(RAIZ, caminho), 'utf8');

test('dá pra trocar o idioma pela tela', () => {
  // `trocarIdioma` e `NOMES` ficaram exportados e sem uma única chamada: os
  // dois dicionários só apareciam se o navegador ou o lugar já casassem.
  const views = ler('web/views.js');
  assert.match(views, /trocarIdioma/, 'a tela chama trocarIdioma');
  assert.match(views, /id="s-idioma"/, 'o computador tem um seletor de idioma');
  assert.match(views, /data-mob="idioma"/, 'o celular tem a linha de idioma');
});

test('nenhuma função de idioma fica sem quem a chame', () => {
  // `trocarIdioma` passou meses exportada e sem uma chamada, e o app inteiro
  // ficou sem seletor de idioma sem que nada acusasse. `formatarData` estava no
  // mesmo estado, enquanto a lista de cópias mostrava o ISO cru.
  const i18n = ler('web/i18n.js');
  const exportadas = [...i18n.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
  const resto = readdirSync(join(RAIZ, 'web'))
    .filter((n) => n.endsWith('.js') && n !== 'i18n.js')
    .map((n) => ler(join('web', n)))
    .join('\n');
  const orfas = exportadas.filter((nome) => !new RegExp(`\\b${nome}\\b`).test(resto));
  assert.deepEqual(orfas, [], 'função de idioma exportada e nunca chamada');
});

test('o menu cede espaço antes da lista de conversas', () => {
  // Com o "Mais" aberto o menu passa de 480px numa gaveta `overflow: hidden`.
  // Sem estas duas regras a lista sobrava com 54px e não rolava em canto nenhum.
  const css = ler('web/styles.css');
  const foraDeMedia = css.split('@media')[0];
  assert.match(foraDeMedia, /#sidebar nav \{[^}]*overflow-y: auto/, 'o menu rola sozinho');
  assert.match(foraDeMedia, /#sidebar nav \{[^}]*flex: 0 3 auto/, 'e encolhe antes da lista');
  const piso = /#chat-list \{[^}]*flex: 1 1 (\d+)px/.exec(foraDeMedia);
  assert.ok(piso, 'a lista de conversas tem um piso declarado');
  assert.ok(Number(piso[1]) >= 200, `piso de ${piso[1]}px é pouco pra uma lista de conversas`);
});

test('o nome da conversa não vaza pras outras telas', () => {
  const app = ler('web/app.js');
  assert.match(
    app,
    /state\.view === 'chat' \? state\.chats\.find/,
    'o título do topo só sai da conversa quando a tela é a conversa'
  );
  assert.match(app, /renderTopbar\(\);\n  const pintado = renderView\(\)/, 'e a barra repinta ao trocar de tela');
});

test('IA de terminal não ganha botão de chave', () => {
  const views = ler('web/views.js');
  const trecho = views.slice(views.indexOf('data-act="refresh"'), views.indexOf('data-act="toggle"'));
  assert.match(trecho, /p\.kind === 'cli'/, 'o botão de chave olha o tipo da IA antes de aparecer');
});
