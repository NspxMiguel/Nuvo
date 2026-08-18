// Texto de arquivo, sem dependência.
//
// Texto puro e código saem diretos. PDF e DOCX precisam de trabalho: o PDF é
// desmontado no nível dos operadores de texto e o DOCX é um ZIP com XML dentro.
// Nenhum dos dois vira um extrator perfeito — quando não dá, a função devolve o
// que conseguiu e diz o que faltou, em vez de fingir que leu.

import { inflateSync, inflateRawSync } from 'node:zlib';
import { extname } from 'node:path';

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.rst', '.log', '.csv', '.tsv', '.json', '.jsonl',
  '.yaml', '.yml', '.toml', '.ini', '.env', '.xml', '.html', '.htm', '.svg',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh',
  '.zsh', '.bash', '.sql', '.css', '.scss', '.vue', '.svelte', '.lua', '.r',
  '.pl', '.dart', '.ex', '.exs', '.gradle', '.make', '.dockerfile', '.gitignore'
]);

/**
 * Texto do arquivo, com a codificação descoberta em vez de suposta.
 *
 * `buffer.toString('utf8')` não falha nunca: byte inválido vira U+FFFD, o
 * losango com a interrogação. Arquivo salvo em latin1 ou cp1252 — que é o que
 * sai de Excel, de sistema antigo e de muito .txt em português — chegava ao
 * modelo com todo acento trocado por esse losango, sem aviso nenhum.
 *
 * @returns {{text: string, note: string|null}}
 */
export function decodeText(buffer) {
  // BOM manda mais que qualquer palpite.
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), note: null };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), note: null };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buffer.subarray(3)), note: null };
  }

  try {
    // `fatal` é o que transforma "byte inválido" em erro em vez de losango.
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), note: null };
  } catch {
    // Não era UTF-8. O windows-1252 é o palpite certo pra quase todo arquivo
    // ocidental que sobrou, e é superconjunto do latin1.
    return {
      text: new TextDecoder('windows-1252').decode(buffer),
      note: 'o arquivo não estava em UTF-8; li como windows-1252 (latin1)'
    };
  }
}

/** Heurística pra decidir se um arquivo sem extensão conhecida é texto. */
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 4096);
  if (sample.includes(0)) return false;
  let weird = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) weird++;
  }
  return weird / Math.max(sample.length, 1) < 0.05;
}

// ---------------------------------------------------------------------- ZIP

/**
 * Leitor de ZIP mínimo: só o necessário pra abrir DOCX, PPTX e EPUB, que são
 * ZIP com XML dentro. Lê o diretório central e devolve os arquivos pedidos.
 */
function unzip(buffer, wanted) {
  const out = new Map();
  // Assinatura do fim do diretório central: 0x06054b50.
  let end = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return out;

  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);

  for (let i = 0; i < count && pos + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compressed = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    if (wanted && !wanted(name)) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(start, start + compressed);
    try {
      // Teto de saída: um docx de 400 kB pode declarar entradas que abrem em
      // centenas de MB, e sem limite o processo morre antes de qualquer
      // validação. Entrada acima do teto simplesmente não entra.
      out.set(name, method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: MAX_INFLADO }));
    } catch {
      /* entrada corrompida, grande demais ou método não suportado: pula */
    }
  }
  return out;
}

function xmlText(xml) {
  return String(xml)
    // Quebra de parágrafo e de linha do OOXML viram quebra de verdade.
    .replace(/<\/w:p>|<w:br\s*\/>|<\/a:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fromDocx(buffer) {
  const files = unzip(buffer, (n) => n === 'word/document.xml');
  const doc = files.get('word/document.xml');
  if (!doc) return { text: '', note: 'não achei word/document.xml dentro do arquivo' };
  return { text: xmlText(decodeText(doc).text) };
}

function fromPptx(buffer) {
  const files = unzip(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = [...files.entries()]
    .sort((a, b) => Number(a[0].match(/\d+/)[0]) - Number(b[0].match(/\d+/)[0]))
    .map(([name, data], i) => `## Slide ${i + 1}\n${xmlText(decodeText(data).text)}`);
  if (!slides.length) return { text: '', note: 'nenhum slide legível' };
  return { text: slides.join('\n\n') };
}

// Entidades HTML que aparecem de verdade em livro: aspas curvas, travessão,
// reticências, espaço fixo. O XML só define cinco, e o `xmlText` do OOXML só
// conhecia essas — num EPUB elas ficavam escritas na tela como "&nbsp;".
const ENTIDADES = {
  nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  deg: '°', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', sect: '§',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', ccedil: 'ç', eacute: 'é',
  ecirc: 'ê', iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú'
};

/**
 * Ponto de código de uma entidade numérica, ou a entidade como veio.
 *
 * `&#99999999;` não é caractere nenhum, e `String.fromCodePoint` responde a
 * isso com exceção. Num livro com uma entidade quebrada — e livro convertido
 * por ferramenta tem —, a exceção subia até o upload e derrubava o pedido
 * inteiro, em vez de o capítulo sair com um pedaço estranho.
 */
function pontoDeCodigo(n, original) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return original;
  // Metade de par substituto sozinha não é texto: gravada no banco ela vira
  // U+FFFD na volta, e some sem ninguém saber por quê.
  if (n >= 0xd800 && n <= 0xdfff) return '';
  return String.fromCodePoint(n);
}

/** Texto de um XHTML de EPUB: estrutura de página, não de documento do Word. */
function htmlText(html) {
  return String(html)
    // Estilo e script não são conteúdo do livro — viravam parágrafo de CSS.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // O que fecha bloco vira quebra: sem isso o capítulo inteiro saía numa linha.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)\s*>/gi, '\n\n')
    .replace(/<\/(td|th)\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (todo, hex) => pontoDeCodigo(parseInt(hex, 16), todo))
    .replace(/&#(\d+);/g, (todo, dec) => pontoDeCodigo(Number(dec), todo))
    .replace(/&(\w+);/g, (todo, nome) => {
      const basico = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[nome];
      return basico ?? ENTIDADES[nome.toLowerCase()] ?? todo;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fromEpub(buffer) {
  // Ordem de leitura: os nomes dos capítulos quase sempre carregam o número, e
  // a ordem do zip não é a do livro.
  const files = unzip(buffer, (n) => /\.x?html?$/i.test(n));
  const ordenados = [...files.entries()].sort(([a], [b]) =>
    a.localeCompare(b, 'en', { numeric: true })
  );
  const parts = ordenados.map(([, d]) => htmlText(decodeText(d).text)).filter(Boolean);
  if (!parts.length) return { text: '', note: 'nenhum capítulo legível' };
  return { text: parts.join('\n\n') };
}

// ---------------------------------------------------------------------- PDF
//
// O PDF não guarda texto: guarda instruções de desenho, e a letra que cada
// código representa depende da fonte que estava valendo naquele ponto. Ler o
// arquivo com expressão regular funciona até a primeira página que use
// parêntese dentro da frase, kerning entre as palavras ou duas fontes com o
// mesmo apelido — e todas as três são comuns. Daí a estrutura aqui: um índice
// de objetos, um mapa de fontes por página, e um analisador do fluxo de
// conteúdo que lê símbolo por símbolo.

/** Escapes do PDF dentro de string literal: \n, \t, \( e octal \053. */
function unescapePdf(text) {
  return text.replace(/\\(\n|n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (_, code) => {
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
    if (code === '\n') return ''; // barra no fim da linha só emenda a linha
    if (simple[code] !== undefined) return simple[code];
    return String.fromCharCode(parseInt(code, 8));
  });
}

// PDF chama de /Encoding a tabela que liga byte a caractere, e são duas na
// prática: a do Windows e a do Mac. Ler tudo como latin1 — byte igual a ponto
// de código — acerta só o miolo: no windows-1252 a faixa 0x80–0x9F virava
// controle invisível (lá moram aspas curvas, travessão e reticências), e num
// PDF feito no Mac o acento inteiro sai trocado, porque `ó` é 0x97 lá e
// travessão aqui. As duas tabelas já existem no `TextDecoder`; escrever à mão
// seria copiar 256 linhas que o runtime tem certas.
const PADRAO = 'windows-1252';
const TABELAS = new Map();

function tabelaBase(nome) {
  let tabela = TABELAS.get(nome);
  if (!tabela) {
    const decoder = new TextDecoder(nome);
    tabela = Array.from({ length: 256 }, (_, b) => decoder.decode(new Uint8Array([b])));
    TABELAS.set(nome, tabela);
  }
  return tabela;
}

/** Byte de fonte que não foi identificada: o palpite é o do Windows. */
function byteWinAnsi(b) {
  return tabelaBase(PADRAO)[b];
}

// Nome de glifo do /Differences. Os compostos são gerados em vez de tabelados:
// `eacute` é `e` mais o acento agudo combinante, normalizado. Cobre a família
// inteira (`atilde`, `ccedilla`, `Ocircumflex`…) sem lista de trezentas linhas.
const ACENTOS = {
  acute: '\u0301', grave: '\u0300', circumflex: '\u0302', tilde: '\u0303',
  dieresis: '\u0308', cedilla: '\u0327', ring: '\u030a', caron: '\u030c',
  macron: '\u0304', breve: '\u0306', ogonek: '\u0328', dotaccent: '\u0307',
  hungarumlaut: '\u030b'
};
const GLIFOS = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$',
  percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')',
  asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<',
  equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_',
  braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  quoteleft: '‘', quoteright: '’', quotedblleft: '“',
  quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„',
  endash: '–', emdash: '—', ellipsis: '…', bullet: '•',
  dagger: '†', daggerdbl: '‡', perthousand: '‰',
  fi: 'ﬁ', fl: 'ﬂ', ff: 'ﬀ', ffi: 'ﬃ', ffl: 'ﬄ',
  germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ',
  eth: 'ð', Eth: 'Ð', thorn: 'þ', Thorn: 'Þ',
  degree: '°', plusminus: '±', euro: '€', sterling: '£',
  yen: '¥', cent: '¢', section: '§', paragraph: '¶',
  copyright: '©', registered: '®', trademark: '™',
  ordfeminine: 'ª', ordmasculine: 'º', guillemotleft: '«',
  guillemotright: '»', questiondown: '¿', exclamdown: '¡',
  multiply: '×', divide: '÷', minus: '−', fraction: '⁄',
  currency: '¤', brokenbar: '¦', logicalnot: '¬',
  onesuperior: '¹', twosuperior: '²', threesuperior: '³',
  onequarter: '¼', onehalf: '½', threequarters: '¾',
  mu: 'µ', middot: '·', dotlessi: 'ı', florin: 'ƒ'
};

function glifoParaTexto(nome) {
  if (Object.hasOwn(GLIFOS, nome)) return GLIFOS[nome];
  if (/^[A-Za-z]$/.test(nome)) return nome;
  // `uni00E9` e `u00E9`: o próprio ponto de código, escrito no nome.
  const direto = /^uni([0-9A-Fa-f]{4})$/.exec(nome) || /^u([0-9A-Fa-f]{4,6})$/.exec(nome);
  if (direto) {
    const cp = parseInt(direto[1], 16);
    return cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? null : String.fromCodePoint(cp);
  }
  const composto = /^([A-Za-z])([a-z]+)$/.exec(nome);
  if (composto && Object.hasOwn(ACENTOS, composto[2])) {
    return (composto[1] + ACENTOS[composto[2]]).normalize('NFC');
  }
  return null; // glifo desenhado (logo, ícone): não tem letra correspondente
}

/** Hexadecimal de destino do CMap: pares de 4 dígitos, UTF-16BE. */
function hexParaTexto(hex) {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex, 16));
  let out = '';
  for (let i = 0; i + 3 < hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

// Teto de entradas por CMap. Um `beginbfrange` pode declarar <0000> <FFFF>, e
// nada impede um arquivo de declarar centenas deles: sem teto, poucos kB de PDF
// viram gigabytes de Map antes de qualquer validação.
const MAX_CMAP = 65536;

/**
 * CMap do /ToUnicode: é ele que diz o que cada código da fonte quer dizer.
 *
 * Fonte de subconjunto — a que sai de qualquer gerador moderno — numera os
 * glifos a partir de 1, na ordem em que aparecem no documento. Sem este mapa os
 * bytes do fluxo não são texto em codificação nenhuma: são índices.
 */
function parseCMap(text) {
  const mapa = new Map();

  // Quantos bytes formam um código sai das próprias entradas, não do
  // /begincodespacerange. Fonte simples de um byte costuma declarar
  // <0000> <FFFF> por descuido do gerador e mapear com `<41> <0041>`: acreditar
  // no cabeçalho fazia ler dois bytes por vez e apagar o texto inteiro do PDF.
  const origens = [...text.matchAll(/<([0-9A-Fa-f]+)>\s*(?:<[0-9A-Fa-f]*>|\[)/g)];
  let largura = 2;
  if (origens.length) {
    // A mais frequente entre as entradas: uma linha torta não muda a leitura.
    const contagem = new Map();
    for (const m of origens) {
      const bytes = Math.max(1, Math.min(4, Math.ceil(m[1].length / 2)));
      contagem.set(bytes, (contagem.get(bytes) || 0) + 1);
    }
    largura = [...contagem].sort((a, b) => b[1] - a[1])[0][0];
  } else {
    const espaco = /begincodespacerange([\s\S]{0,4000}?)endcodespacerange/.exec(text);
    const primeiro = espaco && /<([0-9A-Fa-f]+)>/.exec(espaco[1]);
    if (primeiro) largura = Math.max(1, Math.min(4, Math.ceil(primeiro[1].length / 2)));
  }

  for (const bloco of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (mapa.size >= MAX_CMAP) break;
      mapa.set(parseInt(par[1], 16), hexParaTexto(par[2]));
    }
  }
  for (const bloco of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    for (const m of bloco[1].matchAll(re)) {
      if (mapa.size >= MAX_CMAP) break;
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + (MAX_CMAP - mapa.size));
      if (hi < lo) continue;
      if (m[3] !== undefined) {
        // Faixa contínua: o destino anda junto com o código de origem.
        const base = parseInt(m[3], 16);
        const digitos = m[3].length;
        for (let c = lo; c <= hi; c++) {
          mapa.set(c, hexParaTexto((base + c - lo).toString(16).padStart(digitos, '0')));
        }
      } else {
        [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((d, i) => {
          if (lo + i <= hi) mapa.set(lo + i, hexParaTexto(d[1]));
        });
      }
    }
  }
  return mapa.size ? { mapa, largura } : null;
}

/**
 * Tabela de 256 posições da fonte: a base que ela declarou, com o /Differences
 * por cima. É o /Differences que dá nome a cada posição trocada — `eacute` no
 * lugar do byte 233 —, e sem ele a base sozinha já resolve o texto comum.
 */
function tabelaDeEncoding(dict) {
  const base = /\/MacRomanEncoding\b/.test(dict) ? 'macintosh' : PADRAO;
  const tabela = tabelaBase(base).slice();
  // Declarou de verdade, ou é o palpite? A diferença importa quando a fonte
  // também tem CMap: aí o que o CMap não cobre só pode cair na tabela se o
  // arquivo tiver dito que aqueles bytes significam alguma coisa.
  tabela.declarada = /\/(?:WinAnsi|MacRoman|MacExpert|Standard)Encoding\b|\/Differences\b/.test(dict);

  const diferencas = /\/Differences\s*\[([\s\S]*?)\]/.exec(dict);
  if (diferencas) {
    let code = 0;
    for (const item of diferencas[1].matchAll(/(\d+)|\/([^\s/\][()<>]+)/g)) {
      if (item[1] !== undefined) {
        code = Number(item[1]);
      } else if (code < 256) {
        const letra = glifoParaTexto(item[2]);
        if (letra !== null) tabela[code] = letra;
        code += 1;
      }
    }
  }
  return tabela;
}

// Teto de texto por fluxo. Um bfchar pode mapear um código para uma string
// longa; multiplicado pelos bytes da página, isso sozinho estoura a memória.
const MAX_TEXTO_FLUXO = 4 * 1024 * 1024;

// Teto do documento inteiro. Um livro de cinco mil páginas dá uns 9 milhões de
// caracteres; acima de 32 milhões não é mais documento, é arquivo montado pra
// derrubar o servidor — e derrubava: 30 MB de PDF viravam 527 MB de texto.
const MAX_TEXTO_TOTAL = 32 * 1024 * 1024;

/** Decodifica os bytes de uma string literal com o que a fonte declarou. */
function bytesComFonte(bytes, fonte) {
  if (fonte?.cmap) {
    const { mapa, largura } = fonte.cmap;
    // CMap incompleto é comum: mapeia o que a fonte usa e ignora o resto.
    // Jogar fora o que ele não cobre engolia trechos inteiros em silêncio.
    const sobra = largura === 1 && fonte.tabela?.declarada ? fonte.tabela : null;
    let out = '';
    for (let i = 0; i + largura <= bytes.length && out.length < MAX_TEXTO_FLUXO; i += largura) {
      let code = 0;
      for (let k = 0; k < largura; k++) code = (code << 8) | (bytes.charCodeAt(i + k) & 0xff);
      out += mapa.get(code) ?? sobra?.[code] ?? '';
    }
    return out;
  }
  let out = '';
  for (let i = 0; i < bytes.length && out.length < MAX_TEXTO_FLUXO; i++) {
    const b = bytes.charCodeAt(i) & 0xff;
    out += fonte?.tabela?.[b] ?? byteWinAnsi(b);
  }
  return out;
}

/**
 * Decodifica string hexadecimal.
 *
 * Quantos bytes formam um código é a fonte que decide, não o tamanho da string:
 * decidir pela paridade dos dígitos fazia `<41424344>` numa fonte comum de um
 * byte virar dois ideogramas chineses em vez de "ABCD".
 */
function hexComFonte(hex, fonte) {
  const passo = fonte?.cmap ? fonte.cmap.largura * 2 : fonte?.tabela ? 2 : 4;
  let out = '';
  for (let i = 0; i + passo <= hex.length && out.length < MAX_TEXTO_FLUXO; i += passo) {
    const code = parseInt(hex.slice(i, i + passo), 16);
    if (fonte?.cmap) out += fonte.cmap.mapa.get(code) ?? '';
    else if (fonte?.tabela) out += fonte.tabela[code] ?? byteWinAnsi(code);
    else if (code > 8 && code < 0xfffd) out += String.fromCharCode(code);
  }
  // Sobrou meio código no fim (dígitos ímpares): o PDF manda completar com zero.
  const resto = hex.length % passo;
  if (resto && out.length < MAX_TEXTO_FLUXO) {
    const code = parseInt(hex.slice(-resto).padEnd(passo, '0'), 16);
    if (fonte?.cmap) out += fonte.cmap.mapa.get(code) ?? '';
    else if (fonte?.tabela) out += fonte.tabela[code] ?? byteWinAnsi(code);
  }
  return out;
}

const DELIMITADOR = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const ESPACO = new Set([' ', '\t', '\r', '\n', '\f', '\0']);

/**
 * Percorre o fluxo de conteúdo devolvendo um símbolo por vez.
 *
 * Escrito à mão porque expressão regular não dá conta de parêntese aninhado
 * dentro de string — `(total (com desconto) aprovado)` é uma string só — e
 * porque tentar dar conta com alternância aninhada é o que fazia um arquivo com
 * parêntese solto travar o processo por segundos.
 */
function* simbolos(s) {
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];

    if (ESPACO.has(c)) {
      i++;
    } else if (c === '%') {
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
    } else if (c === '(') {
      let nivel = 1;
      let j = i + 1;
      let bruto = '';
      while (j < n) {
        const d = s[j];
        if (d === '\\') {
          bruto += d + (s[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (d === '(') nivel++;
        else if (d === ')' && --nivel === 0) break;
        bruto += d;
        j++;
      }
      yield { t: 'str', v: unescapePdf(bruto) };
      i = j + 1;
    } else if (c === '<' && s[i + 1] === '<') {
      yield { t: 'abre-dict' };
      i += 2;
    } else if (c === '>' && s[i + 1] === '>') {
      yield { t: 'fecha-dict' };
      i += 2;
    } else if (c === '<') {
      const fim = s.indexOf('>', i + 1);
      if (fim < 0) return;
      yield { t: 'hex', v: s.slice(i + 1, fim).replace(/[^0-9A-Fa-f]/g, '') };
      i = fim + 1;
    } else if (c === '[' || c === ']') {
      yield { t: c };
      i++;
    } else if (c === '/') {
      let j = i + 1;
      while (j < n && !ESPACO.has(s[j]) && !DELIMITADOR.has(s[j])) j++;
      yield { t: 'name', v: s.slice(i + 1, j) };
      i = j;
    } else if (c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) {
      let j = i + 1;
      while (j < n && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.' || s[j] === '-' || s[j] === '+')) j++;
      yield { t: 'num', v: Number(s.slice(i, j)) || 0 };
      i = j;
    } else if (/[A-Za-z'"*]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9*'"]/.test(s[j])) j++;
      const op = s.slice(i, j);
      i = j;
      if (op === 'BI') {
        // Imagem embutida: entre `ID` e `EI` vêm bytes crus, que não são código.
        const fim = s.indexOf('EI', i);
        i = fim < 0 ? n : fim + 2;
        continue;
      }
      yield { t: 'op', v: op };
    } else {
      i++;
    }
  }
}

// Deslocamento no TJ, em milésimos de em. Valor bem negativo é o gerador
// abrindo espaço entre palavras — sem traduzir isso, "Bem vindo ao Brasil" sai
// "BemvindoaoBrasil", que é como o texto de qualquer PDF diagramado chegava.
const KERNING_VIRA_ESPACO = -100;

/** Junta as strings dos operadores de texto de um fluxo já descomprimido. */
function textFromContentStream(content, fontes, estado = {}) {
  const linhas = [];
  let linha = [];
  let pilha = [];
  let array = null;

  const decodificar = (item, fonte) =>
    item?.t === 'str' ? bytesComFonte(item.v, fonte)
    : item?.t === 'hex' ? hexComFonte(item.v, fonte)
    : '';

  const fechar = () => {
    if (linha.length) {
      linhas.push(linha.join(''));
      linha = [];
    }
  };
  const escrever = (texto) => {
    if (texto) linha.push(texto);
  };

  for (const s of simbolos(content)) {
    if (s.t === '[') {
      array = [];
      continue;
    }
    if (s.t === ']') {
      pilha.push({ t: 'array', v: array || [] });
      array = null;
      continue;
    }
    if (s.t !== 'op') {
      (array || pilha).push(s);
      continue;
    }

    switch (s.v) {
      case 'Tf': {
        const nome = [...pilha].reverse().find((x) => x.t === 'name');
        if (nome) estado.fonte = fontes?.get(nome.v) ?? null;
        break;
      }
      case 'Tj':
        escrever(decodificar(pilha.at(-1), estado.fonte));
        break;
      case 'TJ': {
        const arr = pilha.at(-1);
        if (arr?.t === 'array') {
          let out = '';
          for (const item of arr.v) {
            if (item.t === 'num') {
              if (item.v <= KERNING_VIRA_ESPACO && !out.endsWith(' ')) out += ' ';
            } else {
              out += decodificar(item, estado.fonte);
            }
          }
          escrever(out);
        }
        break;
      }
      case "'":
      case '"':
        // Mostram o texto DEPOIS de passar pra linha seguinte.
        fechar();
        escrever(decodificar(pilha.at(-1), estado.fonte));
        break;
      case 'Td':
      case 'TD': {
        // Só quebra linha quem desceu na página. Um gerador de HTML posiciona
        // cada pedaço da MESMA linha com Td horizontal: tratar isso como troca
        // de linha devolvia uma letra por linha, e o resultado nem parecia
        // texto — a página inteira acabava descartada como se fosse imagem.
        const ty = pilha.at(-1)?.t === 'num' ? pilha.at(-1).v : 0;
        if (ty !== 0) {
          fechar();
          estado.y = (estado.y ?? 0) + ty;
        }
        break;
      }
      case 'Tm': {
        // A matriz é absoluta: o sexto número é a altura do texto na página.
        const nums = pilha.filter((x) => x.t === 'num');
        const y = nums.length >= 6 ? nums[5].v : null;
        if (y !== null && estado.y !== undefined && y !== estado.y) fechar();
        if (y !== null) estado.y = y;
        break;
      }
      case 'T*':
      case 'BT':
      case 'ET':
        fechar();
        break;
      default:
        break;
    }
    pilha = [];
  }
  fechar();
  return linhas.join('\n');
}

// Fluxo do PDF que não é página. Fonte embutida, perfil de cor, mapa de
// caracteres, metadados, imagem e o objeto que guarda outros objetos abrem com
// o mesmo FlateDecode do conteúdo — e descomprimidos viram binário que passava
// por "texto do documento" e ia parar no prompt do modelo.
const FLUXO_SEM_TEXTO =
  /\/(?:FontFile\d?|Length1|ToUnicode|ICCBased)\b|\/Subtype\s*\/(?:Type1C|TrueType|OpenType|CIDFontType0C|CIDFontType2|Image|XML)\b|\/Type\s*\/(?:Metadata|ObjStm|XRef|EmbeddedFile|Font|FontDescriptor|CMap)\b/;

// Teto de descompressão por fluxo: zip e PDF podem declarar poucos kB e abrir
// centenas de MB, e o processo morre antes de chegar a qualquer validação.
const MAX_INFLADO = 64 * 1024 * 1024;

/**
 * ASCII85: cinco caracteres imprimíveis para cada quatro bytes.
 *
 * É filtro de transporte, não de compressão — serve pra caber num arquivo que
 * precisa ser só texto. Vem antes do FlateDecode numa lista, e quem só olhava o
 * FlateDecode tentava descomprimir a codificação e desistia: a página inteira
 * era dada como digitalização em imagem.
 */
function ascii85(buf) {
  const out = Buffer.allocUnsafe(Math.ceil((buf.length * 4) / 5) + 4);
  let escritos = 0;
  let tupla = 0;
  let n = 0;
  const despejar = (quantos) => {
    for (let i = 0; i < quantos; i++) {
      out[escritos++] = Math.floor(tupla / 2 ** (24 - i * 8)) & 0xff;
    }
  };
  for (let i = 0; i < buf.length && escritos < out.length - 4; i++) {
    const c = buf[i];
    if (c === 0x7e) break; // "~>" fecha
    if (c <= 0x20) continue; // espaço em branco não conta
    if (c === 0x7a && n === 0) {
      // 'z' abrevia quatro zeros.
      out.fill(0, escritos, escritos + 4);
      escritos += 4;
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    tupla = tupla * 85 + (c - 0x21);
    if (++n === 5) {
      despejar(4);
      tupla = 0;
      n = 0;
    }
  }
  // Sobra parcial: completa com o maior dígito e guarda um byte a menos.
  if (n > 1) {
    for (let i = n; i < 5; i++) tupla = tupla * 85 + 84;
    despejar(n - 1);
  }
  return out.subarray(0, escritos);
}

/** ASCIIHexDecode: dois dígitos por byte, terminado em ">". */
function asciiHex(buf) {
  const texto = buf.toString('latin1');
  const fim = texto.indexOf('>');
  const hex = (fim < 0 ? texto : texto.slice(0, fim)).replace(/[^0-9A-Fa-f]/g, '');
  return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
}

/** Filtros de transporte, aplicados antes do descompressor. */
function desfazerTransporte(raw, header) {
  if (/\/ASCII85Decode\b/.test(header)) return ascii85(raw);
  if (/\/ASCIIHexDecode\b/.test(header)) return asciiHex(raw);
  return raw;
}

function inflar(raw, header = '') {
  const bytes = desfazerTransporte(raw, header);
  try {
    return inflateSync(bytes, { maxOutputLength: MAX_INFLADO });
  } catch {
    try {
      return inflateRawSync(bytes, { maxOutputLength: MAX_INFLADO });
    } catch {
      // Sem compressão nenhuma depois do transporte: o ASCII85 já era o filtro.
      return bytes === raw ? null : bytes;
    }
  }
}

/**
 * Índice dos objetos indiretos: número → posição e dicionário.
 *
 * Feito com busca de texto em vez de expressão regular sobre o arquivo todo:
 * num PDF de dezenas de MB o regex com quantificador preguiçoso custa segundos
 * e centenas de MB, e o resultado é o mesmo.
 */
// Quanto de um dicionário vale a pena guardar. O que se procura nele — /Type,
// /Font, /Resources, /ToUnicode — mora no começo; guardar o resto só ocupa.
const MAX_DICT = 8192;

function indexarObjetos(texto) {
  const objetos = [];

  // Onde está o próximo `endobj` e o próximo `stream`, lembrado entre uma volta
  // e outra. Procurar do zero a cada objeto parece inocente, mas quando o
  // marcador não existe mais à frente cada busca varre o arquivo inteiro: num
  // PDF de 4 MB com muitos objetos isso virava 39 segundos de espera.
  const proximo = { endobj: 0, stream: 0 };
  const acharDepois = (marca, desde) => {
    if (proximo[marca] !== -1 && proximo[marca] < desde) {
      proximo[marca] = texto.indexOf(marca, desde);
    }
    return proximo[marca];
  };

  let i = 0;
  while (i < texto.length) {
    const pos = texto.indexOf(' obj', i);
    if (pos < 0) break;
    i = pos + 4;

    // Antes do `obj` vêm o número do objeto e a geração.
    const antes = texto.slice(Math.max(0, pos - 24), pos);
    const cabeca = /(\d+)\s+(\d+)$/.exec(antes);
    if (!cabeca) continue;

    const fins = [acharDepois('endobj', i), acharDepois('stream', i)].filter((p) => p >= 0);
    const fimDict = fins.length ? Math.min(...fins) : texto.length;
    objetos.push({
      num: Number(cabeca[1]),
      inicio: pos - cabeca[0].length,
      dict: texto.slice(i, Math.min(fimDict, i + MAX_DICT))
    });
  }
  return objetos;
}

/**
 * Objetos guardados dentro de um /ObjStm, que é onde o PDF 1.5+ põe as fontes.
 *
 * Recebe o Buffer, e não a string inteira, de propósito: recortar uma string em
 * JavaScript deixa o pedaço apontando pro original, então quarenta objetos
 * pequenos de dentro de quarenta fluxos de 60 MB seguravam 2,5 GB de memória.
 * Cada dicionário sai do Buffer como string nova e curta.
 */
function objetosDeObjStm(header, aberto) {
  const n = Number(/\/N\s+(\d+)/.exec(header)?.[1]);
  const first = Number(/\/First\s+(\d+)/.exec(header)?.[1]);
  if (!n || !Number.isFinite(first) || first > aberto.length) return [];
  const pares = aberto.toString('latin1', 0, first).trim().split(/\s+/).map(Number);
  const objetos = [];
  for (let i = 0; i < Math.min(n, 100000); i++) {
    const num = pares[i * 2];
    const off = pares[i * 2 + 1];
    if (!Number.isFinite(num) || !Number.isFinite(off) || off < 0) break;
    const proximo = pares[i * 2 + 3];
    const fim = i + 1 < n && Number.isFinite(proximo) ? first + proximo : aberto.length;
    const inicio = Math.min(first + off, aberto.length);
    objetos.push({
      num,
      inicio: -1,
      dict: aberto.toString('latin1', inicio, Math.min(Math.max(fim, inicio), inicio + MAX_DICT))
    });
  }
  return objetos;
}

/** Todos os `stream ... endstream`, com o número do objeto que é dono de cada um. */
/** Depois do tamanho declarado só pode vir espaço e a palavra `endstream`. */
function confereFim(buffer, pos) {
  const depois = buffer.toString('latin1', pos, Math.min(pos + 20, buffer.length));
  return /^[\s\0]{0,4}endstream/.test(depois);
}

function lerFluxos(buffer, texto, objetos) {
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  const fluxos = [];
  const inicios = objetos.map((o) => o.inicio);
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start < 0) break;
    const end = buffer.indexOf(endMarker, start);
    if (end < 0) break;

    let from = start + marker.length;
    if (buffer[from] === 0x0d) from++;
    if (buffer[from] === 0x0a) from++;

    // O dono é o último objeto que abriu antes deste `stream` — busca binária
    // no índice, em vez de reler uma janela de bytes por fluxo.
    let lo = 0;
    let hi = inicios.length - 1;
    let dono = -1;
    while (lo <= hi) {
      const meio = (lo + hi) >> 1;
      if (inicios[meio] >= 0 && inicios[meio] < start) {
        dono = meio;
        lo = meio + 1;
      } else {
        hi = meio - 1;
      }
    }

    const header = dono >= 0 ? objetos[dono].dict : texto.slice(Math.max(0, start - 400), start);

    // O tamanho declarado manda mais que a busca pela palavra `endstream`.
    // Fluxo não comprimido pode ter esses nove bytes no meio do conteúdo, e aí
    // a página era cortada calada no ponto errado. Só vale quando o número está
    // no próprio dicionário e cabe no arquivo — /Length que aponta pra outro
    // objeto, ou que mente, cai na busca de novo.
    const declarado = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(header)?.[1]);
    const porTamanho = Number.isFinite(declarado) ? from + declarado : -1;
    const fim =
      porTamanho > from && porTamanho <= buffer.length && confereFim(buffer, porTamanho)
        ? porTamanho
        : end;

    fluxos.push({ num: dono >= 0 ? objetos[dono].num : null, header, raw: buffer.subarray(from, fim) });
    cursor = Math.max(fim, end) + endMarker.length;
  }
  return fluxos;
}

/** Referência indireta `12 0 R` → número do objeto. */
function referencia(valor) {
  const m = /^\s*(\d+)\s+\d+\s+R\b/.exec(valor || '');
  return m ? Number(m[1]) : null;
}

/** Conteúdo de uma chave do dicionário, com os `<< >>` internos respeitados. */
function valorDaChave(dict, chave) {
  const at = dict.indexOf(`/${chave}`);
  if (at < 0) return null;
  let i = at + chave.length + 1;
  while (i < dict.length && /\s/.test(dict[i])) i++;
  if (dict[i] === '<' && dict[i + 1] === '<') {
    let nivel = 0;
    const inicio = i;
    while (i < dict.length) {
      if (dict[i] === '<' && dict[i + 1] === '<') {
        nivel++;
        i += 2;
      } else if (dict[i] === '>' && dict[i + 1] === '>') {
        nivel--;
        i += 2;
        if (!nivel) break;
      } else i++;
    }
    return dict.slice(inicio, i);
  }
  if (dict[i] === '[') {
    const fim = dict.indexOf(']', i);
    return fim < 0 ? dict.slice(i) : dict.slice(i, fim + 1);
  }
  return dict.slice(i, i + 200);
}

/**
 * Monta, para cada página, o mapa nome-de-recurso (`/F1`) → decodificador.
 *
 * Por página, e não por documento: `/F1` é apelido local, e duas páginas do
 * mesmo arquivo costumam chamar de `/F1` fontes diferentes. Resolver uma vez só
 * fazia a segunda página sair com as letras da fonte da primeira.
 */
function mapearFontes(fluxos, objetos) {
  const dictPorObjeto = new Map();
  const cmapPorObjeto = new Map();
  for (const o of objetos) if (!dictPorObjeto.has(o.num)) dictPorObjeto.set(o.num, o.dict);

  // Teto do que se abre em busca de objeto comprimido. O arquivo pode declarar
  // dezenas de /ObjStm que abrem em dezenas de MB cada, e ninguém precisa de
  // tudo isso pra descobrir de quem é a fonte da página.
  let objStmAberto = 0;

  for (const fluxo of fluxos) {
    if (/\/Type\s*\/ObjStm\b/.test(fluxo.header)) {
      if (objStmAberto > 32 * 1024 * 1024) continue;
      const aberto = inflar(fluxo.raw, fluxo.header);
      if (aberto) {
        objStmAberto += aberto.length;
        for (const obj of objetosDeObjStm(fluxo.header, aberto)) {
          if (!dictPorObjeto.has(obj.num)) dictPorObjeto.set(obj.num, obj.dict);
        }
      }
      continue;
    }
    if (fluxo.num === null) continue;
    // Só vale a pena abrir o que pode ser CMap: mapa de caracteres é pequeno, e
    // abrir página grande à toa custa tempo em documento de centenas de MB.
    if (!/\/Type\s*\/CMap\b|\/ToUnicode\b/.test(fluxo.header) && fluxo.raw.length > 256 * 1024) continue;
    const aberto = inflar(fluxo.raw, fluxo.header) ?? fluxo.raw;
    const texto = aberto.toString('latin1');
    if (!texto.includes('begincmap')) continue;
    const cmap = parseCMap(texto);
    if (cmap) cmapPorObjeto.set(fluxo.num, cmap);
  }

  const fontePorObjeto = new Map();
  const fonteDe = (num) => {
    if (fontePorObjeto.has(num)) return fontePorObjeto.get(num);
    const dict = dictPorObjeto.get(num);
    if (!dict || !/\/Type\s*\/Font\b/.test(dict)) return null;

    const toUnicode = referencia(valorDaChave(dict, 'ToUnicode'));
    // O /Encoding pode ser um nome, um dicionário embutido, ou uma referência
    // pra outro objeto — e no último caso o /Differences mora lá.
    const encoding = valorDaChave(dict, 'Encoding') || '';
    const encRef = referencia(encoding);
    const encDict = encRef !== null ? dictPorObjeto.get(encRef) || '' : encoding;

    const fonte = {
      cmap: toUnicode !== null ? cmapPorObjeto.get(toUnicode) ?? null : null,
      tabela: tabelaDeEncoding(`${encDict} ${dict}`)
    };
    fontePorObjeto.set(num, fonte);
    return fonte;
  };

  /** Nome → decodificador, a partir de um dicionário /Resources. */
  const doRecurso = (recursos) => {
    const mapa = new Map();
    const fontes = valorDaChave(recursos, 'Font');
    if (!fontes) return mapa;
    const alvo = referencia(fontes) !== null ? dictPorObjeto.get(referencia(fontes)) || '' : fontes;
    for (const par of alvo.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fonte = fonteDe(Number(par[2]));
      if (fonte) mapa.set(par[1], fonte);
    }
    return mapa;
  };

  // Uma entrada por página, e uma de reserva com tudo que existe no arquivo —
  // usada quando um fluxo de conteúdo não pôde ser ligado a nenhuma página.
  const paginas = [];
  const reserva = new Map();
  const anotarReserva = (fontes) => {
    for (const [nome, fonte] of fontes) if (!reserva.has(nome) || fonte.cmap) reserva.set(nome, fonte);
  };

  for (const [, dict] of dictPorObjeto) {
    if (!/\/Type\s*\/Page\b/.test(dict)) {
      // Dicionário que não é página mas declara /Resources — formulário, padrão
      // de preenchimento — entra só na reserva.
      if (dict.includes('/Font')) anotarReserva(doRecurso(dict));
      continue;
    }
    const recursos = valorDaChave(dict, 'Resources') || '';
    const alvo = referencia(recursos) !== null ? dictPorObjeto.get(referencia(recursos)) || '' : recursos;
    const fontes = doRecurso(alvo);

    const conteudo = valorDaChave(dict, 'Contents') || '';
    const streams = [...conteudo.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    paginas.push({ fontes, streams });
    anotarReserva(fontes);
  }

  return { paginas, reserva };
}

function fromPdf(buffer) {
  const parts = [];
  let failed = 0;
  let total = 0;

  const texto = buffer.toString('latin1');
  const objetos = indexarObjetos(texto);
  const fluxos = lerFluxos(buffer, texto, objetos);
  const { paginas, reserva } = mapearFontes(fluxos, objetos);

  const fluxoPorObjeto = new Map();
  for (const f of fluxos) if (f.num !== null && !fluxoPorObjeto.has(f.num)) fluxoPorObjeto.set(f.num, f);

  /** Conteúdo legível de um fluxo, ou null. */
  const abrir = (fluxo) => {
    if (!fluxo || FLUXO_SEM_TEXTO.test(fluxo.header)) return null;
    if (/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode/.test(fluxo.header)) return null;
    if (!/FlateDecode|ASCII85Decode|ASCIIHexDecode/.test(fluxo.header)) {
      return fluxo.raw.toString('latin1');
    }
    const aberto = inflar(fluxo.raw, fluxo.header);
    if (!aberto) {
      failed++;
      return null;
    }
    return aberto.toString('latin1');
  };

  const usados = new Set();

  // Primeiro as páginas declaradas: cada uma com as fontes dela, e com todos os
  // fluxos do /Contents lidos como um só — o operador Tf da primeira metade
  // continua valendo na segunda, e uma metade sem `BT` não descarta a outra.
  for (const pagina of paginas) {
    const pedacos = [];
    for (const num of pagina.streams) {
      const fluxo = fluxoPorObjeto.get(num);
      if (!fluxo) continue;
      usados.add(num);
      const conteudo = abrir(fluxo);
      if (conteudo) pedacos.push(conteudo);
    }
    if (!pedacos.length) continue;
    const inteiro = pedacos.join('\n');
    if (!/\bBT\b/.test(inteiro)) continue;
    const saida = textFromContentStream(inteiro, pagina.fontes, {});
    if (/\p{L}{2,}/u.test(saida)) {
      parts.push(saida);
      total += saida.length;
      if (total > MAX_TEXTO_TOTAL) break;
    }
  }

  // Depois o que sobrou: arquivo cuja árvore de páginas não deu pra seguir.
  for (const fluxo of fluxos) {
    if (fluxo.num !== null && usados.has(fluxo.num)) continue;
    const conteudo = abrir(fluxo);
    // Página de verdade abre bloco de texto. Sem esta conferência, binário que
    // por acaso tivesse os bytes de `Tj` era lido como se fosse frase.
    if (!conteudo || !/\bBT\b/.test(conteudo)) continue;
    const saida = textFromContentStream(conteudo, reserva, {});
    // Basta ter palavra de verdade: um corte por tamanho descartaria a página
    // que só tem um título curto.
    if (/\p{L}{2,}/u.test(saida)) {
      parts.push(saida);
      total += saida.length;
      if (total > MAX_TEXTO_TOTAL) break;
    }
  }

  const resultado = parts
    .join('\n\n')
    // Ligadura tipográfica é um glifo só no papel, mas quem procura "confirmação"
    // não digita o "fi" grudado: desfazer aqui é o que faz a busca achar.
    .replace(/[ﬀﬁﬂﬃﬄﬅ]/g, (l) => ({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st' })[l])
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!resultado) {
    return {
      text: '',
      note:
        fluxos.length === 0
          ? 'PDF sem fluxo de conteúdo legível'
          : 'PDF sem texto extraível — provavelmente é digitalização em imagem, que precisaria de OCR'
    };
  }

  const avisos = [];
  if (failed) avisos.push(`${failed} fluxo(s) do PDF não abriram`);
  // Controle C1 no resultado é a assinatura de fonte cuja codificação não deu
  // pra descobrir. Melhor dizer que a leitura saiu torta do que entregar a
  // frase furada como se fosse o documento.
  // Seis caracteres estranhos em trezentos mil é um logotipo, não uma leitura
  // errada: avisar ali só ensina o usuário a ignorar o aviso.
  const controles = (resultado.match(/[\u0080-\u009f]/g) || []).length;
  if (controles >= 8 && controles / resultado.length > 0.002) {
    avisos.push(
      'parte do PDF usa fonte sem mapa de caracteres legível; alguns símbolos podem ter saído errados'
    );
  }
  return { text: resultado, note: avisos.join('; ') || null };
}

// ------------------------------------------------------------------ entrada

/**
 * @returns {{text: string, note: string|null, kind: string}}
 */
/**
 * Envelope que garante o contrato: ler arquivo do usuário devolve um resultado,
 * nunca uma exceção.
 *
 * Cada leitor aqui desmonta formato binário escrito por outra pessoa. Um
 * arquivo estranho — e o usuário vai mandar um — não pode derrubar o pedido de
 * upload: o certo é o anexo aparecer na tela dizendo o que houve.
 */
function comRede(nome, ler) {
  try {
    return ler();
  } catch (err) {
    return { text: '', note: `não consegui ler este ${nome}: ${err.message.slice(0, 120)}` };
  }
}

export function extractText(buffer, filename = '', mime = '') {
  const ext = extname(filename).toLowerCase();

  if (ext === '.pdf' || mime === 'application/pdf') {
    return { ...comRede('PDF', () => fromPdf(buffer)), kind: 'pdf' };
  }
  if (ext === '.docx') return { ...comRede('DOCX', () => fromDocx(buffer)), kind: 'docx' };
  if (ext === '.pptx') return { ...comRede('PPTX', () => fromPptx(buffer)), kind: 'pptx' };
  if (ext === '.epub') return { ...comRede('EPUB', () => fromEpub(buffer)), kind: 'epub' };

  if (TEXT_EXT.has(ext) || (mime || '').startsWith('text/') || looksLikeText(buffer)) {
    return { ...comRede('arquivo', () => decodeText(buffer)), kind: 'texto' };
  }

  return {
    text: '',
    note: `não sei ler ${ext || mime || 'este formato'} — mande texto, código, PDF, DOCX, PPTX ou EPUB`,
    kind: 'desconhecido'
  };
}
