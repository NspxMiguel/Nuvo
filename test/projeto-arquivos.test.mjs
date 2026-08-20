// A pasta do projeto vista pelo painel de programar: o que entra na árvore, o
// que é recusado na leitura e o que o git tem a dizer. A pasta de teste é
// montada de verdade no disco — o defeito que interessa aqui (caminho que
// escapa da raiz, arquivo binário, corte no meio de um acento) só aparece com
// arquivo de verdade, não com `fs` encenado.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { arvoreDoProjeto, lerArquivoDoProjeto, mudancasDoProjeto } from '../server/projeto-arquivos.mjs';

// A raiz do projeto fica DENTRO de outra pasta de propósito: `fora.txt` e
// `projeto-vizinho` são os alvos dos testes de fuga.
const TOPO = mkdtempSync(join(tmpdir(), 'nuvo-projeto-'));
const RAIZ = join(TOPO, 'projeto');

after(() => {
  try {
    rmSync(TOPO, { recursive: true, force: true });
  } catch {
    /* o sistema limpa o tmp depois */
  }
});

function escrever(base, relativo, conteudo) {
  const caminho = join(base, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
  return caminho;
}

writeFileSync(join(TOPO, 'fora.txt'), 'segredo do vizinho');
escrever(TOPO, join('projeto-vizinho', 'x.txt'), 'do vizinho de nome parecido');

escrever(RAIZ, 'LEIAME.MD', '# projeto\n');
escrever(RAIZ, 'LICENSE', 'MIT\n');
escrever(RAIZ, 'soma.mjs', 'export const soma = (a, b) => a + b;\n');
escrever(RAIZ, 'acentos.txt', 'é'.repeat(50));
escrever(RAIZ, join('sub', 'nota.md'), 'nota\n');
escrever(RAIZ, join('sub', 'mais', 'fundo.txt'), 'fundo\n');
// Um byte a mais que o teto de 2 MB.
escrever(RAIZ, 'grande.log', Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
// PNG de mentira: o que importa é o byte zero logo no começo.
escrever(RAIZ, 'imagem.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x1a, 0x0a, 0x41]));

for (const gerada of ['node_modules', 'dist', 'build', 'out', '.venv', '__pycache__', '.git', '.oculta']) {
  escrever(RAIZ, join(gerada, 'peso.js'), 'não é do projeto\n');
}

const ESPERADOS = [
  'LEIAME.MD',
  'LICENSE',
  'acentos.txt',
  'imagem.png',
  'soma.mjs',
  'sub/mais/fundo.txt',
  'sub/nota.md'
];

test('a árvore lista só os arquivos do projeto, em ordem e com barra pra frente', () => {
  const arvore = arvoreDoProjeto(RAIZ);
  assert.deepEqual(
    arvore.arquivos.map((a) => a.caminho),
    ESPERADOS
  );
  assert.equal(arvore.cortado, false);
  assert.equal(arvore.raiz, resolve(RAIZ));
  // A tela usa o caminho como chave; barra invertida do Windows viraria uma
  // chave que nunca casa com a pedida na leitura.
  assert.ok(!arvore.arquivos.some((a) => a.caminho.includes('\\')));
});

test('pasta gerada, pasta de ambiente e pasta com ponto ficam de fora', () => {
  const caminhos = arvoreDoProjeto(RAIZ).arquivos.map((a) => a.caminho);
  for (const gerada of ['node_modules', 'dist', 'build', 'out', '.venv', '__pycache__', '.git', '.oculta']) {
    assert.ok(
      !caminhos.some((c) => c.startsWith(`${gerada}/`)),
      `${gerada} não devia estar na árvore`
    );
  }
});

test('arquivo acima de 2 MB não entra na árvore', () => {
  assert.ok(statSync(join(RAIZ, 'grande.log')).size > 2 * 1024 * 1024, 'o arquivo grande tinha que existir');
  assert.ok(!arvoreDoProjeto(RAIZ).arquivos.some((a) => a.caminho === 'grande.log'));
});

test('tipo é a extensão sem ponto, em minúscula, e vazia quando não tem', () => {
  const porNome = new Map(arvoreDoProjeto(RAIZ).arquivos.map((a) => [a.caminho, a]));
  assert.equal(porNome.get('soma.mjs').tipo, 'mjs');
  assert.equal(porNome.get('LEIAME.MD').tipo, 'md');
  assert.equal(porNome.get('LICENSE').tipo, '');
  assert.equal(porNome.get('sub/nota.md').tipo, 'md');
});

test('bytes de cada arquivo são os do disco', () => {
  const soma = arvoreDoProjeto(RAIZ).arquivos.find((a) => a.caminho === 'soma.mjs');
  assert.equal(soma.bytes, statSync(join(RAIZ, 'soma.mjs')).size);
});

test('o limite corta a lista e a resposta avisa que cortou', () => {
  const cortada = arvoreDoProjeto(RAIZ, { limite: 3 });
  assert.equal(cortada.arquivos.length, 3);
  assert.equal(cortada.cortado, true);
  // O corte é sempre o mesmo pedaço: a varredura anda em ordem alfabética, não
  // na ordem que o disco entregou.
  assert.deepEqual(
    cortada.arquivos.map((a) => a.caminho),
    ESPERADOS.slice(0, 3)
  );
  assert.deepEqual(arvoreDoProjeto(RAIZ, { limite: 3 }).arquivos, cortada.arquivos);
});

test('limite igual ao número de arquivos não conta como cortado', () => {
  const arvore = arvoreDoProjeto(RAIZ, { limite: ESPERADOS.length });
  assert.equal(arvore.arquivos.length, ESPERADOS.length);
  assert.equal(arvore.cortado, false);
});

test('pasta inexistente e pasta vazia viram erro em português', () => {
  assert.throws(() => arvoreDoProjeto(join(TOPO, 'nao-existe')), /não achei a pasta/);
  assert.throws(() => arvoreDoProjeto(''), /pasta escolhida/);
  assert.throws(() => arvoreDoProjeto(null), /pasta escolhida/);
  assert.throws(() => arvoreDoProjeto(join(RAIZ, 'soma.mjs')), /não é uma pasta/);
});

test('leitura devolve o texto, o tamanho e o caminho relativo', () => {
  const lido = lerArquivoDoProjeto(RAIZ, 'sub/nota.md');
  assert.equal(lido.caminho, 'sub/nota.md');
  assert.equal(lido.texto, 'nota\n');
  assert.equal(lido.bytes, 5);
  assert.equal(lido.truncado, false);
  assert.equal(lido.binario, false);
});

test('caminho que escapa da raiz é recusado', () => {
  // O arquivo existe e é legível: a recusa é sobre a fronteira, não sobre falta
  // de arquivo — senão o teste passaria mesmo com a contenção quebrada.
  assert.equal(readFileSync(join(TOPO, 'fora.txt'), 'utf8'), 'segredo do vizinho');

  for (const tentativa of [
    '../fora.txt',
    './sub/../../fora.txt',
    'sub/mais/../../../fora.txt',
    join(TOPO, 'fora.txt'),
    '..',
    // Pasta vizinha de nome parecido: comparar com a raiz sem a barra deixaria
    // `/tmp/x/projeto-vizinho` passar por "dentro de /tmp/x/projeto".
    '../projeto-vizinho/x.txt'
  ]) {
    assert.throws(
      () => lerArquivoDoProjeto(RAIZ, tentativa),
      /fora da pasta do projeto/,
      `devia recusar ${tentativa}`
    );
  }
});

test('link simbólico não é atalho pra fora da pasta do projeto', () => {
  // As outras seis fugas testadas aqui são de texto (`../`, caminho absoluto,
  // vizinho de nome parecido) e o `resolve` as pega. Link simbólico não: ele é
  // do sistema de arquivos, o `resolve` não o enxerga, e o `openSync` seguia
  // direto. Com `ln -s /etc projeto/etc-link`, a tela abria `/etc/hosts`; num
  // repositório clonado com link pra `~/.ssh`, abria a chave privada.
  const alvo = join(TOPO, 'fora.txt');
  const paraArquivo = join(RAIZ, 'link-arquivo');
  const paraPasta = join(RAIZ, 'link-pasta');
  try {
    symlinkSync(alvo, paraArquivo);
    symlinkSync(TOPO, paraPasta);
  } catch {
    // Windows sem permissão de criar link: o defeito não existe lá do mesmo
    // jeito, e recusar o teste é melhor que fingir que ele rodou.
    return;
  }
  try {
    assert.throws(
      () => lerArquivoDoProjeto(RAIZ, 'link-arquivo'),
      /fora da pasta do projeto/,
      'link pra arquivo de fora'
    );
    assert.throws(
      () => lerArquivoDoProjeto(RAIZ, join('link-pasta', 'fora.txt')),
      /fora da pasta do projeto/,
      'link pra pasta de fora'
    );
    // O que é link mas aponta pra dentro continua funcionando: recusar tudo que
    // é link quebraria projeto que usa link entre as próprias pastas.
    const paraDentro = join(RAIZ, 'link-soma');
    symlinkSync(join(RAIZ, 'soma.mjs'), paraDentro);
    assert.match(lerArquivoDoProjeto(RAIZ, 'link-soma').texto, /export const soma/);
    unlinkSync(paraDentro);
  } finally {
    unlinkSync(paraArquivo);
    unlinkSync(paraPasta);
  }
});

test('caminho de dentro que não existe dá erro diferente do de fuga', () => {
  assert.throws(() => lerArquivoDoProjeto(RAIZ, 'sub/nao-existe.md'), /não existe na pasta/);
  assert.throws(() => lerArquivoDoProjeto(RAIZ, 'sub'), /não é um arquivo/);
});

test('binário volta marcado e sem texto', () => {
  const lido = lerArquivoDoProjeto(RAIZ, 'imagem.png');
  assert.equal(lido.binario, true);
  assert.equal(lido.texto, '');
  assert.equal(lido.bytes, 9);
  assert.equal(lido.truncado, false);
});

test('arquivo maior que o limite volta cortado', () => {
  const lido = lerArquivoDoProjeto(RAIZ, 'soma.mjs', { limiteBytes: 10 });
  assert.equal(lido.truncado, true);
  assert.equal(lido.texto, 'export con');
  // `bytes` é o tamanho de verdade, não o do pedaço: a tela mostra quanto ficou
  // de fora.
  assert.equal(lido.bytes, statSync(join(RAIZ, 'soma.mjs')).size);
});

test('corte no meio de um acento não estraga o resto do arquivo', () => {
  // 11 bytes cortam cinco "é" inteiros e deixam meio sexto. Sem tirar o byte
  // sobrando, o decodificador desiste do UTF-8 e relê tudo como windows-1252 —
  // o arquivo chega na tela com todo acento trocado por causa de um byte.
  const lido = lerArquivoDoProjeto(RAIZ, 'acentos.txt', { limiteBytes: 11 });
  assert.equal(lido.texto, 'é'.repeat(5));
  assert.equal(lido.truncado, true);
  assert.ok(!lido.texto.includes('�'));
  assert.ok(!lido.texto.includes('Ã'));
});

test('arquivo inteiro cabe quando o limite é maior que ele', () => {
  const lido = lerArquivoDoProjeto(RAIZ, 'acentos.txt');
  assert.equal(lido.texto, 'é'.repeat(50));
  assert.equal(lido.bytes, 100);
  assert.equal(lido.truncado, false);
});

test('pasta sem git responde que não tem git, e diz que o motivo é esse', async () => {
  // O motivo importa: a tela escreve uma frase por caso, e antes ela dizia
  // "esta pasta não é um repositório do git" pra prazo estourado e pra git não
  // instalado também — afirmação categórica e falsa sobre o projeto de quem
  // está olhando.
  const r = await mudancasDoProjeto(RAIZ);
  assert.equal(r.git, false);
  assert.deepEqual(r.arquivos, []);
  assert.equal(r.motivo, 'sem-repositorio');
});

test('pasta que não existe também responde que não tem git', async () => {
  for (const raiz of [join(TOPO, 'nao-existe'), '']) {
    const r = await mudancasDoProjeto(raiz);
    assert.equal(r.git, false);
    assert.deepEqual(r.arquivos, []);
    // Pasta que não existe não é "não é repositório": é falha de outra ordem, e
    // a tela precisa poder dizer outra coisa.
    assert.equal(r.motivo, 'falhou');
  }
});

test('num repositório de verdade, cada código do git vira um estado da tela', async (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'nuvo-repo-'));
  try {
    try {
      const git = (...args) =>
        execFileSync('git', ['-C', repo, '-c', 'user.email=teste@exemplo', '-c', 'user.name=Teste', '-c', 'commit.gpgsign=false', ...args], {
          stdio: 'ignore'
        });
      git('init', '-q');
      writeFileSync(join(repo, 'a.txt'), 'um\n');
      writeFileSync(join(repo, 'b.txt'), 'dois\n');
      writeFileSync(join(repo, 'f.txt'), 'seis\n');
      mkdirSync(join(repo, 'sub'));
      writeFileSync(join(repo, 'sub', 'd.txt'), 'quatro\n');
      git('add', '-A');
      git('commit', '-qm', 'primeiro');

      writeFileSync(join(repo, 'a.txt'), 'um, mexido\n');
      unlinkSync(join(repo, 'b.txt'));
      writeFileSync(join(repo, 'c.txt'), 'três\n');
      git('mv', 'f.txt', 'g.txt');
      writeFileSync(join(repo, 'sub', 'e.txt'), 'cinco\n');
    } catch (err) {
      // Sem git nesta máquina não há o que provar; o caminho "não é repositório"
      // já está coberto pelo teste acima.
      return t.skip(`sem git utilizável: ${err.message}`);
    }

    const mudancas = await mudancasDoProjeto(repo);
    assert.equal(mudancas.git, true);
    assert.deepEqual(mudancas.arquivos, [
      { caminho: 'a.txt', estado: 'mudou' },
      { caminho: 'b.txt', estado: 'apagado' },
      { caminho: 'c.txt', estado: 'novo' },
      // Renomear vira as duas coisas que aconteceram na pasta: o nome antigo
      // sumiu e o novo apareceu. O vocabulário da tela não tem "renomeado".
      { caminho: 'f.txt', estado: 'apagado' },
      { caminho: 'g.txt', estado: 'novo' },
      { caminho: 'sub/e.txt', estado: 'novo' }
    ]);

    // Projeto apontado pra uma subpasta do repositório: o git devolve o caminho
    // relativo à raiz dele (`sub/e.txt`), e sem a conversão nada casaria com a
    // chave da árvore, que aqui é `e.txt`.
    const daSubpasta = await mudancasDoProjeto(join(repo, 'sub'));
    assert.equal(daSubpasta.git, true);
    assert.deepEqual(daSubpasta.arquivos, [{ caminho: 'e.txt', estado: 'novo' }]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('pedido cancelado não levanta, e o motivo diz que foi cancelamento', async () => {
  const controle = new AbortController();
  controle.abort();
  const r = await mudancasDoProjeto(RAIZ, { signal: controle.signal });
  assert.equal(r.git, false);
  assert.deepEqual(r.arquivos, []);
  assert.equal(r.motivo, 'cancelado');
});
