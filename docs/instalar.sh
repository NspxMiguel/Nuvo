#!/bin/sh
# Instalador do Nuvo para macOS e Linux.
#
#   curl -fsSL https://www.nspx.dev/Nuvo/instalar.sh | sh
#
# Existe por um motivo específico do macOS: arquivo baixado pelo navegador vem
# com a marca de quarentena, e o Gatekeeper recusa app sem assinatura da Apple
# — o duplo clique não abre nada e não explica por quê. O que o `curl` baixa
# não recebe essa marca, então por aqui o app abre na primeira tentativa.
#
# O que este script faz, e nada além disso: descobre o sistema, baixa o pacote
# da última versão publicada no GitHub, confere o SHA-256 e põe o app no lugar.

set -eu

REPO="NspxMiguel/Nuvo"
DESTINO_MAC="$HOME/Applications"
DESTINO_LINUX="$HOME/.local/bin"

erro() { printf '\n%s\n' "$1" >&2; exit 1; }

# ------------------------------------------------------------------- sistema

so=$(uname -s)
arco=$(uname -m)
case "$arco" in
  arm64|aarch64) arco=arm64 ;;
  x86_64|amd64)  arco=x64 ;;
  *) erro "arquitetura não suportada: $arco" ;;
esac

case "$so" in
  Darwin) alvo="macos-$arco"; ext="tar.gz" ;;
  Linux)  alvo="linux-$arco"; ext="tar.gz" ;;
  *) erro "sistema não suportado: $so (o Windows tem o .zip na página de download)" ;;
esac

command -v curl >/dev/null 2>&1 || erro "este script precisa do curl"

# -------------------------------------------------------------------- versão

printf 'procurando a última versão...\n'
versao=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
[ -n "$versao" ] || erro "não consegui descobrir a última versão em github.com/$REPO/releases"

pacote="nuvo-$versao-$alvo.$ext"
url="https://github.com/$REPO/releases/download/v$versao/$pacote"

# --------------------------------------------------------------------- baixa

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

printf 'baixando %s...\n' "$pacote"
curl -fsSL --retry 2 -o "$tmp/$pacote" "$url" || erro "não consegui baixar $url"

# Confere contra o SHA256SUMS.txt da própria versão: pacote truncado no meio do
# download vira erro aqui, não um app que abre e fecha sem explicar.
if curl -fsSL -o "$tmp/SHA256SUMS.txt" \
     "https://github.com/$REPO/releases/download/v$versao/SHA256SUMS.txt" 2>/dev/null; then
  esperado=$(grep " $pacote\$" "$tmp/SHA256SUMS.txt" | awk '{print $1}' | head -1)
  if [ -n "$esperado" ]; then
    if command -v shasum >/dev/null 2>&1; then
      obtido=$(shasum -a 256 "$tmp/$pacote" | awk '{print $1}')
    else
      obtido=$(sha256sum "$tmp/$pacote" | awk '{print $1}')
    fi
    [ "$esperado" = "$obtido" ] || erro "o arquivo baixado não bate com a soma publicada — baixe de novo"
    printf 'soma conferida\n'
  fi
fi

tar -xzf "$tmp/$pacote" -C "$tmp"

# ------------------------------------------------------------------- instala

if [ "$so" = "Darwin" ]; then
  mkdir -p "$DESTINO_MAC"
  rm -rf "$DESTINO_MAC/Nuvo.app"
  mv "$tmp/Nuvo.app" "$DESTINO_MAC/Nuvo.app"
  # Cinto e suspensório: se alguma etapa acima carimbou a quarentena, tira.
  xattr -dr com.apple.quarantine "$DESTINO_MAC/Nuvo.app" 2>/dev/null || true

  printf '\nNuvo instalado em %s\n' "$DESTINO_MAC/Nuvo.app"
  printf 'abrindo...\n'
  open "$DESTINO_MAC/Nuvo.app"
  printf '\nda próxima vez, é só abrir o Nuvo pelo Launchpad.\n'
else
  mkdir -p "$DESTINO_LINUX"
  mv "$tmp/nuvo" "$DESTINO_LINUX/nuvo"
  chmod +x "$DESTINO_LINUX/nuvo"

  printf '\nNuvo instalado em %s\n' "$DESTINO_LINUX/nuvo"
  case ":$PATH:" in
    *":$DESTINO_LINUX:"*) ;;
    *) printf 'atenção: %s não está no seu PATH.\n' "$DESTINO_LINUX" ;;
  esac
  printf '\nsuba com:  nuvo\n'
  printf 'ícone no menu de aplicativos:  nuvo instalar-app\n'
fi
