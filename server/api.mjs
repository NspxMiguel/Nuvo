// Rotas da API. Tudo JSON, menos os streams (chat, pesquisa, conselho e
// download de modelo), que são SSE.

import { all, one, run, uid, now, parseJSON } from './db.mjs';
import { loadConfig, patchConfig, setSecret, listSecretNames } from './config.mjs';
import {
  PRESETS,
  adapterFor,
  contextFor,
  createProvider,
  getProvider,
  listProviders,
  refreshModels,
  refOf
} from './providers/index.mjs';
import { discover } from './discovery.mjs';
import {
  runTurn,
  createChat,
  getChat,
  listMessages,
  deleteMessage,
  truncateFrom
} from './chat.mjs';
import {
  addMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  embeddingAvailable
} from './memory.mjs';
import { importConversations } from './importers.mjs';
import { addAttachment, listAttachments, deleteAttachment } from './documents.mjs';
import { runResearch } from './research.mjs';
import { runCouncil } from './council.mjs';
import { ftsQuery } from './vectors.mjs';
import { search as webSearch, readPage } from './web.mjs';
import { createBackup, restoreBackup, listBackups, backupName } from './backup.mjs';
import { explainProviderError } from './errors.mjs';

// ------------------------------------------------------------------ helpers

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readBuffer(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('arquivo grande demais (limite de 64 MB)');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req, limit) {
  return (await readBuffer(req, limit)).toString('utf8');
}

async function readJSON(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

// Um comentário SSE a cada 15 s. Modelo local pensando, pesquisa lendo página:
// há minutos sem nenhum byte, e celular em Wi‑Fi derruba conexão parada.
const PING_MS = 15_000;

/** Abre um stream SSE e devolve o par (enviar, encerrar). */
function openStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  let last = Date.now();
  const ping = setInterval(() => {
    if (Date.now() - last >= PING_MS && !res.writableEnded) res.write(': ping\n\n');
  }, PING_MS);
  ping.unref?.();

  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
  };
  req.on('close', finish);

  return {
    signal: controller.signal,
    send(event) {
      last = Date.now();
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      finish();
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      res.end();
    }
  };
}

// Um turno por conversa. Dois streams no mesmo chat leriam o mesmo histórico e
// gravariam duas respostas para a mesma pergunta — a segunda aba do navegador,
// o toque duplo no botão de enviar, o "regenerar" enquanto ainda escreve.
const busyChats = new Set();

function chatBusy(chatId) {
  return busyChats.has(chatId);
}

async function withChatLock(chatId, fn) {
  busyChats.add(chatId);
  try {
    return await fn();
  } finally {
    busyChats.delete(chatId);
  }
}

/** Bombeia um gerador assíncrono pra dentro do SSE, com erro virando evento. */
async function pump(stream, iterator) {
  try {
    for await (const event of iterator) stream.send(event);
  } catch (err) {
    if (err.name !== 'AbortError') stream.send({ type: 'error', message: err.message });
  }
  stream.end();
}

function providerView(p) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    base_url: p.base_url,
    secret_name: p.secret_name,
    has_secret: p.secret_name ? listSecretNames().includes(p.secret_name) : null,
    config: parseJSON(p.config),
    enabled: !!p.enabled,
    auto: !!p.auto,
    manageable: p.kind === 'ollama', // dá pra baixar e apagar modelo por aqui
    models: all(
      'SELECT model_id, label, kind FROM models WHERE provider_id = ? ORDER BY model_id',
      p.id
    ).map((m) => ({ ...m, ref: refOf(p.id, m.model_id) }))
  };
}

function settingsView() {
  const cfg = loadConfig();
  return {
    port: cfg.port,
    host: cfg.host,
    requireToken: cfg.requireToken,
    memory: cfg.memory,
    secrets: listSecretNames(),
    embeddingAvailable: embeddingAvailable()
  };
}

const CHAT_COLUMNS = `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count,
  (SELECT COUNT(*) FROM attachments WHERE chat_id = c.id) AS attachment_count FROM chats c`;

function listChats({ includeArchived = false } = {}) {
  return all(
    `${CHAT_COLUMNS} ${includeArchived ? '' : 'WHERE c.archived = 0'}
     ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 300`
  );
}

// ------------------------------------------------------------------- rotas

export async function handleApi(req, res, url) {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;
  const seg = path.split('/').filter(Boolean);

  // --- estado geral, o que a interface carrega no boot ---------------------
  if (method === 'GET' && path === '/state') {
    return json(res, {
      providers: listProviders().map(providerView),
      gems: all('SELECT * FROM gems ORDER BY created_at'),
      projects: all('SELECT * FROM projects ORDER BY created_at'),
      chats: listChats(),
      settings: settingsView()
    });
  }

  // --- busca global --------------------------------------------------------
  if (method === 'GET' && path === '/search') {
    const q = ftsQuery(url.searchParams.get('q') || '');
    if (!q) return json(res, { chats: [], memories: [] });
    const chats = all(
      `SELECT m.id, m.chat_id, m.role, m.created_at,
              snippet(messages_fts, 0, '«', '»', '…', 14) AS excerpt,
              c.title
       FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       JOIN chats c ON c.id = m.chat_id
       WHERE messages_fts MATCH ?
       ORDER BY bm25(messages_fts) LIMIT 30`,
      q
    );
    const memories = all(
      `SELECT m.id, m.text, m.pinned, m.source
       FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ? AND m.active = 1
       ORDER BY bm25(memories_fts) LIMIT 20`,
      q
    );
    return json(res, { chats, memories });
  }

  // --- provedores ----------------------------------------------------------
  if (method === 'GET' && path === '/presets') return json(res, PRESETS);

  if (method === 'POST' && path === '/discover') {
    const found = await discover();
    return json(res, { found, providers: listProviders().map(providerView) });
  }

  if (method === 'GET' && path === '/providers') {
    return json(res, listProviders().map(providerView));
  }

  // Saúde: um por um, em paralelo. É o que responde "por que a resposta não
  // vem?" antes de o usuário ter que adivinhar.
  if (method === 'GET' && path === '/health') {
    const checked = await Promise.all(
      listProviders().map(async (provider) => {
        const base = {
          id: provider.id,
          name: provider.name,
          kind: provider.kind,
          enabled: !!provider.enabled,
          models: all('SELECT COUNT(*) AS n FROM models WHERE provider_id = ?', provider.id)[0].n
        };
        if (!provider.enabled) return { ...base, status: 'off', message: 'desligado nas configurações' };
        if (provider.secret_name && !listSecretNames().includes(provider.secret_name)) {
          return { ...base, status: 'erro', message: `falta a chave "${provider.secret_name}"` };
        }
        const started = Date.now();
        try {
          // `check` quando o adaptador tem um teste melhor que listar modelos —
          // no CLI, listar só repete a configuração e nunca falha.
          const adapter = adapterFor(provider.kind);
          const models = await (adapter.check || adapter.listModels)(contextFor(provider));
          return { ...base, status: 'ok', ms: Date.now() - started, models: models.length };
        } catch (err) {
          return { ...base, status: 'erro', ms: Date.now() - started, message: explainProviderError(err, provider) };
        }
      })
    );
    return json(res, checked);
  }

  if (method === 'POST' && path === '/providers') {
    const body = await readJSON(req);
    if (body.secretValue && body.secretName) setSecret(body.secretName, body.secretValue);
    const provider = createProvider({
      name: body.name,
      kind: body.kind,
      baseUrl: body.baseUrl,
      secretName: body.secretName || null,
      config: body.config || {}
    });
    let error = null;
    try {
      await refreshModels(provider.id);
    } catch (err) {
      error = err.message;
    }
    return json(res, { provider: providerView(getProvider(provider.id)), error });
  }

  if (seg[0] === 'providers' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE' && seg.length === 2) {
      run('DELETE FROM providers WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH' && seg.length === 2) {
      const body = await readJSON(req);
      if (body.secretValue !== undefined && body.secretName) {
        setSecret(body.secretName, body.secretValue);
      }
      const current = getProvider(id);
      run(
        'UPDATE providers SET name = ?, base_url = ?, secret_name = ?, config = ?, enabled = ? WHERE id = ?',
        body.name ?? current.name,
        body.baseUrl ?? current.base_url,
        body.secretName ?? current.secret_name,
        JSON.stringify(body.config ?? parseJSON(current.config)),
        body.enabled === undefined ? current.enabled : body.enabled ? 1 : 0,
        id
      );
      return json(res, providerView(getProvider(id)));
    }
    if (method === 'POST' && seg[2] === 'refresh') {
      try {
        await refreshModels(id);
        return json(res, providerView(getProvider(id)));
      } catch (err) {
        return json(res, { error: err.message }, 502);
      }
    }

    // Gerenciar modelo do provedor (hoje só o Ollama implementa).
    if (method === 'POST' && seg[2] === 'pull') {
      const body = await readJSON(req);
      const provider = getProvider(id);
      const adapter = adapterFor(provider.kind);
      if (!adapter.pull) return json(res, { error: 'este provedor não baixa modelo' }, 400);
      const stream = openStream(req, res);
      await pump(
        stream,
        (async function* () {
          for await (const progress of adapter.pull(contextFor(provider), {
            model: body.model,
            signal: stream.signal
          })) {
            yield { type: 'progress', ...progress };
          }
          await refreshModels(id);
          yield { type: 'done', provider: providerView(getProvider(id)) };
        })()
      );
      return;
    }
    if (method === 'DELETE' && seg[2] === 'models' && seg[3]) {
      const provider = getProvider(id);
      const adapter = adapterFor(provider.kind);
      if (!adapter.remove) return json(res, { error: 'este provedor não apaga modelo' }, 400);
      await adapter.remove(contextFor(provider), { model: decodeURIComponent(seg[3]) });
      await refreshModels(id);
      return json(res, providerView(getProvider(id)));
    }
    if (method === 'GET' && seg[2] === 'running') {
      const provider = getProvider(id);
      const adapter = adapterFor(provider.kind);
      if (!adapter.running) return json(res, []);
      try {
        return json(res, await adapter.running(contextFor(provider)));
      } catch (err) {
        return json(res, { error: err.message }, 502);
      }
    }
  }

  // --- gems ---------------------------------------------------------------
  if (method === 'GET' && path === '/gems') {
    return json(res, all('SELECT * FROM gems ORDER BY created_at'));
  }
  if (method === 'POST' && path === '/gems') {
    const b = await readJSON(req);
    const id = uid();
    run(
      `INSERT INTO gems (id, name, icon, color, system_prompt, model, temperature, mode, unfiltered,
                         memory_read, memory_write, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      b.name || 'Nova gem',
      b.icon || 'sparkle',
      b.color || 'indigo',
      b.system_prompt || '',
      b.model || null,
      b.temperature ?? null,
      b.mode || 'chat',
      b.unfiltered ? 1 : 0,
      b.memory_read === false ? 0 : 1,
      b.memory_write === false ? 0 : 1,
      now()
    );
    return json(res, one('SELECT * FROM gems WHERE id = ?', id));
  }
  if (seg[0] === 'gems' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      run('DELETE FROM gems WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      const cur = one('SELECT * FROM gems WHERE id = ?', id);
      if (!cur) return json(res, { error: 'gem não encontrada' }, 404);
      run(
        `UPDATE gems SET name = ?, icon = ?, color = ?, system_prompt = ?, model = ?, temperature = ?,
           mode = ?, unfiltered = ?, memory_read = ?, memory_write = ? WHERE id = ?`,
        b.name ?? cur.name,
        b.icon ?? cur.icon,
        b.color ?? cur.color,
        b.system_prompt ?? cur.system_prompt,
        b.model !== undefined ? b.model : cur.model,
        b.temperature !== undefined ? b.temperature : cur.temperature,
        b.mode ?? cur.mode,
        b.unfiltered === undefined ? cur.unfiltered : b.unfiltered ? 1 : 0,
        b.memory_read === undefined ? cur.memory_read : b.memory_read ? 1 : 0,
        b.memory_write === undefined ? cur.memory_write : b.memory_write ? 1 : 0,
        id
      );
      return json(res, one('SELECT * FROM gems WHERE id = ?', id));
    }
  }

  // --- projetos ------------------------------------------------------------
  if (method === 'GET' && path === '/projects') {
    return json(res, all('SELECT * FROM projects ORDER BY created_at'));
  }
  if (method === 'POST' && path === '/projects') {
    const b = await readJSON(req);
    const id = uid();
    run(
      'INSERT INTO projects (id, name, icon, color, instructions, workdir, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      b.name || 'Novo projeto',
      b.icon || 'folder',
      b.color || 'slate',
      b.instructions || '',
      b.workdir || null,
      now()
    );
    return json(res, one('SELECT * FROM projects WHERE id = ?', id));
  }
  if (seg[0] === 'projects' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      run('DELETE FROM projects WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      const cur = one('SELECT * FROM projects WHERE id = ?', id);
      if (!cur) return json(res, { error: 'projeto não encontrado' }, 404);
      run(
        'UPDATE projects SET name = ?, icon = ?, color = ?, instructions = ?, workdir = ? WHERE id = ?',
        b.name ?? cur.name,
        b.icon ?? cur.icon,
        b.color ?? cur.color,
        b.instructions ?? cur.instructions,
        b.workdir !== undefined ? b.workdir : cur.workdir,
        id
      );
      return json(res, one('SELECT * FROM projects WHERE id = ?', id));
    }
  }

  // --- conversas -----------------------------------------------------------
  if (method === 'GET' && path === '/chats') {
    return json(res, listChats({ includeArchived: url.searchParams.get('all') === '1' }));
  }
  if (method === 'POST' && path === '/chats') {
    const b = await readJSON(req);
    return json(
      res,
      createChat({
        title: b.title,
        projectId: b.project_id || null,
        gemId: b.gem_id || null,
        mode: b.mode || 'chat',
        model: b.model || null
      })
    );
  }
  if (seg[0] === 'chats' && seg[1]) {
    const id = seg[1];

    if (method === 'GET' && seg.length === 2) {
      const chat = getChat(id);
      if (!chat) return json(res, { error: 'conversa não encontrada' }, 404);
      return json(res, {
        chat,
        messages: listMessages(id),
        attachments: listAttachments({ chatId: id })
      });
    }
    if (method === 'DELETE' && seg.length === 2) {
      run('DELETE FROM chats WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH' && seg.length === 2) {
      const b = await readJSON(req);
      const cur = getChat(id);
      if (!cur) return json(res, { error: 'conversa não encontrada' }, 404);
      run(
        `UPDATE chats SET title = ?, model = ?, gem_id = ?, project_id = ?, mode = ?,
           system_prompt = ?, temperature = ?, top_p = ?, max_tokens = ?,
           pinned = ?, archived = ?, tools = ? WHERE id = ?`,
        b.title ?? cur.title,
        b.model !== undefined ? b.model : cur.model,
        b.gem_id !== undefined ? b.gem_id : cur.gem_id,
        b.project_id !== undefined ? b.project_id : cur.project_id,
        b.mode ?? cur.mode,
        b.system_prompt !== undefined ? b.system_prompt : cur.system_prompt,
        b.temperature !== undefined ? b.temperature : cur.temperature,
        b.top_p !== undefined ? b.top_p : cur.top_p,
        b.max_tokens !== undefined ? b.max_tokens : cur.max_tokens,
        b.pinned === undefined ? cur.pinned : b.pinned ? 1 : 0,
        b.archived === undefined ? cur.archived : b.archived ? 1 : 0,
        b.tools !== undefined ? JSON.stringify(b.tools) : cur.tools,
        id
      );
      return json(res, getChat(id));
    }

    // Exportar a conversa inteira.
    if (method === 'GET' && seg[2] === 'export') {
      const chat = getChat(id);
      if (!chat) return json(res, { error: 'conversa não encontrada' }, 404);
      const messages = listMessages(id);
      const format = url.searchParams.get('format') || 'md';
      if (format === 'json') {
        return json(res, { chat, messages: messages.map((m) => ({ ...m, meta: parseJSON(m.meta) })) });
      }
      const lines = [`# ${chat.title}`, '', `_${chat.created_at}_`, ''];
      for (const m of messages) {
        if (m.role === 'system') continue;
        const meta = parseJSON(m.meta);
        const who = m.role === 'user' ? 'Você' : meta.provider || m.model || 'Assistente';
        lines.push(`## ${who}`, '', m.content, '');
      }
      const body = lines.join('\n');
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${chat.title.replace(/[^\w\- ]+/g, '')}.md"`
      });
      return res.end(body);
    }

    // Streaming da resposta.
    if (method === 'POST' && seg[2] === 'stream') {
      const b = await readJSON(req);
      if (chatBusy(id)) {
        return json(res, { error: 'essa conversa já está respondendo — espere terminar ou pare a resposta' }, 409);
      }
      const stream = openStream(req, res);
      await withChatLock(id, () =>
        pump(
          stream,
          runTurn({
            chatId: id,
            userContent: b.content || '',
            modelRef: b.model || null,
            useWeb: b.web === undefined ? null : Boolean(b.web),
            signal: stream.signal
          })
        )
      );
      return;
    }

    // Regenerar: apaga da mensagem indicada em diante e refaz o último turno.
    if (method === 'POST' && seg[2] === 'regenerate') {
      const b = await readJSON(req);
      if (chatBusy(id)) {
        return json(res, { error: 'essa conversa já está respondendo — pare a resposta antes de refazer' }, 409);
      }
      const messages = listMessages(id);
      const target = b.from
        ? messages.find((m) => m.id === b.from)
        : [...messages].reverse().find((m) => m.role === 'assistant');
      if (!target) return json(res, { error: 'não há resposta pra refazer' }, 400);
      truncateFrom(id, target.id);

      const remaining = listMessages(id);
      const lastUser = [...remaining].reverse().find((m) => m.role === 'user');
      if (!lastUser) return json(res, { error: 'não há pergunta antes dessa resposta' }, 400);

      const stream = openStream(req, res);
      stream.send({ type: 'reset', keep: remaining.map((m) => m.id) });
      await withChatLock(id, () =>
        pump(
          stream,
          runTurn({
            chatId: id,
            userContent: lastUser.content,
            modelRef: b.model || null,
            useWeb: b.web === undefined ? null : Boolean(b.web),
            resend: true,
            signal: stream.signal
          })
        )
      );
      return;
    }

    // Anexos da conversa. O corpo é o arquivo cru: multipart não vale a pena
    // implementar à mão só pra isso.
    if (method === 'POST' && seg[2] === 'attachments') {
      const buffer = await readBuffer(req);
      const name = url.searchParams.get('name') || 'arquivo';
      const attachment = await addAttachment({
        buffer,
        name,
        mime: req.headers['content-type'] || '',
        chatId: id
      });
      return json(res, attachment);
    }
    if (method === 'GET' && seg[2] === 'attachments') {
      return json(res, listAttachments({ chatId: id }));
    }
  }

  // --- mensagens -----------------------------------------------------------
  if (seg[0] === 'messages' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      deleteMessage(id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      const cur = one('SELECT * FROM messages WHERE id = ?', id);
      if (!cur) return json(res, { error: 'mensagem não encontrada' }, 404);
      run('UPDATE messages SET content = ? WHERE id = ?', b.content ?? cur.content, id);
      return json(res, one('SELECT * FROM messages WHERE id = ?', id));
    }
  }

  // --- anexos --------------------------------------------------------------
  if (method === 'GET' && path === '/attachments') {
    return json(
      res,
      listAttachments({
        chatId: url.searchParams.get('chat'),
        projectId: url.searchParams.get('project')
      })
    );
  }
  if (method === 'POST' && path === '/attachments') {
    const buffer = await readBuffer(req);
    const attachment = await addAttachment({
      buffer,
      name: url.searchParams.get('name') || 'arquivo',
      mime: req.headers['content-type'] || '',
      chatId: url.searchParams.get('chat') || null,
      projectId: url.searchParams.get('project') || null
    });
    return json(res, attachment);
  }
  if (seg[0] === 'attachments' && seg[1] && method === 'DELETE') {
    deleteAttachment(seg[1]);
    return json(res, { ok: true });
  }

  // --- pesquisa profunda ---------------------------------------------------
  if (method === 'POST' && path === '/research') {
    const b = await readJSON(req);
    const stream = openStream(req, res);
    await pump(
      stream,
      runResearch({
        question: b.question || '',
        ref: b.model,
        breadth: Number(b.breadth) || 4,
        depth: Number(b.depth) || 3,
        signal: stream.signal
      })
    );
    return;
  }

  // --- conselho de IAs -----------------------------------------------------
  if (method === 'POST' && path === '/council') {
    const b = await readJSON(req);
    const stream = openStream(req, res);
    await pump(
      stream,
      runCouncil({
        prompt: b.prompt || '',
        system: b.system || null,
        // `models` é o que a interface manda; `refs` é o nome interno, aceito
        // aqui pra quem chamar a API direto não tropeçar na diferença.
        refs: b.models || b.refs || [],
        mode: b.mode || 'council',
        judge: b.judge || null,
        temperature: b.temperature ?? null,
        signal: stream.signal
      })
    );
    return;
  }

  // --- ferramenta de web avulsa (a interface usa pra testar) ---------------
  if (method === 'GET' && path === '/web/search') {
    try {
      return json(res, await webSearch(url.searchParams.get('q') || '', { limit: 8 }));
    } catch (err) {
      return json(res, { error: err.message }, 502);
    }
  }
  if (method === 'GET' && path === '/web/read') {
    try {
      return json(res, await readPage(url.searchParams.get('url') || ''));
    } catch (err) {
      return json(res, { error: err.message }, 502);
    }
  }

  // --- memória -------------------------------------------------------------
  if (method === 'GET' && path === '/memories') {
    return json(
      res,
      listMemories({
        projectId: url.searchParams.get('project') || null,
        includeInactive: url.searchParams.get('all') === '1'
      })
    );
  }
  if (method === 'POST' && path === '/memories') {
    const b = await readJSON(req);
    const row = await addMemory({
      text: b.text,
      kind: b.kind || 'fact',
      scope: b.project_id ? 'project' : 'global',
      projectId: b.project_id || null,
      source: 'manual',
      pinned: b.pinned ? 1 : 0
    });
    return json(res, row);
  }
  if (method === 'POST' && path === '/memories/import') {
    const raw = await readBody(req);
    const filename = url.searchParams.get('filename') || '';
    const projectId = url.searchParams.get('project') || null;
    const result = await importConversations(raw, { filename, projectId });
    return json(res, result);
  }
  if (seg[0] === 'memories' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      deleteMemory(id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      return json(res, updateMemory(id, b));
    }
  }

  // --- configuração --------------------------------------------------------
  if (method === 'GET' && path === '/settings') return json(res, settingsView());
  if (method === 'PATCH' && path === '/settings') {
    const b = await readJSON(req);
    // Só repassa o que veio: `requireToken: undefined` desligaria o token.
    const patch = {};
    if (b.memory) patch.memory = b.memory;
    if (b.limits) patch.limits = b.limits;

    const antes = loadConfig().requireToken;
    if (b.requireToken !== undefined) patch.requireToken = !!b.requireToken;
    patchConfig(patch);

    // Religando a tranca, a chave vai junto nesta resposta — quem estava
    // navegando sem token seria trancado do lado de fora no pedido seguinte, e
    // o botão viraria armadilha. Só aqui, e só nesta transição: quem já
    // navegava sem token tinha acesso a tudo de qualquer jeito, então não há o
    // que proteger dele neste instante.
    if (!antes && patch.requireToken) {
      return json(res, { ...settingsView(), accessToken: loadConfig().accessToken });
    }
    return json(res, settingsView());
  }
  if (method === 'POST' && path === '/secrets') {
    const b = await readJSON(req);
    setSecret(b.name, b.value);
    return json(res, { ok: true, secrets: listSecretNames() });
  }

  // --- backup --------------------------------------------------------------
  if (method === 'GET' && path === '/backup') {
    const { buffer } = createBackup();
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': buffer.length,
      'content-disposition': `attachment; filename="${backupName()}"`
    });
    return res.end(buffer);
  }
  if (method === 'GET' && path === '/backups') {
    return json(res, listBackups());
  }
  if (method === 'POST' && path === '/restore') {
    const buffer = await readBuffer(req);
    try {
      const done = restoreBackup(buffer, { keepSecrets: url.searchParams.get('keep-secrets') === '1' });
      // O banco restaurado só passa a valer no próximo start: este processo
      // ainda tem o antigo aberto, com o WAL dele em memória.
      return json(res, {
        ...done,
        restart: true,
        message: 'restaurado — reinicie o servidor pra carregar os dados'
      });
    } catch (err) {
      return json(res, { error: err.message }, 400);
    }
  }

  return json(res, { error: `rota não encontrada: ${method} ${path}` }, 404);
}
