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
  // Idioma escolhido na mão. `null` = ainda não escolheu, e aí vale o que o
  // navegador pedir no `Accept-Language`.
  idioma: null,
  navegador: {
    // O globo liga o agente de navegador. Desligado aqui, ele volta a ser a
    // busca de uma vez só — que é o que roda em máquina sem Chrome nenhum.
    agente: true,
    // Quantas idas ao modelo o agente pode gastar num turno. Cada passo é uma
    // chamada inteira: oito já resolve quase tudo e não custa uma conversa.
    passos: 8,
    // Com janela, dá pra ver o que ele faz — e é como se faz um login que o
    // perfil vai guardar. Sem janela é o padrão porque a janela rouba o foco.
    janela: false,
    // Qual navegador o agente dirige. `null` = ainda não perguntei; `instalado`
    // = o Chrome, Chromium, Edge ou Brave que já existe na máquina; `proprio` =
    // um Chrome for Testing que o app baixou, cujo caminho fica em `binario`.
    //
    // Nenhuma das duas opções entra na sessão pessoal de ninguém: o Chrome
    // recusa depuração remota no perfil padrão desde a 136, e copiar o perfil
    // não traz login junto — a chave que cifra cookie e senha é presa ao
    // diretório de origem. Quem quiser ficar logado abre com `janela: true` uma
    // vez e entra na mão; o perfil do agente guarda dali em diante.
    fonte: null,
    binario: null
  },
  limits: {
    // Segundos até o primeiro pedaço da resposta. Modelo local grande demora
    // de verdade pra carregar na memória, daí o valor folgado.
    firstChunkSeconds: 240,
    // Segundos entre um pedaço e o seguinte. Aqui pode ser curto: se o modelo
    // já começou a escrever e parou, ele travou.
    stallSeconds: 120,
    // Segundos para o extrator de memória. Roda depois de a resposta já estar
    // na tela e segura a tranca da conversa enquanto não volta, então o prazo
    // é curto de propósito: perder um fato é barato, travar o chat não é.
    learnSeconds: 90
  }
};

let cache = null;

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  // `mode` no mkdir só vale na criação: pasta que já existia de uma versão
  // anterior continuaria aberta.
  try {
    chmodSync(DATA_DIR, 0o700);
  } catch {
    /* windows não tem modo posix */
  }
  mkdirSync(UPLOAD_DIR, { recursive: true });
  // Mesmo motivo do `config.json`: a pasta 700 protege enquanto ela for 700.
  // O `--home` aceita qualquer caminho — pendrive, pasta sincronizada, volume
  // de rede — e sistema de arquivos que não guarda modo posix devolve tudo
  // aberto. O que está dentro carrega conversa com todas as IAs e os anexos.
  soDoDono(UPLOAD_DIR, 0o700);
  soDoDono(DB_PATH, 0o600);
  soDoDono(`${DB_PATH}-wal`, 0o600);
  soDoDono(`${DB_PATH}-shm`, 0o600);
}

/** Aperta o modo de um caminho que já existe. Silencioso onde não há posix. */
export function soDoDono(caminho, mode) {
  try {
    chmodSync(caminho, mode);
  } catch {
    /* não existe ainda, ou windows */
  }
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
    navegador: { ...DEFAULTS.navegador, ...(stored.navegador || {}) },
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
  if (patch.navegador) next.navegador = { ...cfg.navegador, ...patch.navegador };
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
