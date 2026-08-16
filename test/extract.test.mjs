// Extração de texto: o que o app promete ler, ele lê — e o que não dá pra ler
// sai com um aviso, não com uma string vazia silenciosa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractText } from '../server/extract.mjs';

test('texto simples sai inteiro', () => {
  const out = extractText(Buffer.from('linha um\nlinha dois'), 'nota.txt', 'text/plain');
  assert.equal(out.kind, 'texto');
  assert.equal(out.text, 'linha um\nlinha dois');
  assert.equal(out.note, null);
});

test('código é tratado como texto pela extensão', () => {
  const out = extractText(Buffer.from('const a = 1;'), 'app.mjs', 'application/octet-stream');
  assert.equal(out.kind, 'texto');
  assert.match(out.text, /const a = 1/);
});

test('arquivo sem extensão conhecida mas com cara de texto passa', () => {
  const out = extractText(Buffer.from('apenas um texto qualquer aqui'), 'LICENSE', '');
  assert.equal(out.kind, 'texto');
});

test('binário desconhecido é recusado com explicação', () => {
  const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x10, 0x00, 0x99]);
  const out = extractText(binary, 'coisa.bin', 'application/octet-stream');
  assert.equal(out.kind, 'desconhecido');
  assert.equal(out.text, '');
  assert.match(out.note, /não sei ler/);
});

// --------------------------------------------------------------------- ZIP

/** Monta um ZIP mínimo (um arquivo, deflate) só com o que o leitor precisa. */
function makeZip(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const deflated = deflateRawSync(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 14); // crc — o leitor não confere
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localBlock = Buffer.concat([local, nameBuf, deflated]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // deslocamento do cabeçalho local
  const centralBlock = Buffer.concat([central, nameBuf]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralBlock.length, 12);
  end.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, end]);
}

test('DOCX tem o texto dos parágrafos extraído', () => {
  const xml =
    '<?xml version="1.0"?><w:document><w:body>' +
    '<w:p><w:r><w:t>Primeiro parágrafo.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Segundo com &amp; escape.</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const out = extractText(makeZip('word/document.xml', xml), 'doc.docx', '');
  assert.equal(out.kind, 'docx');
  assert.match(out.text, /Primeiro parágrafo\./);
  assert.match(out.text, /Segundo com & escape\./);
});

test('DOCX sem o XML esperado avisa em vez de devolver vazio calado', () => {
  const out = extractText(makeZip('outra/coisa.xml', '<a/>'), 'doc.docx', '');
  assert.equal(out.text, '');
  assert.match(out.note, /word\/document\.xml/);
});

test('PPTX junta os slides na ordem', () => {
  const slide = '<p:sld><a:p><a:t>Título do slide</a:t></a:p></p:sld>';
  const out = extractText(makeZip('ppt/slides/slide1.xml', slide), 'apre.pptx', '');
  assert.equal(out.kind, 'pptx');
  assert.match(out.text, /Slide 1/);
  assert.match(out.text, /Título do slide/);
});

// --------------------------------------------------------------------- PDF

/** PDF de um objeto de conteúdo, sem compressão, com dois operadores Tj. */
function makePdf(lines) {
  const content = lines.map((l) => `BT /F1 12 Tf (${l}) Tj ET`).join('\n');
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n%%EOF`,
    'latin1'
  );
}

test('PDF sem compressão tem o texto extraído', () => {
  const out = extractText(makePdf(['Relatorio trimestral da Acme', 'Codigo ACME-ZULU-991']), 'r.pdf', '');
  assert.equal(out.kind, 'pdf');
  assert.match(out.text, /Relatorio trimestral da Acme/);
  assert.match(out.text, /ACME-ZULU-991/);
});

test('PDF só de imagem admite que não tem texto, em vez de devolver vazio', () => {
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Filter /DCTDecode /Length 4 >>\nstream\n\xff\xd8\xff\xd9\nendstream\nendobj\n%%EOF',
    'latin1'
  );
  const out = extractText(pdf, 'scan.pdf', '');
  assert.equal(out.text, '');
  assert.match(out.note, /OCR|conteúdo legível/);
});

test('escapes de string do PDF viram os caracteres certos', () => {
  const out = extractText(makePdf(['linha\\(um\\)', 'dois']), 'e.pdf', '');
  assert.match(out.text, /linha\(um\)/);
});

test('o tipo declarado no mime vale mesmo sem extensão', () => {
  const out = extractText(makePdf(['conteudo do arquivo']), 'sem-extensao', 'application/pdf');
  assert.equal(out.kind, 'pdf');
  assert.match(out.text, /conteudo do arquivo/);
});

test('fonte embutida e imagem não entram como texto do PDF', () => {
  // Binário que, descomprimido, tem os bytes dos operadores de texto — é
  // exatamente o que fazia fonte e imagem virarem "frase" no prompt do modelo.
  const lixo = Buffer.concat([
    Buffer.from('\x00\x01\x02(nao sou frase)Tj [(nem eu)]TJ\x00\xff', 'latin1'),
    Buffer.from(Array.from({ length: 400 }, (_, i) => i % 256))
  ]);
  const fonte = deflateRawSync(lixo);
  const imagem = deflateRawSync(lixo);
  const conteudo = 'BT /F1 12 Tf (Relatorio de verdade) Tj ET';

  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from(`1 0 obj\n<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream\nendobj\n`),
    Buffer.from(`2 0 obj\n<< /Filter /FlateDecode /Length1 54132 /Length ${fonte.length} >>\nstream\n`),
    fonte,
    Buffer.from('\nendstream\nendobj\n'),
    Buffer.from(
      `3 0 obj\n<< /Type /XObject /Subtype /Image /Filter /FlateDecode /Length ${imagem.length} >>\nstream\n`
    ),
    imagem,
    Buffer.from('\nendstream\nendobj\n%%EOF')
  ]);

  const out = extractText(pdf, 'misto.pdf', 'application/pdf');
  assert.equal(out.text, 'Relatorio de verdade');
  assert.ok(!/nao sou frase|nem eu/.test(out.text), 'operador dentro de binário não é texto de página');
});

test('PDF sem bloco de texto admite que não tem texto', () => {
  // Digitalização: o fluxo abre, mas não é página — não pode virar frase.
  const so_imagem = deflateRawSync(Buffer.from('(parece texto)Tj sem abrir bloco nenhum', 'latin1'));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length 10 >>\nstream\n'),
    so_imagem,
    Buffer.from('\nendstream\nendobj\n%%EOF')
  ]);
  const out = extractText(pdf, 'scan.pdf', 'application/pdf');
  assert.equal(out.text, '');
  assert.match(out.note, /digitalização em imagem/);
});
