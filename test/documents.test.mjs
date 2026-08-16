// Anexo e conversa com documento: o arquivo curto entra inteiro, o longo entra
// pelo trecho certo, e o que não dá pra ler é marcado como erro.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { addAttachment, listAttachments, deleteAttachment, recallChunks, renderDocuments, INLINE_LIMIT } =
  await import('../server/documents.mjs');
const { run, all, now } = await import('../server/db.mjs');

after(() => home.cleanup());

function makeChat(id) {
  run(
    'INSERT INTO chats (id, title, mode, created_at, updated_at) VALUES (?,?,?,?,?)',
    id, 'Conversa de teste', 'chat', now(), now()
  );
  return id;
}

test('arquivo curto vira um trecho só', async () => {
  makeChat('chat-curto');
  const att = await addAttachment({
    buffer: Buffer.from('Um texto curto de duas linhas.\n\nSó isso.'),
    name: 'curto.txt',
    chatId: 'chat-curto'
  });
  assert.equal(att.status, 'ok');
  assert.equal(att.chunks, 1);
  assert.ok(att.chars > 0);
});

test('arquivo longo é quebrado em vários trechos com sobreposição', async () => {
  makeChat('chat-longo');
  const paragrafos = Array.from({ length: 60 }, (_, i) =>
    `Parágrafo ${i}. Texto de enchimento suficiente para forçar a quebra em vários pedaços distintos.`
  ).join('\n\n');
  const att = await addAttachment({
    buffer: Buffer.from(paragrafos),
    name: 'longo.txt',
    chatId: 'chat-longo'
  });
  assert.ok(att.chunks > 3, `esperava vários trechos, veio ${att.chunks}`);
  const trechos = all('SELECT text FROM chunks WHERE attachment_id = ? ORDER BY ord', att.id);
  assert.ok(trechos.every((t) => t.text.length <= 1500), 'nenhum trecho pode passar do limite');
});

test('arquivo ilegível fica com status de erro e explicação', async () => {
  makeChat('chat-ruim');
  const att = await addAttachment({
    buffer: Buffer.from([0, 1, 2, 255, 0, 3, 0, 9]),
    name: 'coisa.bin',
    chatId: 'chat-ruim'
  });
  assert.equal(att.status, 'erro');
  assert.ok(att.note);
  assert.equal(att.chunks, 0);
});

test('recupera o trecho que contém a resposta, não o primeiro', async () => {
  makeChat('chat-busca');
  const partes = Array.from({ length: 80 }, (_, i) =>
    `Parágrafo ${i} sobre assuntos genéricos de preenchimento e política de reembolso padrão.`
  );
  partes[55] = 'A chave de ativação do sistema Orion é ORION-7742-XKQ e expira em março de 2027.';
  const att = await addAttachment({
    buffer: Buffer.from(partes.join('\n\n')),
    name: 'manual.txt',
    chatId: 'chat-busca'
  });
  assert.ok(att.chunks > 1);

  const hits = await recallChunks('qual a chave de ativação do sistema Orion', { chatId: 'chat-busca' });
  assert.ok(hits.length > 0, 'tinha que achar algum trecho');
  assert.match(hits[0].text, /ORION-7742-XKQ/, 'o trecho com a chave tinha que vir primeiro');
  assert.equal(hits[0].source, 'manual.txt');
});

test('não vaza trecho de anexo de outra conversa', async () => {
  makeChat('chat-a');
  makeChat('chat-b');
  await addAttachment({
    buffer: Buffer.from('O código secreto da conversa A é BANANA-42.'),
    name: 'a.txt',
    chatId: 'chat-a'
  });
  const hits = await recallChunks('código secreto BANANA', { chatId: 'chat-b' });
  assert.equal(hits.length, 0, 'anexo de outra conversa não pode aparecer');
});

test('documento curto entra inteiro no bloco do prompt', async () => {
  makeChat('chat-inline');
  await addAttachment({
    buffer: Buffer.from('A senha do wifi da casa é abelha-dourada-91.'),
    name: 'wifi.txt',
    chatId: 'chat-inline'
  });
  const { block, used } = await renderDocuments('qualquer pergunta', { chatId: 'chat-inline' });
  assert.match(block, /abelha-dourada-91/);
  assert.equal(used[0].whole, true, 'arquivo curto entra inteiro');
});

test('documento longo entra pelo trecho, não inteiro', async () => {
  makeChat('chat-rag');
  const grande = Array.from({ length: 200 }, (_, i) =>
    `Seção ${i}: conteúdo de enchimento para ultrapassar o limite de inclusão direta.`
  );
  grande[120] = 'O prazo de garantia estendida do equipamento Falcon é de 36 meses.';
  const att = await addAttachment({
    buffer: Buffer.from(grande.join('\n\n')),
    name: 'grande.txt',
    chatId: 'chat-rag'
  });
  assert.ok(att.chars > INLINE_LIMIT, 'o arquivo precisa ser maior que o limite pra testar o caso');

  const { block, used } = await renderDocuments('qual o prazo de garantia do Falcon', {
    chatId: 'chat-rag'
  });
  assert.match(block, /36 meses/, 'o trecho certo tinha que entrar');
  assert.ok(block.length < att.chars, 'o arquivo inteiro não pode ter entrado');
  assert.ok(used.some((u) => u.whole === false));
});

test('sem anexo, o bloco sai vazio', async () => {
  makeChat('chat-vazio');
  const { block, used } = await renderDocuments('pergunta qualquer', { chatId: 'chat-vazio' });
  assert.equal(block, '');
  assert.deepEqual(used, []);
});

test('apagar anexo leva os trechos junto', async () => {
  makeChat('chat-apaga');
  const att = await addAttachment({
    buffer: Buffer.from('Conteúdo que vai ser apagado sobre helicópteros anfíbios.'),
    name: 'apagar.txt',
    chatId: 'chat-apaga'
  });
  deleteAttachment(att.id);
  assert.equal(all('SELECT id FROM chunks WHERE attachment_id = ?', att.id).length, 0);
  assert.ok(!listAttachments({ chatId: 'chat-apaga' }).some((a) => a.id === att.id));
  const hits = await recallChunks('helicópteros anfíbios', { chatId: 'chat-apaga' });
  assert.equal(hits.length, 0, 'o índice tinha que ter sido limpo');
});

test('anexo de projeto vale, e é separado do de conversa', async () => {
  run(
    'INSERT INTO projects (id, name, icon, color, instructions, workdir, created_at) VALUES (?,?,?,?,?,?,?)',
    'proj-doc', 'Projeto com arquivo', 'folder', 'slate', '', null, now()
  );
  await addAttachment({
    buffer: Buffer.from('A convenção de nomes do projeto usa prefixo PX- em toda tabela.'),
    name: 'convencao.txt',
    projectId: 'proj-doc'
  });
  const hits = await recallChunks('convenção de nomes prefixo', { projectId: 'proj-doc' });
  assert.ok(hits.some((h) => /PX-/.test(h.text)));
  assert.equal(listAttachments({ projectId: 'proj-doc' }).length, 1);
});

// ------------------------------------------------------- arquivos no disco

test('apagar os anexos de uma conversa leva os arquivos junto', async () => {
  const { deleteAttachmentsOf } = await import('../server/documents.mjs');
  const { UPLOAD_DIR } = await import('../server/config.mjs');
  const { existsSync } = await import('node:fs');

  makeChat('chat-disco');
  const att = await addAttachment({
    buffer: Buffer.from('Conteúdo confidencial que o usuário achou que tinha apagado.'),
    name: 'confidencial.txt',
    chatId: 'chat-disco'
  });
  assert.ok(att.path && existsSync(att.path), 'o original tinha que ter sido gravado');

  deleteAttachmentsOf({ chatId: 'chat-disco' });
  assert.ok(!existsSync(att.path), 'o arquivo não pode ficar no disco depois de apagar a conversa');
  assert.equal(listAttachments({ chatId: 'chat-disco' }).length, 0);
});

test('a varredura remove arquivo sem dono e poupa o que tem', async () => {
  const { sweepOrphanUploads } = await import('../server/documents.mjs');
  const { UPLOAD_DIR } = await import('../server/config.mjs');
  const { writeFileSync, existsSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  makeChat('chat-varre');
  const vivo = await addAttachment({
    buffer: Buffer.from('Este anexo tem dono e precisa sobreviver à varredura.'),
    name: 'vivo.txt',
    chatId: 'chat-varre'
  });

  // Sobra: arquivo no disco que nenhuma linha do banco reclama.
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const orfao = join(UPLOAD_DIR, 'sobra-de-versao-antiga.txt');
  writeFileSync(orfao, 'lixo de uma queda no meio da gravação');

  const resultado = sweepOrphanUploads();
  assert.ok(resultado.removed >= 1);
  assert.ok(!existsSync(orfao), 'o órfão tinha que ter saído');
  assert.ok(existsSync(vivo.path), 'o anexo com dono não pode ser varrido junto');
});
