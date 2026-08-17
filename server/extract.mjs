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

/** Junta as strings dos operadores de texto de um fluxo já descomprimido. */
function textFromContentStream(content) {
  const out = [];
  // Tj / TJ / ' / " — o que carrega texto visível.
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTJ\b|\bTj\b|\bTD\b|\bTd\b|\bT\*\b|\bET\b/g;
  let line = [];
  for (const match of content.match(re) || []) {
    if (match.startsWith('(')) {
      line.push(unescapePdf(match.slice(1, -1)));
    } else if (match.startsWith('<')) {
      // String hexadecimal: costuma ser UTF-16BE em fonte com CMap.
      const hex = match.slice(1, -1).replace(/\s+/g, '');
      let decoded = '';
      for (let i = 0; i + 3 < hex.length; i += 4) {
        const code = parseInt(hex.slice(i, i + 4), 16);
        if (code > 8 && code < 0xfffd) decoded += String.fromCharCode(code);
      }
      if (decoded) line.push(decoded);
    } else if (match === 'TD' || match === 'Td' || match === 'T*' || match === 'ET') {
      if (line.length) {
        out.push(line.join(''));
        line = [];
      }
    }
  }
  if (line.length) out.push(line.join(''));
  return out.join('\n');
}

// Fluxo do PDF que não é página. Fonte embutida, perfil de cor, mapa de
// caracteres, metadados, imagem e o objeto que guarda outros objetos abrem com
// o mesmo FlateDecode do conteúdo — e descomprimidos viram binário que passava
// por "texto do documento" e ia parar no prompt do modelo.
const FLUXO_SEM_TEXTO =
  /\/(?:FontFile\d?|Length1|ToUnicode|ICCBased)\b|\/Subtype\s*\/(?:Type1C|TrueType|OpenType|CIDFontType0C|CIDFontType2|Image|XML)\b|\/Type\s*\/(?:Metadata|ObjStm|XRef|EmbeddedFile|Font|FontDescriptor)\b/;

// Teto de descompressão por fluxo: zip e PDF podem declarar poucos kB e abrir
// centenas de MB, e o processo morre antes de chegar a qualquer validação.
const MAX_INFLADO = 64 * 1024 * 1024;

function fromPdf(buffer) {
  const parts = [];
  let streams = 0;
  let failed = 0;

  // Cada `stream ... endstream` é um bloco; os de conteúdo vêm comprimidos.
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start < 0) break;
    const end = buffer.indexOf(endMarker, start);
    if (end < 0) break;

    let from = start + marker.length;
    if (buffer[from] === 0x0d) from++;
    if (buffer[from] === 0x0a) from++;

    const header = buffer.toString('latin1', Math.max(0, start - 400), start);
    const raw = buffer.subarray(from, end);
    cursor = end + endMarker.length;
    streams++;

    if (FLUXO_SEM_TEXTO.test(header)) continue;

    let data = raw;
    if (/FlateDecode/.test(header)) {
      try {
        data = inflateSync(raw, { maxOutputLength: MAX_INFLADO });
      } catch {
        try {
          data = inflateRawSync(raw, { maxOutputLength: MAX_INFLADO });
        } catch {
          failed++;
          continue;
        }
      }
    } else if (/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode/.test(header)) {
      continue; // imagem
    }

    const conteudo = data.toString('latin1');
    // Página de verdade abre bloco de texto. Sem esta conferência, binário que
    // por acaso tivesse os bytes de `Tj` era lido como se fosse frase.
    if (!/\bBT\b/.test(conteudo)) continue;

    const text = textFromContentStream(conteudo);
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
        streams === 0
          ? 'PDF sem fluxo de conteúdo legível'
          : 'PDF sem texto extraível — provavelmente é digitalização em imagem, que precisaria de OCR'
    };
  }
  return { text, note: failed ? `${failed} fluxo(s) do PDF não abriram` : null };
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
