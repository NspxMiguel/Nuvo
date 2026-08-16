// Servidor HTTP: estáticos do app + API + SSE.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { seed, one } from './db.mjs';
import { handleApi } from './api.mjs';
import { discover, providerCount } from './discovery.mjs';
import { autoBackup } from './backup.mjs';

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Comparação de token em tempo constante: o tempo de resposta não pode
// entregar quantos caracteres iniciais estavam certos.
function sameToken(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Tentativa repetida: um token de 24 caracteres não se adivinha por força
// bruta, mas deixar tentar à vontade também não custa nada barrar.
const attempts = new Map();
const MAX_ATTEMPTS = 20;
const WINDOW_MS = 60_000;

function tooManyAttempts(ip) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.since > WINDOW_MS) return false;
  return record.count >= MAX_ATTEMPTS;
}

function noteFailure(ip) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.since > WINDOW_MS) attempts.set(ip, { since: now, count: 1 });
  else record.count++;
  // A tabela é limpa junto: sem isso ela cresce com o tempo de vida do processo.
  if (attempts.size > 500) {
    for (const [key, value] of attempts) {
      if (now - value.since > WINDOW_MS) attempts.delete(key);
    }
  }
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

function authorized(req, url) {
  const cfg = loadConfig();
  if (!cfg.requireToken) return true;
  return (
    sameToken(req.headers['x-iaunifier-token'], cfg.accessToken) ||
    sameToken(url.searchParams.get('token'), cfg.accessToken)
  );
}

/**
 * A API só responde a pedido da própria página. Uma aba de outro site que
 * tenha conseguido o token não consegue ler a resposta, porque o navegador
 * exige este cabeçalho e ele não é devolvido para origem estranha.
 */
function allowedOrigin(origin, host) {
  if (!origin) return null; // pedido sem origem (curl, app nativo) segue normal
  try {
    const parsed = new URL(origin);
    if (parsed.host === host) return origin;
    // A mesma máquina servida por outro endereço (localhost x IP da rede)
    // continua sendo o app, não um site de fora.
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const hostName = String(host).split(':')[0];
    if (localHosts.has(parsed.hostname) && localHosts.has(hostName)) return origin;
    if (lanAddressSet().has(parsed.hostname)) return origin;
    return null;
  } catch {
    return null;
  }
}

let lanCache = null;
function lanAddressSet() {
  if (lanCache) return lanCache;
  lanCache = new Set(['localhost', '127.0.0.1', '::1']);
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4') lanCache.add(net.address);
    }
  }
  return lanCache;
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\.])+/, '');
  const file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403).end('proibido');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('não é arquivo');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('não encontrado');
  }
}

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(`http://${net.address}:${port}`);
    }
  }
  return out;
}

/**
 * @param {{quiet?: boolean, discover?: boolean}} options
 *   `quiet` cala o banner (usado pelos testes); `discover: false` pula a
 *   varredura da máquina, que é lenta e não faz sentido em teste.
 */
export async function start({ quiet = false, discover: shouldDiscover = true, backup = true } = {}) {
  const cfg = loadConfig();
  seed();

  // Uma cópia por dia, na subida. Ninguém em casa configura cron, e o que este
  // app guarda — anos de memória — não se refaz. Instalação recém-criada não
  // tem o que copiar: guardar zip de banco vazio é só ruído na pasta.
  if (backup && one('SELECT EXISTS(SELECT 1 FROM messages) OR EXISTS(SELECT 1 FROM memories) AS tem').tem) {
    try {
      const done = autoBackup();
      if (!quiet && !done.skipped) console.log(`backup do dia: ${done.dir}/${done.name}`);
    } catch (err) {
      if (!quiet) console.error(`backup automático falhou: ${err.message}`);
    }
  }

  // Primeiro start: caça o que já existe na máquina antes de mostrar a tela.
  if (shouldDiscover && providerCount() === 0) {
    const found = await discover();
    if (found.length && !quiet) {
      console.log(`descoberto: ${found.map((f) => f.name).join(', ')}`);
    }
  }

  const server = createServer(async (req, res) => {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url, `http://${host}`);
    const origin = allowedOrigin(req.headers.origin, host);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
        'access-control-allow-headers': 'content-type, x-iaunifier-token',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS'
      });
      return res.end();
    }

    if (url.pathname.startsWith('/api/')) {
      if (origin) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      }
      const ip = req.socket.remoteAddress || 'desconhecido';

      if (tooManyAttempts(ip)) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
        return res.end(JSON.stringify({ error: 'tentativas demais — espere um minuto' }));
      }
      if (!authorized(req, url)) {
        noteFailure(ip);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'token inválido' }));
      }
      clearAttempts(ip);

      try {
        return await handleApi(req, res, url);
      } catch (err) {
        if (res.writableEnded) return;
        if (res.headersSent) return res.end();
        const status = /grande demais/.test(err.message) ? 413 : 500;
        res.writeHead(status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    return serveStatic(res, url.pathname);
  });

  // Conexão parada não pode segurar um soquete pra sempre; SSE é longo de
  // propósito, então o tempo limite fica alto o bastante pra não cortá-lo.
  server.headersTimeout = 30_000;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 72_000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  if (!quiet) {
    const port = server.address().port;
    console.log('\n  IAUnifier no ar');
    console.log(`  local:  http://localhost:${port}/?token=${cfg.accessToken}`);
    for (const addr of lanAddresses(port)) {
      console.log(`  rede:   ${addr}/?token=${cfg.accessToken}`);
    }
    console.log('\n  abra o endereço de rede no celular pra instalar como app.\n');
  }

  return server;
}
