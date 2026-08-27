// O idioma de quem nasce antes da tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idiomaDaMaquina } from '../server/idioma.mjs';

function com(env, fn) {
  const antes = { ...process.env };
  for (const k of ['NUVO_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of ['NUVO_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) delete process.env[k];
    Object.assign(process.env, antes);
  }
}

test('o idioma da máquina sai do locale do sistema', () => {
  assert.equal(com({ LANG: 'pt_BR.UTF-8' }, idiomaDaMaquina), 'pt-BR');
  assert.equal(com({ LANG: 'en_US.UTF-8' }, idiomaDaMaquina), 'en');
  assert.equal(com({ LANG: 'es_ES' }, idiomaDaMaquina), 'es');
  assert.equal(com({ LC_ALL: 'es_MX.UTF-8', LANG: 'en_US' }, idiomaDaMaquina), 'es', 'LC_ALL ganha do LANG');
});

test('idioma que o app não fala cai no inglês, não no português', () => {
  // Quem tem a máquina em francês tem mais chance de ler inglês do que
  // português, e o padrão silencioso do resto do código é `pt-BR`.
  assert.equal(com({ LANG: 'fr_FR.UTF-8' }, idiomaDaMaquina), 'en');
  assert.equal(com({ LANG: 'ja_JP' }, idiomaDaMaquina), 'en');
});

test('sem locale nenhum vale o padrão', () => {
  assert.equal(com({}, idiomaDaMaquina), 'pt-BR');
});

test('NUVO_LANG ganha do locale do sistema', () => {
  // É como se confere a tradução sem mexer no idioma da máquina de quem usa.
  assert.equal(com({ NUVO_LANG: 'es', LANG: 'pt_BR.UTF-8' }, idiomaDaMaquina), 'es');
  assert.equal(com({ NUVO_LANG: 'en', LANG: 'pt_BR.UTF-8' }, idiomaDaMaquina), 'en');
});
