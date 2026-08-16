// Scraping de memória: lê o que já foi conversado com outras IAs e transforma
// em fatos da memória compartilhada.
//
// Formatos aceitos:
//   - export do ChatGPT (conversations.json)
//   - export do Claude (conversations.json)
//   - JSON genérico com {role, content}
//   - markdown/texto solto

import { extractWithModel, addMemory } from './memory.mjs';

/** Vira uma lista de {title, turns:[{role, text}]}. */
export function parseExport(raw, filename = '') {
  const text = String(raw);
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return [{ title: filename || 'texto', turns: [{ role: 'user', text }] }];
  }

  // ChatGPT: cada conversa tem "mapping" com os nós da árvore.
  if (Array.isArray(data) && data.some((c) => c && c.mapping)) {
    return data.map((conv) => ({
      title: conv.title || 'conversa',
      turns: Object.values(conv.mapping || {})
        .map((node) => node?.message)
        .filter((m) => m && m.author?.role !== 'system')
        .sort((a, b) => (a.create_time || 0) - (b.create_time || 0))
        .map((m) => ({
          role: m.author?.role === 'assistant' ? 'assistant' : 'user',
          text: (m.content?.parts || [])
            .map((p) => (typeof p === 'string' ? p : p?.text || ''))
            .join('\n')
            .trim()
        }))
        .filter((t) => t.text)
    }));
  }

  // Claude: cada conversa tem "chat_messages".
  if (Array.isArray(data) && data.some((c) => c && c.chat_messages)) {
    return data.map((conv) => ({
      title: conv.name || 'conversa',
      turns: (conv.chat_messages || [])
        .map((m) => ({
          role: m.sender === 'assistant' ? 'assistant' : 'user',
          text:
            m.text ||
            (m.content || [])
              .map((c) => c?.text || '')
              .join('\n')
              .trim()
        }))
        .filter((t) => t.text)
    }));
  }

  // Lista simples de mensagens.
  if (Array.isArray(data) && data.some((m) => m && m.role && m.content)) {
    return [
      {
        title: filename || 'conversa',
        turns: data
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }))
      }
    ];
  }

  return [{ title: filename || 'json', turns: [{ role: 'user', text }] }];
}

/**
 * Importa e grava. Junta os turnos em blocos, porque extrair fato a fato
 * gastaria uma chamada de modelo por mensagem.
 */
export async function importConversations(raw, { filename = '', projectId = null, maxConversations = 200 } = {}) {
  const conversations = parseExport(raw, filename).slice(0, maxConversations);
  const facts = [];
  let scanned = 0;

  for (const conv of conversations) {
    // Só o que o usuário disse — o que a IA respondeu não é fato sobre ele.
    const said = conv.turns.filter((t) => t.role === 'user').map((t) => t.text);
    if (!said.length) continue;
    scanned += said.length;

    const blob = said.join('\n').slice(0, 8000);
    const extracted = await extractWithModel(blob);
    for (const fact of extracted) {
      const row = await addMemory({
        text: fact,
        kind: 'fact',
        scope: projectId ? 'project' : 'global',
        projectId,
        source: 'import',
        sourceRef: `${filename || 'import'} · ${conv.title}`
      });
      if (row) facts.push(row);
    }
  }

  return { conversations: conversations.length, messages: scanned, facts };
}
