// Scraping de memória: lê o que já foi conversado com outras IAs e transforma
// em fatos da memória compartilhada.
//
// Formatos aceitos:
//   - export do ChatGPT (conversations.json)
//   - export do Claude (conversations.json)
//   - JSON genérico com {role, content}
//   - markdown/texto solto

import { extractWithModel, addMemory } from './memory.mjs';

/**
 * As mensagens que a conversa do ChatGPT realmente mostra, na ordem.
 *
 * `mapping` guarda a árvore inteira: cada pergunta editada e cada resposta
 * refeita deixam o ramo antigo lá dentro. Ler todos os nós traz de volta o que
 * o usuário mandou substituir — e como esse texto vira memória permanente,
 * seria a versão descartada que ficaria valendo. O caminho certo sai do nó
 * atual e sobe pelos pais.
 *
 * Export sem árvore (ou recortado à mão) cai na ordem por horário, que era o
 * que existia antes.
 */
function chatgptMessages(conv) {
  const mapping = conv.mapping || {};
  const temArvore =
    (conv.current_node && mapping[conv.current_node]) ||
    Object.values(mapping).some((node) => node?.parent);

  if (!temArvore) {
    return Object.values(mapping)
      .map((node) => node?.message)
      .filter(Boolean)
      .sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
  }

  let id = conv.current_node;
  if (!id || !mapping[id]) {
    // Sem ponteiro do fim: a folha com a mensagem mais recente é o melhor palpite.
    let melhor = null;
    for (const [key, node] of Object.entries(mapping)) {
      if (!node?.message || (node.children || []).length) continue;
      if (!melhor || (node.message.create_time || 0) > (melhor.tempo || 0)) {
        melhor = { key, tempo: node.message.create_time || 0 };
      }
    }
    id = melhor?.key;
  }

  const caminho = [];
  const visto = new Set();
  while (id && mapping[id] && !visto.has(id)) {
    visto.add(id);
    if (mapping[id].message) caminho.push(mapping[id].message);
    id = mapping[id].parent;
  }
  return caminho.reverse();
}

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
      turns: chatgptMessages(conv)
        // Só fala de gente e de modelo. O papel "tool" é saída de ferramenta —
        // resultado de busca, retorno de código, descrição de imagem — e virava
        // fala do usuário, entrando na memória como se fosse preferência dele.
        .filter((m) => m.author?.role === 'user' || m.author?.role === 'assistant')
        // Mensagem que a própria interface esconde é contexto injetado, não fala.
        .filter((m) => !m.metadata?.is_visually_hidden_from_conversation)
        .map((m) => ({
          role: m.author.role,
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

  // Lista simples de mensagens. Basta uma entrada bem formada pra reconhecer o
  // formato, então as outras podem ser qualquer coisa: o filtro no fim é o que
  // impede entrada quebrada de virar turno com texto `undefined`, que depois
  // apareceria escrito "undefined" no prompt do extrator.
  if (Array.isArray(data) && data.some((m) => m && m.role && m.content)) {
    return [
      {
        title: filename || 'conversa',
        turns: data
          .filter((m) => m && m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            text: (typeof m.content === 'string' ? m.content : m.content ? JSON.stringify(m.content) : '').trim()
          }))
          .filter((t) => t.text)
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
  // Export de anos de ChatGPT passa de mil conversas. O corte existe pra não
  // gastar mil chamadas de modelo sem aviso — mas quem chamou precisa saber
  // que houve corte, senão "200 conversas lidas" parece o arquivo inteiro.
  const todas = parseExport(raw, filename);
  const conversations = todas.slice(0, maxConversations);
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

  return {
    conversations: conversations.length,
    total: todas.length,
    skipped: todas.length - conversations.length,
    messages: scanned,
    facts
  };
}
