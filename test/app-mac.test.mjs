// O pacote que vai no download do macOS.
//
// O motivo deste arquivo existir: a versão anterior mandava um executável Unix
// solto dentro do .tar.gz. No Terminal ele roda; no Finder, duplo clique não
// abre nada — e "nada acontece" foi exatamente o que o app fez na máquina de
// quem baixou. O que o macOS abre com duplo clique é um `.app`, e um `.app` só
// é `.app` se tiver a estrutura inteira.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { montarAppMac } from '../build/app-mac.mjs';

const NO_MAC = platform() === 'darwin';
const temporario = mkdtempSync(join(tmpdir(), 'nuvo-app-mac-'));
after(() => rmSync(temporario, { recursive: true, force: true }));

/** Um "binário" de mentira: o que se confere aqui é a embalagem, não o Node. */
function pacote() {
  const fonte = join(temporario, 'nuvo-falso');
  if (!existsSync(fonte)) writeFileSync(fonte, '#!/bin/sh\necho nuvo\n');
  const destino = mkdtempSync(join(temporario, 'saida-'));
  return montarAppMac(fonte, '9.9.9', destino);
}

test('o pacote tem a estrutura que o Finder exige', () => {
  const app = pacote();
  assert.ok(app.endsWith('Nuvo.app'), `o pacote precisa se chamar Nuvo.app: ${app}`);
  for (const parte of ['Contents/Info.plist', 'Contents/PkgInfo', 'Contents/MacOS/Nuvo', 'Contents/Resources/nuvo']) {
    assert.ok(existsSync(join(app, parte)), `faltou ${parte}`);
  }
});

test('o executável do pacote é executável, e é o que o Info.plist aponta', () => {
  const app = pacote();
  const plist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
  const nome = /<key>CFBundleExecutable<\/key><string>([^<]+)<\/string>/.exec(plist)?.[1];
  assert.equal(nome, 'Nuvo', 'sem bater com o arquivo em MacOS/, o Finder abre e fecha na hora');

  // Bit de execução no lançador E no binário de dentro: sem um dos dois o
  // duplo clique falha calado.
  for (const caminho of [join(app, 'Contents', 'MacOS', nome), join(app, 'Contents', 'Resources', 'nuvo')]) {
    assert.equal(statSync(caminho).mode & 0o111, 0o111, `${caminho} precisa ser executável`);
  }
});

test('o lançador sobe o servidor pedindo a janela, e não some com o erro', () => {
  const sh = readFileSync(join(pacote(), 'Contents', 'MacOS', 'Nuvo'), 'utf8');
  assert.match(sh, /^#!\/bin\/sh/, 'sem shebang o Finder não sabe com o que abrir');
  assert.match(sh, /--abrir/, 'sem --abrir o servidor sobe e a pessoa não vê nada');
  assert.match(sh, /Resources\/nuvo|AQUI/, 'o lançador tem que chamar o binário de dentro do pacote');
  // Duplo clique não tem terminal: sem log, um erro na subida não deixa rastro.
  assert.match(sh, /Logs\/Nuvo\.log/);
});

test('a versão do pacote é a versão do app', () => {
  const plist = readFileSync(join(pacote(), 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, /<key>CFBundleShortVersionString<\/key><string>9\.9\.9<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key><string>9\.9\.9<\/string>/);
  assert.match(plist, /<key>CFBundleIdentifier<\/key><string>dev\.nspx\.nuvo\.app<\/string>/);
});

test('o macOS aceita o pacote como pacote', { skip: !NO_MAC }, () => {
  const app = pacote();
  // Quem responde aqui é o próprio sistema, não uma suposição minha sobre ele.
  const lido = execFileSync('/usr/bin/mdls', ['-name', 'kMDItemContentType', app], { encoding: 'utf8' });
  assert.match(lido, /com\.apple\.application-bundle/, `o sistema não viu um app: ${lido.trim()}`);
});

test('o ícone entra no pacote', { skip: !NO_MAC }, () => {
  const app = pacote();
  const icns = join(app, 'Contents', 'Resources', 'nuvo.icns');
  assert.ok(existsSync(icns), 'sem .icns o app aparece com o ícone branco genérico');
  assert.ok(statSync(icns).size > 1000, 'o .icns saiu vazio');
  // Sobra da conversão não pode ir junto no download.
  assert.ok(!existsSync(join(app, 'Contents', 'Resources', 'nuvo.iconset')), 'a pasta de conversão ficou pra trás');
});
