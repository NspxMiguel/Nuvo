// Chamada avulsa a um modelo, sem conversa por trás.
//
// Quem precisa disso: o extrator de memória, o pesquisador, o conselho e o
// título automático. Todos querem "manda esse prompt nesse modelo e me devolve
// o texto", sem histórico, sem gravar mensagem e sem tocar na memória.

import { adapterFor, contextFor, getProvider, parseRef } from './providers/index.mjs';

/** @returns {Promise<{text: string, reasoning: string, usage: object|null, ms: number}>} */
export async function complete(ref, { system, messages, prompt, temperature, maxTokens, signal } = {}) {
  const { providerId, modelId } = parseRef(ref);
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`provedor sumiu: ${providerId}`);
  const adapter = adapterFor(provider.kind);

  const started = Date.now();
  let text = '';
  let reasoning = '';
  let usage = null;

  for await (const chunk of adapter.stream(contextFor(provider), {
    model: modelId,
    system: system || null,
    messages: messages || [{ role: 'user', content: prompt || '' }],
    temperature: temperature ?? null,
    maxTokens: maxTokens ?? null,
    signal
  })) {
    if (chunk.delta) text += chunk.delta;
    if (chunk.reasoning) reasoning += chunk.reasoning;
    if (chunk.usage) usage = chunk.usage;
  }

  return { text: text.trim(), reasoning, usage, ms: Date.now() - started };
}

/** Nome legível do modelo, pra aparecer na tela sem o id interno. */
export function describeModel(ref) {
  try {
    const { providerId, modelId } = parseRef(ref);
    const provider = getProvider(providerId);
    return provider ? `${provider.name} · ${modelId}` : ref;
  } catch {
    return ref;
  }
}

/** Extrai o primeiro array JSON de uma resposta que veio com conversa em volta. */
export function parseJsonArray(text) {
  const match = String(text).match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
