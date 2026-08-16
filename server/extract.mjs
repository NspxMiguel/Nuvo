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
      out.set(name, method === 0 ? raw : inflateRawSync(raw));
    } catch {
      /* entrada corrompida ou método não suportado: pula */
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
  return { text: xmlText(doc.toString('utf8')) };
}

function fromPptx(buffer) {
  const files = unzip(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = [...files.entries()]
    .sort((a, b) => Number(a[0].match(/\d+/)[0]) - Number(b[0].match(/\d+/)[0]))
    .map(([name, data], i) => `## Slide ${i + 1}\n${xmlText(data.toString('utf8'))}`);
  if (!slides.length) return { text: '', note: 'nenhum slide legível' };
  return { text: slides.join('\n\n') };
}

function fromEpub(buffer) {
  const files = unzip(buffer, (n) => /\.x?html?$/i.test(n));
  const parts = [...files.values()].map((d) => xmlText(d.toString('utf8'))).filter(Boolean);
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

    let data = raw;
    if (/FlateDecode/.test(header)) {
      try {
        data = inflateSync(raw);
      } catch {
        try {
          data = inflateRawSync(raw);
        } catch {
          failed++;
          continue;
        }
      }
    } else if (/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode/.test(header)) {
      continue; // imagem
    }

    const text = textFromContentStream(data.toString('latin1'));
    if (text.trim().length > 20) parts.push(text);
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
    return { text: buffer.toString('utf8'), note: null, kind: 'texto' };
  }

  return {
    text: '',
    note: `não sei ler ${ext || mime || 'este formato'} — mande texto, código, PDF, DOCX, PPTX ou EPUB`,
    kind: 'desconhecido'
  };
}
