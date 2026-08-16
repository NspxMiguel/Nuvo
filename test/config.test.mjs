// Configuração e segredos. É aqui que a chave de API do usuário mora, então o
// que se testa é que ela fica guardada, não vaza e não some por acidente.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const config = await import('../server/config.mjs');

after(() => home.cleanup());

test('primeira leitura cria token de acesso e grava no disco', () => {
  const cfg = config.loadConfig();
  assert.ok(cfg.accessToken, 'sem token o app não trancaria nada');
  assert.ok(cfg.accessToken.length >= 20, `token curto demais: ${cfg.accessToken.length} caracteres`);
  assert.equal(cfg.requireToken, true, 'o padrão tem que ser exigir token');

  const salvo = JSON.parse(readFileSync(config.CONFIG_PATH, 'utf8'));
  assert.equal(salvo.accessToken, cfg.accessToken, 'o token tem que sobreviver ao reinício');
});

test('o arquivo de configuração não fica legível pra outros usuários', { skip: platform() === 'win32' }, () => {
  config.loadConfig();
  const modo = statSync(config.CONFIG_PATH).mode & 0o777;
  assert.equal(modo, 0o600, `permissão ${modo.toString(8)} — a chave de API mora nesse arquivo`);
});

test('segredo guardado sai por getSecret e nunca por listSecretNames', () => {
  config.setSecret('MINHA_CHAVE', 'sk-valor-secreto-123');
  assert.equal(config.getSecret('MINHA_CHAVE'), 'sk-valor-secreto-123');

  const nomes = config.listSecretNames();
  assert.ok(nomes.includes('MINHA_CHAVE'));
  assert.ok(
    !JSON.stringify(nomes).includes('sk-valor'),
    'a listagem de nomes não pode carregar o valor junto'
  );
});

test('segredo apagado sai de vez', () => {
  config.setSecret('PRA_APAGAR', 'valor');
  config.setSecret('PRA_APAGAR', '');
  assert.equal(config.getSecret('PRA_APAGAR'), null);
  assert.ok(!config.listSecretNames().includes('PRA_APAGAR'));
});

test('variável de ambiente serve de chave quando não há guardada', () => {
  process.env.CHAVE_DO_AMBIENTE = 'valor-do-ambiente';
  try {
    assert.equal(config.getSecret('CHAVE_DO_AMBIENTE'), 'valor-do-ambiente');
    // O que está guardado ganha do ambiente: foi escolha explícita do usuário.
    config.setSecret('CHAVE_DO_AMBIENTE', 'valor-guardado');
    assert.equal(config.getSecret('CHAVE_DO_AMBIENTE'), 'valor-guardado');
  } finally {
    delete process.env.CHAVE_DO_AMBIENTE;
  }
});

test('getSecret sem nome não explode', () => {
  assert.equal(config.getSecret(null), null);
  assert.equal(config.getSecret(''), null);
  assert.equal(config.getSecret(undefined), null);
});

test('salvar um pedaço da configuração não apaga o resto', () => {
  config.setSecret('SOBREVIVENTE', 'continua aqui');
  const antes = config.loadConfig();

  config.patchConfig({ memory: { maxInjected: 3 } });

  const depois = config.loadConfig();
  assert.equal(depois.memory.maxInjected, 3);
  assert.equal(depois.memory.enabled, antes.memory.enabled, 'o resto da memória tem que ficar');
  assert.equal(depois.accessToken, antes.accessToken, 'o token não pode ser regerado');
  assert.equal(config.getSecret('SOBREVIVENTE'), 'continua aqui', 'a chave não pode sumir');
  assert.equal(depois.limits.stallSeconds, antes.limits.stallSeconds);
});

test('limite salvo pela metade mantém o outro', () => {
  config.patchConfig({ limits: { stallSeconds: 30 } });
  const cfg = config.loadConfig();
  assert.equal(cfg.limits.stallSeconds, 30);
  assert.ok(cfg.limits.firstChunkSeconds > 0, 'o prazo do primeiro pedaço não pode ter virado undefined');
  config.patchConfig({ limits: { stallSeconds: 120 } });
});

test('config.json corrompido não impede o app de subir', async () => {
  writeFileSync(config.CONFIG_PATH, '{isso não é json');
  // O módulo guarda a leitura em cache; a query string força uma instância
  // nova, que lê o arquivo estragado do zero — que é o que acontece no start.
  const { loadConfig } = await import(`../server/config.mjs?corrompido=${process.hrtime.bigint()}`);
  const cfg = loadConfig();
  assert.ok(cfg.accessToken, 'devia ter caído no padrão e gerado token novo');
  assert.equal(cfg.requireToken, true);
  assert.ok(cfg.memory && cfg.limits, 'os padrões inteiros têm que voltar');
});
