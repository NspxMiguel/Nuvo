#!/usr/bin/env python3
"""Refaz os ícones do app a partir da marca que o próprio app desenha.

    python3 build/icone.py

Os PNGs de ícone eram binários commitados sem origem: mudar a marca no
`web/glow.js` deixava o ícone do Dock, o do navegador e o da landing na versão
velha, e ninguém tinha como saber. Aqui eles são gerados da mesma `roseta()`
que a tela usa — uma fonte só pra marca inteira.

Por que Python numa base de Node: isto não roda em produção nem entra no
executável, e o `playwright` do Python já está instalado nesta máquina — a
mesma razão do `build/capturas.py`.

O que sai:

    web/icon-512.png     ícone do app (Dock, PWA, e o .icns do macOS)
    web/icon-192.png     aba do navegador e atalho de celular
    docs/lp/icon-512.png o favicon da landing
"""

import re
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
GLOW = RAIZ / 'web' / 'glow.js'

# O ícone é a marca sobre preto, com o mesmo brilho de fundo que a tela tem
# atrás dela. A marca ocupa 78% do quadrado: é a zona segura do ícone
# "maskable" do PWA, que corta os cantos em círculo no Android.
PAGINA = """<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: #000; }
  #palco {
    width: %(lado)dpx; height: %(lado)dpx;
    display: grid; place-items: center;
    background: radial-gradient(circle at 50%% 34%%, #17203a 0%%, #000 62%%);
  }
  .roseta { display: inline-flex; line-height: 0; }
  .roseta svg { display: block; }
</style>
<div id="palco"></div>
<script>
%(roseta)s
  document.getElementById('palco').innerHTML = roseta(%(marca)d, 'fixa');
</script>
"""


def fonte_da_marca():
    """O texto da `roseta()` tirado do glow.js, pra rodar solto na página.

    Importar o módulo por `file://` não serve: a página montada com
    `set_content` não tem origem, e o navegador recusa o import — foi assim que
    a primeira versão gerou um quadrado preto sem marca nenhuma. A função não
    depende de mais nada do arquivo, então copiá-la inteira é exato.
    """
    texto = GLOW.read_text(encoding='utf-8')
    inicio = texto.index('export function roseta(')
    nivel = 0
    for i in range(texto.index('{', inicio), len(texto)):
        if texto[i] == '{':
            nivel += 1
        elif texto[i] == '}':
            nivel -= 1
            if nivel == 0:
                return texto[inicio:i + 1].replace('export function', 'function', 1)
    raise SystemExit('não achei o fim da roseta() em web/glow.js')

SAIDAS = [
    (512, RAIZ / 'web' / 'icon-512.png'),
    (192, RAIZ / 'web' / 'icon-192.png'),
]


def desenhar(pw, lado, destino):
    """Abre a página da marca no tamanho pedido e fotografa só o palco."""
    navegador = pw.chromium.launch()
    pagina = navegador.new_page(viewport={'width': lado, 'height': lado},
                                device_scale_factor=1)
    html = PAGINA % {
        'lado': lado,
        'marca': round(lado * 0.78),
        'roseta': fonte_da_marca(),
    }
    pagina.set_content(html)
    pagina.wait_for_timeout(250)
    pagina.locator('#palco').screenshot(path=str(destino), omit_background=False)
    navegador.close()
    print(f'  {destino.relative_to(RAIZ)}  {lado}×{lado}')


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('falta o playwright: pip3 install playwright && playwright install chromium')

    # Guarda contra gerar um ícone de uma marca que não existe mais: se a
    # `roseta()` sumir do glow.js, o ícone sairia um quadrado preto e o erro
    # só apareceria no Dock de alguém.
    if not re.search(r'export function roseta\(', GLOW.read_text(encoding='utf-8')):
        sys.exit('web/glow.js não exporta roseta() — o ícone sai do desenho dela')

    print('desenhando a marca:')
    with sync_playwright() as pw:
        for lado, destino in SAIDAS:
            desenhar(pw, lado, destino)

    # A landing serve o próprio arquivo, e não o do app: `docs/` é publicado
    # pelo GitHub Pages e não enxerga `web/`.
    landing = RAIZ / 'docs' / 'lp' / 'icon-512.png'
    if landing.parent.is_dir():
        shutil.copyfile(RAIZ / 'web' / 'icon-512.png', landing)
        print(f'  {landing.relative_to(RAIZ)}  (cópia pra landing)')


if __name__ == '__main__':
    main()
