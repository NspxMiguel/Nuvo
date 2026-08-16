// Subir com a máquina e o atalho do dock. Nada aqui instala coisa nenhuma: o
// que se testa é o que seria escrito, e a detecção de instalação apontando pra
// pasta que não existe mais.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const service = await import('../server/service.mjs');
const desktop = await import('../server/desktop.mjs');

after(() => home.cleanup());

const SUPORTADO = ['darwin', 'linux', 'win32'].includes(platform());

test('o plano diz onde vai escrever e com qual node', { skip: !SUPORTADO }, () => {
  const plano = service.servicePlan();
  assert.equal(plano.supported, true);
  assert.match(plano.entry, /bin[/\\]iaunifier\.mjs$/);
  assert.ok(plano.node, 'sem o caminho do node o serviço não sobe nada');
  assert.ok(plano.file, 'sem arquivo de destino não dá pra dizer o que foi instalado');
  assert.ok(plano.home, 'o serviço precisa levar o IAUNIFIER_HOME junto');
});

test('instalação que aponta pra este projeto é reconhecida', () => {
  const plano = service.servicePlan();
  const plistDaqui = `<string>${plano.entry}</string>`;
  assert.equal(service.describesThisProject(plistDaqui), true);
});

test('instalação que aponta pra outro caminho é reconhecida como velha', () => {
  const antigo = '<string>/Users/alguem/Projetos-antigos/IAUnifier/bin/iaunifier.mjs</string>';
  assert.equal(
    service.describesThisProject(antigo),
    false,
    'mover a pasta do projeto tem que ser detectável — senão o launchd fica tentando subir um arquivo que sumiu'
  );
});

test('conteúdo vazio ou lixo não é confundido com instalação boa', () => {
  assert.equal(service.describesThisProject(''), false);
  assert.equal(service.describesThisProject(null), false);
  assert.equal(service.describesThisProject(undefined), false);
});

// ------------------------------------------------------------ atalho do dock

test('o endereço do atalho leva o token quando ele é exigido', async () => {
  const { patchConfig } = await import('../server/config.mjs');
  patchConfig({ requireToken: true });
  assert.match(desktop.appUrl(), /\?token=/);

  patchConfig({ requireToken: false });
  const semToken = desktop.appUrl();
  assert.ok(!semToken.includes('token'), `sem exigir token o endereço não pode carregar um: ${semToken}`);
  patchConfig({ requireToken: true });
});

test('o atalho aponta pro localhost, nunca pro endereço de rede', () => {
  // O ícone é desta máquina. Apontar pro IP da LAN quebraria assim que o
  // roteador desse outro endereço, e mandaria o token pra fora à toa.
  assert.match(desktop.appUrl(), /^http:\/\/localhost:\d+\//);
});

test('o estado do atalho responde mesmo sem nada instalado', () => {
  const estado = desktop.desktopStatus();
  assert.equal(typeof estado.supported, 'boolean');
  assert.equal(typeof estado.installed, 'boolean');
  if (estado.supported) assert.ok(estado.path, 'suportado tem que dizer onde ficaria');
});

test('a busca por navegador devolve caminho existente, ou nada', () => {
  const browser = desktop.findBrowser();
  if (browser === null) return; // máquina sem Chromium é caso válido
  assert.ok(browser.path && browser.name);
  assert.ok(existsSync(browser.path), `disse que achou mas o caminho não existe: ${browser.path}`);
});
