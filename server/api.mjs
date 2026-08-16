// Rotas da API. Tudo JSON, menos o streaming do chat, que é SSE.

import { all, one, run, uid, now, parseJSON } from './db.mjs';
import { loadConfig, patchConfig, setSecret, listSecretNames } from './config.mjs';
import {
  PRESETS,
  createProvider,
  getProvider,
  listProviders,
  refreshModels,
  refOf
} from './providers/index.mjs';
import { discover } from './discovery.mjs';
import { runTurn, createChat, getChat, listMessages } from './chat.mjs';
import {
  addMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  embeddingAvailable
} from './memory.mjs';
import { importConversations } from './importers.mjs';

// ------------------------------------------------------------------ helpers

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('corpo grande demais');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJSON(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
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
      chats: all(
        `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count
         FROM chats c ORDER BY updated_at DESC LIMIT 200`
      ),
      settings: settingsView()
    });
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
  }

  // --- gems ---------------------------------------------------------------
  if (method === 'GET' && path === '/gems') {
    return json(res, all('SELECT * FROM gems ORDER BY created_at'));
  }
  if (method === 'POST' && path === '/gems') {
    const b = await readJSON(req);
    const id = uid();
    run(
      `INSERT INTO gems (id, name, emoji, system_prompt, model, temperature, mode, unfiltered,
                         memory_read, memory_write, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      b.name || 'Nova gem',
      b.emoji || '💎',
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
        `UPDATE gems SET name = ?, emoji = ?, system_prompt = ?, model = ?, temperature = ?,
           mode = ?, unfiltered = ?, memory_read = ?, memory_write = ? WHERE id = ?`,
        b.name ?? cur.name,
        b.emoji ?? cur.emoji,
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
      'INSERT INTO projects (id, name, emoji, instructions, workdir, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      b.name || 'Novo projeto',
      b.emoji || '📁',
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
        'UPDATE projects SET name = ?, emoji = ?, instructions = ?, workdir = ? WHERE id = ?',
        b.name ?? cur.name,
        b.emoji ?? cur.emoji,
        b.instructions ?? cur.instructions,
        b.workdir !== undefined ? b.workdir : cur.workdir,
        id
      );
      return json(res, one('SELECT * FROM projects WHERE id = ?', id));
    }
  }

  // --- conversas -----------------------------------------------------------
  if (method === 'GET' && path === '/chats') {
    return json(
      res,
      all(
        `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count
         FROM chats c ORDER BY updated_at DESC LIMIT 200`
      )
    );
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
      return json(res, { chat, messages: listMessages(id) });
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
        'UPDATE chats SET title = ?, model = ?, gem_id = ?, project_id = ?, mode = ? WHERE id = ?',
        b.title ?? cur.title,
        b.model !== undefined ? b.model : cur.model,
        b.gem_id !== undefined ? b.gem_id : cur.gem_id,
        b.project_id !== undefined ? b.project_id : cur.project_id,
        b.mode ?? cur.mode,
        id
      );
      return json(res, getChat(id));
    }

    // Streaming da resposta.
    if (method === 'POST' && seg[2] === 'stream') {
      const b = await readJSON(req);
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      const controller = new AbortController();
      req.on('close', () => controller.abort());

      const send = (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        for await (const event of runTurn({
          chatId: id,
          userContent: b.content || '',
          modelRef: b.model || null,
          signal: controller.signal
        })) {
          send(event);
        }
      } catch (err) {
        send({ type: 'error', message: err.message });
      }
      send({ type: 'end' });
      return res.end();
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
    if (b.requireToken !== undefined) patch.requireToken = !!b.requireToken;
    patchConfig(patch);
    return json(res, settingsView());
  }
  if (method === 'POST' && path === '/secrets') {
    const b = await readJSON(req);
    setSecret(b.name, b.value);
    return json(res, { ok: true, secrets: listSecretNames() });
  }

  return json(res, { error: `rota não encontrada: ${method} ${path}` }, 404);
}
