// Adaptador OpenAI-compatível. Cobre a maior parte do mundo: OpenAI, Groq,
// DeepSeek, OpenRouter, xAI, Mistral, LM Studio, llama.cpp, vLLM, LocalAI.

import { sseData, ensureOk, separarPensamento, trimUrl } from './util.mjs';

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
  if (req.topP != null) body.top_p = req.topP;
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  // Mesmo motivo do Gemini: pedir JSON de verdade sai mais barato do que pedir
  // por favor e tentar de novo quando vem prosa.
  //
  // A Groq — e a OpenAI antes dela — recusa `json_object` quando a palavra
  // "json" não aparece nas mensagens, e a checagem é por minúscula: um pedido
  // que diz "objeto JSON" em maiúscula é recusado com 400. Em vez de exigir que
  // quem chama escreva de um jeito, a linha entra aqui.
  if (req.json) {
    // Com esquema, o provedor garante a FORMA. Sem ele, garante só que é JSON —
    // e modelo com liberdade de forma inventa a própria: dois modelos diferentes
    // devolveram `{professor, disciplina, exames}` no lugar do retrato.
    body.response_format =
      typeof req.json === 'object'
        ? { type: 'json_schema', json_schema: { name: 'resposta', schema: req.json } }
        : { type: 'json_object' };
    // A checagem da palavra é por minúscula: "objeto JSON" em maiúscula era
    // recusado com 400.
    if (!body.messages.some((m) => String(m.content || '').includes('json'))) {
      body.messages = [{ role: 'system', content: 'Responda em json.' }, ...body.messages];
    }
  }

  const res = await fetch(`${trimUrl(ctx.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: headers(ctx),
    body: JSON.stringify(body),
    signal: req.signal
  });
  await ensureOk(res, 'chat');

  // Estado da separação do `<think>`: a marca pode chegar partida entre dois
  // pedaços do stream, então ela atravessa as voltas do laço.
  let pensando = { dentro: false, sobra: '' };
  for await (const payload of sseData(res)) {
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    // Servidor compatível com a OpenAI escreve o erro de dois jeitos: objeto
    // (`{error:{message}}`) e texto puro (`{error:"sem cota"}`). Ler só o
    // primeiro jogava fora justamente o motivo, e sobrava "erro do provedor".
    if (json.error) {
      const motivo = typeof json.error === 'string' ? json.error : json.error.message;
      throw new Error(motivo || 'erro do provedor');
    }
    const choice = json.choices?.[0];
    const bruto = choice?.delta?.content ?? choice?.text;
    // Modelos de raciocínio locais mandam o pensamento num campo separado.
    const think = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
    if (think) yield { reasoning: think };
    if (bruto) {
      const partido = separarPensamento(bruto, pensando);
      pensando = partido.estado;
      if (partido.reasoning) yield { reasoning: partido.reasoning };
      if (partido.delta) yield { delta: partido.delta };
    }
    if (json.usage) {
      yield {
        usage: {
          input: json.usage.prompt_tokens ?? null,
          output: json.usage.completion_tokens ?? null
        }
      };
    }
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
