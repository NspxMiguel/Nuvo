// A pasta de dados mudou de `~/.iaunifier` para `~/.nuvo` quando o app trocou de
// nome. Dentro dela mora tudo que o usuário tem: banco de conversas, chaves de
// API, anexos e o perfil do navegador do agente. Um erro aqui não dá erro na
// tela — o app abre limpo, como se fosse a primeira vez, e o que existia fica
// órfão num diretório oculto.
//
// Estes testes rodam o `casaDoUsuario` de verdade num `HOME` de mentira, um
// cenário por vez.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = fileURLToPath(new URL('../server/config.mjs', import.meta.url));

/**
 * Importa o módulo de configuração com um `HOME` só dele e devolve o DATA_DIR
 * que ele escolheu.
 *
 * Em processo separado de propósito: `DATA_DIR` é resolvido no import, e o
 * módulo já está em cache neste processo — reimportar não recalcularia nada.
 */
function ondeMorou(casa, env = {}) {
  const saida = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const m = await import(${JSON.stringify(CONFIG)}); console.log(m.DATA_DIR);`],
    { env: { ...process.env, HOME: casa, USERPROFILE: casa, NUVO_HOME: '', IAUNIFIER_HOME: '', ...env }, encoding: 'utf8' },
  );
  return saida.trim();
}

function casaLimpa() {
  return mkdtempSync(join(tmpdir(), 'nuvo-mudanca-'));
}

describe('a pasta de dados quando o app trocou de nome', () => {
  test('instalação antiga muda de endereço, com o conteúdo junto', () => {
    const casa = casaLimpa();
    const antiga = join(casa, '.iaunifier');
    mkdirSync(join(antiga, 'uploads'), { recursive: true });
    writeFileSync(join(antiga, 'config.json'), '{"accessToken":"marca-do-usuario"}');
    writeFileSync(join(antiga, 'data.db'), 'banco de verdade');
    writeFileSync(join(antiga, 'uploads', 'anexo.txt'), 'anexo de verdade');

    const escolhida = ondeMorou(casa);

    assert.equal(escolhida, join(casa, '.nuvo'));
    assert.equal(existsSync(antiga), false, 'a pasta antiga não pode ficar para trás');
    // O que importa não é a pasta existir: é o conteúdo ter vindo inteiro.
    assert.equal(readFileSync(join(casa, '.nuvo', 'data.db'), 'utf8'), 'banco de verdade');
    assert.equal(readFileSync(join(casa, '.nuvo', 'uploads', 'anexo.txt'), 'utf8'), 'anexo de verdade');
    assert.match(readFileSync(join(casa, '.nuvo', 'config.json'), 'utf8'), /marca-do-usuario/);
    rmSync(casa, { recursive: true, force: true });
  });

  test('instalação nova nasce direto em .nuvo, sem inventar a pasta antiga', () => {
    const casa = casaLimpa();
    assert.equal(ondeMorou(casa), join(casa, '.nuvo'));
    assert.equal(existsSync(join(casa, '.iaunifier')), false);
    rmSync(casa, { recursive: true, force: true });
  });

  test('com as duas pastas, a nova manda e a antiga fica intocada', () => {
    // Cenário real: alguém rodou a versão nova, voltou para a antiga por um dia
    // e voltou de novo. Sobrescrever a nova com a velha apagaria o que ele fez
    // no meio; apagar a velha jogaria fora a única cópia do que ficou lá.
    const casa = casaLimpa();
    mkdirSync(join(casa, '.iaunifier'), { recursive: true });
    mkdirSync(join(casa, '.nuvo'), { recursive: true });
    writeFileSync(join(casa, '.iaunifier', 'data.db'), 'banco antigo');
    writeFileSync(join(casa, '.nuvo', 'data.db'), 'banco novo');

    assert.equal(ondeMorou(casa), join(casa, '.nuvo'));
    assert.equal(readFileSync(join(casa, '.nuvo', 'data.db'), 'utf8'), 'banco novo');
    assert.equal(readFileSync(join(casa, '.iaunifier', 'data.db'), 'utf8'), 'banco antigo');
    rmSync(casa, { recursive: true, force: true });
  });

  test('IAUNIFIER_HOME continua valendo, para quem tem isso escrito num script', () => {
    const casa = casaLimpa();
    const escolhida = join(casa, 'pasta-de-script');
    assert.equal(ondeMorou(casa, { IAUNIFIER_HOME: escolhida }), escolhida);
    rmSync(casa, { recursive: true, force: true });
  });

  test('NUVO_HOME ganha de IAUNIFIER_HOME quando os dois estão postos', () => {
    const casa = casaLimpa();
    const nova = join(casa, 'nova');
    const antiga = join(casa, 'antiga');
    assert.equal(ondeMorou(casa, { NUVO_HOME: nova, IAUNIFIER_HOME: antiga }), nova);
    rmSync(casa, { recursive: true, force: true });
  });
});
