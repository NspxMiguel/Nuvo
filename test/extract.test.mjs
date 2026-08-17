// Extração de texto: o que o app promete ler, ele lê — e o que não dá pra ler
// sai com um aviso, não com uma string vazia silenciosa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, deflateSync } from 'node:zlib';
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

/** ZIP de vários arquivos, pro EPUB, que é um livro inteiro num zip só. */
function zipEpub(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }

  const dirBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, dirBuffer, end]);
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

// ----------------------------------------------- codificação de fonte no PDF

/** Objeto de PDF com fluxo comprimido, do jeito que gerador de verdade escreve. */
function objetoFluxo(num, texto, extra = '') {
  const dados = deflateSync(Buffer.from(texto, 'latin1'));
  return Buffer.concat([
    Buffer.from(`${num} 0 obj << /Length ${dados.length} /Filter /FlateDecode ${extra}>>\nstream\n`, 'latin1'),
    dados,
    Buffer.from('\nendstream endobj\n', 'latin1')
  ]);
}

// Objetos separados por enchimento: sem isso o dicionário de um cai na janela
// de leitura do outro, o que não acontece em PDF de tamanho real.
const ESPACO = Buffer.from(`\n${'%'.repeat(600)}\n`, 'latin1');

test('fonte do Windows: aspa curva e travessão deixam de virar controle invisível', () => {
  // 0x97 travessão, 0x85 reticências, 0x93/0x94 aspas curvas. Lidos como
  // latin1 — byte igual a ponto de código — são controles C1 que somem na tela.
  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n' +
        '2 0 obj << /Type /Page /Resources << /Font << /F1 1 0 R >> >> >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(3, 'BT /F1 12 Tf (O relat\xf3rio \x97 hoje\x85 diz \x93sim\x94) Tj ET'),
    Buffer.from('trailer<</Root 2 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'win.pdf', 'application/pdf');
  assert.equal(out.text, 'O relatório — hoje… diz “sim”');
  assert.equal(out.note, null);
});

test('fonte do Mac: o mesmo byte que é travessão no Windows é "ó" no MacRoman', () => {
  // É o caso de todo PDF impresso no macOS: 0x97 vale `ó`, e supor windows-1252
  // troca a palavra inteira em vez de só a pontuação.
  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.3\n1 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Times /Encoding /MacRomanEncoding >> endobj\n' +
        '2 0 obj << /Type /Page /Resources << /Font << /F1 1 0 R >> >> >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(3, 'BT /F1 12 Tf (relat\x97rio de agosto \xd0 vers\x8bo 2) Tj ET'),
    Buffer.from('trailer<</Root 2 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'mac.pdf', 'application/pdf');
  assert.equal(out.text, 'relatório de agosto – versão 2');
});

test('fonte de subconjunto: sem o /ToUnicode os bytes não são texto, são índices', () => {
  // Gerador moderno numera os glifos a partir de 1, na ordem em que aparecem.
  // Sem ler o CMap, `\x01\x02\x03\x04` não é palavra em codificação nenhuma.
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
1 begincodespacerange <00> <ff> endcodespacerange
4 beginbfchar
<01> <0043>
<02> <0061>
<03> <0066>
<04> <00E9>
endbfchar
1 beginbfrange
<05> <06> <0020>
endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;

  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n1 0 obj << /Type /Page /Resources << /Font << /F2 4 0 R >> >> >> endobj\n' +
        '4 0 obj << /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Minion /ToUnicode 5 0 R >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(5, cmap),
    ESPACO,
    objetoFluxo(6, 'BT /F2 12 Tf (\x01\x02\x03\x04\x05\x01\x02\x03\x04) Tj ET'),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'subconjunto.pdf', 'application/pdf');
  assert.equal(out.text, 'Café Café');
});

test('/Differences dá nome a cada posição trocada, e o nome vira a letra', () => {
  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Page /Resources << /Font << /F3 2 0 R >> >> >> endobj\n' +
        '2 0 obj << /Type /Font /Subtype /TrueType ' +
        '/Encoding << /Differences [ 1 /C /a /f /eacute /exclam 200 /uni00E7 /atilde ] >> >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(3, 'BT /F3 12 Tf (\x01\x02\x03\x04\x05\xc8\xc9) Tj ET'),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'diff.pdf', 'application/pdf');
  assert.equal(out.text, 'Café!çã');
});

test('a fonte vale por bloco: trocar de /Fx troca a tabela no meio da página', () => {
  const cmap = `begincmap
1 begincodespacerange <00> <ff> endcodespacerange
2 beginbfchar
<01> <004F>
<02> <004B>
endbfchar
endcmap`;

  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R /F2 3 0 R >> >> >> endobj\n' +
        '2 0 obj << /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >> endobj\n' +
        '3 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 4 0 R >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(4, cmap),
    ESPACO,
    objetoFluxo(5, 'BT /F1 12 Tf (caf\xe9) Tj /F2 12 Tf (\x01\x02) Tj ET'),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'duas-fontes.pdf', 'application/pdf');
  assert.equal(out.text, 'caféOK');
});

test('página escrita logo depois de uma fonte não é descartada como se fosse a fonte', () => {
  // O dicionário do fluxo era procurado numa janela fixa de bytes atrás, que
  // alcançava o objeto anterior: descritor de fonte antes da página fazia a
  // página inteira sumir.
  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n7 0 obj << /Type /FontDescriptor /FontName /AAAAAA+Arial /Flags 4 >> endobj\n',
      'latin1'
    ),
    objetoFluxo(8, 'BT /F1 12 Tf (pagina colada na fonte) Tj ET'),
    Buffer.from('%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'colado.pdf', 'application/pdf');
  assert.equal(out.text, 'pagina colada na fonte');
});

test('símbolo que nenhuma tabela explica sai com aviso, não como se fosse a frase', () => {
  // Fonte sem /Encoding e sem /ToUnicode: sobra o palpite, e o palpite erra.
  // Entregar isso calado é pior do que entregar dizendo que saiu torto.
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'latin1'),
    objetoFluxo(1, 'BT /F9 12 Tf (relatorio \x81\x8d\x90 final) Tj ET'),
    Buffer.from('%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'sem-tabela.pdf', 'application/pdf');
  assert.match(out.text, /relatorio/);
  assert.match(out.note, /sem mapa de caracteres/);
});

// -------------------------------------------------------------- codificação

test('texto em latin1 sai com acento certo, e diz qual codificação assumiu', () => {
  // Byte 0xE7 é "ç" em windows-1252 e sequência inválida em UTF-8. O
  // `toString('utf8')` não falha: devolve o losango e ninguém fica sabendo.
  const bytes = Buffer.from([0x63, 0x6f, 0x6e, 0x74, 0x72, 0x61, 0xe7, 0xe3, 0x6f]); // "contração"
  const out = extractText(bytes, 'nota.txt', 'text/plain');
  assert.equal(out.text, 'contração');
  assert.match(out.note, /windows-1252|latin1/);
  assert.ok(!out.text.includes('�'), 'nenhum losango de byte inválido');
});

test('UTF-8 continua sem aviso nenhum', () => {
  const out = extractText(Buffer.from('contração', 'utf8'), 'nota.txt', 'text/plain');
  assert.equal(out.text, 'contração');
  assert.equal(out.note, null);
});

test('BOM de UTF-16 é reconhecido em vez de virar lixo', () => {
  const bom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('olá mundo', 'utf16le')]);
  const out = extractText(bom, 'nota.txt', 'text/plain');
  assert.equal(out.text, 'olá mundo');
});

// --------------------------------------------------------------------- EPUB

test('capítulo de EPUB vira parágrafos, sem CSS e com entidade decodificada', () => {
  const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<style type="text/css">p { margin: 0; text-indent: 1.2em; }</style>
<script>var x = 1;</script>
</head><body>
<h1>Cap&#237;tulo I</h1>
<p>Era uma vez&nbsp;&mdash; dizia ele &mdash; um servidor em casa.</p>
<p>E a mem&oacute;ria era uma s&oacute;.</p>
</body></html>`;
  const epub = zipEpub([
    { name: 'OEBPS/cap1.xhtml', data: Buffer.from(xhtml, 'utf8') }
  ]);
  const out = extractText(epub, 'livro.epub', '');
  assert.equal(out.kind, 'epub');
  assert.ok(!/margin|text-indent|var x/.test(out.text), 'CSS e script não são conteúdo do livro');
  assert.match(out.text, /Capítulo I/);
  assert.match(out.text, /Era uma vez — dizia ele — um servidor em casa\./);
  assert.match(out.text, /E a memória era uma só\./);
  assert.ok(
    out.text.split('\n').filter((l) => l.trim()).length >= 3,
    'capítulo não pode sair numa linha só'
  );
});
