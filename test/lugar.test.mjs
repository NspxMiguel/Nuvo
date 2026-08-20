// O idioma que o lugar sugere.
//
// O defeito que originou isto: a landing abriu em inglês num navegador aberto
// do Brasil, porque `navigator.languages` responde o idioma do sistema e o
// macOS estava em inglês. O fuso horário responde a pergunta certa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { idiomaDoLugar } from '../web/lugar.js';
import { gerar, DESTINO } from '../build/gerar-lugar.mjs';

test('fuso do Brasil devolve português, mesmo com o sistema em inglês', () => {
  // A função nem olha o navegador: é essa separação que conserta o defeito.
  assert.equal(idiomaDoLugar('America/Sao_Paulo'), 'pt-BR');
  assert.equal(idiomaDoLugar('America/Manaus'), 'pt-BR');
  assert.equal(idiomaDoLugar('America/Noronha'), 'pt-BR');
});

test('português fora do Brasil também conta', () => {
  assert.equal(idiomaDoLugar('Europe/Lisbon'), 'pt-BR');
  assert.equal(idiomaDoLugar('Atlantic/Azores'), 'pt-BR');
  assert.equal(idiomaDoLugar('Africa/Luanda'), 'pt-BR');
  assert.equal(idiomaDoLugar('Asia/Dili'), 'pt-BR');
});

test('a Argentina entra pelo prefixo, não província por província', () => {
  // São mais de dez fusos, um por província, e a lista muda com o tempo.
  assert.equal(idiomaDoLugar('America/Argentina/Buenos_Aires'), 'es');
  assert.equal(idiomaDoLugar('America/Argentina/Ushuaia'), 'es');
  assert.equal(idiomaDoLugar('America/Argentina/Cordoba'), 'es');
});

test('espanhol da Espanha e das Américas', () => {
  for (const zona of ['Europe/Madrid', 'Atlantic/Canary', 'America/Mexico_City',
                      'America/Bogota', 'America/Santiago', 'America/Montevideo']) {
    assert.equal(idiomaDoLugar(zona), 'es', zona);
  }
});

test('fuso de qualquer outro lugar cai no inglês', () => {
  for (const zona of ['America/New_York', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney']) {
    assert.equal(idiomaDoLugar(zona), 'en', zona);
  }
});

test('fuso que não diz nada devolve null, e não um palpite', () => {
  // `Etc/UTC` aparece em servidor e em navegador com proteção de impressão
  // digital ligada. Chutar inglês ali seria pior que perguntar ao navegador,
  // que é o que quem chamou faz quando recebe `null`.
  for (const zona of ['Etc/UTC', 'UTC', 'Etc/GMT+3', '', null, undefined && 'x', 42]) {
    assert.equal(idiomaDoLugar(zona ?? ''), null, String(zona));
  }
});

test('navegador sem Intl não derruba a página', () => {
  const real = globalThis.Intl;
  globalThis.Intl = { DateTimeFormat: () => { throw new Error('sem Intl'); } };
  try {
    assert.equal(idiomaDoLugar(), null);
  } finally {
    globalThis.Intl = real;
  }
});

test('o arquivo do site é o mesmo módulo, gerado', () => {
  // A landing carrega script clássico, então não pode importar o módulo. Duas
  // tabelas de fuso escritas à mão divergiriam na primeira edição de uma só.
  assert.equal(
    readFileSync(DESTINO, 'utf8'),
    gerar(),
    'docs/lugar.js está velho — rode `node build/gerar-lugar.mjs`'
  );
});
