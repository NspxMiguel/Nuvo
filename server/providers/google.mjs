// Adaptador do Google Gemini (generativelanguage).

import { sseData, ensureOk, trimUrl } from './util.mjs';

export const kind = 'google';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function listModels(ctx) {
  const base = trimUrl(ctx.baseUrl || DEFAULT_BASE);
  const res = await fetch(`${base}/models?key=${encodeURIComponent(ctx.apiKey || '')}`);
  await ensureOk(res, 'listar modelos');
  const data = await res.json();
  return (data.models || [])
    .map((m) => {
      const id = String(m.name || '').replace(/^models\//, '');
      const methods = m.supportedGenerationMethods || [];
      const embedding = methods.includes('embedContent') && !methods.includes('generateContent');
      return { model_id: id, label: m.displayName || id, kind: embedding ? 'embedding' : 'chat' };
    })
    .filter((m) => m.model_id);
}

export async function* stream(ctx, req) {
  const base = trimUrl(ctx.baseUrl || DEFAULT_BASE);
  const url =
    `${base}/models/${encodeURIComponent(req.model)}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(ctx.apiKey || '')}`;

  const body = {
    contents: req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (req.temperature != null) body.generationConfig = { temperature: req.temperature };
  // O Gemini tem filtros de segurança configuráveis pelo chamador.
  if (req.unfiltered) {
    body.safetySettings = [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT'
    ].map((category) => ({ category, threshold: 'BLOCK_NONE' }));
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
    if (json.error) throw new Error(json.error.message || 'erro do Gemini');
    for (const part of json.candidates?.[0]?.content?.parts || []) {
      if (part.text) yield { delta: part.text };
    }
    if (json.usageMetadata) {
      yield {
        usage: {
          prompt_tokens: json.usageMetadata.promptTokenCount,
          completion_tokens: json.usageMetadata.candidatesTokenCount
        }
      };
    }
  }
}

export async function embed(ctx, { model, input }) {
  const base = trimUrl(ctx.baseUrl || DEFAULT_BASE);
  const out = [];
  for (const text of input) {
    const res = await fetch(
      `${base}/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(ctx.apiKey || '')}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } })
      }
    );
    await ensureOk(res, 'embeddings');
    const data = await res.json();
    out.push(data.embedding.values);
  }
  return out;
}
