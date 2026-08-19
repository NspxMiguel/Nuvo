// Um Chromium só do app, pra quem não tem navegador nenhum instalado.
//
// `navegador.mjs` procura Chrome, Chromium, Edge ou Brave na máquina e, quando
// não acha, o modo agente simplesmente não existe pra aquela pessoa. Aqui ela
// pode baixar o Chrome for Testing — o build que o próprio Google publica pra
// automação, sem atualizador automático, sem se registrar como navegador
// padrão e sem tocar no perfil pessoal de ninguém.
//
// Duas chamadas de rede, as duas pedidas pelo usuário no botão: o índice de
// versões (9 kB) e o zip do navegador. Nenhuma delas acontece sozinha.
//
// O índice é o `last-known-good-versions-with-downloads.json`, que já vem com
// a URL pronta dos quatro canais em ~9 kB. O irmão dele,
// `known-good-versions-with-downloads.json`, traz o histórico inteiro e pesa
// 4,9 MB — baixar 4,9 MB pra ler um campo é o tipo de tráfego que este app
// promete não fazer.

import { execFile } from 'node:child_process';
import {
  createWriteStream,
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, delimiter, join, sep } from 'node:path';
import { DATA_DIR } from './config.mjs';

const INDICE =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

// Estável, não Canary: o agente precisa de um navegador que abre site de banco
// e de loja sem surpresa, não do que estreia recurso toda noite.
const CANAL = 'Stable';

export const PASTA = join(DATA_DIR, 'chromium');
const INSTALADO = join(PASTA, 'atual');
const MARCA = join(PASTA, 'versao.json');

/** Onde o executável mora dentro de cada zip, contado a partir da raiz dele. */
const DENTRO_DO_PACOTE = {
  // No macOS o que sai do zip é um .app inteiro; o executável de verdade está
  // enterrado nele, e é esse caminho que o `spawn` do agente precisa receber.
  'mac-arm64': ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  'mac-x64': ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  linux64: ['chrome-linux64', 'chrome'],
  win32: ['chrome-win32', 'chrome.exe'],
  win64: ['chrome-win64', 'chrome.exe']
};

/** Nomes que valem como executável quando o caminho conhecido não bate. */
const NOMES_DO_BINARIO = ['Google Chrome for Testing', 'chrome', 'chrome.exe'];

/**
 * A plataforma desta máquina no vocabulário do Chrome for Testing, ou `null`
 * quando o Google não publica build pra ela.
 *
 * Os parâmetros existem pro teste: sem eles só dava pra conferir o mapeamento
 * da máquina onde o teste roda, que é justamente a combinação que não precisa
 * de prova.
 *
 * @returns {string|null} mac-arm64, mac-x64, linux64, win32, win64 ou null
 */
export function plataformaDaMaquina(so = process.platform, arquitetura = process.arch) {
  if (so === 'darwin') {
    if (arquitetura === 'arm64') return 'mac-arm64';
    if (arquitetura === 'x64') return 'mac-x64';
    return null;
  }
  if (so === 'linux') {
    // Só existe linux64. Raspberry Pi e servidor ARM ficam de fora, e dizer
    // isso agora é melhor do que baixar 185 MB que não executam.
    return arquitetura === 'x64' ? 'linux64' : null;
  }
  if (so === 'win32') {
    if (arquitetura === 'ia32') return 'win32';
    // Windows em ARM roda o binário x64 por emulação, e não há build arm64
    // publicado: win64 é a única resposta útil pras duas arquiteturas.
    return arquitetura === 'x64' || arquitetura === 'arm64' ? 'win64' : null;
  }
  return null;
}

// ----------------------------------------------------------------- descompactar

/**
 * Onde está um programa do sistema, procurando no PATH na mão.
 *
 * Nada de `which`/`where`: seria um processo a mais só pra descobrir se dá pra
 * criar outro processo, e num serviço do sistema esses comandos nem sempre
 * estão no PATH herdado — que é o mesmo motivo da lista de caminhos absolutos
 * lá embaixo.
 */
function acharPrograma(nome) {
  const extensoes =
    process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensoes) {
      const caminho = join(dir, nome + ext);
      if (existsSync(caminho)) return caminho;
    }
  }
  return null;
}

/**
 * A ferramenta do sistema que abre o zip, já com os argumentos montados.
 *
 * O `unzip()` escrito à mão em `backup.mjs` NÃO serve pra este zip. Ele ignora
 * os atributos externos do formato, que é onde ficam guardados o bit de
 * execução e a marca de link simbólico. O `chrome-mac-arm64.zip` tem 645
 * entradas, das quais 12 são executáveis e 5 são links do framework
 * (`.../Versions/Current`, `Resources`, `Libraries`, `Helpers`); extrair esses
 * cinco como arquivo comum monta um .app que não abre. Por isso a extração sai
 * daqui pro sistema, que sabe reconstruir as duas coisas.
 *
 * @param {string} so valor no estilo de `process.platform`
 * @returns {{nome: string, programa: string, args: (zip: string, destino: string) => string[]}}
 */
export function ferramentaDeDescompactar(so = process.platform) {
  if (so === 'darwin') {
    // `ditto -x -k` é o extrator de zip do próprio macOS e é o único aqui que
    // reconstrói link simbólico e permissão do jeito que o .app espera.
    const programa = acharPrograma('ditto') || (existsSync('/usr/bin/ditto') ? '/usr/bin/ditto' : null);
    if (!programa) throw new Error('não achei o `ditto` nesta máquina — sem ele não dá pra abrir o pacote do Chromium sem quebrar o .app');
    return { nome: 'ditto', programa, args: (zip, destino) => ['-x', '-k', zip, destino] };
  }

  if (so === 'linux') {
    const programa = acharPrograma('unzip') || ['/usr/bin/unzip', '/bin/unzip'].find((p) => existsSync(p));
    if (!programa) {
      throw new Error(
        'não achei o `unzip` nesta máquina — instale-o (`apt install unzip`, `dnf install unzip`) e tente de novo'
      );
    }
    return { nome: 'unzip', programa, args: (zip, destino) => ['-q', '-o', zip, '-d', destino] };
  }

  if (so === 'win32') {
    // O tar do Windows 10+ é o bsdtar e lê zip. Onde ele não existir, o
    // PowerShell resolve — mais lento, e é justamente por isso que é o plano B.
    const tar = acharPrograma('tar');
    if (tar) return { nome: 'tar', programa: tar, args: (zip, destino) => ['-xf', zip, '-C', destino] };

    const posh = acharPrograma('powershell') || acharPrograma('pwsh');
    if (posh) {
      return {
        nome: 'Expand-Archive',
        programa: posh,
        args: (zip, destino) => [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // Aspas simples dobradas: é como o PowerShell escapa aspas dentro de
          // string literal, e caminho de usuário no Windows tem de tudo.
          `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destino.replace(/'/g, "''")}' -Force`
        ]
      };
    }
    throw new Error('não achei nem o `tar` nem o PowerShell nesta máquina — sem um dos dois não dá pra abrir o pacote do Chromium');
  }

  throw new Error(`não sei descompactar em ${so}`);
}

/** Roda um programa e devolve a saída; erro vira mensagem de uma linha. */
function rodar(programa, args, { signal, timeout = 10 * 60_000 } = {}) {
  return new Promise((ok, erro) => {
    execFile(programa, args, { signal, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return ok(String(stdout || '').trim());
      // A última linha do stderr é a que diz o que houve; o resto costuma ser
      // uso do comando, que não ajuda quem está olhando a tela do app.
      const detalhe = String(stderr || '').trim().split('\n').filter(Boolean).pop() || err.message;
      erro(new Error(`${basename(programa)} falhou: ${detalhe}`));
    });
  });
}

// ------------------------------------------------------------------- versão

/**
 * Mesmo desenho do `get` de `web.mjs`: prazo pra resposta chegar e o
 * cancelamento de quem chamou ligado no mesmo controlador.
 *
 * O relógio morre quando os cabeçalhos chegam, não quando o corpo acaba — 185
 * MB não cabem em prazo de requisição, e quem cuida do corpo parado é o
 * vigia de travada lá embaixo.
 */
async function buscar(url, { signal, timeout = 15000, method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), timeout);
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, { method, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(relogio);
  }
}

/** Quanto pesa o arquivo, ou `null` se o servidor não disser. */
async function tamanhoDoArquivo(url, { signal } = {}) {
  try {
    // Um HEAD antes do GET: 180 MB é decisão, não detalhe, e a pessoa merece
    // ver o número antes de apertar o botão.
    const res = await buscar(url, { signal, method: 'HEAD', timeout: 10000 });
    const n = Number(res.headers.get('content-length'));
    return res.ok && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Qual Chromium dá pra baixar nesta máquina agora.
 * @param {{signal?: AbortSignal, plataforma?: string}} opcoes
 * @returns {Promise<{versao: string, url: string, bytes?: number}>}
 */
export async function versaoDisponivel({ signal, plataforma = plataformaDaMaquina() } = {}) {
  if (!plataforma) {
    throw new Error(`o Chrome for Testing não publica build pra ${process.platform}/${process.arch}`);
  }

  const res = await buscar(INDICE, { signal });
  if (!res.ok) throw new Error(`não deu pra ver as versões do Chromium: HTTP ${res.status}`);
  const dados = await res.json();

  const canal = dados?.channels?.[CANAL];
  const alvo = canal?.downloads?.chrome?.find((d) => d.platform === plataforma);
  if (!alvo?.url) throw new Error(`o índice do Chrome for Testing não trouxe download de ${plataforma}`);

  const bytes = await tamanhoDoArquivo(alvo.url, { signal });
  return { versao: String(canal.version), url: alvo.url, ...(bytes ? { bytes } : {}) };
}

// ------------------------------------------------------------------ download

const mb = (n) => (n / 1048576).toFixed(0);

/** Caminho do executável dentro de uma raiz já descompactada, ou `null`. */
function acharBinario(raiz, plataforma) {
  const conhecido = join(raiz, ...(DENTRO_DO_PACOTE[plataforma] || []));
  if (DENTRO_DO_PACOTE[plataforma] && existsSync(conhecido)) return conhecido;

  // O caminho conhecido é a aposta, não a certeza: o nome da pasta e do .app
  // vêm do zip do Google. Se mudarem, uma varredura curta custa menos que
  // dizer "baixei mas não achei" pra quem acabou de esperar 185 MB.
  const fila = [{ dir: raiz, nivel: 0 }];
  while (fila.length) {
    const { dir, nivel } = fila.shift();
    if (nivel > 6) continue;
    let itens;
    try {
      itens = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of itens) {
      const caminho = join(dir, item.name);
      if (item.isDirectory()) fila.push({ dir: caminho, nivel: nivel + 1 });
      else if (item.isFile() && NOMES_DO_BINARIO.includes(item.name) && executavel(caminho)) return caminho;
    }
  }
  return null;
}

function executavel(caminho) {
  try {
    // No Windows o X_OK não distingue nada, mas lá o que importa é o `.exe`
    // existir — e existir é o que este teste também responde.
    accessSync(caminho, constants.X_OK);
    return lstatSync(caminho).isFile();
  } catch {
    return false;
  }
}

/**
 * Baixa, descompacta e devolve o executável — contando o que faz pelo caminho.
 *
 * @param {{signal?: AbortSignal}} opcoes
 * @returns {AsyncGenerator<{type: string}, {ok: true, binario: string, versao: string, aviso?: string}>}
 */
export async function* baixarChromium({ signal } = {}) {
  const plataforma = plataformaDaMaquina();
  if (!plataforma) {
    throw new Error(
      `não há Chromium pronto pra ${process.platform}/${process.arch} — instale um Chrome ou Chromium pelo gerenciador de pacotes do sistema`
    );
  }
  // Conferido ANTES do download: descobrir que falta o `unzip` depois de 185
  // MB no disco é a pior hora possível pra descobrir.
  const ferramenta = ferramentaDeDescompactar();
  if (signal?.aborted) throw new Error('download cancelado');

  yield { type: 'phase', text: 'vendo qual é a versão atual' };
  const { versao, url, bytes } = await versaoDisponivel({ signal, plataforma });

  mkdirSync(PASTA, { recursive: true });
  const parcial = join(PASTA, `chromium-${plataforma}.zip.parcial`);
  const zip = join(PASTA, `chromium-${plataforma}.zip`);
  const novo = join(PASTA, 'novo');
  const limpar = () => {
    for (const caminho of [parcial, zip, novo]) rmSync(caminho, { recursive: true, force: true });
  };
  limpar();

  yield { type: 'phase', text: `baixando o Chromium ${versao}${bytes ? ` (${mb(bytes)} MB)` : ''}` };

  try {
    yield* baixarZip(url, parcial, { signal, esperado: bytes });
    renameSync(parcial, zip);

    yield { type: 'phase', text: `descompactando com ${ferramenta.nome}` };
    mkdirSync(novo, { recursive: true });
    await rodar(ferramenta.programa, ferramenta.args(zip, novo), { signal });

    const achado = acharBinario(novo, plataforma);
    if (!achado) throw new Error('o pacote abriu mas não tinha o executável do Chromium dentro');

    // Troca só depois de o pacote novo estar inteiro: uma queda no meio do
    // download deixava a pessoa sem o Chromium que já funcionava.
    rmSync(INSTALADO, { recursive: true, force: true });
    renameSync(novo, INSTALADO);
    rmSync(zip, { force: true });
    const binario = join(INSTALADO, achado.slice(novo.length + 1));

    yield { type: 'phase', text: 'conferindo se ele abre' };
    // `--version` é a prova de que a extração não quebrou o pacote: no macOS um
    // .app com os links do framework virados em arquivo comum falha exatamente
    // aqui, e falha em silêncio se ninguém perguntar.
    let aviso;
    try {
      const resposta = await rodar(binario, ['--version'], { signal, timeout: 30_000 });
      yield { type: 'phase', text: `pronto: ${resposta || versao}` };
    } catch (err) {
      // Baixou e abriu o pacote — o que falhou foi executar, que em Linux
      // enxuto costuma ser biblioteca do sistema faltando. Vale entregar o
      // caminho com o defeito escrito em vez de jogar fora o download inteiro.
      aviso = `o Chromium foi baixado mas não respondeu a --version: ${err.message}`;
      yield { type: 'phase', text: aviso };
    }

    writeFileSync(MARCA, JSON.stringify({ versao, plataforma, binario, quando: new Date().toISOString() }, null, 2));
    return { ok: true, binario, versao, ...(aviso ? { aviso } : {}) };
  } catch (err) {
    limpar();
    throw err;
  }
}

/** O corpo da resposta caindo no disco, contando o quanto já caiu. */
async function* baixarZip(url, destino, { signal, esperado } = {}) {
  const res = await buscar(url, { signal, timeout: 60_000 });
  if (!res.ok) throw new Error(`o download do Chromium falhou: HTTP ${res.status}`);

  const declarado = Number(res.headers.get('content-length'));
  const total = Number.isFinite(declarado) && declarado > 0 ? declarado : esperado || 0;

  const leitor = res.body.getReader();
  const arquivo = createWriteStream(destino);
  let feito = 0;
  let ultimoPct = -1;
  let ultimoAviso = 0;

  // Vigia de travada: conexão que morre sem fechar deixa o `read()` esperando
  // pra sempre, e a tela ficaria em "baixando" até a pessoa desistir do app.
  let travou = null;
  const armar = () => {
    clearTimeout(travou);
    travou = setTimeout(() => leitor.cancel(new Error('a conexão parou de responder')), 90_000);
  };

  try {
    for (;;) {
      if (signal?.aborted) throw new Error('download cancelado');
      armar();
      const { done, value } = await leitor.read();
      if (done) break;

      feito += value.length;
      if (!arquivo.write(value)) await new Promise((ok, erro) => {
        arquivo.once('drain', ok);
        arquivo.once('error', erro);
      });

      const pct = total ? Math.min(100, Math.round((feito / total) * 100)) : 0;
      const agora = Date.now();
      // Um evento por chunk seriam milhares de mensagens pra atravessar o SSE;
      // por ponto percentual, ou a cada 400 ms quando o tamanho é desconhecido,
      // é o bastante pra barra andar.
      if (pct !== ultimoPct || agora - ultimoAviso > 400) {
        ultimoPct = pct;
        ultimoAviso = agora;
        yield { type: 'progresso', feito, total, pct };
      }
    }
    if (ultimoPct !== 100) yield { type: 'progresso', feito, total, pct: total ? 100 : 0 };
  } finally {
    clearTimeout(travou);
    await new Promise((ok) => arquivo.end(ok));
  }

  if (total && feito !== total) {
    throw new Error(`o download veio incompleto: ${mb(feito)} MB de ${mb(total)} MB`);
  }
}

// ------------------------------------------------------------------- estado

/**
 * O executável já baixado, se existir e for executável de verdade.
 * @returns {string|null}
 */
export function chromiumBaixado() {
  const candidatos = [];
  try {
    const marca = JSON.parse(readFileSync(MARCA, 'utf8'));
    if (marca?.binario) candidatos.push(String(marca.binario));
  } catch {
    /* sem marca: cai no caminho conhecido, logo abaixo */
  }

  // A marca pode ter sido apagada com a pasta intacta (restauração de backup,
  // cópia manual). Olhar o caminho conhecido evita mandar baixar 185 MB de novo.
  for (const partes of Object.values(DENTRO_DO_PACOTE)) candidatos.push(join(INSTALADO, ...partes));

  for (const caminho of candidatos) {
    // A marca é um arquivo do disco do usuário: um caminho de fora da pasta do
    // app viraria "executável do Chromium" sem nunca ter sido baixado aqui.
    if (!caminho.startsWith(INSTALADO + sep)) continue;
    if (executavel(caminho)) return caminho;
  }
  return null;
}
