// Ícone no dock, na barra de tarefas, no menu de aplicativos.
//
// Não é Electron: empacotar um Chromium inteiro por aparência custaria umas
// centenas de megabytes e a primeira dependência do projeto. O que existe aqui
// abre o navegador que a pessoa já tem em modo aplicativo — janela sem barra de
// endereço, sem abas, com ícone próprio —, apontado pro servidor de casa.
//
// A diferença que sobra pra um app nativo é a janela pertencer ao navegador.
// Em troca: zero dependência, zero build, e a mesma interface no PC e no
// celular, que continua sendo o PWA.

import { execFileSync } from 'node:child_process';
import { writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhaDeComando, EMPACOTADO } from './empacotado.mjs';
import { getAsset } from 'node:sea';
import { loadConfig, DATA_DIR } from './config.mjs';
import { erroTraduzivel } from './erro-traduzivel.mjs';

// Igual ao serviço: empacotado o atalho tem que chamar o próprio executável.
const COMANDO_SERVIDOR = linhaDeComando(import.meta.url);
// O mesmo ícone que o PWA usa no celular — um desenho só pros dois lugares.
// Empacotado não existe pasta `web/`: o ícone é gravado a partir do binário na
// pasta de dados, e o resto do código continua lendo um caminho de arquivo.
const ICON_PNG = EMPACOTADO
  ? iconeDoBinario()
  : fileURLToPath(new URL('../web/icon-512.png', import.meta.url));

function iconeDoBinario() {
  const destino = join(DATA_DIR, 'icon-512.png');
  try {
    if (!existsSync(destino)) {
      writeFileSync(destino, Buffer.from(getAsset('icon-512.png')));
    }
    return destino;
  } catch {
    // Sem ícone o atalho ainda funciona, só sai com a cara do navegador.
    return destino;
  }
}

/** Navegadores em modo aplicativo, na ordem de preferência. */
const CHROMIUM = {
  darwin: [
    ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Google Chrome'],
    ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', 'Brave'],
    ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Edge'],
    ['/Applications/Chromium.app/Contents/MacOS/Chromium', 'Chromium']
  ],
  linux: [
    ['/usr/bin/google-chrome', 'Google Chrome'],
    ['/usr/bin/chromium', 'Chromium'],
    ['/usr/bin/chromium-browser', 'Chromium'],
    ['/usr/bin/brave-browser', 'Brave'],
    ['/usr/bin/microsoft-edge', 'Edge']
  ],
  win32: [
    ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'Google Chrome'],
    ['C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'Google Chrome'],
    ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'Edge']
  ]
};

/** O primeiro navegador em modo aplicativo que existir nesta máquina. */
export function findBrowser() {
  for (const [caminho, nome] of CHROMIUM[platform()] || []) {
    if (existsSync(caminho)) return { path: caminho, name: nome };
  }
  return null;
}

/** Endereço que a janela abre, já com o token. */
export function appUrl() {
  const cfg = loadConfig();
  const base = `http://localhost:${cfg.port}/`;
  return cfg.requireToken ? `${base}?token=${cfg.accessToken}` : base;
}

/**
 * O script que o ícone dispara: garante o servidor de pé e abre a janela.
 *
 * O servidor é subido em segundo plano quando a porta não responde — quem já
 * instalou o serviço não paga nada por isso, e quem não instalou não precisa
 * abrir terminal antes.
 */
function launcherSh() {
  const cfg = loadConfig();
  const browser = findBrowser();
  const url = appUrl();
  const abrir = browser
    ? `"${browser.path}" --app="${url}" --user-data-dir="${join(DATA_DIR, 'navegador')}" >/dev/null 2>&1 &`
    : platform() === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  // A checagem é por identidade, não por porta ocupada: o endereço leva o token
  // de acesso, e se outro programa tiver tomado a porta ele receberia o token.
  return `#!/bin/sh
# Gerado pelo Nuvo. Recriar: nuvo instalar-app

ping_nuvo() {
  curl -s --max-time 1 "http://localhost:${cfg.port}/api/ping" 2>/dev/null | grep -q '"nuvo"'
}

if ! ping_nuvo; then
  IAUNIFIER_HOME="${DATA_DIR}" ${COMANDO_SERVIDOR} >>"${join(DATA_DIR, 'servidor.log')}" 2>&1 &
  # Espera o servidor atender antes de abrir a janela, senão a primeira
  # abertura mostra "não foi possível conectar".
  i=0
  while [ $i -lt 40 ]; do
    ping_nuvo && break
    sleep 0.25
    i=$((i + 1))
  done

  if ! ping_nuvo; then
    echo "Nuvo não subiu na porta ${cfg.port}. Veja ${join(DATA_DIR, 'servidor.log')}." >&2
    exit 1
  fi
fi

${abrir}
`;
}

// -------------------------------------------------------------------- macOS

const MAC_APP = join(homedir(), 'Applications', 'Nuvo.app');
// O app já se chamou IAUnifier. Quem instalou naquela época tem um pacote com o
// nome antigo apontando para o mesmo servidor: deixá-lo no Launchpad seria dois
// ícones para a mesma coisa, e um deles com o nome errado.
const MAC_APP_ANTIGO = join(homedir(), 'Applications', 'IAUnifier.app');

function macInstall() {
  rmSync(MAC_APP_ANTIGO, { recursive: true, force: true });
  const macos = join(MAC_APP, 'Contents', 'MacOS');
  const resources = join(MAC_APP, 'Contents', 'Resources');
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });

  writeFileSync(
    join(MAC_APP, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Nuvo</string>
  <key>CFBundleDisplayName</key><string>Nuvo</string>
  <key>CFBundleIdentifier</key><string>dev.nspx.nuvo.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>nuvo</string>
  <key>CFBundleIconFile</key><string>icone</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`
  );

  const script = join(macos, 'nuvo');
  writeFileSync(script, launcherSh());
  chmodSync(script, 0o755);

  let icone = false;
  try {
    icone = macIcon(resources);
  } catch {
    /* sem ícone próprio o macOS usa o genérico, e o app funciona igual */
  }

  // O Finder guarda o pacote em cache pelo caminho: sem tocar na data, um app
  // reinstalado continua mostrando o ícone velho.
  try {
    execFileSync('touch', [MAC_APP]);
  } catch {
    /* detalhe cosmético */
  }

  return {
    system: 'macOS',
    path: MAC_APP,
    browser: findBrowser()?.name || 'navegador padrão',
    icon: icone
  };
}

/**
 * PNG → .icns com `sips` e `iconutil`, que já vêm no macOS.
 *
 * O ícone de origem tem 512 px, então só saem os tamanhos que cabem dentro
 * disso: ampliar pra 1024 deixaria a borda serrilhada, e o sistema prefere
 * escolher um tamanho menor nítido a um maior borrado.
 */
function macIcon(resources) {
  if (!existsSync(ICON_PNG)) return false;
  const iconset = join(resources, 'icone.iconset');
  mkdirSync(iconset, { recursive: true });

  const sips = (tamanho, nome) =>
    execFileSync('sips', ['-z', String(tamanho), String(tamanho), ICON_PNG, '--out', join(iconset, nome)], {
      stdio: 'ignore'
    });

  for (const tamanho of [16, 32, 128, 256, 512]) {
    sips(tamanho, `icon_${tamanho}x${tamanho}.png`);
    if (tamanho * 2 <= 512) sips(tamanho * 2, `icon_${tamanho}x${tamanho}@2x.png`);
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'icone.icns')], { stdio: 'ignore' });
  rmSync(iconset, { recursive: true, force: true });
  return true;
}

function macUninstall() {
  rmSync(MAC_APP, { recursive: true, force: true });
  return { system: 'macOS', path: MAC_APP };
}

// -------------------------------------------------------------------- Linux

const LINUX_DESKTOP = join(homedir(), '.local', 'share', 'applications', 'nuvo.desktop');
const LINUX_SCRIPT = join(DATA_DIR, 'abrir-nuvo.sh');
const LINUX_ICON = join(homedir(), '.local', 'share', 'icons', 'nuvo.png');
const LINUX_ANTIGOS = [
  join(homedir(), '.local', 'share', 'applications', 'iaunifier.desktop'),
  join(DATA_DIR, 'abrir-iaunifier.sh'),
  join(homedir(), '.local', 'share', 'icons', 'iaunifier.png'),
];

function linuxInstall() {
  for (const antigo of LINUX_ANTIGOS) rmSync(antigo, { force: true });
  mkdirSync(join(homedir(), '.local', 'share', 'applications'), { recursive: true });
  mkdirSync(join(homedir(), '.local', 'share', 'icons'), { recursive: true });

  writeFileSync(LINUX_SCRIPT, launcherSh());
  chmodSync(LINUX_SCRIPT, 0o755);

  let icone = false;
  if (existsSync(ICON_PNG)) {
    copyFileSync(ICON_PNG, LINUX_ICON);
    icone = true;
  }

  writeFileSync(
    LINUX_DESKTOP,
    `[Desktop Entry]
Type=Application
Name=Nuvo
Comment=Todas as suas IAs, uma memória só
Exec=${LINUX_SCRIPT}
Icon=${icone ? LINUX_ICON : 'applications-internet'}
Terminal=false
Categories=Utility;Development;
`
  );
  try {
    execFileSync('update-desktop-database', [join(homedir(), '.local', 'share', 'applications')], { stdio: 'ignore' });
  } catch {
    /* nem toda distribuição tem, e o atalho funciona sem */
  }
  return { system: 'Linux', path: LINUX_DESKTOP, browser: findBrowser()?.name || 'navegador padrão', icon: icone };
}

function linuxUninstall() {
  rmSync(LINUX_DESKTOP, { force: true });
  rmSync(LINUX_SCRIPT, { force: true });
  rmSync(LINUX_ICON, { force: true });
  return { system: 'Linux', path: LINUX_DESKTOP };
}

// ----------------------------------------------------------------- Windows

const WIN_DIR = join(
  process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs'
);
const WIN_CMD = join(WIN_DIR, 'Nuvo.cmd');
const WIN_CMD_ANTIGO = join(WIN_DIR, 'IAUnifier.cmd');

function winInstall() {
  rmSync(WIN_CMD_ANTIGO, { force: true });
  mkdirSync(WIN_DIR, { recursive: true });
  const cfg = loadConfig();
  const browser = findBrowser();
  const url = appUrl();
  const abrir = browser
    ? `start "" "${browser.path}" --app="${url}" --user-data-dir="${join(DATA_DIR, 'navegador')}"`
    : `start "" "${url}"`;

  // Mesma checagem por identidade do lado do Unix: `findstr` procura a marca
  // do Nuvo na resposta, em vez de aceitar qualquer coisa que atenda.
  writeFileSync(
    WIN_CMD,
    `@echo off\r
rem Gerado pelo Nuvo. Recriar: nuvo instalar-app\r
curl -s --max-time 1 "http://localhost:${cfg.port}/api/ping" 2>NUL | findstr /C:"nuvo" >NUL\r
if errorlevel 1 (\r
  set IAUNIFIER_HOME=${DATA_DIR}\r
  start "" /b ${COMANDO_SERVIDOR}\r
  timeout /t 4 /nobreak >NUL\r
  curl -s --max-time 1 "http://localhost:${cfg.port}/api/ping" 2>NUL | findstr /C:"nuvo" >NUL\r
  if errorlevel 1 (\r
    echo Nuvo nao subiu na porta ${cfg.port}. Veja ${join(DATA_DIR, 'servidor.log')}. 1>&2\r
    exit /b 1\r
  )\r
)\r
${abrir}\r
`
  );
  return { system: 'Windows', path: WIN_CMD, browser: browser?.name || 'navegador padrão', icon: false };
}

function winUninstall() {
  rmSync(WIN_CMD, { force: true });
  return { system: 'Windows', path: WIN_CMD };
}

// ------------------------------------------------------------------ escolha

const POR_SISTEMA = {
  darwin: { install: macInstall, uninstall: macUninstall, path: MAC_APP },
  linux: { install: linuxInstall, uninstall: linuxUninstall, path: LINUX_DESKTOP },
  win32: { install: winInstall, uninstall: winUninstall, path: WIN_CMD }
};

function handler() {
  const impl = POR_SISTEMA[platform()];
  if (!impl) throw erroTraduzivel('não sei criar atalho em {sistema}', { sistema: platform() });
  return impl;
}

export function installDesktopApp() {
  return handler().install();
}

export function uninstallDesktopApp() {
  return handler().uninstall();
}

export function desktopStatus() {
  const impl = POR_SISTEMA[platform()];
  if (!impl) return { supported: false, installed: false };
  return {
    supported: true,
    installed: existsSync(impl.path),
    path: impl.path,
    browser: findBrowser()?.name || null
  };
}
