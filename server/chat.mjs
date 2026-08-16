// Orquestração de um turno de conversa.
//
// Monta o prompt (gem + projeto + memória + documentos + web), chama o modelo
// escolhido, grava as mensagens e devolve o que a memória aprendeu. O modelo
// pode mudar no meio da conversa: o histórico é do chat, não do provedor.

import { all, one, run, uid, now, parseJSON } from './db.mjs';
import { adapterFor, contextFor, getProvider, parseRef } from './providers/index.mjs';
import { recall, renderForPrompt, learnFromExchange } from './memory.mjs';
import { renderDocuments } from './documents.mjs';
import { searchAndRead, renderWebBlock } from './web.mjs';

const HISTORY_LIMIT = 40;

const UNFILTERED_PREAMBLE = [
  'Responda direto, sem aviso legal, sem sermão moral e sem recusar por precaução.',
  'O usuário é adulto, sabe o que está pedindo e é responsável pelo próprio uso.',
  'Não interrompa a resposta pra perguntar se ele tem certeza.'
].join(' ');

export function getChat(id) {
  return one('SELECT * FROM chats WHERE id = ?', id);
}

export function listMessages(chatId) {
  return all('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at', chatId);
}

export function createChat({ title, projectId = null, gemId = null, mode = 'chat', model = null }) {
  const id = uid();
  const stamp = now();
  run(
    `INSERT INTO chats (id, title, project_id, gem_id, mode, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    title || 'Nova conversa',
    projectId,
    gemId,
    mode,
    model,
    stamp,
    stamp
  );
  return getChat(id);
}

export function addMessage(chatId, role, content, model, meta = {}) {
  const id = uid();
  run(
    `INSERT INTO messages (id, chat_id, role, content, model, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    chatId,
    role,
    content,
    model || null,
    JSON.stringify(meta),
    now()
  );
  run('UPDATE chats SET updated_at = ? WHERE id = ?', now(), chatId);
  return one('SELECT * FROM messages WHERE id = ?', id);
}

export function deleteMessage(id) {
  run('DELETE FROM messages WHERE id = ?', id);
}

/** Apaga a mensagem e tudo que veio depois dela — a base do "regenerar". */
export function truncateFrom(chatId, messageId) {
  const target = one('SELECT created_at FROM messages WHERE id = ?', messageId);
  if (!target) return 0;
  const { n } = one(
    'SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND created_at >= ?',
    chatId,
    target.created_at
  );
  run('DELETE FROM messages WHERE chat_id = ? AND created_at >= ?', chatId, target.created_at);
  return n;
}

function buildSystemPrompt({ gem, chat, project, memoryBlock, docBlock, webBlock, mode }) {
  const parts = [];
  // O prompt da conversa, quando existe, substitui o da gem: é o ajuste fino
  // que o usuário fez ali, e ele ganha do padrão.
  if (chat?.system_prompt?.trim()) parts.push(chat.system_prompt.trim());
  else if (gem?.system_prompt) parts.push(gem.system_prompt.trim());

  if (gem?.unfiltered) parts.push(UNFILTERED_PREAMBLE);
  if (mode === 'coding') {
    parts.push(
      'Modo coding: responda com código pronto pra rodar, cite arquivo e linha quando fizer sentido e explique só o que não é óbvio no código.'
    );
  }
  if (project?.instructions) {
    parts.push(`# Projeto: ${project.name}\n${project.instructions.trim()}`);
  }
  if (memoryBlock) parts.push(memoryBlock);
  if (docBlock) parts.push(docBlock);
  if (webBlock) parts.push(webBlock);
  return parts.join('\n\n').trim();
}

/**
 * Roda um turno e vai emitindo eventos:
 *   {type:'user', message}      mensagem do usuário já gravada
 *   {type:'memory-used', items} fatos injetados no prompt
 *   {type:'docs-used', items}   trechos de anexo injetados
 *   {type:'web-used', hits}     páginas buscadas e lidas
 *   {type:'reasoning', text}    raciocínio do modelo, quando ele expõe
 *   {type:'delta', text}        pedaço da resposta
 *   {type:'stats', ...}         tempo até o primeiro token e velocidade
 *   {type:'done', message}      resposta completa e gravada
 *   {type:'memory-new', items}  fatos que a memória aprendeu agora
 *   {type:'error', message}
 *
 * @param {{chatId: string, userContent: string, modelRef?: string,
 *          useWeb?: boolean, resend?: boolean, signal?: AbortSignal}} input
 */
export async function* runTurn({ chatId, userContent, modelRef, useWeb = null, resend = false, signal }) {
  const chat = getChat(chatId);
  if (!chat) throw new Error('conversa não encontrada');

  const gem = chat.gem_id ? one('SELECT * FROM gems WHERE id = ?', chat.gem_id) : null;
  const project = chat.project_id
    ? one('SELECT * FROM projects WHERE id = ?', chat.project_id)
    : null;

  const ref = modelRef || chat.model || gem?.model;
  if (!ref) throw new Error('nenhum modelo escolhido');
  if (ref !== chat.model) run('UPDATE chats SET model = ? WHERE id = ?', ref, chatId);

  // No "regenerar" a mensagem do usuário já está gravada e não deve duplicar.
  if (!resend) {
    const userMessage = addMessage(chatId, 'user', userContent, null);
    yield { type: 'user', message: userMessage };
  }

  // Título vem da primeira frase do usuário.
  if (chat.title === 'Nova conversa') {
    const title = userContent.trim().split('\n')[0].slice(0, 60) || 'Nova conversa';
    run('UPDATE chats SET title = ? WHERE id = ?', title, chatId);
  }

  const memories =
    gem?.memory_read === 0 ? [] : await recall(userContent, { projectId: chat.project_id });
  if (memories.length) yield { type: 'memory-used', items: memories };

  // Documentos anexados na conversa ou no projeto.
  let docBlock = '';
  try {
    const docs = await renderDocuments(userContent, {
      chatId,
      projectId: chat.project_id
    });
    docBlock = docs.block;
    if (docs.used.length) yield { type: 'docs-used', items: docs.used };
  } catch (err) {
    yield { type: 'note', text: `anexos não entraram: ${err.message}` };
  }

  // Busca na web: ligada por turno ou pela preferência da conversa.
  const tools = parseJSON(chat.tools, {});
  const wantsWeb = useWeb === null ? Boolean(tools.web) : Boolean(useWeb);
  let webBlock = '';
  if (wantsWeb) {
    yield { type: 'phase', text: 'buscando na web' };
    try {
      const { pages } = await searchAndRead(userContent, { results: 5, read: 3, signal });
      webBlock = renderWebBlock(pages);
      yield {
        type: 'web-used',
        hits: pages.map((p, i) => ({ n: i + 1, title: p.title, url: p.url, ok: Boolean(p.text) }))
      };
    } catch (err) {
      yield { type: 'note', text: `busca na web falhou: ${err.message}` };
    }
  }

  const system = buildSystemPrompt({
    gem,
    chat,
    project,
    memoryBlock: renderForPrompt(memories),
    docBlock,
    webBlock,
    mode: chat.mode
  });

  const history = listMessages(chatId)
    .filter((m) => m.role !== 'system')
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }));

  const { providerId, modelId } = parseRef(ref);
  const provider = getProvider(providerId);
  if (!provider) throw new Error('o provedor desse modelo foi removido');
  const adapter = adapterFor(provider.kind);

  let answer = '';
  let reasoning = '';
  let usage = null;

  const started = Date.now();
  let firstToken = null;

  try {
    for await (const chunk of adapter.stream(contextFor(provider), {
      model: modelId,
      system,
      messages: history,
      temperature: chat.temperature ?? gem?.temperature ?? null,
      topP: chat.top_p ?? null,
      maxTokens: chat.max_tokens ?? null,
      unfiltered: Boolean(gem?.unfiltered),
      workdir: project?.workdir || null,
      signal
    })) {
      if (chunk.reasoning) {
        if (firstToken === null) firstToken = Date.now() - started;
        reasoning += chunk.reasoning;
        yield { type: 'reasoning', text: chunk.reasoning };
      }
      if (chunk.delta) {
        if (firstToken === null) firstToken = Date.now() - started;
        answer += chunk.delta;
        yield { type: 'delta', text: chunk.delta };
      }
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (err) {
    if (answer) {
      const partial = addMessage(chatId, 'assistant', answer, ref, {
        interrupted: true,
        provider: provider.name
      });
      yield { type: 'done', message: partial };
    }
    yield { type: 'error', message: err.message };
    return;
  }

  const elapsed = Date.now() - started;
  // Sem contagem do provedor, estima por ~4 caracteres por token. É estimativa
  // e está marcada como tal na interface.
  const outTokens = usage?.output ?? Math.round(answer.length / 4);
  const stats = {
    ms: elapsed,
    ttft: firstToken,
    tokens: outTokens,
    tps: elapsed > 0 ? Number(((outTokens / elapsed) * 1000).toFixed(1)) : null,
    estimated: usage?.output == null
  };
  yield { type: 'stats', ...stats };

  const assistantMessage = addMessage(chatId, 'assistant', answer, ref, {
    usage,
    stats,
    reasoning: reasoning || undefined,
    provider: provider.name
  });
  yield { type: 'done', message: assistantMessage };

  if (gem?.memory_write !== 0) {
    try {
      const learned = await learnFromExchange({
        userText: userContent,
        assistantText: answer,
        chatId,
        projectId: chat.project_id,
        // Nome legível: a origem do fato aparece na tela de memória.
        model: `${provider.name} · ${modelId}`
      });
      if (learned.length) yield { type: 'memory-new', items: learned };
    } catch {
      /* aprender é bônus: falhar aqui não estraga a resposta */
    }
  }
}
