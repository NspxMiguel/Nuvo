#!/usr/bin/env node
// Entrada do servidor e dos comandos de operação.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('-') ? args[0] : null;

function flag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

// A pasta de dados é lida no import do módulo de configuração, então `--home`
// precisa valer antes dele — daí o import dinâmico logo abaixo. Serve pra subir
// uma segunda instância (teste, perfil separado) sem encostar na de verdade.
if (flag('home')) process.env.IAUNIFIER_HOME = resolve(flag('home'));

// O corpo inteiro vive dentro de um `main()` em vez de usar `await` de topo.
// O empacotador de executável único (SEA) só aceita CommonJS, e CommonJS não
// tem `await` de topo — sem isto não dá pra gerar o programa que roda sem Node
// instalado. A indentação fica como estava de propósito: reindentar mexeria no
// texto da ajuda, que é um template literal.
async function main() {

const { loadConfig, patchConfig, DATA_DIR } = await import('../server/config.mjs');

function mostrarAjuda() {
  console.log(`IAUnifier — servidor de IA da sua casa

  iaunifier                       sobe o servidor
  iaunifier --port 4747           troca a porta
  iaunifier --host 0.0.0.0        troca o endereço de escuta
  iaunifier --token               mostra o token de acesso
  iaunifier --home ~/.outra       usa outra pasta de dados (instância separada)
  iaunifier --no-token            desliga o token (só em rede confiável)
  iaunifier --com-token           religa o token, e gera um novo se preciso

  iaunifier backup [arquivo.zip]  cópia de tudo: banco, config e anexos
  iaunifier restore arquivo.zip   restaura por cima (guarda o banco anterior)
  iaunifier backups               lista as cópias automáticas

  iaunifier instalar-servico      sobe junto com a máquina
  iaunifier remover-servico       desfaz o de cima
  iaunifier servico               diz se está instalado e rodando

  iaunifier instalar-app          ícone no dock / menu, em janela sem abas
  iaunifier remover-app           desfaz o de cima

  dados em ${DATA_DIR}
`);
}

if (args.includes('--help') || args.includes('-h') || command === 'ajuda') {
  mostrarAjuda();
  process.exit(0);
}

if (args.includes('--token')) {
  console.log(loadConfig().accessToken);
  process.exit(0);
}

function tamanho(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${bytes} B`;
}

// ---------------------------------------------------------------- comandos

if (command === 'backup') {
  const { createBackup, backupName } = await import('../server/backup.mjs');
  const destino = resolve(args[1] || backupName());
  const { buffer, files } = createBackup();
  writeFileSync(destino, buffer);
  console.log(`backup em ${destino} — ${files} arquivos, ${tamanho(buffer.length)}`);
  process.exit(0);
}

if (command === 'restore' || command === 'restaurar') {
  const origem = args[1];
  if (!origem) {
    console.error('falta o arquivo: iaunifier restore arquivo.zip');
    process.exit(1);
  }
  const { restoreBackup } = await import('../server/backup.mjs');
  try {
    const done = restoreBackup(readFileSync(resolve(origem)));
    console.log(`backup lido: banco${done.config ? ', config' : ''}, ${done.uploads} anexo(s)`);
    if (done.previous) console.log(`o banco de agora vai ficar guardado em ${done.previous}`);
    console.log('suba o servidor de novo: a troca do banco é a primeira coisa que ele faz.');
  } catch (err) {
    console.error(`não deu pra restaurar: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'backups') {
  const { listBackups } = await import('../server/backup.mjs');
  const lista = listBackups();
  if (!lista.length) console.log('nenhuma cópia automática ainda — ela é feita na subida do servidor.');
  for (const item of lista) console.log(`${item.at}  ${tamanho(item.bytes).padStart(8)}  ${item.path}`);
  process.exit(0);
}

if (command === 'instalar-servico' || command === 'install-service') {
  const { installService } = await import('../server/service.mjs');
  try {
    const done = installService();
    console.log(`instalado em ${done.system}`);
    console.log(`arquivo: ${done.file}`);
    if (done.logs) console.log(`log: ${done.logs.join(' e ')}`);
    if (done.note) console.log(`atenção: ${done.note}`);
  } catch (err) {
    console.error(`não deu: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'remover-servico' || command === 'uninstall-service') {
  const { uninstallService } = await import('../server/service.mjs');
  try {
    const done = uninstallService();
    console.log(`removido de ${done.system}`);
  } catch (err) {
    console.error(`não deu: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'instalar-app' || command === 'install-app') {
  const { installDesktopApp, appUrl } = await import('../server/desktop.mjs');
  try {
    const done = installDesktopApp();
    console.log(`atalho criado em ${done.path}`);
    console.log(`abre em: ${done.browser}${done.icon ? ' · com ícone próprio' : ''}`);
    console.log(`endereço: ${appUrl()}`);
    if (done.browser === 'navegador padrão') {
      console.log('sem Chrome/Edge/Brave por aqui: abre numa aba normal em vez de janela sem abas.');
    }
  } catch (err) {
    console.error(`não deu: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'remover-app' || command === 'uninstall-app') {
  const { uninstallDesktopApp } = await import('../server/desktop.mjs');
  try {
    const done = uninstallDesktopApp();
    console.log(`removido: ${done.path}`);
  } catch (err) {
    console.error(`não deu: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'servico' || command === 'service') {
  const { serviceStatus, servicePlan } = await import('../server/service.mjs');
  const plano = servicePlan();
  const estado = serviceStatus();
  if (!plano.supported) {
    console.log(`subir sozinho não é suportado em ${plano.platform}`);
    process.exit(0);
  }
  console.log(`sistema:   ${plano.platform}`);
  console.log(`arquivo:   ${plano.file}`);
  console.log(`instalado: ${estado.installed ? 'sim' : 'não'}`);
  if (estado.installed) console.log(`rodando:   ${estado.running ? 'sim' : 'não'}`);
  if (estado.stale) console.log(`\nATENÇÃO: ${estado.message}`);

  const { desktopStatus } = await import('../server/desktop.mjs');
  const atalho = desktopStatus();
  if (atalho.supported) {
    console.log(`atalho:    ${atalho.installed ? atalho.path : 'não instalado'}`);
    if (atalho.browser) console.log(`janela:    ${atalho.browser}`);
  }
  process.exit(0);
}

if (command) {
  console.error(`não conheço o comando "${command}".\n`);
  mostrarAjuda();
  process.exit(1);
}

// ------------------------------------------------------------------ servidor

const patch = {};
if (flag('port')) patch.port = Number(flag('port'));
if (flag('host')) patch.host = flag('host');
if (args.includes('--no-token')) patch.requireToken = false;
if (args.includes('--com-token')) patch.requireToken = true;
if (Object.keys(patch).length) patchConfig(patch);

const { start } = await import('../server/index.mjs');
start().catch((err) => {
  // Pilha de erro do Node não serve pra quem só quer abrir o app. Os dois
  // casos que acontecem de verdade em casa ganham a instrução junto.
  const cfg = loadConfig();
  if (err.code === 'EADDRINUSE') {
    console.error(`a porta ${cfg.port} já está ocupada por outro programa.`);
    console.error(`Suba em outra: node bin/iaunifier.mjs --port ${cfg.port + 1}`);
    console.error('Se for outro IAUnifier já rodando, é ele que está no ar — abra o endereço.');
  } else if (err.code === 'EACCES') {
    console.error(`o sistema não deixou escutar na porta ${cfg.port}.`);
    console.error('Portas abaixo de 1024 pedem administrador; escolha uma acima disso com --port.');
  } else if (err.code === 'EADDRNOTAVAIL') {
    console.error(`o endereço ${cfg.host} não existe nesta máquina.`);
    console.error('Use --host 0.0.0.0 pra escutar em tudo, ou 127.0.0.1 pra só esta máquina.');
  } else {
    console.error('falhou ao subir:', err);
  }
  process.exit(1);
});

}

main();
