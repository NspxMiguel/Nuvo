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
import { sweepOrphanUploads } from './documents.mjs';
import { isSea, getAsset } from 'node:sea';

// Empacotado nao ha pasta no disco, e `import.meta.url` some no CommonJS do
// SEA: montar a URL aqui estouraria antes do servidor subir.
const WEB_DIR = isSea() ? '' : fileURLToPath(new URL('../web/', import.meta.url));

// Empacotado como executável único não existe pasta `web/` no disco: os
// arquivos da interface viajam dentro do próprio binário. `getAsset` devolve o
// conteúdo pela chave que o sea-config.json registrou — o caminho relativo.
const EMPACOTADO = isSea();

/** Lê um arquivo da interface, do binário ou do disco. Devolve null se não há. */
async function lerDaWeb(rel) {
  if (EMPACOTADO) {
    try {
      return Buffer.from(getAsset(rel));
    } catch {
      return null;
    }
  }
  const file = join(WEB_DIR, rel);
  // Fora do binário o caminho ainda pode escapar da pasta por `..`.
  if (!file.startsWith(WEB_DIR)) return null;
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    return await readFile(file);
  } catch {
    return null;
  }
}

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

/** Esquece as tentativas erradas de todo mundo. Usado pelo teste da tranca. */
export function resetAttempts() {
  attempts.clear();
}

/**
 * Tranca única pra todo caminho que confere token.
 *
 * O limite de tentativas existe pra que o token não possa ser martelado, e
 * valia só em `/api/`. Quem quisesse adivinhar era só bater no
 * `/manifest.webmanifest`, que confere o mesmo token: 40 tentativas erradas
 * seguidas continuavam devolvendo 401, sem nunca chegar no 429. Proteção que se
 * contorna por outra porta não protege.
 *
 * @returns {boolean} true quando já respondeu e o chamador deve parar.
 */
function barrado(req, res, url) {
  const ip = req.socket.remoteAddress || 'desconhecido';
  if (tooManyAttempts(ip)) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
    res.end(JSON.stringify({ error: 'tentativas demais — espere um minuto' }));
    return true;
  }
  if (!authorized(req, url)) {
    noteFailure(ip);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'token inválido' }));
    return true;
  }
  clearAttempts(ip);
  return false;
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

/**
 * De onde a URL aponta pra chave do arquivo da interface.
 *
 * A chave é sempre com barra pra frente, porque é assim que ela foi gravada
 * dentro do executável. No Windows, `normalize` devolve `\\idiomas\\en.json` — e
 * `getAsset` não achava nada, então os dicionários de inglês e espanhol
 * respondiam 404 e a interface caía calada no português. Só arquivo em subpasta
 * quebrava; por isso passou despercebido até o executável ser rodado num
 * Windows de verdade.
 *
 * @param {string} pathname  o caminho da URL, como chegou
 * @returns {string} caminho relativo dentro de `web/`, sempre com `/`
 */
export function caminhoDaInterface(pathname) {
  if (pathname === '/' || !pathname) return 'index.html';
  return normalize(pathname).split('\\').join('/').replace(/^[/.]+/, '');
}

async function serveStatic(res, pathname) {
  const rel = caminhoDaInterface(pathname);
  const body = await lerDaWeb(rel);
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('não encontrado');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(rel)] || 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
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

  // Arquivo de anexo sem dono no banco: sobra de versão anterior, de queda no
  // meio da gravação, ou de restauração de backup mais antiga que os anexos.
  try {
    const varrido = sweepOrphanUploads();
    if (!quiet && varrido.removed) {
      console.log(`limpeza: ${varrido.removed} anexo(s) órfão(s), ${Math.round(varrido.bytes / 1000)} kB`);
    }
  } catch {
    /* limpeza é higiene, não requisito pra subir */
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

    // Identificação, sem token: diz apenas que é um IAUnifier que atende aqui.
    // O atalho do dock precisa disso antes de abrir a janela — checar só "tem
    // algo escutando nesta porta" faria ele mandar o token do usuário pra
    // qualquer programa que tivesse tomado a porta.
    if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ app: 'iaunifier' }));
    }

    // O manifest descreve o app instalado, e o `start_url` dele precisa levar o
    // token: sem isso o atalho na tela inicial abre num pedido de senha, porque
    // o localStorage do app instalado começa vazio. Como o arquivo passa a ter
    // o token dentro, ele deixa de ser estático livre e passa pela mesma
    // tranca do resto — a página pede com `?token=` (web/core.js).
    if (url.pathname === '/manifest.webmanifest') {
      if (barrado(req, res, url)) return;
      try {
        const base = JSON.parse((await lerDaWeb('manifest.webmanifest'))?.toString('utf8') || '{}');
        const cfg = loadConfig();
        if (cfg.requireToken) {
          base.start_url = `/?token=${encodeURIComponent(cfg.accessToken)}`;
        }
        res.writeHead(200, {
          'content-type': 'application/manifest+json; charset=utf-8',
          'cache-control': 'no-store'
        });
        return res.end(JSON.stringify(base));
      } catch {
        return serveStatic(res, url.pathname);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      if (origin) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      }
      if (barrado(req, res, url)) return;

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
    const enderecos = lanAddresses(port);
    // Sem token o endereço não leva `?token=`, e mostrá-lo assim daria a
    // impressão errada de que ainda existe uma tranca.
    const sufixo = cfg.requireToken ? `/?token=${cfg.accessToken}` : '/';

    console.log('\n  IAUnifier no ar');
    console.log(`  local:  http://localhost:${port}${sufixo}`);
    for (const addr of enderecos) console.log(`  rede:   ${addr}${sufixo}`);

    if (!cfg.requireToken) {
      // `--no-token` grava na configuração e vale nas próximas subidas também.
      // Quem passou o sinalizador uma vez precisa ver que ele continua valendo.
      console.log('\n  ATENÇÃO: o token está desligado.');
      console.log(
        enderecos.length
          ? '  Qualquer aparelho na sua rede abre este app, lê suas conversas e usa suas chaves de API.'
          : '  Qualquer programa desta máquina abre este app sem se identificar.'
      );
      console.log('  Religar: node bin/iaunifier.mjs --com-token');
    }

    // A promessa tem que caber no que o navegador realmente faz por HTTP na
    // rede local: o iPhone adiciona à tela de início do mesmo jeito, mas o
    // Android só oferece "instalar" em HTTPS, e o service worker (que guarda a
    // casca pra abrir sem servidor) não registra fora de localhost.
    console.log('\n  abra o endereço de rede no celular: no iPhone, Compartilhar → Adicionar à Tela de Início.');
    console.log('  o Android só oferece instalar em HTTPS; por enquanto, use o atalho do navegador.\n');
  }

  return server;
}
