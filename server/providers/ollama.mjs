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
        usage: {
          prompt_tokens: json.prompt_eval_count,
          completion_tokens: json.eval_count
        }
      };
    }
  }
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
