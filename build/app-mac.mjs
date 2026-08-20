// O pacote de aplicativo do macOS.
//
// Arquivo à parte do `empacotar.mjs` porque este é testável: `empacotar.mjs`
// baixa o Node de cada plataforma e injeta binário de 144 MB assim que é
// importado, e nada disso é preciso pra conferir que o pacote sai com a forma
// certa.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: RAIZ, ...opts });

// Duplo clique num executável solto do Unix não abre nada no Finder: não existe
// pacote, não existe ícone e o Gatekeeper não tem o que apresentar. O que o
// macOS abre com duplo clique é um `.app`, então é um `.app` que vai no pacote.
export function montarAppMac(binario, versao, destinoPai) {
  const app = join(destinoPai, 'Nuvo.app');
  const conteudo = join(app, 'Contents');
  const macos = join(conteudo, 'MacOS');
  const recursos = join(conteudo, 'Resources');
  rmSync(app, { recursive: true, force: true });
  mkdirSync(macos, { recursive: true });
  mkdirSync(recursos, { recursive: true });

  copyFileSync(binario, join(recursos, 'nuvo'));
  chmodSync(join(recursos, 'nuvo'), 0o755);

  // O executável do pacote é este script: sobe o servidor e manda abrir a
  // janela. `exec` deixa o processo do servidor sendo o processo do app, então
  // fechar o app no dock encerra o servidor — que é o que quem clicou espera.
  const lancador = join(macos, 'Nuvo');
  writeFileSync(lancador, `#!/bin/sh
# Gerado por build/empacotar.mjs. O binário de verdade está em Resources/nuvo.
AQUI=$(cd "$(dirname "$0")/../Resources" && pwd)
LOG="$HOME/Library/Logs/Nuvo.log"
mkdir -p "$(dirname "$LOG")"
exec "$AQUI/nuvo" --abrir >>"$LOG" 2>&1
`);
  chmodSync(lancador, 0o755);

  writeFileSync(join(conteudo, 'PkgInfo'), 'APPL????');
  writeFileSync(join(conteudo, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Nuvo</string>
  <key>CFBundleDisplayName</key><string>Nuvo</string>
  <key>CFBundleIdentifier</key><string>dev.nspx.nuvo.app</string>
  <key>CFBundleExecutable</key><string>Nuvo</string>
  <key>CFBundleIconFile</key><string>nuvo</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${versao}</string>
  <key>CFBundleVersion</key><string>${versao}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`);

  gerarIcns(join(recursos, 'nuvo.icns'));

  // Sem assinatura o macOS recusa o pacote inteiro. Ad-hoc não tira o aviso da
  // primeira abertura, mas faz o app existir para o sistema.
  try {
    sh('codesign', ['--sign', '-', '--force', '--deep', '--timestamp=none', app], { stdio: 'ignore' });
  } catch {
    console.warn('  aviso: não deu pra assinar o Nuvo.app (só afeta macOS)');
  }
  return app;
}

/** O ícone do PWA vira o ícone do pacote. Sem as ferramentas da Apple, segue sem. */
export function gerarIcns(destino) {
  const png = join(RAIZ, 'web', 'icon-512.png');
  if (process.platform !== 'darwin' || !existsSync(png)) return false;
  const iconset = join(dirname(destino), 'nuvo.iconset');
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });
  try {
    for (const [tamanho, nome] of [
      [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'], [32, 'icon_32x32.png'],
      [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
      [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'], [512, 'icon_512x512.png']
    ]) {
      sh('sips', ['-z', String(tamanho), String(tamanho), png, '--out', join(iconset, nome)], { stdio: 'ignore' });
    }
    sh('iconutil', ['-c', 'icns', iconset, '-o', destino], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(iconset, { recursive: true, force: true });
  }
}
