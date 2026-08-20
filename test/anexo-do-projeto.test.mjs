// Anexar arquivo na tela Programar.
//
// O anexo daqui não é o mesmo da conversa: ali o texto é indexado e entra no
// contexto; aqui quem lê é uma IA de terminal, que abre arquivo do disco. Então
// o que o servidor faz é gravar o arquivo dentro da pasta do projeto — e o
// nome do arquivo chega do navegador, que é lugar de onde nada é confiável.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gravarAnexoNoProjeto, PASTA_DE_ANEXOS } from '../server/projeto-arquivos.mjs';

function projeto() {
  return mkdtempSync(join(tmpdir(), 'nuvo-anexo-'));
}

describe('anexo gravado na pasta do projeto', () => {
  test('o arquivo cai na pasta de anexos, com o conteúdo intacto', () => {
    const raiz = projeto();
    const r = gravarAnexoNoProjeto(raiz, 'relatorio.pdf', Buffer.from('conteúdo de verdade'));

    assert.equal(r.caminho, `${PASTA_DE_ANEXOS}/relatorio.pdf`);
    assert.equal(r.bytes, Buffer.from('conteúdo de verdade').length);
    assert.equal(readFileSync(join(raiz, r.caminho), 'utf8'), 'conteúdo de verdade');
    rmSync(raiz, { recursive: true, force: true });
  });

  test('anexar duas vezes o mesmo nome dá dois arquivos', () => {
    // Sobrescrever apagaria justamente o que a pessoa acabou de mandar.
    const raiz = projeto();
    const a = gravarAnexoNoProjeto(raiz, 'nota.txt', Buffer.from('primeiro'));
    const b = gravarAnexoNoProjeto(raiz, 'nota.txt', Buffer.from('segundo'));

    assert.notEqual(a.caminho, b.caminho);
    assert.equal(b.caminho, `${PASTA_DE_ANEXOS}/nota-2.txt`);
    assert.equal(readFileSync(join(raiz, a.caminho), 'utf8'), 'primeiro');
    assert.equal(readFileSync(join(raiz, b.caminho), 'utf8'), 'segundo');
    rmSync(raiz, { recursive: true, force: true });
  });

  test('nome com caminho dentro não escreve fora da pasta do projeto', () => {
    // O nome vem do `?name=` do pedido: é texto de fora, e o navegador não é a
    // única coisa capaz de mandar um pedido pro servidor.
    const raiz = projeto();
    const fora = join(raiz, '..', `roubado-${process.pid}.txt`);
    rmSync(fora, { force: true });

    for (const tentativa of ['../../roubado.txt', `..${'/'}..${'/'}roubado-${process.pid}.txt`,
                             '/etc/passwd', 'C:\\Windows\\System32\\drivers\\etc\\hosts',
                             '..\\..\\roubado.txt']) {
      const r = gravarAnexoNoProjeto(raiz, tentativa, Buffer.from('x'));
      assert.ok(
        r.caminho.startsWith(`${PASTA_DE_ANEXOS}/`),
        `"${tentativa}" saiu como "${r.caminho}"`
      );
      assert.ok(!r.caminho.includes('..'), `"${tentativa}" deixou .. no caminho`);
    }

    assert.equal(existsSync(fora), false, 'escreveu fora da pasta do projeto');
    rmSync(raiz, { recursive: true, force: true });
  });

  test('nome que sobra vazio ainda vira um arquivo', () => {
    const raiz = projeto();
    for (const tentativa of ['', '...', '/', '   ']) {
      const r = gravarAnexoNoProjeto(raiz, tentativa, Buffer.from('x'));
      assert.ok(existsSync(join(raiz, r.caminho)), `"${tentativa}" não gravou nada`);
    }
    rmSync(raiz, { recursive: true, force: true });
  });

  test('arquivo vazio e arquivo grande demais são recusados com motivo', () => {
    const raiz = projeto();
    assert.throws(() => gravarAnexoNoProjeto(raiz, 'nada.txt', Buffer.alloc(0)), /vazio/);
    assert.throws(
      () => gravarAnexoNoProjeto(raiz, 'gigante.bin', Buffer.alloc(26 * 1024 * 1024)),
      /limite por anexo/
    );
    rmSync(raiz, { recursive: true, force: true });
  });

  test('projeto sem pasta escolhida não grava em lugar nenhum', () => {
    // `resolve('')` devolve o diretório de onde o servidor foi aberto: sem esta
    // guarda, o anexo cairia dentro do próprio app.
    assert.throws(() => gravarAnexoNoProjeto('', 'a.txt', Buffer.from('x')), /pasta escolhida/);
    assert.throws(() => gravarAnexoNoProjeto(join(tmpdir(), 'isso-nao-existe-nuvo'), 'a.txt', Buffer.from('x')));
  });

  test('a pasta apontar pra um arquivo é erro, não gravação torta', () => {
    const raiz = projeto();
    const arquivo = join(raiz, 'arquivo.txt');
    writeFileSync(arquivo, 'sou arquivo');
    assert.throws(() => gravarAnexoNoProjeto(arquivo, 'a.txt', Buffer.from('x')), /não é uma pasta/);
    rmSync(raiz, { recursive: true, force: true });
  });

  test('a pasta de anexos é criada mesmo em projeto que nunca teve uma', () => {
    const raiz = projeto();
    mkdirSync(join(raiz, 'src'), { recursive: true });
    assert.equal(existsSync(join(raiz, PASTA_DE_ANEXOS)), false);
    gravarAnexoNoProjeto(raiz, 'novo.txt', Buffer.from('x'));
    assert.ok(existsSync(join(raiz, PASTA_DE_ANEXOS)));
    rmSync(raiz, { recursive: true, force: true });
  });
});
