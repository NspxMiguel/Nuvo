// Memória compartilhada — o núcleo do IAUnifier.
//
// Um único banco de fatos que qualquer modelo lê e qualquer modelo escreve.
// É o que faz o que foi dito pro Claude aparecer na conversa com o GPT.
//
// Busca híbrida: FTS5 sempre, embeddings quando houver um modelo de embedding
// configurado. Sem embedding o app continua funcionando, só com menos precisão.

import { all, one, run, uid, now, normalizeText } from './db.mjs';
import { loadConfig } from './config.mjs';
import {
  adapterFor,
  contextFor,
  getProvider,
  parseRef,
  withStallTimeout
} from './providers/index.mjs';
import { toBlob, fromBlob, cosine, embedTexts, embeddingAvailable, ftsQuery } from './vectors.mjs';

export { embeddingAvailable };

// ------------------------------------------------------------------ escrita

export async function addMemory({
  text,
  kind = 'fact',
  scope = 'global',
  projectId = null,
  source = 'manual',
  sourceRef = null,
  pinned = 0
}) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const norm = normalizeText(clean);

  // Fato repetido só atualiza o carimbo, não vira linha nova. A comparação é
  // pela chave normalizada: acento e caixa não fazem fato novo.
  const duplicate = one(
    "SELECT id FROM memories WHERE norm = ? AND IFNULL(project_id, '') = IFNULL(?, '')",
    norm,
    projectId
  );
  if (duplicate) {
    run('UPDATE memories SET updated_at = ?, active = 1 WHERE id = ?', now(), duplicate.id);
    return one('SELECT * FROM memories WHERE id = ?', duplicate.id);
  }

  const id = uid();
  const stamp = now();
  run(
    `INSERT INTO memories (id, text, norm, kind, scope, project_id, source, source_ref, pinned, active,
                           use_count, embedding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
    id,
    clean,
    norm,
    kind,
    scope,
    projectId,
    source,
    sourceRef,
    pinned ? 1 : 0,
    stamp,
    stamp
  );

  const vectors = await embedTexts([clean]);
  if (vectors?.[0]) run('UPDATE memories SET embedding = ? WHERE id = ?', toBlob(vectors[0]), id);

  return one('SELECT * FROM memories WHERE id = ?', id);
}

export function updateMemory(id, patch) {
  const current = one('SELECT * FROM memories WHERE id = ?', id);
  if (!current) return null;
  const nextText = patch.text ?? current.text;
  run(
    `UPDATE memories SET text = ?, norm = ?, kind = ?, scope = ?, project_id = ?, pinned = ?, active = ?, updated_at = ?
     WHERE id = ?`,
    nextText,
    normalizeText(nextText),
    patch.kind ?? current.kind,
    patch.scope ?? current.scope,
    patch.projectId !== undefined ? patch.projectId : current.project_id,
    patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : current.pinned,
    patch.active !== undefined ? (patch.active ? 1 : 0) : current.active,
    now(),
    id
  );
  return one('SELECT * FROM memories WHERE id = ?', id);
}

export function deleteMemory(id) {
  run('DELETE FROM memories WHERE id = ?', id);
}

export function listMemories({ projectId = null, includeInactive = false, limit = 500 } = {}) {
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push('active = 1');
  if (projectId) {
    clauses.push('(scope = ? OR project_id = ?)');
    params.push('global', projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all(
    `SELECT * FROM memories ${where} ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
    ...params,
    limit
  );
}

// -------------------------------------------------------------------- busca

/**
 * Fatos relevantes pra uma mensagem. Fixados entram sempre; o resto disputa
 * por pontuação híbrida.
 */
export async function recall(query, { projectId = null, limit = null } = {}) {
  const cfg = loadConfig();
  if (!cfg.memory.enabled) return [];
  const max = limit ?? cfg.memory.maxInjected;

  const pinned = all(
    `SELECT * FROM memories
     WHERE active = 1 AND pinned = 1 AND (scope = 'global' OR project_id = ?)
     ORDER BY updated_at DESC LIMIT ?`,
    projectId,
    max
  );

  const scores = new Map();
  const byId = new Map();

  const q = ftsQuery(query);
  if (q) {
    const rows = all(
      `SELECT m.*, bm25(memories_fts) AS rank
       FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ? AND m.active = 1 AND (m.scope = 'global' OR m.project_id = ?)
       ORDER BY rank LIMIT 60`,
      q,
      projectId
    );
    rows.forEach((row, index) => {
      byId.set(row.id, row);
      // Posição no ranking vira score em [0,1] — comparável com a similaridade.
      scores.set(row.id, (scores.get(row.id) || 0) + 0.6 * (1 - index / Math.max(rows.length, 1)));
    });
  }

  const vectors = await embedTexts([query]);
  if (vectors?.[0]) {
    const target = Float32Array.from(vectors[0]);
    const candidates = all(
      `SELECT * FROM memories
       WHERE active = 1 AND embedding IS NOT NULL AND (scope = 'global' OR project_id = ?)`,
      projectId
    );
    for (const row of candidates) {
      const sim = cosine(target, fromBlob(row.embedding));
      if (sim <= 0) continue;
      byId.set(row.id, row);
      scores.set(row.id, (scores.get(row.id) || 0) + sim);
    }
  }

  const ranked = [...scores.entries()]
    .filter(([, score]) => score >= cfg.memory.minScore)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const row of [...pinned, ...ranked]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= max) break;
  }

  if (out.length) {
    const marks = out.map(() => '?').join(',');
    run(`UPDATE memories SET use_count = use_count + 1 WHERE id IN (${marks})`, ...out.map((m) => m.id));
  }
  return out;
}

/** Bloco de texto que entra no system prompt de qualquer modelo. */
export function renderForPrompt(memories) {
  if (!memories.length) return '';
  const lines = memories.map((m) => `- ${m.text}`).join('\n');
  return [
    '# O que você já sabe sobre esta pessoa',
    'Estes fatos vieram de conversas anteriores, possivelmente com outra IA.',
    'Use quando fizer sentido, sem anunciar que veio da memória.',
    '',
    lines
  ].join('\n');
}

// ---------------------------------------------------------------- extração

/**
 * "Até o fim da frase", com o cuidado de não confundir ponto de frase com
 * ponto de endereço ou de número: `[^.!?]` cortava "nspx.dev" em "nspx", e
 * "versão 3.5" em "versão 3". Só termina o ponto que vem seguido de espaço ou
 * de fim de texto.
 */
const ateOFimDaFrase = (min, max) => `(?:(?!\\s*[.!?](?:\\s|$))[^\\n]){${min},${max}}`;

const HEURISTICS = [
  `\\b(?:eu\\s+)?(?:me\\s+chamo|meu\\s+nome\\s+(?:é|e))\\s+${ateOFimDaFrase(2, 60)}`,
  `\\b(?:eu\\s+)?(?:gosto|amo|odeio|detesto|prefiro)\\s+(?:de\\s+)?${ateOFimDaFrase(3, 90)}`,
  `\\b(?:eu\\s+)?(?:moro|trabalho|estudo)\\s+(?:em|na|no|com|para)\\s+${ateOFimDaFrase(2, 80)}`,
  `\\b(?:meu|minha)\\s+(?:projeto|empresa|time|cachorro|gato|carro|site|dominio|domínio)\\s+${ateOFimDaFrase(2, 80)}`,
  `\\b(?:sempre|nunca)\\s+(?:me|use|usa|faça|faz|responda)\\s+${ateOFimDaFrase(3, 90)}`,
  `\\bmy\\s+name\\s+is\\s+${ateOFimDaFrase(2, 60)}`,
  `\\bi\\s+(?:like|love|hate|prefer|work|live)\\s+${ateOFimDaFrase(3, 90)}`
].map((source) => new RegExp(source, 'gi'));

/** Extração sem modelo: pega padrões óbvios de preferência e identidade. */
export function extractHeuristic(text) {
  const out = [];
  for (const re of HEURISTICS) {
    for (const match of String(text || '').matchAll(re)) {
      const fact = match[0].trim().replace(/\s+/g, ' ');
      if (fact.length >= 8 && !out.includes(fact)) out.push(fact);
    }
  }
  // Os padrões se sobrepõem: "gosto de X e trabalho com Y" casa duas vezes.
  // Fica só o mais longo de cada par contido no outro.
  const kept = out.filter(
    (fact) => !out.some((other) => other !== fact && other.toLowerCase().includes(fact.toLowerCase()))
  );
  return kept.slice(0, 5);
}

const EXTRACTOR_PROMPT = `Você extrai fatos duradouros sobre o usuário a partir de uma conversa.

Devolva SOMENTE um array JSON de strings, sem comentários e sem cercas de código.
Cada string é um fato curto, em terceira pessoa, que continue verdadeiro daqui a meses.

Inclua: nome, preferências, gostos, aversões, ferramentas que usa, projetos,
decisões tomadas, como quer ser respondido.
Ignore: o assunto pontual da conversa, perguntas, o que a IA respondeu, datas relativas.

Se não houver nada duradouro, devolva [].`;

/** Extração com modelo. Cai na heurística se não houver extrator configurado. */
export async function extractWithModel(conversationText, { signal } = {}) {
  const cfg = loadConfig();
  const ref = cfg.memory.extractorModel;
  if (!ref) return extractHeuristic(conversationText);

  try {
    const { providerId, modelId } = parseRef(ref);
    const provider = getProvider(providerId);
    const adapter = adapterFor(provider.kind);
    let out = '';
    // Com prazo, como qualquer outra chamada a modelo. Sem isso, um extrator
    // que não volta — CLI que fica esperando entrada, servidor local que
    // aceitou a conexão e emudeceu — segurava o turno inteiro depois de a
    // resposta já ter sido gravada, e com ela a tranca da conversa.
    const abrir = (watchdog) =>
      adapter.stream(contextFor(provider), {
        model: modelId,
        system: EXTRACTOR_PROMPT,
        messages: [{ role: 'user', content: conversationText.slice(0, 12000) }],
        temperature: 0,
        maxTokens: 1000,
        signal: watchdog
      });
    for await (const chunk of withStallTimeout(abrir, {
      firstMs: cfg.limits.learnSeconds * 1000,
      stallMs: cfg.limits.stallSeconds * 1000,
      signal
    })) {
      if (chunk.delta) out += chunk.delta;
    }
    const match = out.match(/\[[\s\S]*\]/);
    if (!match) return extractHeuristic(conversationText);
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed)
      ? parsed.filter((f) => typeof f === 'string' && f.trim().length > 4).slice(0, 8)
      : extractHeuristic(conversationText);
  } catch {
    return extractHeuristic(conversationText);
  }
}

/** Roda depois de cada troca, sem travar a resposta do chat. */
export async function learnFromExchange({
  userText,
  assistantText,
  chatId,
  projectId,
  model,
  signal
}) {
  const cfg = loadConfig();
  if (!cfg.memory.enabled || !cfg.memory.autoExtract) return [];
  const conversation = `Usuário: ${userText}\n\nAssistente: ${assistantText}`;
  const facts = await extractWithModel(conversation, { signal });
  const saved = [];
  for (const fact of facts) {
    const row = await addMemory({
      text: fact,
      kind: 'fact',
      scope: projectId ? 'project' : 'global',
      projectId: projectId || null,
      source: 'auto',
      sourceRef: `${model || 'modelo'} · chat ${chatId || '?'}`
    });
    if (row) saved.push(row);
  }
  return saved;
}
