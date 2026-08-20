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
import { mkdtempSync, readdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { montarAppMac } from '../build/app-mac.mjs';

const NO_MAC = platform() === 'darwin';
const temporario = mkdtempSync(join(tmpdir(), 'nuvo-app-mac-'));
after(() => rmSync(temporario, { recursive: true, force: true }));

// Um "binário" de mentira: o que se confere aqui é a embalagem, não o Node.
//
// Começa com os bytes de um Mach-O de verdade (`\xcf\xfa\xed\xfe`, que é
// `MH_MAGIC_64` em little-endian) porque um dos testes confere justamente que o
// executável do pacote não começa com `#!`.
const BINARIO_FALSO = Buffer.concat([
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from('nuvo de mentira, só pra conferir a embalagem\n')
]);

function lerBinarioFalso() {
  return BINARIO_FALSO;
}

function pacote() {
  const fonte = join(temporario, 'nuvo-falso');
  if (!existsSync(fonte)) writeFileSync(fonte, BINARIO_FALSO);
  const destino = mkdtempSync(join(temporario, 'saida-'));
  return montarAppMac(fonte, '9.9.9', destino);
}

test('o pacote tem a estrutura que o Finder exige', () => {
  const app = pacote();
  assert.ok(app.endsWith('Nuvo.app'), `o pacote precisa se chamar Nuvo.app: ${app}`);
  for (const parte of ['Contents/Info.plist', 'Contents/PkgInfo', 'Contents/MacOS/Nuvo']) {
    assert.ok(existsSync(join(app, parte)), `faltou ${parte}`);
  }
});

test('o executável do pacote é executável, e é o que o Info.plist aponta', () => {
  const app = pacote();
  const plist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
  const nome = /<key>CFBundleExecutable<\/key><string>([^<]+)<\/string>/.exec(plist)?.[1];
  assert.equal(nome, 'Nuvo', 'sem bater com o arquivo em MacOS/, o Finder abre e fecha na hora');

  const caminho = join(app, 'Contents', 'MacOS', nome);
  assert.equal(statSync(caminho).mode & 0o111, 0o111, `${caminho} precisa ser executável`);
});

test('o executável do pacote é o binário, nunca um script', () => {
  // Este teste existe por causa de um aviso do macOS 26 na primeira abertura:
  // "Support Ending for Intel-based Apps". O binário é arm64 puro; o que trazia
  // x86_64 era o interpretador. Um `#!/bin/sh` na frente conta como executável
  // do pacote, e o /bin/sh do sistema é `x86_64 arm64e` — então o pacote inteiro
  // passava a ser anunciado como parte Intel.
  const executavel = readFileSync(join(pacote(), 'Contents', 'MacOS', 'Nuvo'));
  assert.notEqual(
    executavel.subarray(0, 2).toString('latin1'),
    '#!',
    'script no lugar do binário faz o macOS anunciar o app como Intel'
  );
  assert.deepEqual(
    executavel.subarray(0, 4),
    lerBinarioFalso().subarray(0, 4),
    'o executável do pacote tem que ser o binário que foi injetado, byte a byte'
  );
});

test('o pacote não deixa uma segunda cópia do binário para trás', () => {
  // O binário tem 144 MB. Uma cópia em Resources/ dobrava o download por nada.
  const recursos = join(pacote(), 'Contents', 'Resources');
  const sobrando = existsSync(recursos)
    ? readdirSync(recursos).filter((f) => !f.endsWith('.icns'))
    : [];
  assert.deepEqual(sobrando, [], `sobrou em Resources/: ${sobrando.join(', ')}`);
});

test('o identificador do pacote é o mesmo que o binário procura', () => {
  // O binário decide "fui aberto com duplo clique?" olhando se o
  // XPC_SERVICE_NAME carrega o identificador do pacote. São dois arquivos
  // escrevendo a mesma string: renomear num e esquecer o outro não quebra
  // nada visível no build — só faz o duplo clique voltar a subir o servidor
  // sem abrir janela nenhuma, que é exatamente o defeito de origem.
  const plist = readFileSync(join(pacote(), 'Contents', 'Info.plist'), 'utf8');
  const doPacote = /<key>CFBundleIdentifier<\/key><string>([^<]+)<\/string>/.exec(plist)?.[1];

  const cli = readFileSync(new URL('../bin/nuvo.mjs', import.meta.url), 'utf8');
  const doBinario = /const PACOTE_MAC = '([^']+)'/.exec(cli)?.[1];

  assert.ok(doPacote, 'o Info.plist saiu sem CFBundleIdentifier');
  assert.equal(doBinario, doPacote);
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
