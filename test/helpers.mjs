// Apoio dos testes: cada arquivo roda num diretório de dados próprio, jogado
// fora no fim. Nenhum teste toca o ~/.iaunifier de quem estiver rodando.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Precisa ser chamado ANTES de importar qualquer módulo do servidor: config.mjs
 * lê IAUNIFIER_HOME no import, e db.mjs abre o banco no import.
 */
export function useTempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'iaunifier-test-'));
  process.env.IAUNIFIER_HOME = dir;
  process.env.PORT = '0';
  return {
    dir,
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* o sistema limpa o tmp depois */
      }
    }
  };
}

/** Resposta falsa no formato que os adaptadores esperam consumir. */
export function fakeResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  const chunks = Array.isArray(body) ? body : [body];
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Erro',
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null
    },
    async text() {
      return chunks.join('');
    },
    async json() {
      return JSON.parse(chunks.join(''));
    },
    body: {
      getReader() {
        return {
          async read() {
            if (i >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(chunks[i++]) };
          }
        };
      }
    }
  };
}

/**
 * Troca o fetch global por uma função controlada; devolve o restaurador.
 *
 * O próprio teste fala com o servidor por fetch, então o pedido que vai pro
 * `127.0.0.1` continua indo pra rede de verdade — só a chamada do servidor ao
 * provedor é que cai no handler.
 */
export function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(target)) {
      return original(url, options);
    }
    calls.push({ url: target, options });
    const answer = await handler(target, options);
    return answer === undefined ? original(url, options) : answer;
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

/** Junta tudo que um gerador assíncrono emite. */
export async function collect(iterator) {
  const out = [];
  for await (const item of iterator) out.push(item);
  return out;
}

/** Sobe o servidor HTTP numa porta livre e devolve um cliente já autenticado. */
export async function startServer() {
  const { start } = await import('../server/index.mjs');
  const { loadConfig, patchConfig } = await import('../server/config.mjs');
  patchConfig({ port: 0, host: '127.0.0.1' });
  const server = await start({ quiet: true, discover: false, backup: false });
  const { port } = server.address();
  const token = loadConfig().accessToken;

  return {
    server,
    port,
    token,
    base: `http://127.0.0.1:${port}`,
    async api(path, { method = 'GET', body, raw, token: override } = {}) {
      const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: {
          'x-iaunifier-token': override === undefined ? token : override,
          ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {})
        },
        body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data, text, headers: res.headers };
    },
    async raw(path, options) {
      return fetch(`http://127.0.0.1:${port}${path}`, options);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
