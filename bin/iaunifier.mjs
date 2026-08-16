#!/usr/bin/env node
// Entrada do servidor.

import { start } from '../server/index.mjs';
import { loadConfig, patchConfig } from '../server/config.mjs';

const args = process.argv.slice(2);

function flag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`IAUnifier — servidor de IA da sua casa

  iaunifier                  sobe o servidor
  iaunifier --port 4747      troca a porta
  iaunifier --host 0.0.0.0   troca o endereço de escuta
  iaunifier --token          mostra o token de acesso
  iaunifier --no-token       desliga o token (só faça isso em rede confiável)
`);
  process.exit(0);
}

if (args.includes('--token')) {
  console.log(loadConfig().accessToken);
  process.exit(0);
}

const patch = {};
if (flag('port')) patch.port = Number(flag('port'));
if (flag('host')) patch.host = flag('host');
if (args.includes('--no-token')) patch.requireToken = false;
if (Object.keys(patch).length) patchConfig(patch);

start().catch((err) => {
  console.error('falhou ao subir:', err);
  process.exit(1);
});
