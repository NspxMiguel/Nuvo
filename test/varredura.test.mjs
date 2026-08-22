// Os doze defeitos que a varredura achou, um teste para cada.
//
// Todos foram confirmados lendo o código e reproduzidos aqui: o que cada um
// cobra é o cenário concreto que estava errado, não a forma do conserto.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useTempHome, cliFalso, collect } from './helpers.mjs';

const lerFonte = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const home = useTempHome();
const { criarProfessor, guardarFoto, verProfessor } = await import('../server/estudos.mjs');
const { semearCartoes, suspenderCartao, fila, responder } = await import('../server/cartoes.mjs');
const { guardarSaida } = await import('../server/estudos.mjs');
const { gerarFormato } = await import('../server/estudos-formatos.mjs');
const { addAttachment } = await import('../server/documents.mjs');
const { run, uid, now, one } = await import('../server/db.mjs');

after(() => home.cleanup());

// --- pastas: lista vazia é "nenhuma", não "todas" --------------------------

function iaDeMentira(espelho) {
  const falso = cliFalso(
    'eco',
    `const fs = require('node:fs');
let e = '';
process.stdin.on('data', (p) => { e += p; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(espelho)}, e);
  process.stdout.write(JSON.stringify({ abertura: 'ok', secoes: [{ titulo: 'a', pontos: ['b'] }] }));
});`
  );
  const id = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, 'eco', 'cli', NULL, NULL, ?, 1, 0, ?)`,
    id,
    JSON.stringify({ command: falso.comando, args: [], stdin: true, models: ['default'] }),
    now()
  );
  return { ref: `${id}:default`, falso };
}

test('desmarcar todas as pastas gera com nenhuma, não com todas', async () => {
  // A tela manda a lista das pastas MARCADAS. Vazia quer dizer "não marquei
  // nenhuma" — e o servidor lia isso como "não filtrei", devolvendo um simulado
  // feito com todo o material do professor.
  const prof = criarProfessor({
    nome: 'Ricardo',
    materia: 'Biologia',
    pastas: [{ nome: 'Aula', tipo: 'material' }]
  });
  await addAttachment({
    buffer: Buffer.from('O ciclo de Krebs acontece na matriz mitocondrial.'),
    name: 'aula.txt',
    mime: 'text/plain',
    pastaId: prof.pastas[0].id,
    papel: 'material'
  });
  const { ref, falso } = iaDeMentira(`${home.dir}/eco-1.txt`);
  try {
    await assert.rejects(
      () => collect(gerarFormato({ professorId: prof.id, tipo: 'resumo', ref, pastas: [], notebooklm: false })),
      (err) => {
        assert.match(err.message, /não há material pra ler/);
        return true;
      }
    );
    // E com a pasta marcada continua gerando, que é o outro lado da moeda.
    const eventos = await collect(
      gerarFormato({ professorId: prof.id, tipo: 'resumo', ref, pastas: [prof.pastas[0].id], notebooklm: false })
    );
    assert.ok(eventos.find((e) => e.type === 'pronto'));
  } finally {
    falso.limpar();
  }
});

// --- cartão suspenso não perde o estado ------------------------------------

test('tirar da suspensão devolve o cartão ao estado que ele tinha', async () => {
  const prof = criarProfessor({ nome: 'Ana', pastas: [{ nome: 'Aula', tipo: 'material' }] });
  const saida = guardarSaida({
    professorId: prof.id,
    tipo: 'flashcards',
    titulo: 'Cartões',
    modelo: 'x',
    fontes: [],
    json: { cartoes: [{ frente: 'a', verso: 'b' }, { frente: 'c', verso: 'd' }] }
  });
  semearCartoes(saida.id);
  const [novo, outro] = fila(prof.id, { limite: 10 });
  assert.equal(novo.estado, 'novo');

  // Cartão nunca visto: suspender e soltar tem que devolver "novo", e não
  // "revisando" — senão ele deixa de ser prioridade na fila.
  suspenderCartao(novo.id, true);
  assert.equal(one('SELECT estado FROM cartoes WHERE id = ?', novo.id).estado, 'suspenso');
  suspenderCartao(novo.id, false);
  assert.equal(one('SELECT estado FROM cartoes WHERE id = ?', novo.id).estado, 'novo');

  // Cartão que errou está "aprendendo": tem que voltar aprendendo.
  responder(outro.id, 1);
  const aprendendo = one('SELECT estado FROM cartoes WHERE id = ?', outro.id).estado;
  assert.equal(aprendendo, 'aprendendo');
  suspenderCartao(outro.id, true);
  suspenderCartao(outro.id, false);
  assert.equal(one('SELECT estado FROM cartoes WHERE id = ?', outro.id).estado, 'aprendendo');

  // Suspender duas vezes não pode gravar 'suspenso' como o estado de volta.
  suspenderCartao(outro.id, true);
  suspenderCartao(outro.id, true);
  suspenderCartao(outro.id, false);
  assert.equal(one('SELECT estado FROM cartoes WHERE id = ?', outro.id).estado, 'aprendendo');
});

// --- foto do professor -----------------------------------------------------

const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6360000002000100' +
    '05fe02fea7b5f4b70000000049454e44ae426082',
  'hex'
);

test('a foto nova só apaga a antiga depois de o banco apontar pra ela', async () => {
  // Ao contrário, um erro no UPDATE deixava o professor apontando pra um
  // arquivo que já não existe: foto quebrada e sem volta.
  const prof = criarProfessor({ nome: 'Foto', pastas: [{ nome: 'Aula', tipo: 'material' }] });
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { UPLOAD_DIR } = await import('../server/config.mjs');

  guardarFoto(prof.id, PNG_1x1);
  const primeira = verProfessor(prof.id).foto;
  assert.ok(existsSync(join(UPLOAD_DIR, primeira)), 'a foto está no disco');
  assert.ok(readFileSync(join(UPLOAD_DIR, primeira)).length, 'e tem conteúdo');

  // Mesma extensão: a antiga é a mesma e não pode ser apagada.
  guardarFoto(prof.id, PNG_1x1);
  assert.equal(verProfessor(prof.id).foto, primeira);
  assert.ok(existsSync(join(UPLOAD_DIR, primeira)), 'trocar por outra igual não deixa o professor sem foto');
});

// --- CMap de comprimento ímpar ---------------------------------------------

test('CMap com hexadecimal torto não faz a letra sumir', async () => {
  // O /ToUnicode de um PDF diz o que cada código da fonte quer dizer. Um gerador
  // desleixado escreve `<41> <ABC>` — três dígitos —, e o laço de quatro em
  // quatro simplesmente não rodava: a função devolvia string vazia e a letra
  // desaparecia do texto sem ninguém saber.
  const { hexParaTexto } = await import('../server/extract.mjs');

  assert.equal(hexParaTexto('0041'), 'A', 'o caso normal continua igual');
  assert.equal(hexParaTexto('41'), 'A', 'um byte só também');
  assert.equal(hexParaTexto('00410042'), 'AB', 'dois de uma vez');

  const torto = hexParaTexto('ABC');
  assert.notEqual(torto, '', 'três dígitos não podem virar nada');
  assert.equal(torto.length, 1);
  assert.equal(torto.charCodeAt(0), 0xabc0, 'completa com zero à direita, como o resto do arquivo faz');

  assert.equal(hexParaTexto('004100').length, 2, 'cinco ou seis dígitos também não somem');
});

// --- erro do provedor em texto puro ----------------------------------------

test('provedor que manda o erro como texto não vira "erro do provedor"', async () => {
  const { createServer } = await import('node:http');
  const { complete } = await import('../server/complete.mjs');
  const { createProvider } = await import('../server/providers/index.mjs');

  const srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // 200 no HTTP e o erro dentro do stream: é assim que LM Studio, llama.cpp e
    // companhia avisam, e o `error` vem como texto puro.
    res.write(`data: ${JSON.stringify({ error: 'modelo não carregado' })}\n\n`);
    res.end();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const p = createProvider({
    name: 'local',
    kind: 'openai',
    baseUrl: `http://127.0.0.1:${srv.address().port}/v1`,
    secretName: null,
    config: { models: ['m'] },
    auto: 0
  });
  try {
    await assert.rejects(() => complete(`${p.id}:m`, { prompt: 'oi' }), (err) => {
      assert.match(err.message, /modelo não carregado/);
      return true;
    });
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
});

// --- a cópia de segurança da restauração não pode ficar legível pra máquina -

test('a cópia do banco feita antes da restauração fica só pro dono', async () => {
  // `copyFileSync` copia a permissão junto. Um banco que tenha nascido 644 daria
  // uma cópia 644 — e a cópia é o banco inteiro: conversa, memória, chave de API.
  const { writeFileSync, chmodSync, statSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { DB_PATH } = await import('../server/config.mjs');
  const { applyPendingRestore } = await import('../server/pending-restore.mjs');

  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(`${DB_PATH}.restaurar`, 'banco novo');
  chmodSync(DB_PATH, 0o644);

  const r = applyPendingRestore();
  assert.equal(r.applied, true);
  assert.ok(r.previous, 'a cópia de segurança existe');
  assert.equal(statSync(r.previous).mode & 0o777, 0o600, 'e ninguém além do dono lê');
});

// --- o navegador avisa quando a página não parou de mudar -------------------

test('passo do navegador diz quando a página ainda estava carregando', () => {
  // `assentar()` devolvia sempre `undefined`: estourar o prazo e assentar de
  // verdade eram indistinguíveis, e o modelo lia meia página achando que era a
  // página inteira.
  const fonte = lerFonte('../server/navegador.mjs');
  assert.match(fonte, /if \(\+\+iguais >= 2\) return true;/, 'assentou devolve true');
  assert.match(fonte, /\n  return false;\n\}/, 'e o estouro do prazo devolve false');
  assert.match(fonte, /const AINDA_CARREGANDO =/, 'existe um aviso pra anexar');
  // Toda chamada tem que usar o retorno: uma que ignore volta a mentir.
  const chamadas = [...fonte.matchAll(/await assentar\(sessao\)/g)].length;
  const usadas = [...fonte.matchAll(/const parou = await assentar\(sessao\)/g)].length;
  assert.equal(usadas, chamadas, 'nenhuma chamada joga fora o resultado');
});
