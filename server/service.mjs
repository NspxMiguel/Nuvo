// Subir junto com a máquina.
//
// Três sistemas, três mecanismos, mesma ideia: registrar o `node bin/iaunifier`
// pra iniciar no login do usuário e reiniciar sozinho se cair. Tudo no escopo
// do usuário — nada aqui pede senha de administrador.

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comandoDoServidor, EMPACOTADO } from './empacotado.mjs';
import { DATA_DIR } from './config.mjs';

const LABEL = 'dev.nspx.iaunifier';
// Empacotado, o servidor é o próprio executável e não existe arquivo de
// entrada separado — o serviço do sistema tem que apontar pro binário, não pra
// um `node caminho/arquivo.mjs` que não existe na máquina de quem baixou.
const { programa: NODE, argumentos: ARGS } = comandoDoServidor(import.meta.url);
const ENTRY = ARGS[0] || NODE;
const COMANDO = [NODE, ...ARGS];

const LAUNCH_AGENT = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const SYSTEMD_UNIT = join(homedir(), '.config', 'systemd', 'user', 'iaunifier.service');
const LOG_OUT = join(DATA_DIR, 'servidor.log');
const LOG_ERR = join(DATA_DIR, 'servidor.err.log');

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`);
}

function sh(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// ------------------------------------------------------------------- macOS

function macInstall() {
  mkdirSync(dirname(LAUNCH_AGENT), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    ${COMANDO.map((p) => `<string>${escapeXml(p)}</string>`).join('\n    ')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(LOG_OUT)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(LOG_ERR)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>IAUNIFIER_HOME</key><string>${escapeXml(DATA_DIR)}</string>
  </dict>
</dict>
</plist>
`;
  writeFileSync(LAUNCH_AGENT, plist);
  // `bootout` antes de `bootstrap`: recarregar por cima dá "already loaded".
  const domain = `gui/${process.getuid()}`;
  try {
    sh('launchctl', ['bootout', `${domain}/${LABEL}`]);
  } catch {
    /* não estava carregado */
  }
  sh('launchctl', ['bootstrap', domain, LAUNCH_AGENT]);
  return { system: 'macOS (launchd)', file: LAUNCH_AGENT, logs: [LOG_OUT, LOG_ERR] };
}

function macUninstall() {
  try {
    sh('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]);
  } catch {
    /* já estava fora */
  }
  rmSync(LAUNCH_AGENT, { force: true });
  return { system: 'macOS (launchd)', file: LAUNCH_AGENT };
}

function macStatus() {
  if (!existsSync(LAUNCH_AGENT)) return { installed: false };
  try {
    const out = sh('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]);
    const pid = /pid = (\d+)/.exec(out)?.[1] || null;
    return { installed: true, running: Boolean(pid), pid: pid && Number(pid), file: LAUNCH_AGENT };
  } catch {
    return { installed: true, running: false, file: LAUNCH_AGENT };
  }
}

// ------------------------------------------------------------------- Linux

function linuxInstall() {
  mkdirSync(dirname(SYSTEMD_UNIT), { recursive: true });
  const unit = `[Unit]
Description=IAUnifier — servidor de IA da casa
After=network-online.target

[Service]
Type=simple
ExecStart=${COMANDO.join(' ')}
Environment=IAUNIFIER_HOME=${DATA_DIR}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
  writeFileSync(SYSTEMD_UNIT, unit);
  sh('systemctl', ['--user', 'daemon-reload']);
  sh('systemctl', ['--user', 'enable', '--now', 'iaunifier.service']);
  // Sem isso o serviço só roda enquanto houver sessão aberta.
  let lingering = true;
  try {
    sh('loginctl', ['enable-linger', process.env.USER || '']);
  } catch {
    lingering = false;
  }
  return {
    system: 'Linux (systemd --user)',
    file: SYSTEMD_UNIT,
    lingering,
    note: lingering
      ? null
      : 'sem `loginctl enable-linger`: o servidor só fica de pé enquanto você estiver logado'
  };
}

function linuxUninstall() {
  try {
    sh('systemctl', ['--user', 'disable', '--now', 'iaunifier.service']);
  } catch {
    /* já estava desligado */
  }
  rmSync(SYSTEMD_UNIT, { force: true });
  try {
    sh('systemctl', ['--user', 'daemon-reload']);
  } catch {
    /* systemd pode nem estar rodando */
  }
  return { system: 'Linux (systemd --user)', file: SYSTEMD_UNIT };
}

function linuxStatus() {
  if (!existsSync(SYSTEMD_UNIT)) return { installed: false };
  try {
    const state = sh('systemctl', ['--user', 'is-active', 'iaunifier.service']).trim();
    return { installed: true, running: state === 'active', state, file: SYSTEMD_UNIT };
  } catch {
    return { installed: true, running: false, file: SYSTEMD_UNIT };
  }
}

// ----------------------------------------------------------------- Windows

const TASK = 'IAUnifier';

function windowsInstall() {
  // `onlogon` do próprio usuário não exige administrador.
  sh('schtasks', [
    '/create', '/f',
    '/tn', TASK,
    '/sc', 'onlogon',
    '/rl', 'limited',
    '/tr', COMANDO.map((p) => `"${p}"`).join(' ')
  ]);
  sh('schtasks', ['/run', '/tn', TASK]);
  return {
    system: 'Windows (Agendador de Tarefas)',
    file: TASK,
    note: 'a tarefa roda no seu login; o Agendador não reinicia sozinho se o processo cair'
  };
}

function windowsUninstall() {
  try {
    sh('schtasks', ['/end', '/tn', TASK]);
  } catch {
    /* não estava rodando */
  }
  sh('schtasks', ['/delete', '/f', '/tn', TASK]);
  return { system: 'Windows (Agendador de Tarefas)', file: TASK };
}

function windowsStatus() {
  try {
    const out = sh('schtasks', ['/query', '/tn', TASK, '/fo', 'list']);
    return { installed: true, running: /Running|Em execução/i.test(out), file: TASK };
  } catch {
    return { installed: false };
  }
}

// ------------------------------------------------------------------ escolha

const BY_PLATFORM = {
  darwin: { install: macInstall, uninstall: macUninstall, status: macStatus },
  linux: { install: linuxInstall, uninstall: linuxUninstall, status: linuxStatus },
  win32: { install: windowsInstall, uninstall: windowsUninstall, status: windowsStatus }
};

function handler() {
  const impl = BY_PLATFORM[platform()];
  if (!impl) throw new Error(`não sei subir sozinho em ${platform()} — rode o servidor à mão`);
  return impl;
}

export function installService() {
  return handler().install();
}
export function uninstallService() {
  return handler().uninstall();
}
/**
 * O caminho gravado no serviço ainda aponta pra este projeto?
 *
 * O arquivo instalado guarda o caminho absoluto de `bin/iaunifier.mjs`. Mover
 * ou renomear a pasta do projeto deixa o serviço apontando pro vazio — e o
 * launchd, com KeepAlive ligado, fica tentando subir um arquivo que não existe
 * mais, sem que nada apareça na tela.
 */
/** Parte pura, testável sem tocar no que está instalado na máquina. */
export function describesThisProject(content, entry = ENTRY) {
  return String(content || '').includes(entry);
}

function pathMatches(file) {
  if (!existsSync(file)) return null;
  try {
    return describesThisProject(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function serviceStatus() {
  let base;
  try {
    base = handler().status();
  } catch {
    return { installed: false, supported: false };
  }
  if (!base.installed || !base.file) return base;

  const combina = pathMatches(base.file);
  if (combina === false) {
    return {
      ...base,
      stale: true,
      message:
        'o serviço aponta pra outro caminho — o projeto foi movido desde a instalação. ' +
        'Rode `iaunifier instalar-servico` de novo pra corrigir.'
    };
  }
  return { ...base, stale: false };
}

/** O que seria escrito, sem escrever — usado pra mostrar antes de instalar. */
export function servicePlan() {
  return {
    platform: platform(),
    supported: Boolean(BY_PLATFORM[platform()]),
    node: NODE,
    entry: ENTRY,
    home: DATA_DIR,
    file: { darwin: LAUNCH_AGENT, linux: SYSTEMD_UNIT, win32: `Tarefa "${TASK}"` }[platform()] || null
  };
}
