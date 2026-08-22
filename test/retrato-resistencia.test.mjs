// O retrato quando o mundo não colabora: cota estourada no meio, uma prova que
// o modelo não consegue ler, e a segunda tentativa depois de tudo isso.
//
// Nenhum destes testes chama modelo: a IA é um CLI de mentira que responde o
// que o teste mandar, inclusive falhar.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome, cliFalso, collect } from './helpers.mjs';

const home = useTempHome();
const { montarRetrato } = await import('../server/retrato.mjs');
const { criarProfessor, leituraGuardada } = await import('../server/estudos.mjs');
const { addAttachment } = await import('../server/documents.mjs');
const { run, uid, now, all } = await import('../server/db.mjs');

after(() => home.cleanup());

const LEITURA = {
  questoes: [
    { n: 1, enunciado: 'Defina respiração celular.', formato: 'discursiva', tema: 'respiração celular', nivel: 'lembrar', verbo: 'defina', pontos: 1, citacao: 'Defina respiração celular.' }
  ],
  n_questoes: 1,
  pontuacao: '10 pontos'
};
const RETRATO = {
  formato: { n_questoes: 8, tipos: [{ tipo: 'discursiva', peso: 1 }], pontuacao: '10 pontos' },
  conteudo: [{ tema: 'respiração celular', peso: 1, apareceu_em: ['A1'], citacao: 'Defina respiração celular.' }],
  cognitivo: [{ nivel: 'lembrar', peso: 1 }],
  verbos: [{ verbo: 'defina', vezes: 1, exemplo: 'Defina…' }],
  manias: ['pede definição antes de aplicar']
};

/**
 * Uma IA de terminal que segue um roteiro: cada chamada consome uma linha do
 * arquivo de roteiro — `ok` devolve a leitura, `retrato` devolve a síntese, e
 * qualquer outra coisa é escrita em stderr com saída 1.
 */
function iaComRoteiro(roteiro, passos) {
  writeFileSync(roteiro, passos.join('\n'));
  const falso = cliFalso(
    'roteirista',
    `const fs = require('node:fs');
const arq = ${JSON.stringify(roteiro)};
const passos = fs.readFileSync(arq, 'utf8').split('\\n').filter(Boolean);
const agora = passos.shift() || 'falha';
fs.writeFileSync(arq, passos.join('\\n'));
process.stdin.resume();
process.stdin.on('end', () => {
  if (agora === 'ok') process.stdout.write(${JSON.stringify(JSON.stringify(LEITURA))});
  else if (agora === 'retrato') process.stdout.write(${JSON.stringify(JSON.stringify(RETRATO))});
  else { process.stderr.write('a IA caiu'); process.exit(1); }
});`
  );
  const id = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, 'IA de roteiro', 'cli', NULL, NULL, ?, 1, 0, ?)`,
    id,
    JSON.stringify({ command: falso.comando, args: [], stdin: true, models: ['default'] }),
    now()
  );
  return { ref: `${id}:default`, falso };
}

async function palco(quantas = 3) {
  const prof = criarProfessor({
    nome: 'Ricardo Alves',
    materia: 'Biologia',
    pastas: Array.from({ length: quantas }, (_, i) => ({ nome: `Prova ${i + 1}`, tipo: 'prova' }))
  });
  for (const [i, pasta] of prof.pastas.entries()) {
    await addAttachment({
      buffer: Buffer.from(`PROVA ${i + 1}\n1) Defina respiração celular e cite as etapas.`),
      name: `prova-${i + 1}.txt`,
      mime: 'text/plain',
      pastaId: pasta.id,
      papel: 'prova'
    });
  }
  return prof;
}

test('uma prova que a IA não consegue ler não derruba as outras', async () => {
  const prof = await palco(3);
  const { ref, falso } = iaComRoteiro(join(home.dir, 'roteiro-1.txt'), ['ok', 'falha', 'ok', 'retrato']);
  try {
    const eventos = await collect(montarRetrato({ professorId: prof.id, ref }));
    const lidas = eventos.filter((e) => e.type === 'lida');
    const puladas = eventos.filter((e) => e.type === 'pulada');
    assert.equal(lidas.length, 2, 'as duas que deram certo entraram');
    assert.equal(puladas.length, 1, 'a que falhou saiu com motivo');
    assert.match(puladas[0].porque, /caiu|1|erro|falh/i);
    const pronto = eventos.find((e) => e.type === 'retrato');
    assert.ok(pronto, 'o retrato sai mesmo com uma prova de fora');
    assert.equal(pronto.retrato.confianca.provas, 2);
  } finally {
    falso.limpar();
  }
});

test('a leitura de cada prova fica guardada, e trocar de modelo não reaproveita', async () => {
  const prof = await palco(2);
  const roteiro = join(home.dir, 'roteiro-2.txt');
  // Primeira rodada: lê as duas e cai na síntese — é o caso da cota diária, em
  // que quatro minutos de leitura iam pro lixo.
  const um = iaComRoteiro(roteiro, ['ok', 'ok', 'falha', 'falha']);
  await assert.rejects(() => collect(montarRetrato({ professorId: prof.id, ref: um.ref })));
  um.falso.limpar();

  const guardadas = all(
    'SELECT leitura_chave FROM estudo_pastas WHERE professor_id = ? AND leitura IS NOT NULL',
    prof.id
  );
  assert.equal(guardadas.length, 2, 'as duas leituras ficaram no armário');

  // Outro provedor é outro `ref`, e a chave muda junto: dar a leitura de um
  // modelo com o nome de outro seria mentira no campo "modelo" do retrato.
  const dois = iaComRoteiro(join(home.dir, 'roteiro-2b.txt'), ['ok', 'ok', 'retrato']);
  const eventos = await collect(montarRetrato({ professorId: prof.id, ref: dois.ref }));
  assert.equal(eventos.filter((e) => e.type === 'lida' && e.guardada).length, 0, 'modelo diferente relê');
  assert.equal(eventos.filter((e) => e.type === 'lida').length, 2, 'e relê as duas');
  dois.falso.limpar();
});

test('mesma IA e mesma fonte: a segunda tentativa não relê nada', async () => {
  const prof = await palco(2);
  const roteiro = join(home.dir, 'roteiro-3.txt');
  const ia = iaComRoteiro(roteiro, ['ok', 'ok', 'falha', 'falha']);
  await assert.rejects(() => collect(montarRetrato({ professorId: prof.id, ref: ia.ref })));

  // Mesmo `ref`: as duas leituras valem, e o único passo que sobra é a síntese.
  writeFileSync(roteiro, 'retrato');
  const eventos = await collect(montarRetrato({ professorId: prof.id, ref: ia.ref }));
  const reaproveitadas = eventos.filter((e) => e.type === 'lida' && e.guardada);
  assert.equal(reaproveitadas.length, 2, 'as duas vieram do armário');
  assert.ok(eventos.find((e) => e.type === 'retrato'), 'e o retrato saiu');
  ia.falso.limpar();
});

test('a leitura guardada não vaza pra tela', async () => {
  const prof = await palco(1);
  const ia = iaComRoteiro(join(home.dir, 'roteiro-4.txt'), ['ok', 'retrato']);
  try {
    await collect(montarRetrato({ professorId: prof.id, ref: ia.ref }));
    const { verProfessor } = await import('../server/estudos.mjs');
    const visto = verProfessor(prof.id);
    assert.equal(visto.pastas[0].leitura, undefined, 'JSON de trabalho não vai pro cliente');
    assert.ok(leituraGuardada(visto.pastas[0].id, 'chave-errada') === null, 'chave errada não devolve leitura');
  } finally {
    ia.falso.limpar();
  }
});
