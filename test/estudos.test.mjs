// Estudos: o armário dos professores.
//
// O que estes testes protegem é a separação que sustenta a ideia toda — prova,
// conteúdo cobrado por ela e material de aula são coisas diferentes, e o retrato
// só vale se elas não se misturarem no caminho.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const estudos = await import('../server/estudos.mjs');
const { addAttachment, listAttachments, recallChunks } = await import('../server/documents.mjs');
const { all, one } = await import('../server/db.mjs');

after(() => home.cleanup());

const anexar = (pastaId, papel, nome, texto) =>
  addAttachment({ buffer: Buffer.from(texto), name: nome, mime: 'text/plain', pastaId, papel });

test('professor nasce com a caixa de material que não é prova', () => {
  const p = estudos.criarProfessor({ nome: 'Marcos', materia: 'Biologia' });
  assert.equal(p.nome, 'Marcos');
  assert.equal(p.pastas.length, 1);
  assert.equal(p.pastas[0].tipo, 'material');
});

test('professor sem nome é recusado, e com o código certo', () => {
  try {
    estudos.criarProfessor({ nome: '   ' });
    assert.fail('devia ter recusado');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.match(err.message, /nome/);
  }
});

test('professor que não existe é 404, não 500', () => {
  try {
    estudos.verProfessor('ninguem');
    assert.fail('devia ter recusado');
  } catch (err) {
    assert.equal(err.status, 404);
  }
});

test('as pastas da primeira vez vêm de quem chamou, no idioma dele', () => {
  // O servidor não tem `t()`: semear "1º trimestre" aqui apareceria em português
  // pra quem lê o app em inglês.
  const p = estudos.criarProfessor({
    nome: 'Ana',
    organizacao: 'periodo',
    pastas: [
      { nome: '1st term · A1', tipo: 'prova' },
      { nome: '1st term · A2', tipo: 'prova' },
      { nome: 'Class material', tipo: 'material' }
    ]
  });
  assert.equal(p.organizacao, 'periodo');
  assert.deepEqual(
    p.pastas.map((x) => x.nome),
    ['1st term · A1', '1st term · A2', 'Class material']
  );
  assert.equal(p.pastas.filter((x) => x.tipo === 'prova').length, 2);
});

test('organização desconhecida cai em pastas, não explode', () => {
  const p = estudos.criarProfessor({ nome: 'Zé', organizacao: 'sei-la' });
  assert.equal(p.organizacao, 'pastas');
});

test('a prova e o conteúdo dela convivem na mesma pasta sem se confundir', async () => {
  const p = estudos.criarProfessor({ nome: 'Célia', materia: 'História' });
  const pasta = estudos.criarPasta(p.id, { nome: 'A1 1º tri', tipo: 'prova' });

  await anexar(pasta.id, 'prova', 'a1.txt', 'Questão 1. Justifique a Revolução Francesa.');
  await anexar(pasta.id, 'conteudo', 'materia-a1.txt', 'Revolução Francesa: causas, etapas e consequências.');

  const visto = estudos.verProfessor(p.id);
  const caixa = visto.pastas.find((x) => x.id === pasta.id);
  assert.equal(caixa.contagem.prova, 1);
  assert.equal(caixa.contagem.conteudo, 1);
  assert.equal(visto.material.provas, 1);
  assert.equal(visto.material.conteudos, 1);
});

test('dá pra pedir só as provas, sem arrastar o conteúdo junto', async () => {
  const p = estudos.criarProfessor({ nome: 'Rui', materia: 'Física' });
  const pasta = estudos.criarPasta(p.id, { nome: 'A2', tipo: 'prova' });
  await anexar(pasta.id, 'prova', 'prova.txt', 'Calcule a aceleração do bloco sobre o plano inclinado.');
  await anexar(pasta.id, 'conteudo', 'aula.txt', 'Plano inclinado: decomposição de forças e aceleração.');

  const soProva = await recallChunks('plano inclinado', { pastaId: pasta.id, papeis: ['prova'] });
  assert.ok(soProva.length, 'a busca precisa achar alguma coisa');
  assert.ok(
    soProva.every((t) => t.papel === 'prova'),
    `veio trecho de outro papel: ${soProva.map((t) => t.papel).join(', ')}`
  );

  const tudo = await recallChunks('plano inclinado', { pastaId: pasta.id });
  assert.ok(tudo.length >= soProva.length, 'sem filtro tem que vir pelo menos o mesmo');
});

test('o trecho recuperado sabe de qual anexo veio', async () => {
  const p = estudos.criarProfessor({ nome: 'Bia' });
  const pasta = estudos.criarPasta(p.id, { nome: 'Listas', tipo: 'material' });
  const att = await anexar(pasta.id, 'material', 'lista.txt', 'Fotossíntese acontece no cloroplasto.');
  const [trecho] = await recallChunks('cloroplasto', { pastaId: pasta.id });
  assert.equal(trecho.anexo, att.id, 'sem isto a citação não abre o arquivo certo');
  assert.equal(trecho.source, 'lista.txt');
});

test('apagar a pasta leva os anexos e os arquivos do disco', async () => {
  const p = estudos.criarProfessor({ nome: 'Dora' });
  const pasta = estudos.criarPasta(p.id, { nome: 'A1', tipo: 'prova' });
  const att = await anexar(pasta.id, 'prova', 'p.txt', 'Uma prova qualquer.');
  assert.equal(listAttachments({ pastaId: pasta.id }).length, 1);

  estudos.apagarPasta(pasta.id);
  assert.equal(listAttachments({ pastaId: pasta.id }).length, 0);
  assert.equal(one('SELECT id FROM attachments WHERE id = ?', att.id), undefined);
  assert.equal(all('SELECT id FROM chunks WHERE attachment_id = ?', att.id).length, 0);
});

test('apagar o professor não deixa anexo órfão pra trás', async () => {
  const p = estudos.criarProfessor({ nome: 'Elias' });
  const pasta = estudos.criarPasta(p.id, { nome: 'A1', tipo: 'prova' });
  const att = await anexar(pasta.id, 'prova', 'p.txt', 'Outra prova.');

  estudos.apagarProfessor(p.id);
  assert.equal(one('SELECT id FROM professores WHERE id = ?', p.id), undefined);
  assert.equal(one('SELECT id FROM estudo_pastas WHERE id = ?', pasta.id), undefined);
  assert.equal(one('SELECT id FROM attachments WHERE id = ?', att.id), undefined);
});

test('reordenar respeita só as pastas do próprio professor', () => {
  const a = estudos.criarProfessor({ nome: 'Um' });
  const b = estudos.criarProfessor({ nome: 'Dois' });
  const p1 = estudos.criarPasta(a.id, { nome: 'A', tipo: 'prova' });
  const p2 = estudos.criarPasta(a.id, { nome: 'B', tipo: 'prova' });
  const alheia = estudos.criarPasta(b.id, { nome: 'C', tipo: 'prova' });

  const fora = estudos.reordenarPastas(a.id, [p2.id, p1.id, alheia.id]);
  assert.deepEqual(fora.map((x) => x.nome), ['B', 'A', 'Material da aula']);
  assert.ok(!fora.some((x) => x.id === alheia.id), 'pasta de outro professor não pode entrar');

  // Lista parcial não pode largar as outras com o número antigo: sem isso duas
  // pastas empatavam em zero e a ordem saía por desempate de data.
  const dePonta = estudos.reordenarPastas(a.id, [p1.id]);
  assert.deepEqual(dePonta.map((x) => x.nome), ['A', 'B', 'Material da aula']);
  assert.deepEqual(dePonta.map((x) => x.ord), [0, 1, 2]);
});

test('o que foi gerado fica guardado com as fontes', () => {
  const p = estudos.criarProfessor({ nome: 'Fê' });
  const saida = estudos.guardarSaida({
    professorId: p.id,
    tipo: 'simulado',
    titulo: 'Simulado da A1',
    json: { questoes: [{ enunciado: 'Explique.' }] },
    fontes: [{ anexo: 'x', trecho: 'y' }],
    modelo: 'ollama:llama3'
  });
  assert.equal(saida.tipo, 'simulado');
  assert.equal(saida.json.questoes.length, 1);
  assert.equal(saida.fontes[0].anexo, 'x');
  assert.equal(estudos.listarSaidas(p.id, { tipo: 'simulado' }).length, 1);
  assert.equal(estudos.listarSaidas(p.id, { tipo: 'guia' }).length, 0);

  estudos.apagarSaida(saida.id);
  assert.equal(estudos.listarSaidas(p.id).length, 0);
});

test('avaliação guarda o dia, e só o dia', () => {
  // Prova tem dia, não horário: guardar um instante faria "hoje" virar "ontem"
  // pra quem abrir o app de manhã cedo noutro fuso.
  const p = estudos.criarProfessor({ nome: 'Marcos' });
  const pasta = estudos.criarPasta(p.id, { nome: 'A2', tipo: 'prova', quando: '2026-08-24' });
  assert.equal(pasta.quando, '2026-08-24');

  assert.equal(estudos.criarPasta(p.id, { nome: 'A3', tipo: 'prova' }).quando, null);
  assert.equal(
    estudos.criarPasta(p.id, { nome: 'A4', tipo: 'prova', quando: '24/08/2026' }).quando,
    null,
    'formato torto vira sem data, não vira data errada'
  );
  assert.equal(
    estudos.criarPasta(p.id, { nome: 'A5', tipo: 'prova', quando: '2026-08-24T18:30:00Z' }).quando,
    '2026-08-24',
    'instante é cortado no dia'
  );

  // Editar sem mencionar a data não apaga a data.
  const renomeada = estudos.atualizarPasta(pasta.id, { nome: 'A2 nova' });
  assert.equal(renomeada.quando, '2026-08-24');
  assert.equal(estudos.atualizarPasta(pasta.id, { quando: null }).quando, null);
});
