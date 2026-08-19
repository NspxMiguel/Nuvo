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
import {
  toBlob,
  fromBlob,
  cosine,
  embedTexts,
  embeddingAvailable,
  embeddingModelRef,
  ftsQuery
} from './vectors.mjs';

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
  if (vectors?.[0]) {
    run(
      'UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?',
      toBlob(vectors[0]),
      embeddingModelRef(),
      id
    );
  }

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
       WHERE active = 1 AND embedding IS NOT NULL AND embedding_model IS ?
         AND (scope = 'global' OR project_id = ?)`,
      embeddingModelRef(),
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

  // Fixar quer dizer "isto sempre entra", não "só isto entra". Com o teto de 12
  // e doze recados fixados, a busca sumia inteira e sem aviso: um fato que
  // casava palavra por palavra — o domínio dele — não chegava ao modelo, e nada
  // na tela dizia que a memória tinha parado de procurar. Fixado leva no máximo
  // metade do orçamento enquanto houver resultado de busca pra dividir; sem
  // resultado nenhum, fica com tudo, que é o certo em vez de desperdiçar.
  const tetoFixado = ranked.length ? Math.max(1, Math.floor(max / 2)) : max;

  const out = [];
  const seen = new Set();
  for (const row of [...pinned.slice(0, tetoFixado), ...ranked, ...pinned.slice(tetoFixado)]) {
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

/**
 * Quanto da memória está fora do índice do modelo de embedding em uso.
 *
 * Trocar o modelo não invalida nada visível: as linhas continuam lá, a busca
 * por palavra continua funcionando. O que some é a busca por significado, e
 * some calada. Este número é o que dá pra mostrar na tela.
 */
export function reindexPending() {
  const atual = embeddingModelRef();
  if (!atual) return { model: null, memories: 0, chunks: 0, total: 0 };
  const memories = one(
    'SELECT COUNT(*) AS n FROM memories WHERE active = 1 AND embedding_model IS NOT ?',
    atual
  ).n;
  const chunks = one('SELECT COUNT(*) AS n FROM chunks WHERE embedding_model IS NOT ?', atual).n;
  return { model: atual, memories, chunks, total: memories + chunks };
}

/**
 * Recalcula os vetores das linhas que ficaram para trás.
 *
 * Em lotes, e com teto por chamada: a interface chama de novo enquanto sobrar
 * coisa, e assim uma memória de anos não trava o servidor num pedido só.
 */
export async function reindexEmbeddings({ batch = 64, max = 512 } = {}) {
  const atual = embeddingModelRef();
  if (!atual) return { done: true, updated: 0, remaining: 0, reason: 'sem modelo de embedding' };

  let updated = 0;
  for (const tabela of ['memories', 'chunks']) {
    while (updated < max) {
      const linhas = all(
        `SELECT id, text FROM ${tabela}
         WHERE embedding_model IS NOT ? ${tabela === 'memories' ? 'AND active = 1' : ''}
         LIMIT ?`,
        atual,
        Math.min(batch, max - updated)
      );
      if (!linhas.length) break;

      const vetores = await embedTexts(linhas.map((l) => l.text));
      if (!vetores) return { done: false, updated, remaining: reindexPending().total, reason: 'o modelo de embedding não respondeu' };

      linhas.forEach((linha, i) => {
        const v = vetores[i];
        if (!v) return;
        run(
          `UPDATE ${tabela} SET embedding = ?, embedding_model = ? WHERE id = ?`,
          toBlob(v),
          atual,
          linha.id
        );
        updated += 1;
      });
    }
  }

  const remaining = reindexPending().total;
  return { done: remaining === 0, updated, remaining };
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

// Um bloco por idioma da interface. Sem extrator configurado, é isto que a
// memória enxerga — e é o caso mais comum, porque o extrator custa uma chamada
// de modelo por turno. Enquanto só havia português (mais duas frases soltas em
// inglês), o app falava três línguas e lembrava numa: quem usasse em espanhol
// nunca via a memória encher, e a promessa da primeira tela não valia pra ele.
const HEURISTICS = [
  // português
  `\\b(?:eu\\s+)?(?:me\\s+chamo|meu\\s+nome\\s+(?:é|e))\\s+${ateOFimDaFrase(2, 60)}`,
  `\\b(?:eu\\s+)?(?:gosto|amo|odeio|detesto|prefiro)\\s+(?:de\\s+)?${ateOFimDaFrase(3, 90)}`,
  `\\b(?:eu\\s+)?(?:moro|trabalho|estudo)\\s+(?:em|na|no|com|para)\\s+${ateOFimDaFrase(2, 80)}`,
  `\\b(?:meu|minha)\\s+(?:projeto|empresa|time|cachorro|gato|carro|site|dominio|domínio)\\s+${ateOFimDaFrase(2, 80)}`,
  `\\b(?:sempre|nunca)\\s+(?:me|use|usa|faça|faz|responda)\\s+${ateOFimDaFrase(3, 90)}`,
  `\\b(?:eu\\s+)?estou\\s+(?:construindo|desenvolvendo|criando|fazendo|montando|escrevendo)\\s+${ateOFimDaFrase(3, 90)}`,
  `\\b(?:eu\\s+)?(?:vou|pretendo)\\s+(?:lançar|publicar|abrir|montar)\\s+${ateOFimDaFrase(3, 90)}`,

  // inglês
  `\\bmy\\s+name\\s+is\\s+${ateOFimDaFrase(2, 60)}`,
  `\\bi\\s+(?:like|love|hate|prefer|work|live|use|study)\\s+${ateOFimDaFrase(3, 90)}`,
  `\\bi(?:'m|\\s+am)\\s+(?:building|developing|creating|making|writing|working\\s+on)\\s+${ateOFimDaFrase(3, 90)}`,
  `\\bmy\\s+(?:project|company|team|dog|cat|car|site|domain)\\s+${ateOFimDaFrase(2, 80)}`,
  `\\b(?:always|never)\\s+(?:call\\s+me|use|answer|reply|write)\\s+${ateOFimDaFrase(3, 90)}`,

  // espanhol
  `\\b(?:me\\s+llamo|mi\\s+nombre\\s+es)\\s+${ateOFimDaFrase(2, 60)}`,
  `\\b(?:me\\s+gusta|me\\s+encanta|amo|odio|detesto|prefiero)\\s+${ateOFimDaFrase(3, 90)}`,
  `\\b(?:vivo|trabajo|estudio)\\s+(?:en|con|para)\\s+${ateOFimDaFrase(2, 80)}`,
  `\\bmi\\s+(?:proyecto|empresa|equipo|perro|gato|coche|sitio|dominio)\\s+${ateOFimDaFrase(2, 80)}`,
  `\\b(?:siempre|nunca)\\s+(?:me|usa|use|responde|responda|escribe)\\s+${ateOFimDaFrase(3, 90)}`,
  `\\bestoy\\s+(?:construyendo|desarrollando|creando|haciendo|escribiendo)\\s+${ateOFimDaFrase(3, 90)}`
].map((source) => new RegExp(source, 'gi'));

/**
 * Negação logo antes do verbo. Os padrões começam no verbo, então "não gosto
 * de café" casava a partir de "gosto" e gravava o oposto do que foi dito — e
 * memória é permanente e compartilhada: o fato invertido passa a valer para
 * todos os modelos, em todas as conversas seguintes.
 */
const NEGADO = /\b(?:n[ãa]o|no|nunca|jamais|jam[áa]s|nem|ni|tampoco|don'?t|doesn'?t|never)\s+(?:eu\s+|yo\s+)?$/i;

/**
 * A frase é uma pergunta?
 *
 * Pergunta casa com os mesmos padrões da afirmação — "qual o nome do meu gato?"
 * casa em "meu gato ..." e virava o fato "meu gato e onde eu moro". Fato assim
 * é permanente, compartilhado entre todas as IAs e falso: ninguém disse nada,
 * só perguntou.
 *
 * A checagem é da frase inteira em volta do casamento, não do trecho: o padrão
 * para antes do "?" justamente porque `ateOFimDaFrase` não deixa pontuação
 * entrar.
 */
// O `¿` do espanhol fica fora do grupo com `\b` no fim: `\b` depois de um sinal
// de pontuação não casa, e a pergunta escrita com ele passaria batido.
const INTERROGATIVA =
  /^\s*(?:¿|(?:qual|quais|quem|quando|onde|aonde|como|quanto|quantos|quantas|por\s?que|porque|o\s+que|cu[áa]l|cu[áa]les|qu[ée]|qui[ée]n|d[óo]nde|cu[áa]ndo|cu[áa]nto|c[óo]mo|what|where|who|when|how|why|which|do|does|did|can|could|is|are)\b)/i;

function ehPergunta(texto, inicio) {
  const antes = texto.lastIndexOf('\n', inicio - 1) + 1;
  const abre = Math.max(antes, ...['.', '!', '?'].map((c) => texto.lastIndexOf(c, inicio - 1) + 1));
  const fecha = texto.slice(inicio).search(/[.!?\n]/);
  const frase = texto.slice(abre, fecha < 0 ? texto.length : inicio + fecha + 1).trim();
  return frase.endsWith('?') || INTERROGATIVA.test(frase);
}

/** Extração sem modelo: pega padrões óbvios de preferência e identidade. */
export function extractHeuristic(text) {
  const out = [];
  for (const re of HEURISTICS) {
    for (const match of String(text || '').matchAll(re)) {
      if (NEGADO.test(match.input.slice(0, match.index))) continue;
      if (ehPergunta(match.input, match.index)) continue;
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
