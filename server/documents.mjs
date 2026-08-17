// Anexos e conversa com documento.
//
// O arquivo raramente cabe no contexto, então é quebrado em pedaços, indexado
// em FTS5 (mais embeddings quando houver) e só o trecho relevante entra no
// prompt — com o nome do arquivo junto, pra resposta poder citar a fonte.

import { writeFileSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { all, one, run, tx, uid, now } from './db.mjs';
import { UPLOAD_DIR } from './config.mjs';
import { extractText } from './extract.mjs';
import { toBlob, fromBlob, cosine, embedTexts, embeddingModelRef, ftsQuery } from './vectors.mjs';

const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 200;
// Arquivo curto entra inteiro no prompt; não vale a pena recuperar pedaço de
// algo que cabe todo. É o mesmo corte que o LM Studio faz no anexo.
export const INLINE_LIMIT = 6000;

/** Quebra por parágrafo, sem cortar frase no meio quando dá pra evitar. */
function chunkText(text) {
  const clean = String(text).replace(/\r\n/g, '\n').trim();
  if (clean.length <= CHUNK_CHARS) return clean ? [clean] : [];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < paragraph.length; i += CHUNK_CHARS - CHUNK_OVERLAP) {
        chunks.push(paragraph.slice(i, i + CHUNK_CHARS));
      }
      continue;
    }
    if ((current + '\n\n' + paragraph).length > CHUNK_CHARS) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);

  // Pedaço curto era descartado, e com ele sumia a última linha de todo
  // documento que termina em assinatura, código ou valor — justamente o que
  // costuma ser perguntado. Em vez de apagar, cola no anterior.
  const saida = [];
  for (const pedaco of chunks) {
    if (!pedaco.trim()) continue;
    if (pedaco.trim().length <= 20 && saida.length) saida[saida.length - 1] += `\n\n${pedaco}`;
    else saida.push(pedaco);
  }
  return saida;
}

/** Salva o arquivo, extrai o texto e indexa. */
export async function addAttachment({ buffer, name, mime, chatId = null, projectId = null }) {
  const id = uid();
  const { text, note, kind } = extractText(buffer, name, mime);

  let path = null;
  try {
    // A pasta pode não existir ainda: quem chama `addAttachment` sem ter
    // passado pelo start do servidor perderia a cópia crua em silêncio.
    mkdirSync(UPLOAD_DIR, { recursive: true });
    path = join(UPLOAD_DIR, `${id}-${name.replace(/[^\w.\-]+/g, '_')}`.slice(0, 180));
    writeFileSync(path, buffer);
  } catch {
    path = null; // guardar o original é conveniência, não requisito
  }

  const pieces = chunkText(text);

  // Anexo e trechos entram juntos: anexo sem trecho aparece na lista como se
  // fosse pesquisável e nunca devolve nada.
  tx(() => {
    run(
      `INSERT INTO attachments (id, chat_id, project_id, name, mime, bytes, chars, path, status, note, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      chatId,
      projectId,
      name,
      mime || kind,
      buffer.length,
      text.length,
      path,
      text.trim() ? 'ok' : 'erro',
      note || null,
      // Só o que cabe inteiro no prompt: acima disso o texto vem dos trechos
      // recuperados, e guardar de novo seria dobrar o banco à toa.
      text.length <= INLINE_LIMIT ? text : null,
      now()
    );

    const stamp = now();
    for (const [ord, piece] of pieces.entries()) {
      run(
        'INSERT INTO chunks (id, attachment_id, chat_id, project_id, ord, text, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
        uid(),
        id,
        chatId,
        projectId,
        ord,
        piece,
        stamp
      );
    }
  });

  // Embedding em lote, e só se houver modelo — a indexação por palavra já
  // funciona sozinha.
  const vectors = await embedTexts(pieces.slice(0, 200));
  if (vectors) {
    const rows = all('SELECT id, ord FROM chunks WHERE attachment_id = ? ORDER BY ord', id);
    for (const row of rows) {
      const vector = vectors[row.ord];
      if (vector) {
        run(
          'UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?',
          toBlob(vector),
          embeddingModelRef(),
          row.id
        );
      }
    }
  }

  return { ...one('SELECT * FROM attachments WHERE id = ?', id), chunks: pieces.length };
}

// O que a tela precisa saber de um anexo. Fica de fora o `path`, que é o
// caminho absoluto no disco do servidor, e o `text`, que é o documento inteiro:
// nenhum dos dois é usado pela interface, e mandar os dois significa expor a
// árvore de pastas da máquina e repetir até 6 kB por anexo a cada listagem.
const CAMPOS_PUBLICOS = [
  'id', 'chat_id', 'project_id', 'name', 'mime',
  'bytes', 'chars', 'status', 'note', 'created_at'
];

/** Recorta um anexo para o que pode sair pela API. */
export function publicAttachment(row) {
  if (!row) return row;
  const fora = {};
  for (const campo of [...CAMPOS_PUBLICOS, 'chunks']) {
    if (campo in row) fora[campo] = row[campo];
  }
  return fora;
}

export function listAttachments({ chatId = null, projectId = null } = {}) {
  const campos = CAMPOS_PUBLICOS.map((c) => `a.${c}`).join(', ');
  const contagem = '(SELECT COUNT(*) FROM chunks WHERE attachment_id = a.id) AS chunks';
  if (chatId) {
    return all(
      `SELECT ${campos}, ${contagem} FROM attachments a WHERE a.chat_id = ? ORDER BY a.created_at`,
      chatId
    );
  }
  if (projectId) {
    return all(
      `SELECT ${campos}, ${contagem} FROM attachments a WHERE a.project_id = ? ORDER BY a.created_at`,
      projectId
    );
  }
  return all(
    `SELECT ${campos}, ${contagem} FROM attachments a ORDER BY a.created_at DESC LIMIT 200`
  );
}

export function deleteAttachment(id) {
  const row = one('SELECT path FROM attachments WHERE id = ?', id);
  run('DELETE FROM attachments WHERE id = ?', id);
  if (row?.path) {
    try {
      unlinkSync(row.path);
    } catch {
      /* já sumiu */
    }
  }
}

/**
 * Apaga os arquivos dos anexos de uma conversa ou projeto.
 *
 * Precisa ser chamado ANTES do DELETE da conversa: o `ON DELETE CASCADE` leva a
 * linha do anexo junto, e sem a linha ninguém sabe mais qual arquivo no disco
 * era daquela conversa. O documento ficaria lá pra sempre, com o conteúdo
 * dentro, depois de o usuário achar que tinha apagado.
 */
export function deleteAttachmentsOf({ chatId = null, projectId = null } = {}) {
  if (!chatId && !projectId) return 0;
  const rows = chatId
    ? all('SELECT id FROM attachments WHERE chat_id = ?', chatId)
    : all('SELECT id FROM attachments WHERE project_id = ?', projectId);
  for (const row of rows) deleteAttachment(row.id);
  return rows.length;
}

/**
 * Arquivo em `uploads/` que nenhuma linha do banco reclama.
 *
 * Sobra de versão anterior, de restauração de backup mais antiga que os anexos,
 * ou de queda no meio da gravação. Roda na subida do servidor.
 */
export function sweepOrphanUploads() {
  if (!existsSync(UPLOAD_DIR)) return { removed: 0, bytes: 0 };
  const conhecidos = new Set(
    all('SELECT path FROM attachments WHERE path IS NOT NULL').map((r) => basename(r.path))
  );

  let removed = 0;
  let bytes = 0;
  for (const nome of readdirSync(UPLOAD_DIR)) {
    if (conhecidos.has(nome)) continue;
    const caminho = join(UPLOAD_DIR, nome);
    try {
      const info = statSync(caminho);
      if (!info.isFile()) continue;
      unlinkSync(caminho);
      removed += 1;
      bytes += info.size;
    } catch {
      /* sumiu no meio do caminho, ou é de outro dono */
    }
  }
  return { removed, bytes };
}

/**
 * Trechos relevantes dos anexos da conversa (e do projeto). Mesma pontuação
 * híbrida da memória: posição no ranking FTS mais similaridade de cosseno.
 */
export async function recallChunks(query, { chatId = null, projectId = null, limit = 6 } = {}) {
  const scope = [];
  const params = [];
  if (chatId) {
    scope.push('c.chat_id = ?');
    params.push(chatId);
  }
  if (projectId) {
    scope.push('c.project_id = ?');
    params.push(projectId);
  }
  if (!scope.length) return [];
  const where = `(${scope.join(' OR ')})`;

  const scores = new Map();
  const byId = new Map();

  const q = ftsQuery(query);
  if (q) {
    const rows = all(
      `SELECT c.*, a.name AS source, bm25(chunks_fts) AS rank
       FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
       JOIN attachments a ON a.id = c.attachment_id
       WHERE chunks_fts MATCH ? AND ${where}
       ORDER BY rank LIMIT 40`,
      q,
      ...params
    );
    rows.forEach((row, index) => {
      byId.set(row.id, row);
      scores.set(row.id, 0.6 * (1 - index / Math.max(rows.length, 1)));
    });
  }

  const vectors = await embedTexts([query]);
  if (vectors?.[0]) {
    const target = Float32Array.from(vectors[0]);
    const rows = all(
      `SELECT c.*, a.name AS source FROM chunks c JOIN attachments a ON a.id = c.attachment_id
       WHERE c.embedding IS NOT NULL AND c.embedding_model IS ? AND ${where}`,
      embeddingModelRef(),
      ...params
    );
    for (const row of rows) {
      const sim = cosine(target, fromBlob(row.embedding));
      if (sim <= 0) continue;
      byId.set(row.id, row);
      scores.set(row.id, (scores.get(row.id) || 0) + sim);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({ id: row.id, source: row.source, ord: row.ord, text: row.text }));
}

/**
 * Bloco de documentos pro system prompt. Arquivo curto entra inteiro; o resto
 * entra pelos trechos recuperados.
 */
export async function renderDocuments(query, { chatId, projectId }) {
  const attachments = [
    ...(chatId ? listAttachments({ chatId }) : []),
    ...(projectId ? listAttachments({ projectId }) : [])
  ].filter((a) => a.status === 'ok');
  if (!attachments.length) return { block: '', used: [] };

  const parts = [];
  const used = [];

  const short = attachments.filter((a) => a.chars > 0 && a.chars <= INLINE_LIMIT);
  for (const att of short) {
    // O texto guardado é o do arquivo, e é buscado aqui porque a listagem não
    // carrega o documento inteiro — quem precisa dele é só o prompt. Emendar os
    // trechos repetia a sobreposição de 200 caracteres que existe entre eles de
    // propósito; anexo de antes desta coluna cai na emenda, que é o que havia.
    const text =
      one('SELECT text FROM attachments WHERE id = ?', att.id)?.text ??
      all('SELECT text FROM chunks WHERE attachment_id = ? ORDER BY ord', att.id)
        .map((c) => c.text)
        .join('\n\n');
    parts.push(`## ${att.name}\n${text}`);
    used.push({ source: att.name, whole: true });
  }

  const longIds = new Set(attachments.filter((a) => a.chars > INLINE_LIMIT).map((a) => a.id));
  if (longIds.size) {
    const hits = await recallChunks(query, { chatId, projectId, limit: 6 });
    for (const hit of hits.filter((h) => !short.some((s) => s.name === h.source))) {
      parts.push(`## ${hit.source} (trecho ${hit.ord + 1})\n${hit.text}`);
      used.push({ source: hit.source, ord: hit.ord, whole: false });
    }
  }

  if (!parts.length) return { block: '', used: [] };

  return {
    block: [
      '# Documentos anexados',
      'Use como fonte. Cite o nome do arquivo quando a resposta vier daqui.',
      '',
      parts.join('\n\n')
    ].join('\n'),
    used
  };
}
