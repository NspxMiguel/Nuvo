// Adaptador OpenAI-compatível. Cobre a maior parte do mundo: OpenAI, Groq,
// DeepSeek, OpenRouter, xAI, Mistral, LM Studio, llama.cpp, vLLM, LocalAI.

import { sseData, ensureOk, trimUrl } from './util.mjs';

export const kind = 'openai';

function headers(ctx) {
  const h = { 'content-type': 'application/json' };
  if (ctx.apiKey) h.authorization = `Bearer ${ctx.apiKey}`;
  const extra = ctx.config?.headers;
  if (extra && typeof extra === 'object') Object.assign(h, extra);
  return h;
}

export async function listModels(ctx) {
  const res = await fetch(`${trimUrl(ctx.baseUrl)}/models`, { headers: headers(ctx) });
  await ensureOk(res, 'listar modelos');
  const data = await res.json();
  return (data.data || data.models || []).map((m) => {
    const id = m.id || m.name;
    const embedding = /embed/i.test(id) || m.type === 'embeddings';
    return { model_id: id, label: id, kind: embedding ? 'embedding' : 'chat' };
  });
}

export async function* stream(ctx, req) {
  const body = {
    model: req.model,
    messages: req.system ? [{ role: 'system', content: req.system }, ...req.messages] : req.messages,
    stream: true
  };
  if (req.temperature != null) body.temperature = req.temperature;
  if (req.maxTokens) body.max_tokens = req.maxTokens;

  const res = await fetch(`${trimUrl(ctx.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: headers(ctx),
    body: JSON.stringify(body),
    signal: req.signal
  });
  await ensureOk(res, 'chat');

  for await (const payload of sseData(res)) {
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    if (json.error) throw new Error(json.error.message || 'erro do provedor');
    const choice = json.choices?.[0];
    const delta = choice?.delta?.content ?? choice?.text;
    // Modelos de raciocínio locais mandam o pensamento num campo separado.
    const think = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
    if (think) yield { reasoning: think };
    if (delta) yield { delta };
    if (json.usage) yield { usage: json.usage };
  }
}

export async function embed(ctx, { model, input }) {
  const res = await fetch(`${trimUrl(ctx.baseUrl)}/embeddings`, {
    method: 'POST',
    headers: headers(ctx),
    body: JSON.stringify({ model, input })
  });
  await ensureOk(res, 'embeddings');
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}
