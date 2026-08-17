// Embeddings e similaridade, compartilhados pela memória e pelos documentos.
//
// Vetor é gravado como BLOB de Float32: ocupa 4 bytes por dimensão e volta sem
// parse. Embedding é opcional no produto inteiro — sem modelo configurado, tudo
// que depende disso cai pra busca por palavra.

import { loadConfig } from './config.mjs';
import { adapterFor, contextFor, getProvider, parseRef } from './providers/index.mjs';

export function toBlob(vector) {
  const arr = Float32Array.from(vector);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

export function fromBlob(blob) {
  if (!blob) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function embeddingAvailable() {
  return Boolean(loadConfig().memory.embeddingModel);
}

/** Referência do modelo de embedding em uso, ou null. É o carimbo dos vetores. */
export function embeddingModelRef() {
  return loadConfig().memory.embeddingModel || null;
}

/** @returns {Promise<number[][]|null>} null quando não há embedding configurado. */
export async function embedTexts(texts) {
  const cfg = loadConfig();
  const ref = cfg.memory.embeddingModel;
  if (!ref || !texts.length) return null;
  try {
    const { providerId, modelId } = parseRef(ref);
    const provider = getProvider(providerId);
    const adapter = adapterFor(provider.kind);
    if (!adapter.embed) return null;
    return await adapter.embed(contextFor(provider), { model: modelId, input: texts });
  } catch {
    return null; // embedding é opcional: sem ele a busca vira só FTS
  }
}

const STOPWORDS = new Set([
  'a', 'o', 'e', 'de', 'do', 'da', 'em', 'um', 'uma', 'que', 'para', 'com', 'no',
  'na', 'os', 'as', 'dos', 'das', 'por', 'se', 'mais', 'como', 'the', 'and', 'of',
  'to', 'in', 'is', 'it', 'for', 'on', 'with', 'my', 'me', 'i', 'you'
]);

/** Consulta FTS5 tolerante: termos soltos em OR, sem sintaxe do usuário vazar. */
export function ftsQuery(text, limit = 12) {
  const terms = String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .slice(0, limit);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}
