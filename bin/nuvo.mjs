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
if (flag('home')) process.env.NUVO_HOME = resolve(flag('home'));

// O corpo inteiro vive dentro de um `main()` em vez de usar `await` de topo.
// O empacotador de executável único (SEA) só aceita CommonJS, e CommonJS não
// tem `await` de topo — sem isto não dá pra gerar o programa que roda sem Node
// instalado. A indentação fica como estava de propósito: reindentar mexeria no
// texto da ajuda, que é um template literal.
async function main() {

const { loadConfig, patchConfig, DATA_DIR } = await import('../server/config.mjs');

function mostrarAjuda() {
  console.log(`Nuvo — servidor de IA da sua casa

  nuvo                       sobe o servidor
  nuvo --port 4747           troca a porta
  nuvo --host 0.0.0.0        troca o endereço de escuta
  nuvo --token               mostra o token de acesso
  nuvo --abrir               sobe o servidor e abre a janela do app
  nuvo --home ~/.outra       usa outra pasta de dados (instância separada)
  nuvo --no-token            desliga o token (só em rede confiável)
  nuvo --com-token           religa o token, e gera um novo se preciso

  nuvo backup [arquivo.zip]  cópia de tudo: banco, config e anexos
  nuvo restore arquivo.zip   restaura por cima (guarda o banco anterior)
  nuvo backups               lista as cópias automáticas

  nuvo instalar-servico      sobe junto com a máquina
  nuvo remover-servico       desfaz o de cima
  nuvo servico               diz se está instalado e rodando

  nuvo instalar-app          ícone no dock / menu, em janela sem abas
  nuvo remover-app           desfaz o de cima

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
    console.error('falta o arquivo: nuvo restore arquivo.zip');
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

/** O identificador do pacote de macOS. Igual ao do `Info.plist` do `Nuvo.app`. */
const PACOTE_MAC = 'dev.nspx.nuvo.app';

/**
 * O programa está rodando como aplicativo de mesa, e não na linha de comando?
 *
 * Dentro do `Nuvo.app` o executável é este mesmo binário — não há script no
 * meio —, então quem responde é ele.
 *
 * A resposta boa vem do `XPC_SERVICE_NAME`: quando é o LaunchServices que abre
 * (duplo clique, Launchpad, dock, `open`), ele carimba ali o identificador do
 * pacote que está sendo aberto. Medido nesta máquina:
 *
 *   aberto pelo Finder  -> XPC_SERVICE_NAME=application.dev.nspx.nuvo.app.N.N
 *   chamado num shell   -> a variável existe, mas com o identificador de OUTRO
 *                          app (um terminal dentro de um editor herda o do
 *                          editor). Por isso a conta é "contém o meu id", e não
 *                          "a variável existe".
 *
 * O segundo caminho é rede de segurança: executável dentro de um pacote, sem
 * argumento nenhum e sem terminal do outro lado. Se um macOS futuro parar de
 * carimbar a variável, o duplo clique continua abrindo a janela em vez de
 * voltar a não fazer nada — que era o defeito de origem.
 */
function abertoComoApp() {
  if (String(process.env.XPC_SERVICE_NAME || '').includes(PACOTE_MAC)) return true;
  return process.execPath.includes('.app/Contents/MacOS/') && !process.stdout.isTTY;
}

const abrirJanelaNoFim =
  args.includes('--abrir') ||
  args.includes('--open') ||
  // Duplo clique não passa argumento nenhum. `Nuvo.app/Contents/MacOS/Nuvo
  // --port 4747` no terminal passa, e continua sendo linha de comando.
  (!command && args.length === 0 && abertoComoApp());

// Sem terminal, tudo que o servidor escreve cairia no vazio — inclusive o
// motivo de ele não ter subido. O log é o único lugar onde uma abertura que
// falhou deixa rastro.
if (abrirJanelaNoFim && abertoComoApp()) {
  const { appendFileSync, mkdirSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join: juntar } = await import('node:path');
  const log = juntar(homedir(), 'Library', 'Logs', 'Nuvo.log');
  try {
    mkdirSync(juntar(homedir(), 'Library', 'Logs'), { recursive: true });
    for (const saida of [process.stdout, process.stderr]) {
      saida.write = (pedaco, ...resto) => {
        try {
          appendFileSync(log, pedaco);
        } catch {
          /* disco cheio ou pasta sem permissão: não vale derrubar o app por log */
        }
        const pronto = resto.find((r) => typeof r === 'function');
        if (pronto) pronto();
        return true;
      };
    }
  } catch {
    /* sem log, o app ainda abre */
  }
}

const patch = {};
if (flag('port')) patch.port = Number(flag('port'));
if (flag('host')) patch.host = flag('host');
if (args.includes('--no-token')) patch.requireToken = false;
if (args.includes('--com-token')) patch.requireToken = true;
if (Object.keys(patch).length) patchConfig(patch);

const { linhaDeComando } = await import('../server/empacotado.mjs');
const { start } = await import('../server/index.mjs');
start().then(async () => {
  // Duplo clique não passa por terminal nenhum: sem isto, o programa sobe, fica
  // escutando e a pessoa não vê nada acontecer.
  if (!abrirJanelaNoFim) return;
  const { abrirJanela } = await import('../server/desktop.mjs');
  const onde = abrirJanela();
  console.log(`janela aberta em ${onde.browser}`);
}).catch(async (err) => {
  // Pilha de erro do Node não serve pra quem só quer abrir o app. Os dois
  // casos que acontecem de verdade em casa ganham a instrução junto.
  const cfg = loadConfig();

  // Clicar no ícone com o serviço já rodando cai aqui. Se quem está na porta é
  // outro Nuvo, não há nada de errado acontecendo: a janela é o que a pessoa
  // pediu, e é ela que abre.
  if (err.code === 'EADDRINUSE' && abrirJanelaNoFim) {
    const { ehNuvo, abrirJanela } = await import('../server/desktop.mjs');
    if (await ehNuvo(cfg.port)) {
      abrirJanela();
      process.exit(0);
    }
  }

  if (err.code === 'EADDRINUSE') {
    console.error(`a porta ${cfg.port} já está ocupada por outro programa.`);
    // Dentro do executável não existe `bin/nuvo.mjs` pra rodar: a instrução
    // tem que ser o comando que a pessoa acabou de dar.
    console.error(`Suba em outra: ${linhaDeComando(import.meta.url)} --port ${cfg.port + 1}`);
    console.error('Se for outro Nuvo já rodando, é ele que está no ar — abra o endereço.');
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
