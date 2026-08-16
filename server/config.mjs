// Configuração e diretório de dados.
//
// Tudo do usuário mora em ~/.iaunifier: banco, chaves e uploads. O arquivo de
// configuração guarda segredos, então é criado com permissão 600.

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DATA_DIR = process.env.IAUNIFIER_HOME || join(homedir(), '.iaunifier');
export const DB_PATH = join(DATA_DIR, 'data.db');
export const CONFIG_PATH = join(DATA_DIR, 'config.json');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');

const DEFAULTS = {
  port: Number(process.env.PORT || 4747),
  host: process.env.HOST || '0.0.0.0',
  // Token de acesso: o app fica na LAN, então quem abre precisa apresentar
  // este token uma vez. Gerado no primeiro start.
  accessToken: null,
  requireToken: true,
  // Chaves de API por provedor, nunca expostas pela API do servidor.
  secrets: {},
  memory: {
    enabled: true,
    autoExtract: true,
    maxInjected: 12,
    minScore: 0.12,
    embeddingModel: null, // ex.: { provider: 'lmstudio', model: 'text-embedding-nomic-embed-text-v1.5' }
    extractorModel: null // ex.: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }
  },
  limits: {
    // Segundos até o primeiro pedaço da resposta. Modelo local grande demora
    // de verdade pra carregar na memória, daí o valor folgado.
    firstChunkSeconds: 240,
    // Segundos entre um pedaço e o seguinte. Aqui pode ser curto: se o modelo
    // já começou a escrever e parou, ele travou.
    stallSeconds: 120
  }
};

let cache = null;

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function loadConfig() {
  if (cache) return cache;
  ensureDirs();
  let stored = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      stored = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      stored = {};
    }
  }
  cache = {
    ...DEFAULTS,
    ...stored,
    memory: { ...DEFAULTS.memory, ...(stored.memory || {}) },
    limits: { ...DEFAULTS.limits, ...(stored.limits || {}) },
    secrets: { ...(stored.secrets || {}) }
  };
  if (!cache.accessToken) {
    cache.accessToken = randomBytes(18).toString('base64url');
    saveConfig(cache);
  }
  return cache;
}

export function saveConfig(next) {
  ensureDirs();
  cache = next;
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* windows não tem modo posix */
  }
  return cache;
}

export function patchConfig(patch) {
  const cfg = loadConfig();
  const next = { ...cfg, ...patch };
  if (patch.memory) next.memory = { ...cfg.memory, ...patch.memory };
  if (patch.limits) next.limits = { ...cfg.limits, ...patch.limits };
  if (patch.secrets) next.secrets = { ...cfg.secrets, ...patch.secrets };
  return saveConfig(next);
}

export function getSecret(name) {
  if (!name) return null;
  const cfg = loadConfig();
  return cfg.secrets[name] || process.env[name] || null;
}

export function setSecret(name, value) {
  const cfg = loadConfig();
  const secrets = { ...cfg.secrets };
  if (value === null || value === '') delete secrets[name];
  else secrets[name] = value;
  return saveConfig({ ...cfg, secrets });
}

/** Nomes das chaves guardadas — sem os valores, que nunca saem daqui. */
export function listSecretNames() {
  const cfg = loadConfig();
  return Object.keys(cfg.secrets);
}
