// Adaptador nativo do Ollama. O Ollama também expõe /v1 OpenAI-compatível, mas
// a API nativa lista os modelos com tamanho e família, e não exige chave.

import { lines, ensureOk, trimUrl } from './util.mjs';

export const kind = 'ollama';

const DEFAULT_BASE = 'http://127.0.0.1:11434';

export async function listModels(ctx) {
  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/api/tags`);
  await ensureOk(res, 'listar modelos');
  const data = await res.json();
  return (data.models || []).map((m) => ({
    model_id: m.name,
    label: `${m.name} (${formatSize(m.size)})`,
    kind: /embed/i.test(m.name) ? 'embedding' : 'chat'
  }));
}

function formatSize(bytes) {
  if (!bytes) return '?';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export async function* stream(ctx, req) {
  const body = {
    model: req.model,
    stream: true,
    messages: req.system
      ? [{ role: 'system', content: req.system }, ...req.messages]
      : req.messages,
    options: {}
  };
  if (req.temperature != null) body.options.temperature = req.temperature;
  if (req.topP != null) body.options.top_p = req.topP;
  if (req.maxTokens) body.options.num_predict = req.maxTokens;

  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: req.signal
  });
  await ensureOk(res, 'chat');

  // Resposta é NDJSON, não SSE.
  for await (const line of lines(res)) {
    if (!line.trim()) continue;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    if (json.error) throw new Error(json.error);
    if (json.message?.thinking) yield { reasoning: json.message.thinking };
    if (json.message?.content) yield { delta: json.message.content };
    if (json.done) {
      yield {
        usage: { input: json.prompt_eval_count ?? null, output: json.eval_count ?? null }
      };
    }
  }
}

// ------------------------------------------------------ gerenciar modelos
//
// É o que o LM Studio faz na aba de modelos: baixar e apagar sem sair do app.

/** Baixa um modelo, emitindo o andamento. O Ollama responde NDJSON. */
export async function* pull(ctx, { model, signal }) {
  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    signal
  });
  await ensureOk(res, 'baixar modelo');

  for await (const line of lines(res)) {
    if (!line.trim()) continue;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    if (json.error) throw new Error(json.error);
    yield {
      status: json.status || '',
      completed: json.completed ?? null,
      total: json.total ?? null,
      percent:
        json.total > 0 ? Number(((json.completed || 0) / json.total * 100).toFixed(1)) : null
    };
  }
}

export async function remove(ctx, { model }) {
  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/api/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model })
  });
  await ensureOk(res, 'remover modelo');
  return true;
}

/** Modelos carregados na memória agora, com quanto ocupam. */
export async function running(ctx) {
  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/api/ps`);
  await ensureOk(res, 'modelos carregados');
  const data = await res.json();
  return (data.models || []).map((m) => ({
    model: m.name,
    size: m.size,
    until: m.expires_at || null
  }));
}

export async function embed(ctx, { model, input }) {
  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input })
  });
  await ensureOk(res, 'embeddings');
  const data = await res.json();
  return data.embeddings;
}
