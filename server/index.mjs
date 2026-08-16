// Servidor HTTP: estáticos do app + API + SSE.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { loadConfig } from './config.mjs';
import { seed } from './db.mjs';
import { handleApi } from './api.mjs';
import { discover, providerCount } from './discovery.mjs';

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
  '.ico': 'image/x-icon'
};

function authorized(req, url) {
  const cfg = loadConfig();
  if (!cfg.requireToken) return true;
  const header = req.headers['x-iaunifier-token'];
  const query = url.searchParams.get('token');
  return header === cfg.accessToken || query === cfg.accessToken;
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
      'cache-control': 'no-cache'
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

export async function start() {
  const cfg = loadConfig();
  seed();

  // Primeiro start: caça o que já existe na máquina antes de mostrar a tela.
  if (providerCount() === 0) {
    const found = await discover();
    if (found.length) {
      console.log(`descoberto: ${found.map((f) => f.name).join(', ')}`);
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, x-iaunifier-token',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS'
      });
      return res.end();
    }

    if (url.pathname.startsWith('/api/')) {
      res.setHeader('access-control-allow-origin', '*');
      if (!authorized(req, url)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'token inválido' }));
      }
      try {
        return await handleApi(req, res, url);
      } catch (err) {
        if (res.headersSent) return res.end();
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    return serveStatic(res, url.pathname);
  });

  await new Promise((resolve) => server.listen(cfg.port, cfg.host, resolve));

  const local = `http://localhost:${cfg.port}`;
  console.log('\n  IAUnifier no ar');
  console.log(`  local:  ${local}/?token=${cfg.accessToken}`);
  for (const addr of lanAddresses(cfg.port)) {
    console.log(`  rede:   ${addr}/?token=${cfg.accessToken}`);
  }
  console.log('\n  abra o endereço de rede no celular pra instalar como app.\n');

  return server;
}
