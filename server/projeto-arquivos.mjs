// Os arquivos da pasta do projeto, pro painel de programar.
//
// A pasta vem do campo `workdir`, que é um texto livre digitado por quem usa —
// ninguém confere nada na hora de salvar. Então nada aqui confia no caminho que
// chega: a varredura fica dentro da pasta, a leitura recusa o que sai dela, e
// as três funções tratam o disco como algo que some no meio do caminho.

import { execFile } from 'node:child_process';
import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { decodeText } from './extract.mjs';
import { erroTraduzivel } from './erro-traduzivel.mjs';

// Pasta que só guarda coisa gerada ou baixada. Sem esta lista, um projeto de
// Node comum entrega mais de 30 mil arquivos de `node_modules` e o limite da
// árvore estoura antes do primeiro arquivo que a pessoa escreveu aparecer.
const PASTAS_PULADAS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.venv', '__pycache__']);

// Acima disso não é código: é dump de banco, vídeo, modelo de IA. Entra na
// árvore só pra nunca poder ser aberto, então fica de fora dela.
const MAIOR_ARQUIVO = 2 * 1024 * 1024;

// O `git status` de um repositório grande demora; o painel não pode ficar
// pendurado esperando. Cinco segundos é folgado pro pior caso medido aqui
// (repositório com 12 mil arquivos responde em menos de 300 ms).
const PRAZO_GIT = 5000;

/** Ordem estável da lista, sem depender do idioma da máquina como o `localeCompare`. */
function porCaminho(a, b) {
  if (a.caminho < b.caminho) return -1;
  return a.caminho > b.caminho ? 1 : 0;
}

/**
 * O caminho relativo como a tela vai usar: sempre com barra pra frente.
 *
 * No Windows o `path.relative` devolve barra invertida, e a tela usa esse texto
 * como chave (do arquivo aberto, do estado no git). Foi exatamente assim que os
 * dicionários de idioma sumiram no servidor de estáticos: a chave gravada com
 * `\` nunca casava com a pedida com `/`.
 */
function chaveRelativa(base, alvo) {
  return relative(base, alvo).split(sep).join('/');
}

/** A raiz resolvida, ou erro em português dizendo o que houve com a pasta. */
function pastaValida(raiz) {
  const texto = String(raiz || '').trim();
  // Sem esta guarda, `resolve('')` devolve o diretório de onde o servidor foi
  // aberto — projeto sem pasta escolhida listaria os arquivos do próprio app.
  if (!texto) throw new Error('este projeto ainda não tem uma pasta escolhida');

  const base = resolve(texto);
  let info;
  try {
    info = statSync(base);
  } catch {
    throw erroTraduzivel('não achei a pasta {pasta} neste computador', { pasta: base });
  }
  if (!info.isDirectory()) throw erroTraduzivel('{pasta} não é uma pasta', { pasta: base });
  return base;
}

/**
 * Lista os arquivos da pasta do projeto.
 *
 * @returns {{raiz: string, arquivos: Array<{caminho: string, bytes: number, tipo: string}>, cortado: boolean}}
 */
export function arvoreDoProjeto(raiz, { limite = 2000 } = {}) {
  const base = pastaValida(raiz);
  const arquivos = [];
  let cortado = false;

  // Pilha em vez de recursão: pasta funda de verdade existe (o `.build` do
  // Swift passa de 40 níveis, e um link mal resolvido faz pior), e estouro de
  // pilha aqui derruba o servidor inteiro, não só a rota.
  const pilha = [base];
  while (pilha.length > 0 && !cortado) {
    const pasta = pilha.pop();
    let entradas;
    try {
      entradas = readdirSync(pasta, { withFileTypes: true });
    } catch {
      // Pasta sem permissão de leitura, ou apagada agora: uma pasta ilegível não
      // pode zerar a listagem do projeto inteiro.
      continue;
    }
    entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const subpastas = [];
    for (const entrada of entradas) {
      const caminho = resolve(pasta, entrada.name);

      if (entrada.isDirectory()) {
        // Qualquer pasta com ponto na frente fica de fora: `.git`, `.venv`,
        // `.next`, `.cache` — é histórico e cache, não é o projeto.
        if (entrada.name.startsWith('.') || PASTAS_PULADAS.has(entrada.name)) continue;
        subpastas.push(caminho);
        continue;
      }
      // `withFileTypes` usa lstat, então link simbólico não responde nem
      // `isFile` nem `isDirectory` — e é bom que fique fora: um link pra `/` ou
      // pra pasta de cima faz a varredura andar o disco inteiro em círculo.
      if (!entrada.isFile()) continue;

      let info;
      try {
        info = statSync(caminho);
      } catch {
        continue;
      }
      if (info.size > MAIOR_ARQUIVO) continue;

      // O corte é conferido aqui, na hora de guardar, e não no começo da volta:
      // assim `cortado` só fica verdadeiro quando um arquivo de verdade ficou de
      // fora — pasta vazia depois do limite não vira aviso de lista incompleta.
      if (arquivos.length >= limite) {
        cortado = true;
        break;
      }

      arquivos.push({
        caminho: chaveRelativa(base, caminho),
        bytes: info.size,
        // Minúscula porque a tela escolhe o ícone e o destaque de sintaxe por
        // aqui: `.JS` e `.js` são a mesma linguagem pra quem está olhando.
        tipo: extname(entrada.name).replace(/^\./, '').toLowerCase()
      });
    }

    // Empilhadas ao contrário pra sair em ordem alfabética no `pop`. Assim,
    // quando o limite corta, o pedaço que sobra é sempre o mesmo — e não o que
    // o disco entregou primeiro naquele dia.
    for (let i = subpastas.length - 1; i >= 0; i--) pilha.push(subpastas[i]);
  }

  arquivos.sort(porCaminho);
  return { raiz: base, arquivos, cortado };
}

/**
 * Só o começo do arquivo, sem carregar o resto.
 *
 * `readFileSync` traria um log de 300 MB inteiro pra memória do servidor só pra
 * devolver os primeiros 400 kB — e o processo é o mesmo que atende a conversa.
 */
function lerInicio(caminho, quantos) {
  if (quantos <= 0) return Buffer.alloc(0);
  const fd = openSync(caminho, 'r');
  try {
    const buffer = Buffer.alloc(quantos);
    const lidos = readSync(fd, buffer, 0, quantos, 0);
    return buffer.subarray(0, lidos);
  } finally {
    closeSync(fd);
  }
}

/**
 * Tira do fim os bytes de um caractere que ficou partido pelo corte.
 *
 * O `decodeText` decodifica com `fatal: true`: um "é" cortado no meio faz ele
 * desistir do UTF-8 e reler tudo como windows-1252, então o arquivo chega na
 * tela com TODOS os acentos trocados por causa de um byte no fim. Cortar até o
 * começo do caractere incompleto custa no máximo três bytes do fim.
 */
function semCaractereQuebrado(buffer) {
  const limite = Math.max(0, buffer.length - 4);
  for (let i = buffer.length - 1; i >= limite; i--) {
    const byte = buffer[i];
    if ((byte & 0b1100_0000) === 0b1000_0000) continue;
    const esperado = byte < 0x80 ? 1 : byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return i + esperado > buffer.length ? buffer.subarray(0, i) : buffer;
  }
  return buffer;
}

/**
 * Lê um arquivo de dentro da pasta do projeto.
 *
 * @returns {{caminho: string, texto: string, bytes: number, truncado: boolean, binario: boolean}}
 */
export function lerArquivoDoProjeto(raiz, relativo, { limiteBytes = 400_000 } = {}) {
  const base = pastaValida(raiz);
  // Os dois lados resolvidos ANTES de comparar. Sem normalizar, `docs/../../..`
  // passa por qualquer comparação de texto — é o mesmo defeito que deixou o
  // caminho do Chromium escapar da pasta do app. E comparar com `base + sep`,
  // não com `base` cru, impede que a pasta vizinha `/projeto-antigo` conte como
  // dentro de `/projeto`.
  const alvo = resolve(base, String(relativo || ''));
  if (!alvo.startsWith(base + sep)) throw new Error('esse arquivo está fora da pasta do projeto');

  let info;
  try {
    info = statSync(alvo);
  } catch {
    throw new Error('esse arquivo não existe na pasta do projeto');
  }
  if (!info.isFile()) throw new Error('esse caminho não é um arquivo');

  // O `resolve` acima é só texto: ele colapsa `..`, mas não sabe o que é link
  // simbólico. Com `ln -s /etc projeto/etc-link`, o caminho `etc-link/hosts`
  // passa na comparação e o `openSync` segue o link — a tela abria `/etc/hosts`
  // e abriria `~/.ssh` de um repositório clonado com link dentro. A checagem de
  // verdade é comparar os caminhos já resolvidos pelo sistema de arquivos.
  const real = realpathSync(alvo);
  if (real !== alvo && !real.startsWith(realpathSync(base) + sep)) {
    throw new Error('esse arquivo está fora da pasta do projeto');
  }

  const caminho = chaveRelativa(base, alvo);
  const bytes = info.size;
  const pedaco = lerInicio(alvo, Math.min(bytes, limiteBytes));

  // Byte zero nos primeiros 8 kB é o que separa binário de texto na prática (é
  // a mesma heurística que a leitura de anexo usa). Mandar os bytes crus pra
  // tela trava o navegador desenhando lixo que ninguém consegue ler.
  if (pedaco.subarray(0, 8192).includes(0)) {
    // `truncado` fica falso de propósito: não cortamos texto nenhum, o arquivo
    // inteiro foi recusado, e quem lê a resposta olha `binario` primeiro.
    return { caminho, texto: '', bytes, truncado: false, binario: true };
  }

  const truncado = bytes > pedaco.length;
  const { text } = decodeText(truncado ? semCaractereQuebrado(pedaco) : pedaco);
  return { caminho, texto: text, bytes, truncado, binario: false };
}

/** Roda o git sem shell, com prazo, e devolve a saída. */
function git(cwd, args, signal) {
  return new Promise((ok, erro) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        signal,
        timeout: PRAZO_GIT,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        // `git status` costuma reescrever o índice com o que acabou de conferir,
        // e isso disputa o `index.lock` com o git que a pessoa está rodando no
        // terminal ao lado. O painel só lê: nunca precisa gravar nada.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      },
      (err, stdout) => (err ? erro(err) : ok(String(stdout)))
    );
  });
}

/** Traduz um código XY do porcelain pro vocabulário da tela. */
function estadoDe(x, y) {
  if (x === '?') return 'novo';
  // Apagado é conferido antes de novo por causa do `AD`: arquivo que entrou no
  // índice e depois sumiu do disco. Quem olha a tela quer ver que ele não está lá.
  if (x === 'D' || y === 'D') return 'apagado';
  if (x === 'A') return 'novo';
  return 'mudou';
}

/**
 * Guarda o arquivo com o caminho relativo à pasta do projeto.
 *
 * O porcelain dá o caminho relativo à raiz do REPOSITÓRIO. Quando o projeto
 * aponta pra uma subpasta dele, o caminho cru não casa com nenhuma chave da
 * árvore, e a aba Mudanças marcaria arquivo nenhum.
 */
function juntar(lista, caminhoDoGit, estado, topo, base) {
  const absoluto = resolve(topo, caminhoDoGit);
  if (!absoluto.startsWith(base + sep)) return;
  lista.push({ caminho: chaveRelativa(base, absoluto), estado });
}

function traduzirStatus(saida, topo, base) {
  const arquivos = [];
  // `-z` separa por byte zero e desliga a citação de nome: sem ele, arquivo com
  // acento vem como "\303\251" entre aspas e vira uma chave que não existe.
  const campos = saida.split('\0').filter((campo) => campo !== '');

  for (let i = 0; i < campos.length; i++) {
    const campo = campos[i];
    if (campo.length < 4) continue;
    const x = campo[0];
    const y = campo[1];
    const caminho = campo.slice(3);

    if (x === 'R' || x === 'C') {
      // No `-z`, a origem do rename vem no campo seguinte. Renomear aparece
      // como as duas coisas que de fato aconteceram na pasta.
      const origem = campos[++i];
      if (x === 'R' && origem) juntar(arquivos, origem, 'apagado', topo, base);
      juntar(arquivos, caminho, 'novo', topo, base);
      continue;
    }
    juntar(arquivos, caminho, estadoDe(x, y), topo, base);
  }

  arquivos.sort(porCaminho);
  return arquivos;
}

/**
 * O que mudou na pasta do projeto, quando ela é um repositório git.
 *
 * Sem git não existe com o que comparar: "mudou desde quando?" só tem resposta
 * porque o repositório guarda a versão anterior de cada arquivo. Guardar uma
 * cópia de referência do lado do app pra fingir um diff seria escrever um
 * segundo git, pior — então a resposta honesta é `git: false`, e a tela diz que
 * essa pasta não tem controle de versão.
 *
 * @returns {Promise<{git: boolean, arquivos: Array<{caminho: string, estado: 'novo'|'mudou'|'apagado'}>, motivo?: string}>}
 */
export async function mudancasDoProjeto(raiz, { signal } = {}) {
  const semGit = { git: false, arquivos: [] };
  try {
    // `realpathSync` porque o git responde sempre com o caminho real: no macOS,
    // `/var/folders/...` é link pra `/private/var/folders/...`, e comparar o
    // caminho do git com o `workdir` cru descartava TODOS os arquivos por
    // "estão fora da pasta" — a aba Mudanças ficava vazia num repositório cheio.
    const base = realpathSync(pastaValida(raiz));
    const topo = resolve((await git(base, ['rev-parse', '--show-toplevel'], signal)).trim());
    // `--untracked-files=all` porque, no modo padrão, uma pasta nova inteira sai
    // como uma linha só (`web/`) e nenhum arquivo da árvore ficaria marcado.
    const saida = await git(base, ['status', '--porcelain', '-z', '--untracked-files=all'], signal);
    return { git: true, arquivos: traduzirStatus(saida, topo, base) };
  } catch (err) {
    // Tudo isso é "não tenho o que mostrar aqui", e nenhum deles pode derrubar
    // a rota. Mas eles não são a mesma coisa, e a tela dizia "esta pasta não é
    // um repositório do git" pros quatro: num repositório grande com
    // `node_modules` não ignorado o `git status` estoura o buffer de 4 MB, e o
    // painel afirmava, categórico, que um repositório git não era repositório.
    // O `motivo` deixa a tela dizer a verdade em cada caso.
    return { ...semGit, motivo: motivoDaFalhaDoGit(err) };
  }
}

/** Qual das falhas do git aconteceu — a tela escreve uma frase pra cada. */
function motivoDaFalhaDoGit(err) {
  const texto = `${err?.code || ''} ${err?.message || ''}`;
  if (err?.name === 'AbortError' || /aborted/i.test(texto)) return 'cancelado';
  if (/ETIMEDOUT|SIGTERM|SIGKILL/.test(texto)) return 'demorou';
  if (/MAXBUFFER/i.test(texto)) return 'grande-demais';
  if (err?.code === 'ENOENT') return 'sem-git';
  // O `git rev-parse` de uma pasta fora de repositório sai com código 128 e
  // esta frase; é o caso comum, e o único em que "não é um repositório" é
  // verdade.
  if (/not a git repository/i.test(texto)) return 'sem-repositorio';
  return 'falhou';
}
