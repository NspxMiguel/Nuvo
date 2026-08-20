// Navegador de verdade, dirigido pelo protocolo de depuração do Chrome.
//
// A busca de `web.mjs` baixa o HTML e lê o que veio. Isso resolve página
// escrita no servidor e falha em tudo que é montado depois, por JavaScript —
// que hoje é quase todo site com login, painel ou lista que carrega rolando.
//
// Aqui o Chrome renderiza a página e nós conversamos com ele pelo CDP: um
// WebSocket com JSON dos dois lados. Nenhuma dependência entra por isso — o
// Node traz `WebSocket` global desde a 22 e o CDP é o protocolo que o próprio
// DevTools usa.
//
// O perfil é uma pasta separada em `~/.nuvo/navegador`, não o perfil
// pessoal. Dois motivos: o Chrome recusa depuração remota no perfil padrão
// desde a 136, e um agente com acesso à sessão do dia a dia erra caro. Como a
// pasta persiste entre execuções, um login feito ali continua valendo depois.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:process';
import { createServer } from 'node:net';
import { DATA_DIR, loadConfig } from './config.mjs';
import { erroTraduzivel } from './erro-traduzivel.mjs';

const CAMINHOS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ]
};

/**
 * Onde está o navegador que o agente vai dirigir, ou `null` se não houver.
 *
 * A ordem é: o que a variável de ambiente manda (veto explícito de quem está
 * rodando), depois o que a pessoa escolheu nos ajustes, e só então o primeiro
 * navegador instalado. Sem consultar a escolha aqui, baixar um Chromium próprio
 * não mudaria nada: o agente continuaria pegando o Chrome do sistema.
 */
export function acharNavegador() {
  const escolhido = process.env.NUVO_CHROME || process.env.IAUNIFIER_CHROME;
  if (escolhido) {
    return existsSync(escolhido) ? escolhido : null;
  }
  const escolha = loadConfig().navegador || {};
  if (escolha.fonte === 'proprio' && escolha.binario && existsSync(escolha.binario)) {
    return escolha.binario;
  }
  for (const c of CAMINHOS[platform] || []) if (existsSync(c)) return c;
  // Escolheu o próprio, o download sumiu do disco e não há nada instalado: o
  // caminho guardado ainda é a melhor resposta pra quem for dar a mensagem de
  // erro — mas não é um navegador, então vale `null`.
  return null;
}

/** Porta livre de verdade: o sistema escolhe e devolve qual foi. */
function portaLivre() {
  return new Promise((ok, erro) => {
    const s = createServer();
    s.on('error', erro);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O Chrome abre a porta bem depois de o processo existir — em máquina fria
 * passou de 2,5 s aqui. Perguntar uma vez e desistir dá "conexão recusada" num
 * navegador que ia subir; então insistimos até o prazo.
 */
async function esperarPorta(porta, { limite = 20000, signal } = {}) {
  const fim = Date.now() + limite;
  let ultimo = null;
  while (Date.now() < fim) {
    if (signal?.aborted) throw new Error('cancelado');
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/version`);
      if (r.ok) return await r.json();
    } catch (err) {
      ultimo = err;
    }
    await espera(250);
  }
  throw erroTraduzivel('o navegador não respondeu em {segundos}s{causa}', {
    segundos: limite / 1000,
    causa: ultimo ? `: ${ultimo.message}` : ''
  });
}

/** Uma conexão CDP com uma aba, com correspondência de resposta por id. */
class Sessao {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pendentes = new Map();
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      const f = this.pendentes.get(m.id);
      if (f) {
        this.pendentes.delete(m.id);
        f(m);
      }
    };
    // Aba fechada no meio deixaria todo mundo esperando pra sempre.
    ws.onclose = () => {
      for (const f of this.pendentes.values()) f({ error: { message: 'a aba fechou' } });
      this.pendentes.clear();
    };
  }

  cmd(method, params = {}, { timeout = 30000 } = {}) {
    const n = ++this.id;
    return new Promise((ok, erro) => {
      const relogio = setTimeout(() => {
        this.pendentes.delete(n);
        erro(new Error(`${method} não respondeu em ${timeout / 1000}s`));
      }, timeout);
      this.pendentes.set(n, (m) => {
        clearTimeout(relogio);
        if (m.error) erro(new Error(m.error.message));
        else ok(m.result);
      });
      this.ws.send(JSON.stringify({ id: n, method, params }));
    });
  }

  /** Roda a expressão na página e devolve o valor já em JS. */
  async avaliar(expr, opcoes = {}) {
    const r = await this.cmd(
      'Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true },
      opcoes
    );
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'erro na página');
    }
    return r.result?.value;
  }

  fechar() {
    try {
      this.ws.close();
    } catch {
      /* já fechou */
    }
  }
}

/**
 * Sobe um Chrome só nosso e devolve a aba pronta.
 * @param {{janela?: boolean, signal?: AbortSignal}} opcoes
 */
export async function abrirNavegador({ janela = false, signal } = {}) {
  const binario = acharNavegador();
  if (!binario) throw new Error('nenhum Chrome, Chromium, Edge ou Brave encontrado nesta máquina');

  const porta = await portaLivre();
  // Perfil só do agente. O `navegador` puro é o da janela do app
  // (server/desktop.mjs), e o Chrome recusa dois processos no mesmo
  // `--user-data-dir`: com o ícone do app aberto, o agente morria depois de 20s
  // esperando uma porta que nunca ia abrir.
  const perfil = join(DATA_DIR, 'navegador-agente');
  const args = [
    `--remote-debugging-port=${porta}`,
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--disable-sync',
    'about:blank'
  ];
  // A janela na frente rouba o teclado a cada passo. Sem janela é o padrão; com
  // janela é o modo de ver o que está acontecendo — e de fazer um login que o
  // perfil vai guardar.
  if (!janela) args.unshift('--headless=new');

  const proc = spawn(binario, args, { stdio: 'ignore', detached: false });
  let morto = false;
  proc.on('exit', () => {
    morto = true;
  });

  let sessao = null;
  const encerrar = () => {
    sessao?.fechar();
    if (!morto) {
      try {
        proc.kill();
      } catch {
        /* já morreu */
      }
    }
  };

  try {
    await esperarPorta(porta, { signal });
    const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
    const aba = alvos.find((t) => t.type === 'page');
    if (!aba) throw new Error('o navegador subiu sem nenhuma aba');

    const ws = new WebSocket(aba.webSocketDebuggerUrl);
    await new Promise((ok, erro) => {
      ws.onopen = ok;
      ws.onerror = () => erro(new Error('não deu pra falar com a aba'));
    });
    sessao = new Sessao(ws);
    await sessao.cmd('Page.enable');
    await sessao.cmd('Runtime.enable');
    // Sem janela, o Chrome se anuncia como "HeadlessChrome" — e site grande
    // trata isso como robô: o DuckDuckGo devolvia a página com zero resultados,
    // sempre, sem erro nenhum. Tirar a palavra do user-agent resolve; o resto
    // da identificação continua sendo a verdadeira.
    if (!janela) {
      await sessao.cmd('Network.setUserAgentOverride', {
        userAgent: (await sessao.avaliar('navigator.userAgent')).replace('HeadlessChrome', 'Chrome'),
        acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8'
      });
    }
    return { sessao, encerrar, porta, binario, perfil };
  } catch (err) {
    encerrar();
    throw err;
  }
}

// O que a página vira pro modelo: o texto que um leitor veria, mais a lista
// numerada do que dá pra clicar e preencher. O número é gravado no próprio nó
// (`data-ia-n`), então o clique seguinte acha o mesmo elemento sem depender de
// seletor inventado — que é onde esse tipo de agente costuma errar de alvo.
const LER_PAGINA = `(() => {
  const visivel = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const rotulo = (e) => {
    const t = (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.value ||
               e.innerText || e.getAttribute('title') || e.getAttribute('name') || '')
              .replace(/\\s+/g, ' ').trim();
    return t.slice(0, 80);
  };
  document.querySelectorAll('[data-ia-n]').forEach((e) => e.removeAttribute('data-ia-n'));
  const alvos = [...document.querySelectorAll(
    'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]'
  )].filter((e) => visivel(e) && !e.disabled);
  const elementos = [];
  alvos.slice(0, 120).forEach((e, i) => {
    const n = i + 1;
    e.setAttribute('data-ia-n', String(n));
    const tag = e.tagName.toLowerCase();
    const escrevivel = tag === 'textarea' || e.isContentEditable ||
      (tag === 'input' && !['checkbox','radio','submit','button','file','range'].includes((e.type||'text').toLowerCase()));
    elementos.push({ n, tag, escrevivel, rotulo: rotulo(e) || (tag === 'a' ? (e.getAttribute('href')||'').slice(0,60) : '') });
  });
  const texto = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').replace(/[ \\t]+/g, ' ').trim();
  return { url: location.href, titulo: document.title, texto, elementos,
           fim: Math.ceil(window.scrollY + window.innerHeight) >= document.body.scrollHeight - 4 };
})()`;

/** Estado atual da página, do jeito que o modelo vai ler. */
export async function lerPagina(sessao, { limite = 6000 } = {}) {
  const p = await sessao.avaliar(LER_PAGINA);
  if (!p) throw new Error('a página não respondeu');
  return { ...p, texto: p.texto.slice(0, limite), cortado: p.texto.length > limite };
}

/**
 * Espera a página assentar depois de uma ação.
 *
 * `Page.loadEventFired` não serve sozinho: em site de uma página só, clicar
 * troca o conteúdo inteiro sem nenhum load. Então olhamos o que de fato
 * interessa — a URL e o tamanho do texto — e seguimos quando param de mudar.
 */
async function assentar(sessao, { limite = 6000 } = {}) {
  const fim = Date.now() + limite;
  let anterior = null;
  let iguais = 0;
  while (Date.now() < fim) {
    await espera(280);
    let agora;
    try {
      agora = await sessao.avaliar(
        '(() => location.href + "|" + (document.body ? document.body.innerText.length : 0))()'
      );
    } catch {
      continue; // navegando: o contexto da página some por um instante
    }
    if (agora === anterior) {
      if (++iguais >= 2) return;
    } else {
      iguais = 0;
      anterior = agora;
    }
  }
}

const acheElemento = (n) => `document.querySelector('[data-ia-n="${Number(n)}"]')`;

/**
 * Executa uma ação do agente e devolve o que houve, em uma linha.
 * @param {Sessao} sessao
 * @param {{acao: string, alvo?: string, texto?: string}} passo
 */
export async function executar(sessao, passo) {
  const { acao } = passo;

  if (acao === 'navegar') {
    let url = String(passo.alvo || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
    // `Page.navigate` responde com `errorText` em vez de rejeitar: sem olhar
    // isso, um domínio que não existe viraria "naveguei" e o modelo seguiria
    // lendo a página anterior achando que era a nova.
    const r = await sessao.cmd('Page.navigate', { url });
    if (r.errorText) throw erroTraduzivel('não abriu {url}: {causa}', { url, causa: r.errorText });
    await assentar(sessao);
    return `abri ${url}`;
  }

  if (acao === 'buscar') {
    const termo = String(passo.alvo || passo.texto || '').trim();
    const url = 'https://duckduckgo.com/?q=' + encodeURIComponent(termo);
    await sessao.cmd('Page.navigate', { url });
    await assentar(sessao);
    return `busquei por "${termo}"`;
  }

  if (acao === 'clicar') {
    const ok = await sessao.avaliar(`(() => {
      const e = ${acheElemento(passo.alvo)};
      if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      const r = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim().slice(0,60);
      e.click();
      return r || 'elemento ' + ${Number(passo.alvo)};
    })()`);
    if (ok === null) throw erroTraduzivel('não existe elemento {alvo} nesta página', { alvo: passo.alvo });
    await assentar(sessao);
    return `cliquei em "${ok}"`;
  }

  if (acao === 'escrever') {
    const texto = String(passo.texto ?? '');
    // Campo de senha não se preenche sozinho. O agente erra de alvo, erra de
    // site e não tem como saber que errou; e uma senha digitada no lugar errado
    // não volta atrás. Quem digita senha aqui é o usuário, com a janela aberta.
    const senha = await sessao.avaliar(
      `(() => { const e = ${acheElemento(passo.alvo)}; return !!e && (e.type || '').toLowerCase() === 'password'; })()`
    );
    if (senha) throw new Error('campo de senha: só o usuário digita, com a janela do navegador aberta');
    // Digitar direto no `value` não acorda React nem Vue — o campo mostra o
    // texto e o site continua achando que está vazio. Os dois eventos abaixo
    // são o que as bibliotecas escutam.
    const ok = await sessao.avaliar(`(() => {
      const e = ${acheElemento(passo.alvo)};
      if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      e.focus();
      const v = ${JSON.stringify(texto)};
      if (e.isContentEditable) { e.textContent = v; }
      else {
        const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
        const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
        if (set) set.call(e, v); else e.value = v;
      }
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (ok === null) throw erroTraduzivel('não existe elemento {alvo} nesta página', { alvo: passo.alvo });
    if (passo.enter !== false) {
      await sessao.cmd('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      });
      await sessao.cmd('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      });
      await assentar(sessao);
    }
    return `escrevi "${texto.slice(0, 60)}" no campo ${passo.alvo}`;
  }

  if (acao === 'rolar') {
    const paraCima = String(passo.alvo || '').startsWith('cima');
    await sessao.avaliar(
      `window.scrollBy({ top: ${paraCima ? '-' : ''}Math.round(window.innerHeight * 0.85) })`
    );
    await espera(500);
    return paraCima ? 'rolei pra cima' : 'rolei pra baixo';
  }

  if (acao === 'voltar') {
    await sessao.avaliar('history.back()');
    await assentar(sessao);
    return 'voltei uma página';
  }

  throw erroTraduzivel('ação desconhecida: {acao}', { acao });
}
