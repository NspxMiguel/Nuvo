// A API do Estudos, com o servidor de verdade numa porta livre. As saídas e
// os cartões são semeados direto no armário para que nenhuma rota de IA entre
// nestes testes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { startServer } = await import('./helpers.mjs');
const { guardarSaida } = await import('../server/estudos.mjs');
const { semearCartoes } = await import('../server/cartoes.mjs');

let app;

before(async () => {
  app = await startServer();
});

after(async () => {
  await app.close();
  home.cleanup();
});

async function novoProfessor(dados = {}) {
  const res = await app.api('/professores', {
    method: 'POST',
    body: { nome: 'Professor de teste', ...dados }
  });
  assert.equal(res.status, 200);
  return res.data;
}

// Um PNG 1x1 RGBA completo. A foto não depende de fixture nem de biblioteca:
// os pedaços, a soma e o IDAT comprimido nascem todos aqui.
function pedacoPng(tipo, dados) {
  const nome = Buffer.from(tipo, 'ascii');
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const soma = Buffer.alloc(4);
  soma.writeUInt32BE(crc32(Buffer.concat([nome, dados])));
  return Buffer.concat([tamanho, nome, dados, soma]);
}

function pngMinimo() {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(1, 0);
  cabecalho.writeUInt32BE(1, 4);
  cabecalho[8] = 8;
  cabecalho[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedacoPng('IHDR', cabecalho),
    pedacoPng('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pedacoPng('IEND', Buffer.alloc(0))
  ]);
}

test('professor: cria, abre, edita e apaga', async () => {
  const criada = await app.api('/professores', {
    method: 'POST',
    body: { nome: 'Helena', materia: 'Química', cor: 'violet' }
  });
  assert.equal(criada.status, 200);
  assert.equal(criada.data.nome, 'Helena');
  assert.equal(criada.data.materia, 'Química');
  assert.equal(criada.data.pastas.length, 1);
  assert.equal(criada.data.pastas[0].tipo, 'material');

  const aberta = await app.api(`/professores/${criada.data.id}`);
  assert.equal(aberta.status, 200);
  assert.equal(aberta.data.id, criada.data.id);

  const editada = await app.api(`/professores/${criada.data.id}`, {
    method: 'PATCH',
    body: { nome: 'Helena Costa', escola: 'Colégio Nuvo' }
  });
  assert.equal(editada.status, 200);
  assert.equal(editada.data.nome, 'Helena Costa');
  assert.equal(editada.data.escola, 'Colégio Nuvo');
  assert.equal(editada.data.materia, 'Química', 'campo não enviado precisa continuar igual');

  const apagada = await app.api(`/professores/${criada.data.id}`, { method: 'DELETE' });
  assert.equal(apagada.status, 200);
  assert.deepEqual(apagada.data, { ok: true });
  assert.equal((await app.api(`/professores/${criada.data.id}`)).status, 404);
});

test('professor sem nome é 400 e professor inexistente é 404', async () => {
  const semNome = await app.api('/professores', { method: 'POST', body: { nome: '   ' } });
  assert.equal(semNome.status, 400);
  assert.match(semNome.data.error, /nome/);

  const inexistente = await app.api('/professores/nao-existe');
  assert.equal(inexistente.status, 404);
  assert.match(inexistente.data.error, /não encontrado/);
});

test('pastas: cria, reordena, edita e apaga', async () => {
  const professor = await novoProfessor({ nome: 'Caio' });
  const material = professor.pastas[0];

  const primeira = await app.api(`/professores/${professor.id}/pastas`, {
    method: 'POST',
    body: { nome: 'Prova A1', tipo: 'prova' }
  });
  assert.equal(primeira.status, 200);
  assert.equal(primeira.data.tipo, 'prova');

  const segunda = await app.api(`/professores/${professor.id}/pastas`, {
    method: 'POST',
    body: { nome: 'Prova A2', tipo: 'prova' }
  });
  assert.equal(segunda.status, 200);

  const ordem = await app.api(`/professores/${professor.id}/pastas/ordem`, {
    method: 'POST',
    body: { ids: [segunda.data.id, primeira.data.id] }
  });
  assert.equal(ordem.status, 200);
  assert.deepEqual(
    ordem.data.map((pasta) => pasta.id),
    [segunda.data.id, primeira.data.id, material.id]
  );

  const editada = await app.api(`/pastas/${primeira.data.id}`, {
    method: 'PATCH',
    body: { nome: 'Recuperação A1', etiquetas: ['estequiometria'] }
  });
  assert.equal(editada.status, 200);
  assert.equal(editada.data.nome, 'Recuperação A1');
  assert.deepEqual(editada.data.etiquetas, ['estequiometria']);

  const apagada = await app.api(`/pastas/${primeira.data.id}`, { method: 'DELETE' });
  assert.equal(apagada.status, 200);
  assert.deepEqual(apagada.data, { ok: true });

  const visto = await app.api(`/professores/${professor.id}`);
  assert.ok(!visto.data.pastas.some((pasta) => pasta.id === primeira.data.id));
});

test('anexos de pasta preservam o papel e corrigem papel inválido', async () => {
  const professor = await novoProfessor({ nome: 'Lia' });
  const pasta = professor.pastas[0];

  const prova = await app.api(`/attachments?pasta=${pasta.id}&papel=prova&name=prova.txt`, {
    method: 'POST',
    raw: true,
    body: 'Questão 1. Explique a fotossíntese.'
  });
  assert.equal(prova.status, 200);
  assert.equal(prova.data.pasta_id, pasta.id);
  assert.equal(prova.data.papel, 'prova');

  const corrigido = await app.api(`/attachments?pasta=${pasta.id}&papel=desconhecido&name=aula.txt`, {
    method: 'POST',
    raw: true,
    body: 'Cloroplastos transformam energia luminosa.'
  });
  assert.equal(corrigido.status, 200);
  assert.equal(corrigido.data.papel, 'material');

  const lista = await app.api(`/attachments?pasta=${pasta.id}`);
  assert.equal(lista.status, 200);
  const papeis = new Map(lista.data.map((anexo) => [anexo.id, anexo.papel]));
  assert.equal(papeis.size, 2);
  assert.equal(papeis.get(prova.data.id), 'prova');
  assert.equal(papeis.get(corrigido.data.id), 'material');
});

test('saídas do professor são listadas e podem ser apagadas', async () => {
  const professor = await novoProfessor({ nome: 'Nina' });
  const saida = guardarSaida({
    professorId: professor.id,
    tipo: 'guia',
    titulo: 'Guia da A1',
    json: { secoes: [{ titulo: 'Revisão' }] },
    fontes: [{ anexo: 'material-1', trecho: 'Trecho usado' }]
  });

  const lista = await app.api(`/professores/${professor.id}/saidas`);
  assert.equal(lista.status, 200);
  assert.equal(lista.data.length, 1);
  assert.equal(lista.data[0].id, saida.id);
  assert.equal(lista.data[0].json.secoes[0].titulo, 'Revisão');

  const apagada = await app.api(`/saidas/${saida.id}`, { method: 'DELETE' });
  assert.equal(apagada.status, 200);
  assert.deepEqual(apagada.data, { ok: true });
  assert.deepEqual((await app.api(`/professores/${professor.id}/saidas`)).data, []);
});

test('fila de cartões do professor volta com contagem e previsões', async () => {
  const professor = await novoProfessor({ nome: 'Otávio' });
  const saida = guardarSaida({
    professorId: professor.id,
    tipo: 'flashcards',
    titulo: 'Cartões de revisão',
    json: {
      cartoes: [{ frente: 'Onde ocorre a fotossíntese?', verso: 'Nos cloroplastos.', tema: 'Botânica' }]
    }
  });
  assert.equal(semearCartoes(saida.id).entraram, 1);

  const fila = await app.api(`/professores/${professor.id}/cartoes`);
  assert.equal(fila.status, 200);
  assert.deepEqual(fila.data.contagem, { total: 1, novos: 1, hoje: 1 });
  assert.equal(fila.data.cartoes.length, 1);
  assert.equal(fila.data.cartoes[0].frente, 'Onde ocorre a fotossíntese?');
  assert.deepEqual(Object.keys(fila.data.cartoes[0].previsao), ['denovo', 'dificil', 'bom', 'facil']);
});

test('foto recusa texto e aceita um PNG mínimo', async () => {
  const professor = await novoProfessor({ nome: 'Rosa' });

  const texto = await app.api(`/professores/${professor.id}/foto`, {
    method: 'POST',
    raw: true,
    body: Buffer.from('isto é texto, não uma imagem')
  });
  assert.equal(texto.status, 400);
  assert.match(texto.data.error, /PNG, JPG ou WebP/);

  const png = await app.api(`/professores/${professor.id}/foto`, {
    method: 'POST',
    raw: true,
    body: pngMinimo()
  });
  assert.equal(png.status, 200);
  assert.equal(png.data.id, professor.id);
  assert.match(png.data.foto, /^prof-.+\.png$/);
});
