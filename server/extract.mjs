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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
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

/** Escapes do PDF dentro de string literal: \n, \t, \( e octal \053. */
function unescapePdf(text) {
  return text.replace(/\\(n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (_, code) => {
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
    if (simple[code] !== undefined) return simple[code];
    return String.fromCharCode(parseInt(code, 8));
  });
}

// A única faixa em que o windows-1252 diverge do latin1 — e é justamente onde
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
  fi: 'ﬁ', fl: 'ﬂ', germandbls: 'ß', ae: 'æ', AE: 'Æ',
  oe: 'œ', OE: 'Œ', eth: 'ð', Eth: 'Ð', thorn: 'þ',
  Thorn: 'Þ', degree: '°', plusminus: '±', euro: '€',
  sterling: '£', yen: '¥', cent: '¢', section: '§',
  paragraph: '¶', copyright: '©', registered: '®',
  trademark: '™', ordfeminine: 'ª', ordmasculine: 'º',
  guillemotleft: '«', guillemotright: '»', questiondown: '¿',
  exclamdown: '¡', multiply: '×', divide: '÷',
  minus: '−', fraction: '⁄', nbspace: ' ', currency: '¤'
};

function glifoParaTexto(nome) {
  if (GLIFOS[nome]) return GLIFOS[nome];
  if (/^[A-Za-z]$/.test(nome)) return nome;
  // `uni00E9` e `u00E9`: o próprio ponto de código, escrito no nome.
  const direto = /^uni([0-9A-Fa-f]{4})$/.exec(nome) || /^u([0-9A-Fa-f]{4,6})$/.exec(nome);
  if (direto) {
    const cp = parseInt(direto[1], 16);
    return cp > 0x10ffff ? null : String.fromCodePoint(cp);
  }
  const composto = /^([A-Za-z])([a-z]+)$/.exec(nome);
  if (composto && ACENTOS[composto[2]]) {
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

/**
 * CMap do /ToUnicode: é ele que diz o que cada código da fonte quer dizer.
 *
 * Fonte de subconjunto — a que sai de qualquer gerador moderno — numera os
 * glifos a partir de 1, na ordem em que aparecem no documento. Sem este mapa os
 * bytes do fluxo não são texto em codificação nenhuma: são índices.
 */
function parseCMap(text) {
  const mapa = new Map();
  let largura = 2;
  const espaco = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  const primeiro = espaco && /<([0-9A-Fa-f]+)>/.exec(espaco[1]);
  if (primeiro) largura = Math.max(1, Math.min(2, Math.ceil(primeiro[1].length / 2)));

  for (const bloco of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      mapa.set(parseInt(par[1], 16), hexParaTexto(par[2]));
    }
  }
  for (const bloco of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    for (const m of bloco[1].matchAll(re)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi < lo || hi - lo > 0xffff) continue;
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

/** Decodifica os bytes de uma string literal com o que a fonte declarou. */
function bytesComFonte(bytes, fonte) {
  if (fonte?.cmap) {
    const { mapa, largura } = fonte.cmap;
    let out = '';
    for (let i = 0; i + largura <= bytes.length; i += largura) {
      let code = 0;
      for (let k = 0; k < largura; k++) code = (code << 8) | (bytes.charCodeAt(i + k) & 0xff);
      out += mapa.get(code) ?? '';
    }
    return out;
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes.charCodeAt(i) & 0xff;
    out += fonte?.tabela?.[b] ?? byteWinAnsi(b);
  }
  return out;
}

/** Decodifica string hexadecimal, que é a forma usual das fontes com CMap. */
function hexComFonte(hex, fonte) {
  if (fonte?.cmap) {
    const passo = fonte.cmap.largura * 2;
    let out = '';
    for (let i = 0; i + passo <= hex.length; i += passo) {
      out += fonte.cmap.mapa.get(parseInt(hex.slice(i, i + passo), 16)) ?? '';
    }
    return out;
  }
  if (fonte?.tabela && hex.length % 4 !== 0) {
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
      const b = parseInt(hex.slice(i, i + 2), 16);
      out += fonte.tabela[b] ?? byteWinAnsi(b);
    }
    return out;
  }
  // Sem fonte identificada, hexadecimal em PDF é quase sempre UTF-16BE.
  let out = '';
  for (let i = 0; i + 3 < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (code > 8 && code < 0xfffd) out += String.fromCharCode(code);
  }
  return out;
}

/** Junta as strings dos operadores de texto de um fluxo já descomprimido. */
function textFromContentStream(content, fontes) {
  const out = [];
  // Tj / TJ / ' / " — o que carrega texto visível. `Tf` entra porque é ele que
  // diz qual fonte está valendo, e a fonte é quem sabe decodificar os bytes.
  const re =
    /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\/[^\s/<>[\]()]+\s+[\d.]+\s+Tf|\bTJ\b|\bTj\b|\bTD\b|\bTd\b|\bT\*\b|\bET\b|'|"/g;
  let line = [];
  let fonte = null;
  const fecharLinha = () => {
    if (line.length) {
      out.push(line.join(''));
      line = [];
    }
  };
  for (const match of content.match(re) || []) {
    if (match.startsWith('(')) {
      line.push(bytesComFonte(unescapePdf(match.slice(1, -1)), fonte));
    } else if (match.startsWith('<')) {
      line.push(hexComFonte(match.slice(1, -1).replace(/\s+/g, ''), fonte));
    } else if (match.endsWith('Tf')) {
      fonte = fontes?.get(/^\/(\S+)/.exec(match)[1]) ?? null;
    } else if (match !== 'Tj' && match !== 'TJ') {
      // Td / TD / T* / ET / ' / " — todos trocam de linha ou fecham o bloco.
      // `Tj` e `TJ` não: dois deles seguidos escrevem na mesma linha, e quebrar
      // ali parte no meio a frase que a página mostra inteira.
      fecharLinha();
    }
  }
  fecharLinha();
  return out.join('\n');
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

function inflar(raw) {
  try {
    return inflateSync(raw, { maxOutputLength: MAX_INFLADO });
  } catch {
    try {
      return inflateRawSync(raw, { maxOutputLength: MAX_INFLADO });
    } catch {
      return null;
    }
  }
}

/**
 * Todos os `stream ... endstream`, com o dicionário que pertence a cada um.
 *
 * O dicionário é procurado a partir do `obj` mais próximo, e não numa janela
 * fixa de bytes atrás: a janela alcançava o objeto anterior, e uma página
 * escrita logo depois de uma fonte era descartada como se fosse a fonte.
 */
function lerFluxos(buffer) {
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  const fluxos = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start < 0) break;
    const end = buffer.indexOf(endMarker, start);
    if (end < 0) break;

    let from = start + marker.length;
    if (buffer[from] === 0x0d) from++;
    if (buffer[from] === 0x0a) from++;

    const janela = buffer.toString('latin1', Math.max(0, start - 4000), start);
    const abre = [...janela.matchAll(/(\d+)\s+\d+\s+obj\b/g)].pop();
    fluxos.push({
      num: abre ? Number(abre[1]) : null,
      header: abre ? janela.slice(abre.index) : janela.slice(-400),
      raw: buffer.subarray(from, end)
    });
    cursor = end + endMarker.length;
  }
  return fluxos;
}

/** Objetos guardados dentro de um /ObjStm, que é onde o PDF 1.5+ põe as fontes. */
function objetosDeObjStm(header, texto) {
  const n = Number(/\/N\s+(\d+)/.exec(header)?.[1]);
  const first = Number(/\/First\s+(\d+)/.exec(header)?.[1]);
  if (!n || !Number.isFinite(first)) return [];
  const pares = texto.slice(0, first).trim().split(/\s+/).map(Number);
  const objetos = [];
  for (let i = 0; i < n; i++) {
    const num = pares[i * 2];
    const off = pares[i * 2 + 1];
    if (!Number.isFinite(num) || !Number.isFinite(off)) break;
    const proximo = pares[i * 2 + 3];
    const fim = i + 1 < n && Number.isFinite(proximo) ? first + proximo : texto.length;
    objetos.push({ num, dict: texto.slice(first + off, fim) });
  }
  return objetos;
}

/**
 * Nome de recurso (`/F1`) → como decodificar os bytes daquela fonte.
 *
 * Duas travessias: primeiro os dicionários — de onde saem `/Font << /F1 4 0 R >>`
 * e o objeto de fonte com seu /ToUnicode —, depois os CMaps já descomprimidos.
 */
function mapearFontes(buffer, fluxos) {
  const dicionarios = [buffer.toString('latin1')];
  const cmapPorObjeto = new Map();

  for (const fluxo of fluxos) {
    if (/\/Type\s*\/ObjStm\b/.test(fluxo.header)) {
      const aberto = inflar(fluxo.raw);
      if (aberto) {
        for (const obj of objetosDeObjStm(fluxo.header, aberto.toString('latin1'))) {
          dicionarios.push(`${obj.num} 0 obj ${obj.dict} endobj`);
        }
      }
      continue;
    }
    if (fluxo.num === null) continue;
    // Só vale a pena abrir o que pode ser CMap: mapa de caracteres é pequeno, e
    // abrir página grande à toa custa tempo em documento de centenas de MB.
    if (!/\/Type\s*\/CMap\b|\/ToUnicode\b/.test(fluxo.header) && fluxo.raw.length > 256 * 1024) continue;
    const aberto = inflar(fluxo.raw) ?? fluxo.raw;
    const texto = aberto.toString('latin1');
    if (!texto.includes('begincmap')) continue;
    const cmap = parseCMap(texto);
    if (cmap) cmapPorObjeto.set(fluxo.num, cmap);
  }

  const tudo = dicionarios.join('\n');

  // Objeto de fonte → o que ele declarou.
  const fontePorObjeto = new Map();
  for (const m of tudo.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]{0,4000}?)(?:endobj|stream\b)/g)) {
    const dict = m[2];
    if (!/\/Type\s*\/Font\b/.test(dict)) continue;
    const toUnicode = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(dict);
    const fonte = {
      cmap: toUnicode ? cmapPorObjeto.get(Number(toUnicode[1])) ?? null : null,
      tabela: tabelaDeEncoding(dict)
    };
    if (fonte.cmap || fonte.tabela) fontePorObjeto.set(Number(m[1]), fonte);
  }

  // Nome do recurso → objeto de fonte. O mesmo `/F1` costuma valer no documento
  // inteiro; quando dois apontam pra fontes diferentes, fica a que tem CMap,
  // que é a única capaz de decodificar índice de glifo.
  const porNome = new Map();
  for (const bloco of tudo.matchAll(/\/Font\s*<<([\s\S]{0,4000}?)>>/g)) {
    for (const par of bloco[1].matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fonte = fontePorObjeto.get(Number(par[2]));
      if (!fonte) continue;
      const atual = porNome.get(par[1]);
      if (!atual || (!atual.cmap && fonte.cmap)) porNome.set(par[1], fonte);
    }
  }
  return porNome;
}

function fromPdf(buffer) {
  const parts = [];
  let failed = 0;

  const fluxos = lerFluxos(buffer);
  const fontes = mapearFontes(buffer, fluxos);

  for (const fluxo of fluxos) {
    if (FLUXO_SEM_TEXTO.test(fluxo.header)) continue;

    let data = fluxo.raw;
    if (/FlateDecode/.test(fluxo.header)) {
      data = inflar(fluxo.raw);
      if (!data) {
        failed++;
        continue;
      }
    } else if (/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode/.test(fluxo.header)) {
      continue; // imagem
    }

    const conteudo = data.toString('latin1');
    // Página de verdade abre bloco de texto. Sem esta conferência, binário que
    // por acaso tivesse os bytes de `Tj` era lido como se fosse frase.
    if (!/\bBT\b/.test(conteudo)) continue;

    const text = textFromContentStream(conteudo, fontes);
    // Basta ter palavra de verdade: um corte por tamanho descartaria a página
    // que só tem um título curto.
    if (/\p{L}{2,}/u.test(text)) parts.push(text);
  }

  const text = parts
    .join('\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
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
  if (/[\u0080-\u009f]/.test(text)) {
    avisos.push(
      'parte do PDF usa fonte sem mapa de caracteres legível; alguns símbolos podem ter saído errados'
    );
  }
  return { text, note: avisos.join('; ') || null };
}

// ------------------------------------------------------------------ entrada

/**
 * @returns {{text: string, note: string|null, kind: string}}
 */
export function extractText(buffer, filename = '', mime = '') {
  const ext = extname(filename).toLowerCase();

  if (ext === '.pdf' || mime === 'application/pdf') {
    return { ...fromPdf(buffer), kind: 'pdf' };
  }
  if (ext === '.docx') return { ...fromDocx(buffer), kind: 'docx' };
  if (ext === '.pptx') return { ...fromPptx(buffer), kind: 'pptx' };
  if (ext === '.epub') return { ...fromEpub(buffer), kind: 'epub' };

  if (TEXT_EXT.has(ext) || (mime || '').startsWith('text/') || looksLikeText(buffer)) {
    return { ...decodeText(buffer), kind: 'texto' };
  }

  return {
    text: '',
    note: `não sei ler ${ext || mime || 'este formato'} — mande texto, código, PDF, DOCX, PPTX ou EPUB`,
    kind: 'desconhecido'
  };
}
