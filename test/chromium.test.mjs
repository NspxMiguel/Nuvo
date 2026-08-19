// O Chromium próprio: mapeamento de plataforma, escolha da URL, progresso e
// cancelamento. Nada aqui sai pra rede — o índice de versões e os 185 MB do
// navegador são os dois encenados por um zip de três entradas, montado aqui
// mesmo. A descompactação, essa é de verdade: é o ponto que quebra o .app.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import { useTempHome, stubFetch, collect } from './helpers.mjs';

const home = useTempHome();
const {
  plataformaDaMaquina,
  versaoDisponivel,
  baixarChromium,
  chromiumBaixado,
  ferramentaDeDescompactar,
  PASTA
} = await import('../server/chromium.mjs');
const { unzip } = await import('../server/backup.mjs');

after(() => home.cleanup());

const INDICE = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const BASE = 'https://storage.googleapis.com/chrome-for-testing-public/999.0.0.0';

/** O índice como o Google publica, reduzido ao que este módulo lê. */
const indice = {
  channels: {
    Stable: {
      version: '999.0.0.0',
      downloads: {
        chrome: [
          { platform: 'linux64', url: `${BASE}/linux64/chrome-linux64.zip` },
          { platform: 'mac-arm64', url: `${BASE}/mac-arm64/chrome-mac-arm64.zip` },
          { platform: 'mac-x64', url: `${BASE}/mac-x64/chrome-mac-x64.zip` },
          { platform: 'win32', url: `${BASE}/win32/chrome-win32.zip` },
          { platform: 'win64', url: `${BASE}/win64/chrome-win64.zip` }
        ]
      }
    },
    Canary: { version: '1000.0.0.0', downloads: { chrome: [{ platform: 'mac-arm64', url: 'canary.zip' }] } }
  }
};

// ------------------------------------------------------------------ plataforma

test('cada máquina cai no nome que o Chrome for Testing usa', () => {
  assert.equal(plataformaDaMaquina('darwin', 'arm64'), 'mac-arm64');
  assert.equal(plataformaDaMaquina('darwin', 'x64'), 'mac-x64');
  assert.equal(plataformaDaMaquina('linux', 'x64'), 'linux64');
  assert.equal(plataformaDaMaquina('win32', 'x64'), 'win64');
  assert.equal(plataformaDaMaquina('win32', 'ia32'), 'win32');
  // Windows em ARM não tem build próprio e roda o x64 por emulação.
  assert.equal(plataformaDaMaquina('win32', 'arm64'), 'win64');
});

test('máquina sem build publicado devolve null em vez de um palpite', () => {
  // Estes são os casos que o download não resolve: baixar 185 MB de x86 pra um
  // Raspberry Pi seria pior do que dizer que não dá.
  assert.equal(plataformaDaMaquina('linux', 'arm64'), null);
  assert.equal(plataformaDaMaquina('darwin', 'ppc'), null);
  assert.equal(plataformaDaMaquina('freebsd', 'x64'), null);
  assert.equal(plataformaDaMaquina('aix', 'ppc64'), null);
});

test('sem nada baixado, chromiumBaixado não inventa caminho', () => {
  assert.equal(chromiumBaixado(), null);
});

// ---------------------------------------------------------------- versão/URL

/** Responde só o que este módulo tem motivo pra pedir; o resto é erro. */
function encenar({ tamanho = 12345, corpoDoIndice = indice, statusDoIndice = 200 } = {}) {
  return stubFetch(async (url, options) => {
    if (url === INDICE) {
      return {
        ok: statusDoIndice < 400,
        status: statusDoIndice,
        headers: { get: () => null },
        async json() {
          return corpoDoIndice;
        }
      };
    }
    if (url.startsWith(BASE) && options?.method === 'HEAD') {
      return { ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(tamanho) : null) } };
    }
    throw new Error(`o teste não esperava um pedido pra ${url}`);
  });
}

test('a URL sai do canal Stable, na plataforma pedida', async () => {
  const stub = encenar();
  try {
    const linux = await versaoDisponivel({ plataforma: 'linux64' });
    assert.equal(linux.versao, '999.0.0.0');
    assert.equal(linux.url, `${BASE}/linux64/chrome-linux64.zip`);
    assert.equal(linux.bytes, 12345);

    const mac = await versaoDisponivel({ plataforma: 'mac-arm64' });
    assert.equal(mac.url, `${BASE}/mac-arm64/chrome-mac-arm64.zip`);
    // O Canary tem versão mais alta e apareceria primeiro numa leitura
    // descuidada do JSON; o agente precisa do navegador estável.
    assert.notEqual(mac.versao, '1000.0.0.0');
  } finally {
    stub.restore();
  }
});

test('o índice lido é o de 9 kB, nunca o histórico de 4,9 MB', async () => {
  const stub = encenar();
  try {
    await versaoDisponivel({ plataforma: 'win64' });
    const pedidos = stub.calls.map((c) => c.url);
    assert.ok(pedidos.includes(INDICE), 'tinha que ler o last-known-good');
    // O nome do arquivo pesado é o do leve sem o "last-": a barra antes de
    // "known-good" é o que separa um do outro.
    assert.ok(
      !pedidos.some((u) => /\/known-good-versions/.test(u)),
      'o histórico completo pesa 4,9 MB e não pode ser baixado'
    );
    // O HEAD é o que permite mostrar o tamanho antes de a pessoa decidir.
    assert.equal(stub.calls.filter((c) => c.options?.method === 'HEAD').length, 1);
  } finally {
    stub.restore();
  }
});

test('plataforma fora do índice é erro com nome, não download errado', async () => {
  const stub = encenar();
  try {
    await assert.rejects(() => versaoDisponivel({ plataforma: 'linux-arm64' }), /linux-arm64/);
  } finally {
    stub.restore();
  }
});

test('índice fora do ar vira mensagem legível', async () => {
  const stub = encenar({ statusDoIndice: 503 });
  try {
    await assert.rejects(() => versaoDisponivel({ plataforma: 'linux64' }), /HTTP 503/);
  } finally {
    stub.restore();
  }
});

test('tamanho é opcional: HEAD recusado não impede baixar', async () => {
  const stub = stubFetch(async (url, options) => {
    if (options?.method === 'HEAD') throw new Error('HEAD bloqueado por proxy');
    return { ok: true, status: 200, headers: { get: () => null }, async json() { return indice; } };
  });
  try {
    const { bytes, url } = await versaoDisponivel({ plataforma: 'linux64' });
    assert.equal(bytes, undefined);
    assert.ok(url.endsWith('chrome-linux64.zip'));
  } finally {
    stub.restore();
  }
});

// -------------------------------------------------------------------- zip

/**
 * ZIP com os atributos externos preenchidos — bit de execução e link
 * simbólico. É o que o zip do Google traz e o que o `unzip()` de backup.mjs
 * joga fora; sem isso o teste da descompactação não provaria nada.
 */
function zipComAtributos(entradas) {
  const locais = [];
  const central = [];
  let offset = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.name, 'utf8');
    const corpo = Buffer.from(e.data);
    const soma = crc32(corpo);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // data qualquer, válida
    local.writeUInt32LE(soma, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(corpo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    locais.push(local, nome, corpo);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4); // origem unix: é o que dá sentido ao modo
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(soma, 16);
    dir.writeUInt32LE(corpo.length, 20);
    dir.writeUInt32LE(corpo.length, 24);
    dir.writeUInt16LE(nome.length, 28);
    dir.writeUInt32LE((e.mode >>> 0) * 65536, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nome);
    offset += 30 + nome.length + corpo.length;
  }
  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

/** O caminho do executável dentro do zip de cada plataforma. */
const RAIZ = {
  'mac-arm64': 'chrome-mac-arm64/Google Chrome for Testing.app',
  'mac-x64': 'chrome-mac-x64/Google Chrome for Testing.app',
  linux64: 'chrome-linux64',
  win32: 'chrome-win32',
  win64: 'chrome-win64'
};

const plataforma = plataformaDaMaquina();
const naMao = plataforma ? RAIZ[plataforma] : null;
const ehMac = String(plataforma).startsWith('mac');
const binarioNoZip = ehMac
  ? `${naMao}/Contents/MacOS/Google Chrome for Testing`
  : `${naMao}/${plataforma === 'linux64' ? 'chrome' : 'chrome.exe'}`;
const linkNoZip = ehMac ? `${naMao}/Contents/Frameworks/C.framework/Versions/Current` : null;

/** Um pacote minúsculo com a mesma anatomia do de verdade. */
function pacoteFalso({ enchimento = 0 } = {}) {
  const entradas = [
    { name: binarioNoZip, data: '#!/bin/sh\necho "Chromium 999.0.0.0"\n', mode: 0o100755 },
    { name: `${naMao}/LICENSE`, data: 'texto qualquer', mode: 0o100644 }
  ];
  // Peso de verdade: o WriteStream tem 64 kB de folga, e só um pacote grande
  // obriga o download a esperar por `drain` — é nessa espera que o defeito de
  // ouvintes acumulados aparece.
  if (enchimento) {
    entradas.push({ name: `${naMao}/enchimento.bin`, data: Buffer.alloc(enchimento, 0x61), mode: 0o100644 });
  }
  if (linkNoZip) {
    entradas.push({ name: `${naMao}/Contents/Frameworks/C.framework/Versions/A/oi`, data: 'x', mode: 0o100644 });
    entradas.push({ name: linkNoZip, data: 'A', mode: 0o120755 });
  }
  return zipComAtributos(entradas);
}

test('o unzip próprio do backup perde o bit de execução e o link — por isso ele não é usado aqui', {
  skip: !plataforma || !linkNoZip
}, () => {
  // Não é teste do backup: é a prova do motivo de `chromium.mjs` chamar a
  // ferramenta do sistema. O leitor de zip do app entrega bytes, e o .app do
  // macOS precisa de mais que bytes pra abrir.
  const arquivos = unzip(pacoteFalso());
  assert.ok(arquivos.has(binarioNoZip), 'os bytes ele lê');
  assert.equal(arquivos.get(linkNoZip).toString(), 'A');
  // O conteúdo do link é o alvo dele, "A" — vira um arquivo de um byte, e o
  // framework do Chromium fica sem `Versions/Current`.
  assert.equal(arquivos.get(linkNoZip).length, 1);
});

// ---------------------------------------------------------------- download

/** Resposta com corpo binário, fatiado pra a barra de progresso ter o que contar. */
function respostaBinaria(buffer, pedacos = 5, { declararTamanho = true } = {}) {
  const passo = Math.ceil(buffer.length / pedacos);
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (n) => (declararTamanho && n.toLowerCase() === 'content-length' ? String(buffer.length) : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (i >= buffer.length) return { done: true, value: undefined };
            const fatia = buffer.subarray(i, Math.min(i + passo, buffer.length));
            i += fatia.length;
            return { done: false, value: new Uint8Array(fatia) };
          },
          async cancel() {}
        };
      }
    }
  };
}

/** Índice + zip encenados; o zip é o pacote falso desta plataforma. */
function encenarDownload(zip, opcoes = {}) {
  return stubFetch(async (url, options) => {
    if (url === INDICE) {
      return { ok: true, status: 200, headers: { get: () => null }, async json() { return indice; } };
    }
    if (options?.method === 'HEAD') {
      return { ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(zip.length) : null) } };
    }
    return respostaBinaria(zip, opcoes.pedacos ?? 5, opcoes);
  });
}

// Sem a ferramenta do sistema não há o que testar: é justamente a máquina onde
// o módulo se recusa a começar, e ele diz isso antes de gastar o download.
let temFerramenta = true;
try {
  ferramentaDeDescompactar();
} catch {
  temFerramenta = false;
}
const podeBaixar = Boolean(plataforma) && temFerramenta;
// Skip mudo escondia que download, extração e cancelamento não rodaram — seis
// testes sumiam numa CI Linux enxuta sem ninguém notar. O motivo escrito sai no
// relatório do `node --test`.
const semDownload = podeBaixar
  ? false
  : plataforma
    ? 'FALTA A FERRAMENTA DE DESCOMPACTAR DO SISTEMA (instale `unzip`): download, extração e cancelamento NÃO foram exercitados'
    : `o Chrome for Testing não publica build pra ${process.platform}/${process.arch}: o caminho de download NÃO foi exercitado`;
// Trancar a pasta só funciona onde a permissão vale: root passa por cima dela e
// no Windows o chmod não é isso.
const semTrancaDePasta =
  process.platform === 'win32' || process.getuid?.() === 0
    ? 'não dá pra deixar a pasta só-leitura nesta máquina (Windows ou root)'
    : semDownload;

test('baixa, conta o progresso e entrega um executável que abre', { skip: semDownload }, async () => {
  const zip = pacoteFalso();
  const stub = encenarDownload(zip);
  try {
    const eventos = [];
    const gerador = baixarChromium({});
    let fim;
    for (;;) {
      const passo = await gerador.next();
      if (passo.done) {
        fim = passo.value;
        break;
      }
      eventos.push(passo.value);
    }

    const progresso = eventos.filter((e) => e.type === 'progresso');
    assert.ok(progresso.length >= 2, `a barra precisa de mais de um ponto (veio ${progresso.length})`);
    assert.equal(progresso.at(-1).pct, 100);
    assert.equal(progresso.at(-1).feito, zip.length);
    assert.equal(progresso.at(-1).total, zip.length);
    // Contador que anda pra trás é defeito visível na tela.
    for (let i = 1; i < progresso.length; i++) {
      assert.ok(progresso[i].feito >= progresso[i - 1].feito, 'o total baixado não pode diminuir');
      assert.ok(progresso[i].pct >= progresso[i - 1].pct);
    }

    const fases = eventos.filter((e) => e.type === 'phase').map((e) => e.text);
    assert.ok(fases.some((t) => /999\.0\.0\.0/.test(t)), `a versão tinha que aparecer numa fase: ${fases.join(' | ')}`);
    assert.ok(fases.some((t) => /descompactando/.test(t)));

    assert.equal(fim.ok, true);
    assert.equal(fim.aviso, undefined, 'o pacote falso responde a --version; aviso aqui é sinal de extração quebrada');
    assert.ok(existsSync(fim.binario), `o executável tinha que existir em ${fim.binario}`);
    assert.ok(fim.binario.startsWith(PASTA), 'o Chromium mora na pasta de dados do app, não solto no disco');
    if (ehMac) assert.match(fim.binario, /\.app\/Contents\/MacOS\//);

    // O que o `unzip()` de casa perderia: o bit de execução e o link do
    // framework. Os dois são o que separa um .app que abre de um que não abre.
    assert.equal(chromiumBaixado(), fim.binario);
    if (linkNoZip) {
      const link = join(PASTA, 'atual', linkNoZip);
      assert.ok(lstatSync(link).isSymbolicLink(), 'Versions/Current tem que continuar sendo link');
      assert.equal(readlinkSync(link), 'A');
    }

    // Nem o zip nem a pasta de trabalho ficam ocupando 185 MB depois do fim.
    const sobrou = readdirSync(PASTA);
    assert.ok(!sobrou.some((n) => n.endsWith('.zip') || n.endsWith('.parcial')), `sobrou lixo: ${sobrou.join(', ')}`);
    assert.ok(!sobrou.includes('novo'));
  } finally {
    stub.restore();
  }
});

test('sem content-length a barra continua andando, só sem porcentagem', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  const zip = pacoteFalso();
  const stub = encenarDownload(zip, { declararTamanho: false });
  try {
    // O HEAD é o único que sabe o tamanho aqui; sem ele o total é zero e o
    // download não pode travar por causa disso.
    const eventos = await collect(baixarChromium({}));
    const progresso = eventos.filter((e) => e.type === 'progresso');
    assert.ok(progresso.length >= 1);
    assert.equal(progresso.at(-1).feito, zip.length);
    assert.ok(chromiumBaixado(), 'mesmo sem tamanho declarado, o Chromium tinha que ficar pronto');
  } finally {
    stub.restore();
  }
});

test('download cancelado no meio para e não deixa arquivo parcial', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  const zip = pacoteFalso();
  const stub = encenarDownload(zip, { pedacos: 40 });
  const ctrl = new AbortController();
  try {
    const gerador = baixarChromium({ signal: ctrl.signal });
    await assert.rejects(async () => {
      for await (const evento of gerador) {
        // No primeiro sinal de progresso o usuário desiste — é a hora em que o
        // botão "cancelar" aparece na tela de verdade.
        if (evento.type === 'progresso') ctrl.abort();
      }
    }, /cancelad/i);

    assert.equal(chromiumBaixado(), null, 'download cancelado não vira Chromium instalado');
    const sobrou = existsSync(PASTA) ? readdirSync(PASTA) : [];
    assert.ok(!sobrou.some((n) => n.includes('.parcial') || n.endsWith('.zip')), `sobrou lixo: ${sobrou.join(', ')}`);
  } finally {
    stub.restore();
  }
});

test('cancelado antes de começar não chega a pedir nada pra rede', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  const stub = encenarDownload(pacoteFalso());
  const ctrl = new AbortController();
  ctrl.abort();
  try {
    await assert.rejects(() => collect(baixarChromium({ signal: ctrl.signal })), /cancelad/i);
    assert.equal(stub.calls.length, 0, 'já cancelado, nem o índice de versões deve ser buscado');
  } finally {
    stub.restore();
  }
});

test('zip sem o executável dentro é erro, não sucesso silencioso', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  const zip = zipComAtributos([{ name: `${naMao}/LEIA-ME`, data: 'só isso', mode: 0o100644 }]);
  const stub = encenarDownload(zip);
  try {
    await assert.rejects(() => collect(baixarChromium({})), /executável/i);
    assert.equal(chromiumBaixado(), null);
  } finally {
    stub.restore();
  }
});

test('a ferramenta de descompactar é escolhida por sistema, e a falta dela é dita', () => {
  // As sondas entram por parâmetro: a versão anterior chamava
  // `ferramentaDeDescompactar('darwin')` com a sonda de disco de verdade e o
  // `npm test` inteiro ficava vermelho em Linux e Windows, onde não há `ditto`.
  const nada = { achar: () => null, existe: () => false };
  const tudo = { achar: (nome) => `/usr/bin/${nome}`, existe: () => true };

  const ditto = ferramentaDeDescompactar('darwin', tudo);
  assert.equal(ditto.nome, 'ditto');
  assert.deepEqual(ditto.args('/a.zip', '/fora'), ['-x', '-k', '/a.zip', '/fora']);
  assert.throws(() => ferramentaDeDescompactar('darwin', nada), /ditto/);

  const unzip = ferramentaDeDescompactar('linux', tudo);
  assert.equal(unzip.nome, 'unzip');
  assert.deepEqual(unzip.args('/a.zip', '/fora'), ['-q', '-o', '/a.zip', '-d', '/fora']);
  assert.throws(() => ferramentaDeDescompactar('linux', nada), /unzip/);

  assert.throws(() => ferramentaDeDescompactar('sunos'), /sunos/);

  // PATH vazio é o que um serviço do sistema mal herdado entrega. No Unix o
  // extrator ainda tem que ser achado — é pra isso que existe a lista de
  // caminhos absolutos. No Windows não há lista dessas, e aí o que se cobra é
  // a mensagem: "falta o tar" em vez de "spawn ENOENT".
  const semPath = { achar: () => null, existe: (caminho) => ['/usr/bin/ditto', '/usr/bin/unzip', '/bin/unzip'].includes(caminho) };
  for (const so of ['darwin', 'linux']) {
    const achada = ferramentaDeDescompactar(so, semPath);
    assert.ok(achada.programa.startsWith('/'), `${so} tinha que cair no caminho absoluto: ${achada.programa}`);
  }

  // No Windows o tar do sistema é o primeiro; o PowerShell é o plano B, e sem
  // nenhum dos dois a mensagem tem que dizer o que falta.
  const soTar = ferramentaDeDescompactar('win32', { achar: (nome) => (nome === 'tar' ? 'C:\\Windows\\tar.exe' : null), existe: () => false });
  assert.equal(soTar.nome, 'tar');
  const soPosh = ferramentaDeDescompactar('win32', { achar: (nome) => (nome === 'powershell' ? 'C:\\posh.exe' : null), existe: () => false });
  assert.equal(soPosh.nome, 'Expand-Archive');
  assert.throws(() => ferramentaDeDescompactar('win32', nada), /tar|PowerShell/);
});

// -------------------------------------------------- defeitos que já morderam

test('download longo não vaza ouvinte de erro no arquivo', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  // 4 MB em pedaços de 128 kB: cada pedaço estoura os 64 kB do WriteStream e
  // obriga uma espera por `drain`. São ~32 esperas — o triplo do limite de
  // ouvintes do Node, que é onde o aviso de vazamento aparecia. O zip de alguns
  // kB dos outros testes nunca chega a esperar.
  const zip = pacoteFalso({ enchimento: 4 * 1024 * 1024 });
  const stub = encenarDownload(zip, { pedacos: Math.ceil(zip.length / (128 * 1024)) });
  const avisos = [];
  const anotar = (aviso) => avisos.push(aviso);
  process.on('warning', anotar);
  try {
    const eventos = await collect(baixarChromium({}));
    assert.ok(
      eventos.filter((e) => e.type === 'progresso').length >= 10,
      'o teste só prova algo se o download for longo o bastante pra esperar por drain'
    );
    // O aviso do Node sai num tick próprio.
    await new Promise((ok) => setImmediate(ok));
    const vazou = avisos.filter((a) => a.name === 'MaxListenersExceededWarning');
    assert.deepEqual(vazou.map((a) => a.message), [], 'cada espera por drain tem que soltar o ouvinte de erro que registrou');
    assert.ok(chromiumBaixado(), 'e o download tinha que terminar de pé');
  } finally {
    process.off('warning', anotar);
    stub.restore();
  }
});

/** AbortError igual ao do fetch: nome certo, mensagem em inglês. */
function erroDeAbort() {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Corpo que se comporta como o do fetch de verdade: o `read()` fica pendente e
 * rejeita com AbortError quando o sinal aborta.
 *
 * `aoPendurar` é chamado com o `read()` já pendurado — é dali que o teste
 * dispara o cancelamento, que é a única hora em que ele acontece na produção
 * (o cliente do SSE some no meio de uma leitura). Leitor que responde na hora
 * devolve o controle antes disso e faz o laço notar o sinal sozinho, exercitando
 * um caminho que o download de verdade quase nunca toma.
 */
function respostaQueRejeitaNoAbort(buffer, pedacos, signal, aoPendurar = () => {}) {
  const passo = Math.ceil(buffer.length / pedacos);
  let i = 0;
  let leituras = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(buffer.length) : null) },
    body: {
      getReader() {
        return {
          read() {
            return new Promise((ok, erro) => {
              if (signal?.aborted) return erro(erroDeAbort());
              if (i >= buffer.length) return ok({ done: true, value: undefined });
              const aoAbortar = () => {
                clearTimeout(relogio);
                erro(erroDeAbort());
              };
              const relogio = setTimeout(() => {
                signal?.removeEventListener('abort', aoAbortar);
                const fatia = buffer.subarray(i, Math.min(i + passo, buffer.length));
                i += fatia.length;
                ok({ done: false, value: new Uint8Array(fatia) });
              }, 2);
              signal?.addEventListener('abort', aoAbortar, { once: true });
              aoPendurar(++leituras);
            });
          },
          async cancel() {}
        };
      }
    }
  };
}

test('cancelar no meio fala português mesmo quando quem rejeita é o fetch', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  const zip = pacoteFalso();
  const ctrl = new AbortController();
  const stub = stubFetch(async (url, options) => {
    if (url === INDICE) {
      return { ok: true, status: 200, headers: { get: () => null }, async json() { return indice; } };
    }
    if (options?.method === 'HEAD') {
      return { ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(zip.length) : null) } };
    }
    // Cancela com a segunda leitura pendurada: um pedaço já andou (a barra
    // apareceu na tela) e o usuário aperta o botão.
    return respostaQueRejeitaNoAbort(zip, 40, options?.signal, (leitura) => {
      if (leitura === 2) ctrl.abort();
    });
  });
  try {
    await assert.rejects(
      async () => {
        for await (const evento of baixarChromium({ signal: ctrl.signal })) void evento;
      },
      (err) => {
        // O api.mjs manda `err.message` cru pra tela de um app todo em
        // português: "This operation was aborted" não pode chegar lá.
        assert.doesNotMatch(err.message, /abort/i, `mensagem em inglês chegando na tela: ${err.message}`);
        assert.match(err.message, /cancelad/i);
        return true;
      }
    );
    assert.equal(chromiumBaixado(), null, 'download cancelado não vira Chromium instalado');
    const sobrou = existsSync(PASTA) ? readdirSync(PASTA) : [];
    assert.ok(!sobrou.some((n) => n.includes('.parcial') || n.endsWith('.zip')), `sobrou lixo: ${sobrou.join(', ')}`);
  } finally {
    stub.restore();
  }
});

test('disco que recusa escrita vira erro de disco, não zip quebrado', { skip: semTrancaDePasta }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  mkdirSync(PASTA, { recursive: true });
  const zip = pacoteFalso();
  const stub = encenarDownload(zip);
  // Pendrive, volume só-leitura, --home em pasta protegida: o que o usuário vê
  // é isto aqui.
  chmodSync(PASTA, 0o500);
  const eventos = [];
  try {
    await assert.rejects(
      async () => {
        for await (const evento of baixarChromium({})) eventos.push(evento);
      },
      (err) => {
        assert.match(err.message, /gravar|EACCES|permission/i, `o erro tinha que ser o do disco: ${err.message}`);
        assert.doesNotMatch(err.message, /rename|ditto|unzip|tar/i, `erro de disco disfarçado de outra coisa: ${err.message}`);
        return true;
      }
    );
    assert.ok(
      !eventos.some((e) => e.type === 'progresso' && e.pct === 100),
      'a barra não pode chegar a 100% com o disco recusando cada byte'
    );
  } finally {
    chmodSync(PASTA, 0o700);
    stub.restore();
    rmSync(PASTA, { recursive: true, force: true });
  }
});

test('corpo que acaba antes da hora não pinta 100% na barra', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  const zip = pacoteFalso();
  const stub = stubFetch(async (url, options) => {
    if (url === INDICE) {
      return { ok: true, status: 200, headers: { get: () => null }, async json() { return indice; } };
    }
    if (options?.method === 'HEAD') {
      return { ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(zip.length) : null) } };
    }
    // Promete o zip inteiro e fecha na metade: é como o fetch entrega uma
    // conexão que caiu.
    const res = respostaBinaria(zip.subarray(0, Math.floor(zip.length / 2)), 2);
    res.headers = { get: (n) => (n.toLowerCase() === 'content-length' ? String(zip.length) : null) };
    return res;
  });
  const eventos = [];
  try {
    await assert.rejects(async () => {
      for await (const evento of baixarChromium({})) eventos.push(evento);
    }, /incompleto/);
    assert.ok(
      !eventos.some((e) => e.type === 'progresso' && e.pct === 100),
      '100% com metade do zip é mentira na tela'
    );
  } finally {
    stub.restore();
  }
});

test('gerador fechado por fora não deixa o .parcial no disco', { skip: semDownload }, async () => {
  rmSync(PASTA, { recursive: true, force: true });
  const zip = pacoteFalso({ enchimento: 512 * 1024 });
  const stub = encenarDownload(zip, { pedacos: 40 });
  try {
    // É o que acontece quando o cliente do SSE some: o `for await` do api.mjs
    // sai por `break` e o gerador é fechado sem erro nenhum — conclusão que o
    // `catch` não vê.
    for await (const evento of baixarChromium({})) {
      if (evento.type === 'progresso') break;
    }
    const sobrou = existsSync(PASTA) ? readdirSync(PASTA) : [];
    assert.ok(!sobrou.some((n) => n.includes('.parcial')), `sobrou lixo: ${sobrou.join(', ')}`);
  } finally {
    stub.restore();
  }
});

test('marca com `..` no caminho não vira Chromium instalado', {
  skip: process.platform === 'win32' ? 'o /bin/sh desta prova é de Unix' : false
}, () => {
  rmSync(PASTA, { recursive: true, force: true });
  mkdirSync(join(PASTA, 'atual'), { recursive: true });
  // Sem normalizar, `startsWith(INSTALADO + sep)` aceita qualquer coisa que
  // comece com a pasta do app — inclusive o /bin/sh alcançado por `..`.
  const fuga = join(PASTA, 'atual') + sep + '..'.concat(sep).repeat(12) + 'bin/sh';
  writeFileSync(join(PASTA, 'versao.json'), JSON.stringify({ binario: fuga }));
  try {
    assert.equal(chromiumBaixado(), null, `caminho de fora da pasta do app virou executável do Chromium: ${fuga}`);
  } finally {
    rmSync(PASTA, { recursive: true, force: true });
  }
});
