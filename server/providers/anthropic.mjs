// Adaptador nativo da Anthropic (Messages API).
//
// HTTP cru em vez do SDK oficial porque o servidor inteiro é zero-dependência:
// precisa subir em Windows, Mac e Linux sem build nativo e sem npm install.

import { sseData, ensureOk, trimUrl } from './util.mjs';

export const kind = 'anthropic';

const DEFAULT_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

// Modelos com sampling removido: mandar temperature/top_p/top_k devolve 400.
const NO_SAMPLING = /^claude-(opus-5|opus-4-8|opus-4-7|sonnet-5|fable-5|mythos-5)/;

function headers(ctx) {
  return {
    'content-type': 'application/json',
    'x-api-key': ctx.apiKey || '',
    'anthropic-version': API_VERSION
  };
}

export async function listModels(ctx) {
  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/models?limit=100`, {
    headers: headers(ctx)
  });
  await ensureOk(res, 'listar modelos');
  const data = await res.json();
  return (data.data || []).map((m) => ({
    model_id: m.id,
    label: m.display_name || m.id,
    kind: 'chat'
  }));
}

export async function* stream(ctx, req) {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens || 16000,
    stream: true,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content }))
  };
  if (req.system) body.system = req.system;
  // Sampling só vai pros modelos que ainda aceitam — nos novos, é erro 400.
  if (req.temperature != null && !NO_SAMPLING.test(req.model)) {
    body.temperature = req.temperature;
  }

  const res = await fetch(`${trimUrl(ctx.baseUrl || DEFAULT_BASE)}/messages`, {
    method: 'POST',
    headers: headers(ctx),
    body: JSON.stringify(body),
    signal: req.signal
  });
  await ensureOk(res, 'chat');

  for await (const payload of sseData(res)) {
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    switch (ev.type) {
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta') yield { delta: ev.delta.text };
        else if (ev.delta?.type === 'thinking_delta') yield { reasoning: ev.delta.thinking };
        break;
      case 'message_delta':
        if (ev.usage) yield { usage: ev.usage };
        // Os classificadores de segurança recusam pedindo HTTP 200 com este stop_reason.
        if (ev.delta?.stop_reason === 'refusal') {
          yield { delta: '\n\n_(o provedor recusou este pedido)_' };
        }
        break;
      case 'error':
        throw new Error(ev.error?.message || 'erro da Anthropic');
      default:
        break;
    }
  }
}
