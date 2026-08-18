// Anexo e conversa com documento: o arquivo curto entra inteiro, o longo entra
// pelo trecho certo, e o que não dá pra ler é marcado como erro.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { addAttachment, listAttachments, deleteAttachment, recallChunks, renderDocuments, INLINE_LIMIT, ORCAMENTO_INTEIRO } =
  await import('../server/documents.mjs');
const { run, all, now } = await import('../server/db.mjs');
const { createChat } = await import('../server/chat.mjs');

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

test('arquivo curto entra no prompt sem repetir trecho', async () => {
  // Parágrafo maior que o pedaço é fatiado com 200 caracteres de sobreposição —
  // de propósito, pra busca não perder frase cortada na emenda. Remontar o
  // arquivo a partir dos pedaços devolvia essa sobreposição pro modelo.
  const paragrafo = `${'O contrato prevê entrega em trinta dias. '.repeat(70)}FIM-DO-DOCUMENTO.`;
  const chat = createChat({ title: 'x' });
  await addAttachment({
    buffer: Buffer.from(paragrafo, 'utf8'),
    name: 'contrato.txt',
    mime: 'text/plain',
    chatId: chat.id
  });

  const { block } = await renderDocuments('contrato', { chatId: chat.id, projectId: null });
  const vezes = block.split('FIM-DO-DOCUMENTO').length - 1;
  assert.equal(vezes, 1, 'o fim do arquivo não pode aparecer duas vezes no prompt');

  // E o tamanho do bloco tem que bater com o do arquivo, não com a soma dos
  // pedaços — que é maior justamente pela sobreposição.
  const corpo = block.slice(block.indexOf('## contrato.txt'));
  assert.ok(
    corpo.length < paragrafo.length + 200,
    `bloco com ${corpo.length} caracteres pra um arquivo de ${paragrafo.length}`
  );
});

test('última linha curta do arquivo não some da indexação', async () => {
  // Pedaço com 20 caracteres ou menos era descartado. A última linha de um
  // documento costuma ser exatamente isso: assinatura, total, código.
  const texto = `${'linha de conteúdo do relatório\n\n'.repeat(80)}Total: R$ 91,20`;
  const chat = createChat({ title: 'y' });
  const att = await addAttachment({
    buffer: Buffer.from(texto, 'utf8'),
    name: 'relatorio.txt',
    mime: 'text/plain',
    chatId: chat.id
  });

  const pedacos = all('SELECT text FROM chunks WHERE attachment_id = ? ORDER BY ord', att.id);
  const inteiro = pedacos.map((p) => p.text).join('\n');
  assert.match(inteiro, /Total: R\$ 91,20/, 'a última linha tinha que estar indexada');
});

test('projeto com muitos anexos não estoura o prompt', async () => {
  // "Curto" é medida por arquivo, e projeto é onde se junta arquivo. Vinte
  // notas de 5 mil caracteres entravam inteiras: 103 mil caracteres — uns 26
  // mil tokens — antes de a conversa começar, toda vez, independentemente da
  // pergunta. Modelo local de 8k não recebe isso.
  const { uid } = await import('../server/db.mjs');
  const projectId = uid();
  run('INSERT INTO projects (id, name, created_at) VALUES (?,?,?)', projectId, 'muitos', now());

  for (let i = 0; i < 20; i++) {
    const corpo =
      i === 17
        ? 'Relatório sobre o gerador de vapor da caldeira Zephyr. ' + 'Detalhe operacional. '.repeat(200)
        : `Nota ${i} do projeto. ` + `Conteúdo genérico sobre o assunto ${i}. `.repeat(140);
    await addAttachment({
      projectId,
      name: `nota-${i}.txt`,
      mime: 'text/plain',
      buffer: Buffer.from(corpo, 'utf8')
    });
  }

  const { block, used } = await renderDocuments('caldeira Zephyr gerador de vapor', {
    chatId: null,
    projectId
  });

  const inteiros = used.filter((u) => u.whole);
  // Teto: o que entra inteiro cabe no orçamento (mais o último, que só é
  // recusado depois de medido), e os trechos são 6 de 1400 no máximo.
  const teto = ORCAMENTO_INTEIRO + INLINE_LIMIT + 6 * 1400;
  assert.ok(block.length <= teto, `o bloco saiu com ${block.length} caracteres, teto ${teto}`);
  assert.ok(inteiros.length < 20, `${inteiros.length} de 20 entraram inteiros`);
  assert.ok(inteiros.length >= 1, 'o orçamento zerou o bloco em vez de reparti-lo');

  // E o que foi rebaixado não sumiu: continua alcançável pela pergunta.
  assert.ok(/Zephyr/.test(block), 'o anexo rebaixado ficou invisível pra busca');
  assert.ok(
    used.some((u) => !u.whole && u.source === 'nota-17.txt'),
    `o trecho não foi creditado: ${JSON.stringify(used)}`
  );
});

test('anexo único continua entrando inteiro', async () => {
  // O orçamento não pode punir o caso comum: um arquivo de duas páginas é
  // melhor inteiro do que picotado.
  const { uid } = await import('../server/db.mjs');
  const projectId = uid();
  run('INSERT INTO projects (id, name, created_at) VALUES (?,?,?)', projectId, 'um só', now());
  await addAttachment({
    projectId,
    name: 'contrato.txt',
    mime: 'text/plain',
    buffer: Buffer.from('Cláusula sobre prazo de entrega. '.repeat(140), 'utf8')
  });

  const { used } = await renderDocuments('qual o prazo', { chatId: null, projectId });
  assert.deepEqual(used, [{ source: 'contrato.txt', whole: true }]);
});
