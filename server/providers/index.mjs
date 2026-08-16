// Registro de provedores: resolve "providerId:modelId" no adaptador certo.

import * as openai from './openai.mjs';
import * as anthropic from './anthropic.mjs';
import * as google from './google.mjs';
import * as ollama from './ollama.mjs';
import * as cli from './cli.mjs';
import { all, one, run, uid, now, parseJSON } from '../db.mjs';
import { getSecret } from '../config.mjs';

const ADAPTERS = { openai, anthropic, google, ollama, cli };

export function adapterFor(kind) {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw new Error(`tipo de provedor desconhecido: ${kind}`);
  return adapter;
}

/** Provedor do banco + segredo resolvido, no formato que os adaptadores esperam. */
export function contextFor(provider) {
  return {
    id: provider.id,
    kind: provider.kind,
    baseUrl: provider.base_url,
    apiKey: getSecret(provider.secret_name),
    config: parseJSON(provider.config)
  };
}

/**
 * Corta o stream que parou de emitir.
 *
 * Sem isso, um provedor que aceita a conexão e nunca responde deixa o turno
 * pendurado pra sempre — e como a conversa fica trancada enquanto responde,
 * ela nunca mais aceitaria pergunta. O primeiro pedaço ganha prazo maior:
 * modelo local grande demora pra subir na memória antes de escrever a primeira
 * palavra.
 *
 * O corte é feito por `abort`, não por `return()` no gerador: um gerador
 * assíncrono parado num `await` só executa o `return` quando esse await
 * resolver — e é justamente ele que nunca resolve. Abortar faz a leitura
 * falhar, e aí o gerador desmonta sozinho, fechando a conexão HTTP ou matando
 * o processo do CLI.
 *
 * @param {(signal: AbortSignal) => AsyncIterable} open recebe o sinal e devolve o stream
 * @param {{firstMs: number, stallMs: number, signal?: AbortSignal}} limits
 */
export async function* withStallTimeout(open, { firstMs, stallMs, signal }) {
  const controller = new AbortController();
  const forward = () => controller.abort();
  // Sinal que já veio cancelado nunca dispara `abort` de novo: sem esta linha o
  // provedor era aberto e o cancelamento só chegava nele no próximo evento.
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forward, { once: true });

  const source = open(controller.signal)[Symbol.asyncIterator]();
  let started = false;

  try {
    while (true) {
      const limit = started ? stallMs : firstMs;
      let timer;
      const prazo = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              started
                ? `o modelo parou de responder no meio (${Math.round(limit / 1000)}s sem nada)`
                : `o modelo não respondeu em ${Math.round(limit / 1000)}s`
            )
          );
          controller.abort();
        }, limit);
        timer.unref?.();
      });

      // Corrida, e não só `abort`: abortar só funciona se o outro lado reagir, e
      // o CLI cujo neto herdou o cano de saída não reage — o `close` do processo
      // nunca chega e este `await` ficaria parado pra sempre, com o prazo já
      // vencido. A corrida corta mesmo quando o abort não é ouvido.
      const proximo = source.next();
      // O lado perdedor da corrida ainda vai falhar por causa do abort; sem este
      // ouvinte a falha vira "unhandled rejection" e derruba o servidor inteiro.
      proximo.catch(() => {});

      let step;
      try {
        step = await Promise.race([proximo, prazo]);
      } finally {
        clearTimeout(timer);
      }

      if (step.done) return;
      started = true;
      yield step.value;
    }
  } finally {
    signal?.removeEventListener('abort', forward);
    controller.abort();
    // Fecha a fonte quando ela ainda responde. Não dá pra esperar: gerador
    // parado num `await` só roda o `return` quando o await resolver.
    Promise.resolve(source.return?.()).catch(() => {});
  }
}

export function getProvider(id) {
  const row = one('SELECT * FROM providers WHERE id = ?', id);
  if (!row) throw new Error(`provedor não encontrado: ${id}`);
  return row;
}

export function listProviders({ enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? 'SELECT * FROM providers WHERE enabled = 1 ORDER BY created_at'
    : 'SELECT * FROM providers ORDER BY created_at';
  return all(sql);
}

/** "providerId:modelId" — o modelo pode ter ":" no nome (ex.: llama3:8b). */
export function parseRef(ref) {
  const idx = String(ref || '').indexOf(':');
  if (idx < 0) throw new Error(`modelo inválido: ${ref}`);
  return { providerId: ref.slice(0, idx), modelId: ref.slice(idx + 1) };
}

export function refOf(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

/** Consulta o provedor, grava o catálogo de modelos e devolve o que achou. */
export async function refreshModels(providerId) {
  const provider = getProvider(providerId);
  const adapter = adapterFor(provider.kind);
  const models = await adapter.listModels(contextFor(provider));
  const stamp = now();
  for (const m of models) {
    run(
      `INSERT INTO models (id, provider_id, model_id, label, kind, seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET label = excluded.label,
         kind = excluded.kind, seen_at = excluded.seen_at`,
      uid(),
      providerId,
      m.model_id,
      m.label || m.model_id,
      m.kind || 'chat',
      stamp
    );
  }
  // Modelo que sumiu do provedor sai do catálogo.
  run('DELETE FROM models WHERE provider_id = ? AND seen_at != ?', providerId, stamp);
  return models;
}

export function createProvider({ name, kind, baseUrl, secretName, config, auto = 0 }) {
  const id = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id,
    name,
    kind,
    baseUrl || null,
    secretName || null,
    JSON.stringify(config || {}),
    auto ? 1 : 0,
    now()
  );
  return getProvider(id);
}

/** Presets prontos — o usuário só cola a chave. */
export const PRESETS = [
  { key: 'anthropic', name: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', secretName: 'ANTHROPIC_API_KEY' },
  { key: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', secretName: 'OPENAI_API_KEY' },
  { key: 'google', name: 'Google Gemini', kind: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', secretName: 'GEMINI_API_KEY' },
  { key: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', secretName: 'GROQ_API_KEY' },
  { key: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', secretName: 'DEEPSEEK_API_KEY' },
  { key: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', secretName: 'OPENROUTER_API_KEY' },
  { key: 'xai', name: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', secretName: 'XAI_API_KEY' },
  { key: 'mistral', name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', secretName: 'MISTRAL_API_KEY' },
  { key: 'lmstudio', name: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', secretName: null },
  { key: 'ollama', name: 'Ollama (local)', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', secretName: null },
  { key: 'llamacpp', name: 'llama.cpp (local)', kind: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', secretName: null },
  {
    key: 'claude-cli',
    name: 'Claude Code (CLI)',
    kind: 'cli',
    config: { command: 'claude', args: ['-p'], stdin: true, models: ['default'] }
  },
  {
    key: 'codex-cli',
    name: 'Codex (CLI)',
    kind: 'cli',
    config: { command: 'codex', args: ['exec', '--skip-git-repo-check', '-'], stdin: true, models: ['default'] }
  },
  {
    key: 'opencode-cli',
    name: 'OpenCode (CLI)',
    kind: 'cli',
    config: { command: 'opencode', args: ['run'], stdin: true, models: ['default'] }
  }
];
