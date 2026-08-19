// Instalador guiado do Ollama.
//
// A tela hoje só sabe dizer "ligue o Ollama primeiro", e quem nunca ouviu falar
// de Ollama não tem o que fazer com esse aviso. Aqui mora o que o botão
// Instalar dispara: descobrir se ele já está na máquina, ligar o que já existe
// e — só quando não existe mesmo — baixar o pacote oficial e rodar o passo
// local de cada sistema.
//
// Nada de `curl | sh`: o artefato é baixado num arquivo, conferido no tamanho e
// só então descompactado ou executado. Dá o mesmo resultado do script oficial
// da Ollama e deixa a pessoa auditar o que entrou na máquina dela.
//
// É a única parte do app que fala com um servidor de fora sem a pessoa ter
// pedido um texto a uma IA — e ela só sai depois do clique em Instalar, sempre
// pro mesmo domínio (ollama.com), sem mandar nada junto.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, chmodSync, openSync, closeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir, platform, arch } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { DATA_DIR } from './config.mjs';

const exec = promisify(execFile);

const BASE_PADRAO = 'http://127.0.0.1:11434';
const ORIGEM = 'https://ollama.com/download';

// Onde a nossa instalação mora quando não dá pra usar o caminho do sistema.
// Fica junto do resto dos dados do app: quem apagar ~/.iaunifier apaga tudo
// junto, sem deixar pedaço de Ollama espalhado pela máquina.
const NOSSA_PASTA = join(DATA_DIR, 'ollama');
const LOG = join(DATA_DIR, 'ollama.log');

// Instalador que veio pela metade é o defeito mais comum de download grande, e
// ele se disfarça bem: um HTML de erro de 2 KB gravado com nome de .zip. Abaixo
// disso não é instalador de jeito nenhum.
const MINIMO_PLAUSIVEL = 5 * 1024 * 1024;

/**
 * Endereço em que o Ollama atende. `OLLAMA_HOST` é a variável oficial dele —
 * quem trocou a porta já a tem configurada, e ignorar isso faria o app dizer
 * "não está instalado" pra quem está com ele aberto na frente.
 */
function enderecoBase() {
  const bruto = String(process.env.OLLAMA_HOST || '').trim();
  if (!bruto) return BASE_PADRAO;
  const comEsquema = /^https?:\/\//i.test(bruto) ? bruto : `http://${bruto}`;
  return comEsquema.replace(/\/+$/, '');
}

/**
 * Prazo próprio, já amarrado ao cancelamento de quem chamou.
 *
 * O ouvinte é retirado no fim de propósito: a espera pelo Ollama subir sonda a
 * porta dezenas de vezes com o mesmo signal, e um ouvinte pendurado por sondagem
 * faz o Node começar a avisar de vazamento na saída do programa.
 */
function comPrazo(timeoutMs, signal) {
  const ctrl = new AbortController();
  const cancelar = () => ctrl.abort();
  const timer = setTimeout(cancelar, timeoutMs);
  if (signal?.aborted) cancelar();
  else signal?.addEventListener('abort', cancelar);
  return {
    signal: ctrl.signal,
    semPrazo() {
      clearTimeout(timer);
    },
    limpar() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelar);
    }
  };
}

/** Mesma sonda da descoberta automática: responder em /api/tags é estar no ar. */
async function respondendo(timeoutMs = 1200, signal) {
  const prazo = comPrazo(timeoutMs, signal);
  try {
    const res = await fetch(`${enderecoBase()}/api/tags`, { signal: prazo.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    prazo.limpar();
  }
}

async function versaoNoAr(signal) {
  const prazo = comPrazo(1200, signal);
  try {
    const res = await fetch(`${enderecoBase()}/api/version`, { signal: prazo.signal });
    if (!res.ok) return null;
    return (await res.json())?.version || null;
  } catch {
    // Ollama antigo não tem /api/version. Sem versão a tela ainda funciona.
    return null;
  } finally {
    prazo.limpar();
  }
}

async function temComando(comando) {
  const finder = platform() === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await exec(finder, [comando]);
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

/** Lugares onde o Ollama fica instalado, na ordem em que valem mais. */
function candidatos() {
  const exe = platform() === 'win32' ? 'ollama.exe' : 'ollama';
  const lista = [{ caminho: join(NOSSA_PASTA, 'bin', exe), tipo: 'binario' }];

  if (platform() === 'darwin') {
    // No macOS o que interessa é o pacote: o binário de dentro sobe o servidor,
    // mas quem liga o ícone da barra de menu é o app.
    for (const raiz of ['/Applications', join(homedir(), 'Applications')]) {
      lista.push({ caminho: join(raiz, 'Ollama.app'), tipo: 'app' });
    }
  } else if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    lista.push({ caminho: join(local, 'Programs', 'Ollama', 'ollama.exe'), tipo: 'binario' });
    lista.push({ caminho: join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'), tipo: 'binario' });
  } else {
    for (const raiz of ['/usr/local/bin', '/usr/bin', join(homedir(), '.local', 'bin')]) {
      lista.push({ caminho: join(raiz, exe), tipo: 'binario' });
    }
  }
  return lista;
}

/**
 * O Ollama instalado nesta máquina, ou null.
 * @returns {Promise<{caminho: string, tipo: 'app'|'binario'}|null>}
 */
async function acharInstalado() {
  // Caminho apontado à mão manda, e manda sozinho: se a pessoa disse onde está
  // e não está lá, usar outro binário em silêncio é pior que dizer que sumiu.
  const forcado = String(process.env.IAUNIFIER_OLLAMA_BIN || '').trim();
  if (forcado) {
    if (!existsSync(forcado)) return null;
    return { caminho: forcado, tipo: forcado.endsWith('.app') ? 'app' : 'binario' };
  }

  for (const c of candidatos()) {
    if (existsSync(c.caminho)) return c;
  }
  const noCaminho = await temComando('ollama');
  return noCaminho ? { caminho: noCaminho, tipo: 'binario' } : null;
}

/**
 * Em que pé está o Ollama.
 * @param {{signal?: AbortSignal}} [opcoes]
 * @returns {Promise<{estado: 'no_ar'|'instalado_parado'|'ausente', versao?: string, caminho?: string}>}
 */
export async function estadoDoOllama({ signal } = {}) {
  if (await respondendo(1200, signal)) {
    const versao = await versaoNoAr(signal);
    // Sem procurar binário aqui de propósito: esta função é o que a tela chama
    // de tempos em tempos, e varrer o disco e o PATH a cada olhada custa caro
    // pra responder o que a porta já respondeu.
    return versao ? { estado: 'no_ar', versao } : { estado: 'no_ar' };
  }
  const achado = await acharInstalado();
  if (achado) return { estado: 'instalado_parado', caminho: achado.caminho };
  return { estado: 'ausente' };
}

/** Espera a porta atender, checando de tempos em tempos. */
async function esperarNoAr(limiteMs, signal) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (signal?.aborted) return false;
    if (await respondendo(1000, signal)) return true;
    await new Promise((ok) => setTimeout(ok, 400));
  }
  return respondendo(1500, signal);
}

/**
 * Dispara o Ollama que já existe. Resolve quando o processo sobreviveu ao
 * arranque — não quando ele atende, que é a espera de quem chamou.
 *
 * O arranque é conferido de verdade porque a alternativa é péssima: binário sem
 * permissão de execução falha em milissegundos, e sem escutar o erro a tela
 * ficaria meio minuto girando pra concluir o que já dava pra dizer na hora.
 */
async function subir(achado) {
  if (achado.tipo === 'app') {
    // `--args hidden` é o que o instalador oficial usa: sobe o servidor sem
    // abrir a janela de boas-vindas na cara de quem só quer conversar.
    await exec('open', ['-a', achado.caminho, '--args', 'hidden']);
    return;
  }

  await new Promise((ok, erro) => {
    let saida = 'ignore';
    let fd = null;
    try {
      fd = openSync(LOG, 'a');
      saida = fd;
    } catch {
      /* sem log o Ollama sobe igual; só fica mais difícil descobrir por que não subiu */
    }
    const proc = spawn(achado.caminho, ['serve'], {
      detached: true,
      stdio: ['ignore', saida, saida],
      windowsHide: true
    });
    let decidido = false;
    const decidir = (fn, arg) => {
      if (decidido) return;
      decidido = true;
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* o filho já ficou com a cópia dele do arquivo */
        }
      }
      fn(arg);
    };
    proc.on('error', (err) => decidir(erro, new Error(`não consegui rodar ${achado.caminho}: ${err.message}`)));
    proc.on('exit', (codigo) => decidir(erro, new Error(`o Ollama fechou logo depois de abrir (código ${codigo}). Veja ${LOG}.`)));
    setTimeout(() => {
      // Sobreviveu ao arranque: solta o processo, pra ele continuar servindo
      // depois que o IAUnifier fechar.
      proc.unref();
      decidir(ok);
    }, 500).unref?.();
  });
}

/**
 * Liga um Ollama já instalado. Não baixa nada.
 * @param {{signal?: AbortSignal}} [opcoes]
 * @returns {Promise<boolean>}
 */
export async function ligarOllama({ signal } = {}) {
  if (await respondendo(800, signal)) return true;
  const achado = await acharInstalado();
  if (!achado) return false;
  try {
    await subir(achado);
  } catch {
    return false;
  }
  return esperarNoAr(30000, signal);
}

function emMega(bytes) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Baixa um arquivo grande mostrando o quanto já veio.
 *
 * Emite `{type:'progresso', feito, total, pct}` e devolve o total de bytes
 * gravados. Sem isso a tela ficaria parada por vários minutos — o pacote do
 * Linux passa de 1 GB —, e tela parada é tela quebrada aos olhos de quem espera.
 *
 * @param {string} url
 * @param {string} destino
 * @param {{signal?: AbortSignal}} [opcoes]
 */
export async function* baixarArquivo(url, destino, { signal } = {}) {
  // Prazo só até o servidor responder o cabeçalho. Depois que os bytes começam
  // a andar, não existe prazo: baixar 1 GB numa internet de casa é lento e
  // isso não é defeito. O elo com o cancelamento de quem chamou, esse fica de
  // pé até o fim — é ele que corta a conexão no meio do corpo.
  const prazo = comPrazo(30000, signal);

  let res;
  try {
    res = await fetch(url, { signal: prazo.signal, redirect: 'follow' });
  } catch (err) {
    prazo.limpar();
    if (signal?.aborted) throw new Error('o download do Ollama foi cancelado.');
    throw new Error(`não consegui falar com ollama.com pra baixar o Ollama (${err.message}). Veja se a internet está funcionando e tente de novo.`);
  }
  prazo.semPrazo();

  if (!res.ok) {
    prazo.limpar();
    throw new Error(
      `o site do Ollama respondeu ${res.status} em vez de mandar o programa. Tente de novo em alguns minutos; se insistir, dá pra instalar na mão.`
    );
  }

  const total = Number(res.headers.get('content-length')) || 0;
  const arquivo = await open(destino, 'w');
  let feito = 0;
  let ultimoAviso = 0;
  let completo = false;
  const reader = res.body.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      // O AbortSignal chega no fetch, mas o corpo falso dos testes — e um
      // proxy que segure a conexão aberta — não reagem a ele. A checagem no
      // laço é o que garante que Cancelar cancela mesmo.
      if (signal?.aborted) throw new Error('o download do Ollama foi cancelado.');
      await arquivo.write(value);
      feito += value.length;
      const agora = Date.now();
      // Um aviso a cada quarto de segundo. Sem essa contenção seriam dezenas de
      // milhares de eventos numa barra que só tem 100 posições.
      if (agora - ultimoAviso >= 250) {
        ultimoAviso = agora;
        yield { type: 'progresso', feito, total, pct: total ? Math.floor((feito / total) * 100) : null };
      }
    }

    if (total && feito !== total) {
      throw new Error(
        `o download do Ollama veio pela metade (${emMega(feito)} de ${emMega(total)}). Costuma ser a internet caindo no meio: tente de novo.`
      );
    }
    if (!total && feito < MINIMO_PLAUSIVEL) {
      throw new Error(
        `o que baixou de ollama.com tem só ${emMega(feito)} e não é o programa do Ollama. Tente de novo mais tarde.`
      );
    }
    completo = true;
  } finally {
    prazo.limpar();
    await arquivo.close();
    reader.cancel?.()?.catch?.(() => {});
    // Pedaço de download não serve pra nada e ocupa centenas de megabytes.
    // Vale tanto pro erro quanto pro Cancelar — que chega aqui como exceção.
    if (!completo) rmSync(destino, { force: true });
  }

  // Fecha a barra em 100% sempre: o último pedaço quase nunca cai na janelinha
  // do aviso, e a barra travada em 98% parece defeito.
  yield { type: 'progresso', feito, total: total || feito, pct: 100 };
  return feito;
}

/** Pasta de trabalho do download, dentro dos dados do app. */
function pastaDeTrabalho() {
  // Em ~/.iaunifier, não no /tmp: em muita distribuição o /tmp é memória RAM, e
  // o pacote do Linux tem mais de 1 GB — o download morreria com "sem espaço"
  // numa máquina com disco sobrando.
  const pasta = join(DATA_DIR, 'instalador-ollama');
  mkdirSync(pasta, { recursive: true });
  return pasta;
}

function arquiteturaLinux() {
  const mapa = { x64: 'amd64', arm64: 'arm64' };
  const alvo = mapa[arch()];
  if (!alvo) {
    throw new Error(`o Ollama não tem versão pronta pra este processador (${arch()}). Dá pra compilar do código-fonte, mas isso é trabalho de quem programa.`);
  }
  return alvo;
}

// ------------------------------------------------------------------- macOS

async function* instalarNoMac(trabalho, signal) {
  const zip = join(trabalho, 'Ollama-darwin.zip');
  yield { type: 'phase', text: 'baixando o Ollama do site oficial' };
  yield* baixarArquivo(`${ORIGEM}/Ollama-darwin.zip`, zip, { signal });

  yield { type: 'phase', text: 'descompactando' };
  const solto = join(trabalho, 'solto');
  rmSync(solto, { recursive: true, force: true });
  mkdirSync(solto, { recursive: true });
  await exec('unzip', ['-q', '-o', zip, '-d', solto], { signal, maxBuffer: 1 << 20 });
  rmSync(zip, { force: true });

  const origem = join(solto, 'Ollama.app');
  if (!existsSync(origem)) throw new Error('o arquivo que veio de ollama.com não tem o programa dentro. Tente de novo.');

  // Sem `sudo` em lugar nenhum: o único passo do script oficial que pede senha
  // é criar o atalho em /usr/local/bin, e o app não precisa dele — conversa com
  // o Ollama por HTTP na porta 11434.
  let destino = '/Applications/Ollama.app';
  if (existsSync(destino)) {
    // Já tem um lá. Apagar por cima é destruir instalação de outro programa
    // sem ninguém ter pedido.
    yield { type: 'phase', text: 'o Ollama já estava na pasta Aplicativos' };
  } else {
    yield { type: 'phase', text: 'instalando na pasta Aplicativos' };
    try {
      // `ditto` em vez de cp: é o utilitário do próprio macOS pra copiar pacote
      // de aplicativo, e preserva os atributos que a assinatura do programa usa.
      // Copiado errado, o Ollama passa a ser recusado pelo sistema na abertura.
      await exec('ditto', [origem, destino], { signal });
    } catch {
      // Máquina onde o usuário não é administrador. A pasta Aplicativos dele
      // sempre aceita, e o macOS abre programa de lá igual.
      destino = join(homedir(), 'Applications', 'Ollama.app');
      mkdirSync(join(homedir(), 'Applications'), { recursive: true });
      if (!existsSync(destino)) await exec('ditto', [origem, destino], { signal });
    }
  }
  rmSync(solto, { recursive: true, force: true });

  yield { type: 'phase', text: 'abrindo o Ollama' };
  // Pelo caminho completo, não por nome: o pacote acabou de aparecer no disco e
  // o macOS pode levar um tempo até indexá-lo pra achar por nome.
  await exec('open', ['-a', destino, '--args', 'hidden'], { signal });
}

// ----------------------------------------------------------------- Windows

async function* instalarNoWindows(trabalho, signal) {
  const instalador = join(trabalho, 'OllamaSetup.exe');
  yield { type: 'phase', text: 'baixando o Ollama do site oficial' };
  yield* baixarArquivo(`${ORIGEM}/OllamaSetup.exe`, instalador, { signal });

  yield { type: 'phase', text: 'instalando (isso demora um pouco)' };
  // Os três parâmetros são os mesmos do script oficial da Ollama: instala sem
  // janela, sem reiniciar o computador e sem caixa de aviso. Instalação por
  // usuário, sem pedir administrador.
  await exec(instalador, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { signal, windowsHide: true });
  rmSync(instalador, { force: true });
}

// ------------------------------------------------------------------- Linux

/** Como esta máquina sabe descompactar o pacote do Linux. */
function descompactadorZstd() {
  // O Node traz zstd desde a 22.15; em Node mais antigo sobra o programa do
  // sistema. Nenhum dos dois é dependência instalada por nós.
  if (typeof zlib.createZstdDecompress === 'function') return 'node';
  return 'programa';
}

async function* instalarNoLinux(trabalho, signal) {
  const alvo = arquiteturaLinux();
  const via = descompactadorZstd();
  const temPrograma = via === 'programa' ? await temComando('zstd') : true;

  // A Ollama publica o pacote do Linux só em .tar.zst hoje; o .tgz das versões
  // antigas responde 404. Quando não dá pra abrir zst, ainda vale tentar o
  // .tgz — se um dia ele voltar, isto passa a funcionar sozinho —, e o erro
  // abaixo explica as duas saídas de quem cair no 404.
  const extensao = via === 'node' || temPrograma ? 'tar.zst' : 'tgz';
  const pacote = join(trabalho, `ollama-linux-${alvo}.${extensao}`);

  yield { type: 'phase', text: 'baixando o Ollama do site oficial' };
  try {
    yield* baixarArquivo(`${ORIGEM}/ollama-linux-${alvo}.${extensao}`, pacote, { signal });
  } catch (err) {
    if (extensao === 'tgz' && /respondeu 404/.test(err.message)) {
      throw new Error(
        'esta máquina não sabe abrir o formato em que o Ollama é publicado (zstd). Instale o programa zstd (no Ubuntu e no Debian: `sudo apt install zstd`) e clique em Instalar de novo.'
      );
    }
    throw err;
  }

  yield { type: 'phase', text: 'descompactando' };
  const tar = join(trabalho, 'ollama.tar');
  if (extensao === 'tgz') {
    await pipeline(createReadStream(pacote), zlib.createGunzip(), createWriteStream(tar));
  } else if (via === 'node') {
    await pipeline(createReadStream(pacote), zlib.createZstdDecompress(), createWriteStream(tar));
  } else {
    await exec('zstd', ['-d', '-f', pacote, '-o', tar], { signal });
  }
  // O pacote comprimido some agora: manter os dois lados abertos ao mesmo tempo
  // seria quase 3 GB de disco parado à toa.
  rmSync(pacote, { force: true });

  // Na pasta do usuário, não em /usr/local: instalar no sistema pede senha de
  // administrador, e é justamente isso que o script oficial faz e que este
  // botão promete não fazer. O `bin/` e o `lib/` ficam lado a lado como no
  // pacote oficial, que é como o programa acha as bibliotecas dele.
  mkdirSync(NOSSA_PASTA, { recursive: true });
  try {
    await exec('tar', ['-xf', tar, '-C', NOSSA_PASTA], { signal, maxBuffer: 1 << 20 });
  } catch (err) {
    throw new Error(`não consegui abrir o pacote do Ollama (${err.message}). Se o programa \`tar\` não existir nesta máquina, instale-o e tente de novo.`);
  } finally {
    rmSync(tar, { force: true });
  }

  const binario = join(NOSSA_PASTA, 'bin', 'ollama');
  if (!existsSync(binario)) throw new Error('o pacote do Ollama veio sem o programa dentro. Tente de novo.');
  try {
    chmodSync(binario, 0o755);
  } catch {
    /* o tar já costuma trazer a permissão certa */
  }

  yield { type: 'phase', text: 'ligando o Ollama' };
  await subir({ caminho: binario, tipo: 'binario' });
}

const POR_SISTEMA = {
  darwin: instalarNoMac,
  win32: instalarNoWindows,
  linux: instalarNoLinux
};

/**
 * Instala o Ollama do zero, contando o que está fazendo.
 *
 * Emite `{type:'phase'}` e `{type:'progresso'}`; termina devolvendo
 * `{ok: true}` ou estoura com uma frase que dá pra ler sem ser programador.
 *
 * @param {{signal?: AbortSignal}} [opcoes]
 */
export async function* instalarOllama({ signal } = {}) {
  if (await respondendo(800, signal)) return { ok: true };

  // Instalado e parado é o caso mais comum de quem aperta Instalar: baixar
  // centenas de megabytes por cima do que já está no disco seria um desperdício
  // que a pessoa paga em tempo e em internet.
  const achado = await acharInstalado();
  if (achado) {
    yield { type: 'phase', text: 'o Ollama já está instalado aqui; ligando' };
    try {
      await subir(achado);
    } catch (err) {
      throw new Error(
        `o Ollama está instalado em ${achado.caminho}, mas não consegui ligar: ${err.message} Abra-o na mão uma vez e tente de novo.`
      );
    }
    if (!(await esperarNoAr(30000, signal))) {
      throw new Error(`o Ollama abriu mas não atendeu em ${enderecoBase()}. Abra-o na mão uma vez e tente de novo.`);
    }
    return { ok: true };
  }

  const receita = POR_SISTEMA[platform()];
  if (!receita) {
    const manual = receitaManual();
    throw new Error(`não sei instalar o Ollama sozinho em ${platform()}. ${manual.explicacao}`);
  }

  const trabalho = pastaDeTrabalho();
  try {
    yield* receita(trabalho, signal);
    yield { type: 'phase', text: 'esperando o Ollama atender' };
    if (!(await esperarNoAr(60000, signal))) {
      throw new Error(
        `o Ollama foi instalado, mas não atendeu em ${enderecoBase()}. Abra o programa Ollama na mão uma vez — na primeira abertura ele às vezes pede uma confirmação — e volte aqui.`
      );
    }
    return { ok: true };
  } catch (err) {
    if (signal?.aborted) throw new Error('a instalação do Ollama foi cancelada.');
    throw err;
  } finally {
    // O que sobrou do download não serve pra mais nada e ocupa o disco de quem
    // nem sabe que existe.
    rmSync(trabalho, { recursive: true, force: true });
  }
}

/**
 * O plano B, pra quando a instalação automática falhar: um comando pra copiar.
 * @returns {{comando: string, explicacao: string}}
 */
export function receitaManual() {
  if (platform() === 'darwin') {
    return {
      comando: `curl -fL ${ORIGEM}/Ollama-darwin.zip -o ~/Downloads/Ollama.zip && unzip -o ~/Downloads/Ollama.zip -d /Applications && open -a /Applications/Ollama.app`,
      explicacao:
        'Abra o Terminal (Aplicativos → Utilitários → Terminal), cole a linha acima e aperte Enter. Ela baixa o Ollama do site oficial, põe o programa na pasta Aplicativos e abre. Não pede senha. Quando terminar, volte aqui.'
    };
  }
  if (platform() === 'win32') {
    return {
      comando: `curl.exe -L ${ORIGEM}/OllamaSetup.exe -o "%TEMP%\\OllamaSetup.exe" && "%TEMP%\\OllamaSetup.exe"`,
      explicacao:
        'Abra o Prompt de Comando (tecla Windows, digite "cmd"), cole a linha acima e aperte Enter. Ela baixa o instalador oficial e abre a janela de instalação: é só ir clicando em avançar. Quando terminar, volte aqui.'
    };
  }
  if (platform() === 'linux') {
    return {
      comando: 'curl -fsSL https://ollama.com/install.sh -o ollama-install.sh && sh ollama-install.sh',
      explicacao:
        'Abra o terminal, cole a linha acima e aperte Enter. Ela baixa o script oficial de instalação num arquivo — dá pra abrir e ler antes de rodar — e executa. Esse script instala no sistema todo e vai pedir a sua senha. Quando terminar, volte aqui.'
    };
  }
  return {
    comando: 'https://ollama.com/download',
    explicacao:
      'Abra esse endereço no navegador, baixe o Ollama para o seu sistema e instale. Quando terminar, volte aqui.'
  };
}
