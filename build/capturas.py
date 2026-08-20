#!/usr/bin/env python3
"""Refaz as capturas do app que aparecem na landing e no cartão do site.

    python3 build/capturas.py                # todas as telas que dão pra refazer
    python3 build/capturas.py tela-conversa  # só uma

Por que Python numa base de Node: isto não roda em produção nem entra no
executável — é ferramenta de manutenção, e o `playwright` do Python já está
instalado nesta máquina. O que ele faz é abrir o app de verdade num navegador de
verdade, então a captura é o app, não uma montagem.

O app é aberto numa **casa de mentira** (`NUVO_HOME` temporário), nunca na pasta
de dados de quem roda: as imagens vão pro site, e conversa de verdade não pode
vazar numa captura.

As telas que precisam de resposta de IA de verdade (`tela-varias`, `tela-cli`,
`tela-programar`, `tela-agente`) não estão aqui: elas mostram trabalho que só
existe depois de uma sessão real, e inventar o conteúdo seria anunciar uma coisa
que o app não fez. Refazer aquelas quatro é rodar a sessão à mão e capturar.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / 'docs' / 'lp'
PORTA = 4794

# 1600x1005 com escala 2 dá 3200x2010, que reduz pra 2000x1257 — o tamanho das
# imagens que já estão no site. A proporção (1.592) é a mesma.
LARGURA, ALTURA = 1600, 1005
LARGURA_FINAL = 2000

# O cartão do projeto no nspx.dev usa uma captura de celular junto da de mesa.
CELULAR = (390, 844)
LARGURA_FINAL_CELULAR = 1170

IDIOMAS = {'pt-BR': '', 'en': '-en', 'es': '-es'}

# Cada tela: como chegar nela e o que esperar antes de bater a foto.
TELAS = {
    'tela-conversa': {'view': None, 'espera': '.vazio h1'},
    # `tela-maquina` saiu daqui por enquanto. A tela lê a máquina de verdade, e
    # numa casa de mentira ela abre com o aviso "falta o Ollama" ocupando o topo
    # — anuncia um erro, não o produto. E as descrições dos modelos ainda saem em
    # português na tela em inglês, que é defeito a corrigir antes de virar foto.
    # 'tela-maquina': {'view': 'providers', 'espera': '#view-providers .panel-inner'},
}

# Títulos de conversa que aparecem na barra lateral. São de mentira, e é de
# propósito: a alternativa seria publicar conversa de verdade de alguém.
CONVERSAS = {
    'pt-BR': ['O que você sabe de mim', 'Resumo do contrato de aluguel', 'Erro no backup do domingo'],
    'en': ['What you know about me', 'Summary of the lease', 'Sunday backup error'],
    'es': ['Qué sabes de mí', 'Resumen del contrato de alquiler', 'Error en la copia del domingo'],
}


def api(caminho, corpo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    pedido = urllib.request.Request(
        f'http://127.0.0.1:{PORTA}/api{caminho}',
        data=dados,
        headers={'content-type': 'application/json'},
        method='POST' if dados else 'GET',
    )
    with urllib.request.urlopen(pedido, timeout=20) as resposta:
        return json.loads(resposta.read() or b'null')


def esperar_servidor(prazo=40):
    limite = time.time() + prazo
    while time.time() < limite:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORTA}/api/ping', timeout=2) as r:
                if json.loads(r.read()).get('app') == 'nuvo':
                    return True
        except (urllib.error.URLError, OSError, ValueError):
            time.sleep(0.4)
    return False


def reduzir(png, largura, jpg):
    """PNG grande vira JPG do tamanho publicado. `sips` já vem no macOS."""
    subprocess.run(['sips', '--resampleWidth', str(largura),
                    '-s', 'format', 'jpeg', '-s', 'formatOptions', '80',
                    str(png), '--out', str(jpg)],
                   check=True, capture_output=True)


def capturar(quais):
    from playwright.sync_api import sync_playwright

    casa = Path(tempfile.mkdtemp(prefix='nuvo-capturas-'))
    (casa / 'config.json').write_text(json.dumps({'port': PORTA, 'requireToken': False}))

    servidor = subprocess.Popen(
        [shutil.which('node'), str(RAIZ / 'bin' / 'nuvo.mjs'), '--port', str(PORTA), '--no-token'],
        env={**os.environ, 'NUVO_HOME': str(casa)},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    try:
        if not esperar_servidor():
            raise SystemExit('o servidor não subiu — veja se a porta 4794 está livre')

        temporario = Path(tempfile.mkdtemp(prefix='nuvo-png-'))
        with sync_playwright() as pw:
            navegador = pw.chromium.launch()
            for idioma, sufixo in IDIOMAS.items():
                # Uma conversa de cada, no idioma da vez: a barra lateral vazia
                # anuncia um app onde nunca aconteceu nada.
                for titulo in CONVERSAS[idioma]:
                    api('/chats', {'title': titulo})

                for nome in quais:
                    tela = TELAS[nome]
                    for celular in (False, True):
                        if celular and nome != 'tela-conversa':
                            continue
                        largura, altura = CELULAR if celular else (LARGURA, ALTURA)
                        ctx = navegador.new_context(
                            viewport={'width': largura, 'height': altura},
                            device_scale_factor=3 if celular else 2,
                            is_mobile=celular,
                            locale=idioma,
                            color_scheme='dark',
                        )
                        ctx.add_init_script(
                            f"try {{ localStorage.setItem('nuvo.idioma', {json.dumps(idioma)}); }} catch {{}}")
                        pg = ctx.new_page()
                        pg.goto(f'http://127.0.0.1:{PORTA}/', wait_until='load')
                        if tela['view']:
                            # "IAs ligadas" mora dentro do <details> "Mais", que
                            # nasce fechado: clicar no botão sem abrir antes bate
                            # num elemento que existe e não está visível.
                            pg.evaluate("document.getElementById('nav-mais')?.setAttribute('open', '')")
                            pg.click(f".nav-item[data-view='{tela['view']}']")
                        pg.wait_for_selector(tela['espera'], timeout=20_000)
                        # A roseta abre em 700 ms e o brilho do rodapé entra
                        # depois: bater antes pega a marca pela metade.
                        pg.wait_for_timeout(2500)

                        png = temporario / f'{nome}{sufixo}.png'
                        pg.screenshot(path=str(png))
                        alvo = DESTINO / f'{nome}{"-mobile" if celular else ""}{sufixo}.jpg'
                        reduzir(png, LARGURA_FINAL_CELULAR if celular else LARGURA_FINAL, alvo)
                        print(f'  {alvo.relative_to(RAIZ)}')
                        ctx.close()

                # Cada idioma começa do zero: senão a segunda volta acha as
                # conversas da primeira e a barra lateral vira uma torre de Babel.
                for chat in api('/chats'):
                    urllib.request.urlopen(urllib.request.Request(
                        f'http://127.0.0.1:{PORTA}/api/chats/{chat["id"]}', method='DELETE'), timeout=20)
            navegador.close()
        shutil.rmtree(temporario, ignore_errors=True)
    finally:
        servidor.terminate()
        servidor.wait(timeout=10)
        shutil.rmtree(casa, ignore_errors=True)


if __name__ == '__main__':
    pedidas = sys.argv[1:] or list(TELAS)
    desconhecidas = [p for p in pedidas if p not in TELAS]
    if desconhecidas:
        raise SystemExit(f'não sei capturar: {", ".join(desconhecidas)}\nconheço: {", ".join(TELAS)}')
    print('capturando:')
    capturar(pedidas)
