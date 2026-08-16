// Utilitários compartilhados pelos adaptadores.

/** Quebra um ReadableStream de bytes em linhas de texto. */
export async function* lines(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}

/** Eventos `data:` de um stream SSE, já sem o prefixo e ignorando comentários. */
export async function* sseData(res) {
  for await (const line of lines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      if (payload === '[DONE]') return;
      continue;
    }
    yield payload;
  }
}

export async function ensureOk(res, label) {
  if (res.ok) return res;
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 600);
  } catch {
    /* corpo ilegível */
  }
  throw new Error(`${label}: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
}

export function trimUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}
