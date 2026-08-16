// Descoberta automática de IA local na máquina e na rede de casa.
//
// Varre as portas conhecidas dos servidores locais e cadastra o que responder.
// É isso que faz o app funcionar sem configuração no primeiro start.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { all, one } from './db.mjs';
import { createProvider, refreshModels } from './providers/index.mjs';

const exec = promisify(execFile);

const CANDIDATES = [
  { name: 'LM Studio', kind: 'openai', url: 'http://127.0.0.1:1234/v1', probe: '/models' },
  { name: 'Ollama', kind: 'ollama', url: 'http://127.0.0.1:11434', probe: '/api/tags' },
  { name: 'llama.cpp', kind: 'openai', url: 'http://127.0.0.1:8080/v1', probe: '/models' },
  { name: 'vLLM', kind: 'openai', url: 'http://127.0.0.1:8000/v1', probe: '/models' },
  { name: 'LocalAI', kind: 'openai', url: 'http://127.0.0.1:8081/v1', probe: '/models' },
  { name: 'Jan', kind: 'openai', url: 'http://127.0.0.1:1337/v1', probe: '/models' },
  { name: 'KoboldCpp', kind: 'openai', url: 'http://127.0.0.1:5001/v1', probe: '/models' },
  { name: 'text-generation-webui', kind: 'openai', url: 'http://127.0.0.1:5000/v1', probe: '/models' }
];

const CLI_CANDIDATES = [
  { name: 'Claude Code (CLI)', command: 'claude', args: ['-p'] },
  { name: 'Codex (CLI)', command: 'codex', args: ['exec', '--skip-git-repo-check', '-'] },
  { name: 'Gemini (CLI)', command: 'gemini', args: ['-p'] },
  { name: 'OpenCode (CLI)', command: 'opencode', args: ['run'] }
];

async function alive(url, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function hasCommand(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    await exec(finder, [command]);
    return true;
  } catch {
    return false;
  }
}

/** Roda no start e sob demanda. Não duplica o que já está cadastrado. */
export async function discover({ includeCli = true } = {}) {
  const existing = all('SELECT base_url, config FROM providers');
  const knownUrls = new Set(existing.map((p) => p.base_url).filter(Boolean));
  const knownCommands = new Set(
    existing
      .map((p) => {
        try {
          return JSON.parse(p.config || '{}').command;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );

  const found = [];

  await Promise.all(
    CANDIDATES.map(async (c) => {
      if (knownUrls.has(c.url)) return;
      if (!(await alive(c.url + c.probe))) return;
      const provider = createProvider({
        name: c.name,
        kind: c.kind,
        baseUrl: c.url,
        auto: 1
      });
      found.push({ id: provider.id, name: c.name, url: c.url });
    })
  );

  if (includeCli) {
    for (const c of CLI_CANDIDATES) {
      if (knownCommands.has(c.command)) continue;
      if (!(await hasCommand(c.command))) continue;
      const provider = createProvider({
        name: c.name,
        kind: 'cli',
        config: { command: c.command, args: c.args, stdin: true, models: ['default'] },
        auto: 1
      });
      found.push({ id: provider.id, name: c.name, command: c.command });
    }
  }

  // Catálogo de modelos de cada descoberta, sem derrubar o start se falhar.
  for (const f of found) {
    try {
      await refreshModels(f.id);
    } catch {
      /* provedor no ar mas sem modelo carregado */
    }
  }

  return found;
}

export function providerCount() {
  return one('SELECT COUNT(*) AS n FROM providers').n;
}
