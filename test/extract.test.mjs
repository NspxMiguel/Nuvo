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
  // Entregar isso calado é pior do que entregar dizendo que saiu torto — mas o
  // aviso tem que ser proporcional: dois símbolos estranhos num relatório de
  // trezentas mil letras é um logotipo, e avisar ali ensina a ignorar o aviso.
  const quebrado = Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'latin1'),
    objetoFluxo(1, 'BT /F9 12 Tf (relatorio \x81\x8d\x90\x81\x8d\x90\x81\x8d\x90 final) Tj ET'),
    Buffer.from('%%EOF', 'latin1')
  ]);
  const ruim = extractText(quebrado, 'sem-tabela.pdf', 'application/pdf');
  assert.match(ruim.text, /relatorio/);
  assert.match(ruim.note, /sem mapa de caracteres/);

  const raro = Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'latin1'),
    objetoFluxo(1, `BT /F9 12 Tf (${'texto legivel de um relatorio comum. '.repeat(20)}\x81) Tj ET`),
    Buffer.from('%%EOF', 'latin1')
  ]);
  const bom = extractText(raro, 'quase-limpo.pdf', 'application/pdf');
  assert.match(bom.text, /texto legivel/);
  assert.equal(bom.note, null, 'um símbolo perdido em setecentas letras não é leitura torta');
});

// -------------------------------------- leitura do fluxo de conteúdo do PDF

/** Página completa: recursos, fonte e um fluxo de conteúdo comprimido. */
function pdfDePagina(conteudo, { fonte = '<< /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >>', nome = 'F1' } = {}) {
  return Buffer.concat([
    Buffer.from(
      `%PDF-1.4\n1 0 obj << /Type /Page /Resources << /Font << /${nome} 2 0 R >> >> /Contents 3 0 R >> endobj\n` +
        `2 0 obj ${fonte} endobj\n`,
      'latin1'
    ),
    ESPACO,
    objetoFluxo(3, conteudo),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);
}

test('kerning do TJ vira espaço: as palavras param de sair coladas', () => {
  // Diagramador não escreve o espaço entre as palavras: ele desloca a próxima.
  // Sem traduzir esse deslocamento, todo PDF de revista, contrato ou artigo
  // chegava ao modelo como uma palavra gigante sem separação nenhuma.
  const out = extractText(
    pdfDePagina('BT /F1 12 Tf 72 720 Td [ (Bem) -250 (vindo) -1000 (ao) -250 (Brasil) ] TJ ET'),
    'kern.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'Bem vindo ao Brasil');
});

test('deslocamento pequeno dentro da palavra não vira espaço', () => {
  // O mesmo operador ajusta o par "AV" por meia unidade. Virar espaço ali
  // partiria a palavra no meio, que é o erro oposto e igualmente ruim.
  const out = extractText(
    pdfDePagina('BT /F1 12 Tf 72 720 Td [ (A) -20 (V) -15 (ISO) ] TJ ET'),
    'kern2.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'AVISO');
});

test('parêntese dentro da frase não corta o resto da linha', () => {
  // Parêntese equilibrado não precisa de escape no PDF. A leitura por expressão
  // regular parava no primeiro fecha-parêntese e entregava só o miolo.
  const out = extractText(
    pdfDePagina('BT /F1 12 Tf (total (com desconto) aprovado) Tj ET'),
    'paren.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'total (com desconto) aprovado');
});

test("os operadores ' e \" trocam de linha antes de escrever, não depois", () => {
  const out = extractText(
    pdfDePagina("BT /F1 12 Tf 14 TL 72 720 Td (linha um) Tj\n(linha dois) '\n0.25 0 (linha tres) \"\nET"),
    'aspas.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'linha um\nlinha dois\nlinha tres');
});

test('T* troca de linha — o operador existe, apesar de o nome terminar em asterisco', () => {
  // A busca antiga exigia fronteira de palavra depois do `*`, e entre `*` e
  // espaço não existe fronteira nenhuma: o operador nunca era reconhecido e
  // todo parágrafo saía emendado no seguinte.
  const out = extractText(
    pdfDePagina('BT /F1 12 Tf 14 TL 72 720 Td (primeira) Tj T* (segunda) Tj ET'),
    'tstar.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'primeira\nsegunda');
});

test('deslocamento horizontal não quebra a linha, deslocamento vertical quebra', () => {
  // Gerador de HTML — Chrome, wkhtmltopdf — posiciona cada pedaço da MESMA
  // linha com Td horizontal. Tratar isso como troca de linha devolvia uma
  // palavra por linha, e o texto nem parecia texto.
  const out = extractText(
    pdfDePagina(
      'BT /F1 12 Tf 72 720 Td (uma) Tj 30 0 Td (linha) Tj 30 0 Td (so) Tj\n' +
        '0 -14 Td (agora sim outra) Tj ET'
    ),
    'html.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'umalinhaso\nagora sim outra');
});

test('string hexadecimal em fonte simples é lida byte a byte, não como UTF-16', () => {
  // `<41424344>` tem oito dígitos, mas a fonte é de um byte: ler de dois em
  // dois devolvia dois ideogramas chineses no lugar de "ABCD".
  const out = extractText(
    pdfDePagina('BT /F1 12 Tf <41424344> Tj ET'),
    'hex.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'ABCD');
});

test('cada página usa a fonte que ela declarou, mesmo com o apelido repetido', () => {
  // `/F1` é apelido local da página. Num PDF de duas origens juntadas, as duas
  // páginas chamam de `/F1` fontes diferentes; resolver uma vez só pro
  // documento inteiro fazia a segunda página sair com as letras da primeira.
  const cmapA = `begincmap
1 begincodespacerange <00> <ff> endcodespacerange
2 beginbfchar
<01> <0041>
<02> <0042>
endbfchar
endcmap`;
  const cmapB = `begincmap
1 begincodespacerange <00> <ff> endcodespacerange
2 beginbfchar
<01> <0058>
<02> <0059>
endbfchar
endcmap`;

  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n' +
        '1 0 obj << /Type /Page /Resources << /Font << /F1 10 0 R >> >> /Contents 20 0 R >> endobj\n' +
        '2 0 obj << /Type /Page /Resources << /Font << /F1 11 0 R >> >> /Contents 21 0 R >> endobj\n' +
        '10 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 12 0 R >> endobj\n' +
        '11 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 13 0 R >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(12, cmapA),
    ESPACO,
    objetoFluxo(13, cmapB),
    ESPACO,
    objetoFluxo(20, 'BT /F1 12 Tf (\x01\x02) Tj ET'),
    ESPACO,
    objetoFluxo(21, 'BT /F1 12 Tf (\x01\x02) Tj ET'),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'duas-paginas.pdf', 'application/pdf');
  assert.equal(out.text, 'AB\n\nXY');
});

test('página dividida em vários fluxos é lida inteira, com a fonte atravessando', () => {
  // /Contents pode ser uma lista. O segundo pedaço costuma não abrir bloco de
  // texto próprio — era descartado como se fosse binário — e a fonte escolhida
  // no primeiro tem que continuar valendo nele.
  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n' +
        '1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R >> >> /Contents [ 3 0 R 4 0 R ] >> endobj\n' +
        '2 0 obj << /Type /Font /Subtype /Type1 /Encoding /MacRomanEncoding >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(3, 'BT /F1 12 Tf (primeira metade) Tj'),
    ESPACO,
    objetoFluxo(4, '0 -14 Td (segunda metade: vers\x8bo) Tj ET'),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'partido.pdf', 'application/pdf');
  assert.equal(out.text, 'primeira metade\nsegunda metade: versão');
});

test('ligadura tipográfica volta a ser as letras que a busca procura', () => {
  // O glifo "ﬁ" é um caractere só. Quem procura "confirmação" não digita ele,
  // e o documento ficava invisível pra busca por palavra.
  const out = extractText(
    pdfDePagina('BT /F1 12 Tf (con) Tj (\xderma\xe7\xe3o) Tj ET', {
      fonte: '<< /Type /Font /Subtype /Type1 /Encoding << /Differences [ 222 /fi ] >> >>'
    }),
    'ligadura.pdf',
    'application/pdf'
  );
  assert.equal(out.text, 'confirmação');
});

test('mapa de caracteres gigante não vira memória sem fim', () => {
  // Um `beginbfrange` pode declarar <0000> <FFFF>, e nada impede o arquivo de
  // declarar centenas deles: poucos kB de PDF viravam gigabytes de memória
  // antes de qualquer validação.
  const faixas = Array.from({ length: 400 }, () => '<0000> <FFFF> <0041>').join('\n');
  const bomba = `begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
400 beginbfrange
${faixas}
endbfrange
endcmap`;

  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R >> >> /Contents 4 0 R >> endobj\n' +
        '2 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 3 0 R >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(3, bomba),
    ESPACO,
    objetoFluxo(4, 'BT /F1 12 Tf <00410042> Tj ET'),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const antes = Date.now();
  const out = extractText(pdf, 'bomba.pdf', 'application/pdf');
  assert.ok(Date.now() - antes < 5000, `demorou ${Date.now() - antes}ms; o teto do CMap não segurou`);
  assert.equal(typeof out.text, 'string');
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

test('cadeia de filtros: ASCII85 antes do FlateDecode', () => {
  // /Filter pode ser uma lista, e o ASCII85 é de transporte — serve pra caber
  // num arquivo que precisa ser só texto imprimível. Quem só olhava o
  // FlateDecode tentava descomprimir a codificação, desistia, e dava a página
  // inteira como digitalização em imagem.
  const conteudo = 'BT /F1 12 Tf (certificado de conclusao) Tj ET';
  const comprimido = deflateSync(Buffer.from(conteudo, 'latin1'));

  // Codifica em ASCII85, que é o que o gerador faz.
  let saida = '';
  for (let i = 0; i < comprimido.length; i += 4) {
    const pedaco = comprimido.subarray(i, i + 4);
    const faltam = 4 - pedaco.length;
    let n = 0;
    for (let k = 0; k < 4; k++) n = n * 256 + (pedaco[k] ?? 0);
    if (n === 0 && !faltam) {
      saida += 'z';
      continue;
    }
    const digitos = [];
    for (let k = 0; k < 5; k++) {
      digitos.unshift(String.fromCharCode(33 + (n % 85)));
      n = Math.floor(n / 85);
    }
    saida += digitos.slice(0, 5 - faltam).join('');
  }
  saida += '~>';

  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R >> >> /Contents 3 0 R >> endobj\n' +
        '2 0 obj << /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >> endobj\n',
      'latin1'
    ),
    ESPACO,
    Buffer.from(
      `3 0 obj << /Filter [ /ASCII85Decode /FlateDecode ] /Length ${saida.length} >>\nstream\n${saida}\nendstream endobj\n`,
      'latin1'
    ),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'certificado.pdf', 'application/pdf');
  assert.equal(out.text, 'certificado de conclusao');
  assert.equal(out.note, null);
});

test('/Length declarado manda mais que a palavra endstream no meio do texto', () => {
  // Fluxo sem compressão pode ter esses nove bytes dentro do conteúdo. Achar
  // o fim procurando a palavra cortava a página ali, calada.
  const conteudo =
    'BT /F1 12 Tf (a palavra endstream aparece aqui) Tj 0 -14 Td (e a frase continua) Tj ET';
  const pdf = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R >> >> /Contents 3 0 R >> endobj\n' +
      '2 0 obj << /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >> endobj\n' +
      `3 0 obj << /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream endobj\n` +
      'trailer<</Root 1 0 R>>\n%%EOF',
    'latin1'
  );

  const out = extractText(pdf, 'length.pdf', 'application/pdf');
  assert.equal(out.text, 'a palavra endstream aparece aqui\ne a frase continua');
});

test('/Length que mente não é obedecido: vale o que o arquivo mostra', () => {
  const conteudo = 'BT /F1 12 Tf (frase inteira do documento) Tj ET';
  const pdf = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R >> >> /Contents 3 0 R >> endobj\n' +
      '2 0 obj << /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >> endobj\n' +
      `3 0 obj << /Length 7 >>\nstream\n${conteudo}\nendstream endobj\n` +
      'trailer<</Root 1 0 R>>\n%%EOF',
    'latin1'
  );

  const out = extractText(pdf, 'mentira.pdf', 'application/pdf');
  assert.equal(out.text, 'frase inteira do documento');
});

test('código que o mapa da fonte não cobre cai na tabela declarada, em vez de sumir', () => {
  // CMap costuma mapear só o que a fonte usa. Descartar o resto engolia
  // trechos inteiros sem nenhum sinal de que algo tinha sido perdido.
  const cmap = `begincmap
1 begincodespacerange <00> <ff> endcodespacerange
1 beginbfchar
<41> <0041>
endbfchar
endcmap`;

  const pdf = Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n1 0 obj << /Type /Page /Resources << /Font << /F1 2 0 R >> >> /Contents 4 0 R >> endobj\n' +
        '2 0 obj << /Type /Font /Subtype /TrueType /Encoding /WinAnsiEncoding /ToUnicode 3 0 R >> endobj\n',
      'latin1'
    ),
    ESPACO,
    objetoFluxo(3, cmap),
    ESPACO,
    objetoFluxo(4, 'BT /F1 12 Tf (ABC) Tj ET'),
    Buffer.from('trailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);

  const out = extractText(pdf, 'parcial.pdf', 'application/pdf');
  assert.equal(out.text, 'ABC');
});

test('entidade numérica quebrada no EPUB não derruba a leitura do livro', () => {
  // `&#99999999;` não é caractere nenhum, e converter isso responde com
  // exceção — que subia até o upload e derrubava o pedido inteiro.
  const capitulo = (corpo) =>
    zipEpub([
      { name: 'OEBPS/cap1.xhtml', data: Buffer.from(`<html><body>${corpo}</body></html>`, 'utf8') }
    ]);

  const fora = extractText(capitulo('<p>capitulo com &#99999999; no meio</p>'), 'l.epub');
  assert.match(fora.text, /capitulo com/);
  assert.match(fora.text, /&#99999999;/, 'entidade impossível fica como veio, à vista');

  const substituto = extractText(capitulo('<p>meio de par &#55296; aqui</p>'), 'l.epub');
  assert.equal(substituto.text, 'meio de par aqui', 'metade de par substituto não é texto');

  const boa = extractText(capitulo('<p>caf&#233; e &#x2014; tra&ccedil;o</p>'), 'l.epub');
  assert.equal(boa.text, 'café e — traço');
});

test('arquivo que derruba o leitor vira aviso, não erro no upload', () => {
  // Cada leitor desmonta formato binário escrito por outra pessoa. O usuário
  // vai mandar um arquivo estranho, e o certo é o anexo aparecer na tela
  // dizendo o que houve — não o pedido inteiro cair.
  const restos = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37) % 256)),
    Buffer.from('\nstream\n'),
    Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 91) % 256)),
    Buffer.from('\nendstream\n%%EOF')
  ]);
  const out = extractText(restos, 'quebrado.pdf', 'application/pdf');
  assert.equal(typeof out.text, 'string');
  assert.equal(out.kind, 'pdf');
  assert.ok(out.note, 'sem texto, tem que sair com aviso');
});
