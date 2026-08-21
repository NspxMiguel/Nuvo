// As duas mãos: o NotebookLM lê o material e a IA escolhida reescreve com o
// retrato por cima.
//
// A tela do Google não entra na suíte — ela muda sem avisar e exigiria conta.
// O que entra é o contrato entre as duas mãos: que o rascunho chega inteiro na
// segunda, que o retrato entra no pedido, e que o NotebookLM caindo não derruba
// a geração.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome, cliFalso, collect } from './helpers.mjs';

const home = useTempHome();
const { gerarFormato } = await import('../server/estudos-formatos.mjs');
const { criarProfessor } = await import('../server/estudos.mjs');
const { addAttachment } = await import('../server/documents.mjs');
const { run, uid, now } = await import('../server/db.mjs');

after(() => home.cleanup());

const RESPOSTA = `Notebook
<<<NUVO_PEDIDO_FIM>>>
carregando
<<<NUVO_RESPOSTA_INICIO>>>
RASCUNHO DO NOTEBOOKLM: a célula usa ATP como moeda de energia.
<<<NUVO_RESPOSTA_FIM>>>`;

/** A sessão CDP de mentira, a mesma de `notebooklm.test.mjs`. */
class SessaoFalsa {
  constructor({ fora = false } = {}) {
    this.fora = fora;
  }

  async cmd(method) {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [17] };
    return {};
  }

  async avaliar(expressao) {
    if (expressao.includes('nuvo:notebooklm:conta')) {
      return { fora: this.fora, criar: this.fora ? 0 : 1, pronta: true };
    }
    if (expressao.includes('nuvo:notebooklm:clicar')) return { ok: true, nome: 'ação esperada' };
    if (expressao.includes('nuvo:notebooklm:upload')) return { arquivos: 1, botoes: 0 };
    if (expressao.includes('nuvo:notebooklm:notebook')) return { fontes: true, campos: 1, fora: false };
    if (expressao.includes('nuvo:notebooklm:preencher')) return true;
    if (expressao.includes('nuvo:notebooklm:corpo')) return RESPOSTA;
    throw new Error('expressão inesperada no teste');
  }
}

/**
 * Uma IA de terminal que grava o pedido que recebeu e devolve um resumo válido.
 * O arquivo de espelho é como o teste enxerga o que foi parar no prompt.
 */
function iaDeMentira(espelho) {
  const falso = cliFalso(
    'resumidor',
    `const fs = require('node:fs');
let entrada = '';
process.stdin.on('data', (p) => { entrada += p; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(espelho)}, entrada);
  process.stdout.write(JSON.stringify({
    abertura: 'O material trata do metabolismo energético da célula.',
    secoes: [{ titulo: 'ATP', pontos: ['A célula usa ATP como moeda de energia.'] }],
    termos: [{ termo: 'ATP', definicao: 'a moeda de energia da célula' }]
  }));
});`
  );
  const id = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, 'IA de mentira', 'cli', NULL, NULL, ?, 1, 0, ?)`,
    id,
    JSON.stringify({ command: falso.comando, args: [], stdin: true, models: ['default'] }),
    now()
  );
  return { ref: `${id}:default`, falso };
}

const RETRATO = {
  versao: 1,
  formato: { n_questoes: 8, tipos: [{ tipo: 'discursiva', peso: 0.6 }] },
  conteudo: [{ tema: 'respiração celular', peso: 0.33 }],
  cognitivo: [{ nivel: 'aplicar', peso: 0.4 }],
  verbos: [{ verbo: 'justifique', vezes: 6 }],
  manias: ['sempre pede exemplo do cotidiano']
};

async function palco({ comRetrato = true } = {}) {
  const prof = criarProfessor({
    nome: 'Ricardo Alves',
    materia: 'Biologia',
    pastas: [{ nome: 'Material da aula', tipo: 'material' }]
  });
  if (comRetrato) {
    run('UPDATE professores SET retrato = ? WHERE id = ?', JSON.stringify(RETRATO), prof.id);
  }
  await addAttachment({
    buffer: Buffer.from('Aula 1: glicólise. Aula 2: ciclo de Krebs. Aula 3: cadeia de elétrons.'),
    name: 'caderno.txt',
    mime: 'text/plain',
    pastaId: prof.pastas[0].id,
    papel: 'material'
  });
  return prof;
}

test('o rascunho do NotebookLM chega inteiro na segunda mão', async () => {
  const prof = await palco();
  const espelho = join(home.dir, 'pedido-1.txt');
  const { ref, falso } = iaDeMentira(espelho);
  try {
    const eventos = await collect(
      gerarFormato({ professorId: prof.id, tipo: 'resumo', ref, sessao: new SessaoFalsa() })
    );

    // O `for await` de antes não enxergava o `return` do gerador, e o texto do
    // NotebookLM nunca chegava: toda geração morria em "não devolveu nada".
    const pedido = readFileSync(espelho, 'utf8');
    assert.match(pedido, /RASCUNHO DO NOTEBOOKLM/);
    assert.match(pedido, /Rascunho \(leitura do material feita pelo NotebookLM\)/);

    const inicio = eventos.find((e) => e.type === 'start');
    assert.equal(inicio.rascunho, 'NotebookLM');
    assert.ok(inicio.toque, 'a segunda mão aparece no evento de abertura');
    assert.equal(eventos.find((e) => e.type === 'etapa').o_que, 'toque');

    const pronto = eventos.find((e) => e.type === 'pronto');
    assert.equal(pronto.saida.modelo, `notebooklm+${ref}`);
    assert.match(pronto.saida.json.abertura, /metabolismo energético/);
  } finally {
    falso.limpar();
  }
});

test('com retrato, a segunda mão recebe a ordem de imitar o professor', async () => {
  const prof = await palco();
  const espelho = join(home.dir, 'pedido-2.txt');
  const { ref, falso } = iaDeMentira(espelho);
  try {
    await collect(gerarFormato({ professorId: prof.id, tipo: 'resumo', ref, sessao: new SessaoFalsa() }));
    const pedido = readFileSync(espelho, 'utf8');
    assert.match(pedido, /respiração celular/, 'o peso do tema entra no pedido');
    assert.match(pedido, /justifique/, 'e os verbos de comando dele');
    assert.match(pedido, /sempre pede exemplo do cotidiano/, 'e as manias');
  } finally {
    falso.limpar();
  }
});

test('sem retrato, o pedido manda não inventar estilo — e gera assim mesmo', async () => {
  const prof = await palco({ comRetrato: false });
  const espelho = join(home.dir, 'pedido-3.txt');
  const { ref, falso } = iaDeMentira(espelho);
  try {
    const eventos = await collect(
      gerarFormato({ professorId: prof.id, tipo: 'resumo', ref, sessao: new SessaoFalsa() })
    );
    assert.equal(eventos.find((e) => e.type === 'start').retrato, false);
    assert.ok(eventos.find((e) => e.type === 'pronto'), 'gerar sem retrato continua possível');
    assert.match(readFileSync(espelho, 'utf8'), /nada de inventar mania nem estilo dele/);
  } finally {
    falso.limpar();
  }
});

test('NotebookLM fora do ar não derruba a geração: a segunda mão lê o material', async () => {
  const prof = await palco();
  const espelho = join(home.dir, 'pedido-4.txt');
  const { ref, falso } = iaDeMentira(espelho);
  try {
    const eventos = await collect(
      gerarFormato({
        professorId: prof.id,
        tipo: 'resumo',
        ref,
        sessao: new SessaoFalsa({ fora: true })
      })
    );

    const aviso = eventos.find((e) => e.type === 'passo' && /não respondeu/.test(e.o_que || ''));
    assert.ok(aviso, 'a tela fica sabendo que o NotebookLM caiu');
    assert.equal(eventos.find((e) => e.type === 'etapa').o_que, 'sozinho');

    const pedido = readFileSync(espelho, 'utf8');
    assert.match(pedido, /ciclo de Krebs/, 'o material foi lido aqui mesmo');
    assert.doesNotMatch(pedido, /RASCUNHO DO NOTEBOOKLM/);
    assert.equal(eventos.find((e) => e.type === 'pronto').saida.modelo, ref);
  } finally {
    falso.limpar();
  }
});

test('pedido com notebooklm desligado nem tenta abrir a tela do Google', async () => {
  const prof = await palco();
  const espelho = join(home.dir, 'pedido-5.txt');
  const { ref, falso } = iaDeMentira(espelho);
  try {
    const eventos = await collect(
      gerarFormato({ professorId: prof.id, tipo: 'resumo', ref, notebooklm: false })
    );
    assert.equal(eventos.find((e) => e.type === 'start').rascunho, null);
    assert.equal(eventos.find((e) => e.type === 'etapa').o_que, 'sozinho');
    assert.ok(existsSync(espelho));
  } finally {
    falso.limpar();
  }
});
