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

# `CAPTURAS_IDIOMAS=pt-BR` roda um idioma só. Serve pra acertar um roteiro sem
# gastar três sessões de IA de verdade a cada tentativa.
_so = os.environ.get('CAPTURAS_IDIOMAS')
if _so:
    IDIOMAS = {k: v for k, v in IDIOMAS.items() if k in _so.split(',')}

# Cada tela: como chegar nela e o que esperar antes de bater a foto.
TELAS = {
    'tela-conversa': {'view': None, 'espera': '.vazio h1'},
    # `tela-maquina` saiu daqui por enquanto. A tela lê a máquina de verdade, e
    # numa casa de mentira ela abre com o aviso "falta o Ollama" ocupando o topo
    # — anuncia um erro, não o produto. E as descrições dos modelos ainda saem em
    # português na tela em inglês, que é defeito a corrigir antes de virar foto.
    # 'tela-maquina': {'view': 'providers', 'espera': '#view-providers .panel-inner'},

    # As quatro que precisam de resposta de IA de verdade. `roteiro` é o nome da
    # função que faz a sessão acontecer antes da foto: elas mostram trabalho que
    # só existe depois de uma IA responder, e escrever o conteúdo à mão seria
    # anunciar uma coisa que o app não fez.
    'tela-varias': {'view': 'council', 'espera': '#c-out .council-col:not(.run)', 'roteiro': 'conselho'},
    'tela-cli': {'view': None, 'espera': '.msg.assistant .body', 'roteiro': 'memoria'},
}

# Títulos de conversa que aparecem na barra lateral. São de mentira, e é de
# propósito: a alternativa seria publicar conversa de verdade de alguém.
CONVERSAS = {
    'pt-BR': ['O que você sabe de mim', 'Resumo do contrato de aluguel', 'Erro no backup do domingo'],
    'en': ['What you know about me', 'Summary of the lease', 'Sunday backup error'],
    'es': ['Qué sabes de mí', 'Resumen del contrato de alquiler', 'Error en la copia del domingo'],
}


# A pergunta de cada roteiro, no idioma da vez. Curta de propósito: cada uma
# custa uma sessão de IA de verdade, e a foto mostra o formato, não o ensaio.
PERGUNTAS = {
    'conselho': {
        'pt-BR': 'Vale a pena reescrever um app que funciona? Responda em uma frase.',
        'en': 'Is it worth rewriting an app that works? Answer in one sentence.',
        'es': '¿Vale la pena reescribir una app que funciona? Responde en una frase.',
    },
    'memoria': {
        'pt-BR': ('Meu domínio é nspx.dev e eu escrevo em português do Brasil.',
                  'Qual é o meu domínio? Responda em uma frase.'),
        'en': ('My domain is nspx.dev and I write in English.',
               'What is my domain? Answer in one sentence.'),
        'es': ('Mi dominio es nspx.dev y escribo en español.',
               '¿Cuál es mi dominio? Responde en una frase.'),
    },
}


def cli_disponivel(nome):
    """A ref 'providerId:modelId' de um CLI ligado, ou None."""
    for p in api('/state')['providers']:
        if p['kind'] == 'cli' and p['enabled'] and p.get('models'):
            if nome is None or nome.lower() in p['name'].lower():
                return f"{p['id']}:{p['models'][0]['model_id']}"
    return None


def falar(chat_id, texto, prazo=240):
    """Manda uma mensagem e espera o turno fechar. Sem isto a foto pega o vazio."""
    pedido = urllib.request.Request(
        f'http://127.0.0.1:{PORTA}/api/chats/{chat_id}/stream',
        data=json.dumps({'content': texto}).encode(),
        headers={'content-type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(pedido, timeout=prazo) as r:
        for linha in r:  # consumir o SSE até o fim é o que espera o turno
            pass


def roteiro_conselho(idioma):
    """O conselho não guarda resultado: quem pergunta é a própria página."""
    return {'pergunta': PERGUNTAS['conselho'][idioma]}


def roteiro_memoria(idioma):
    """O que dá nome ao produto: contar pra uma IA e outra saber."""
    conta, pergunta = PERGUNTAS['memoria'][idioma]
    primeira = cli_disponivel('claude') or cli_disponivel(None)
    segunda = cli_disponivel('codex') or cli_disponivel(None)
    if not primeira:
        raise SystemExit('nenhuma IA de terminal ligada')

    contando = api('/chats', {'model': primeira, 'title': CONVERSAS[idioma][0]})
    falar(contando['id'], conta)

    # Conversa nova, outra IA: é a memória compartilhada que responde, e é isso
    # que a captura mostra.
    perguntando = api('/chats', {'model': segunda or primeira, 'title': CONVERSAS[idioma][0]})
    falar(perguntando['id'], pergunta)
    return {'chat': perguntando['id']}


ROTEIROS = {'conselho': roteiro_conselho, 'memoria': roteiro_memoria}


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

                preparados = {}
                for nome in quais:
                    roteiro = TELAS[nome].get('roteiro')
                    if roteiro:
                        print(f'  {nome}: rodando a sessão de verdade…')
                        preparados[nome] = ROTEIROS[roteiro](idioma)

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
                        preparado = preparados.get(nome)
                        if tela.get('roteiro') == 'memoria':
                            # A conversa já existe e já tem resposta: basta abrir
                            # a primeira da lista, que é ela.
                            pg.wait_for_selector('#chat-list .chat-item', timeout=20_000)
                            pg.click('#chat-list .chat-item')
                        if tela['view']:
                            # "IAs ligadas" mora dentro do <details> "Mais", que
                            # nasce fechado: clicar no botão sem abrir antes bate
                            # num elemento que existe e não está visível.
                            pg.evaluate("document.getElementById('nav-mais')?.setAttribute('open', '')")
                            pg.click(f".nav-item[data-view='{tela['view']}']")
                        if tela.get('roteiro') == 'conselho':
                            # Navegador limpo não tem escolha guardada, e sem IA
                            # marcada o conselho não roda. Marca todas e escolhe
                            # "Lado a lado", que é o modo que a foto mostra.
                            pg.wait_for_selector('#c-models input[type=checkbox]', timeout=20_000)
                            # Três, e só as que respondem. A foto é a vitrine do
                            # produto: uma IA que falha nela anuncia o defeito,
                            # não o recurso.
                            pg.evaluate(
                                "[...document.querySelectorAll('#c-models label.check')]"
                                ".filter((l) => !/gemini/i.test(l.textContent)).slice(0, 3)"
                                ".forEach((l) => { const c = l.querySelector('input');"
                                " if (!c.checked) c.click(); })")
                            pg.click("#c-modos [data-modo='compare']")
                            pg.fill('#c-prompt', preparado['pergunta'])
                            pg.click('#c-go')
                        # Resposta de IA de verdade demora: o prazo aqui é o da
                        # sessão, não o de uma tela que só precisa pintar.
                        pg.wait_for_selector(
                            tela['espera'], timeout=300_000 if tela.get('roteiro') else 20_000)
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
