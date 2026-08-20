// Gera o executável único do Nuvo para macOS, Linux e Windows.
//
// O caminho é o SEA do próprio Node: junta o código num arquivo CommonJS,
// transforma em blob e injeta esse blob dentro do binário oficial do Node de
// cada plataforma. Quem baixa não precisa ter Node instalado.
//
// Compilar para outra plataforma não exige estar nela: o binário oficial do
// alvo é baixado e a injeção é feita aqui. O que NÃO dá pra fazer de fora é
// assinar — o executável de macOS é assinado ad-hoc (roda, mas o Gatekeeper
// avisa na primeira abertura) e o de Windows sai sem assinatura.

import { execFileSync } from 'node:child_process';
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
  readdirSync, statSync, copyFileSync, createWriteStream, chmodSync
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { montarAppMac } from './app-mac.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SAIDA = join(RAIZ, 'build', 'out');
const DIST = join(RAIZ, 'build', 'dist');
const CACHE = join(RAIZ, 'build', 'node-cache');
const VERSAO_NODE = process.versions.node;

const ALVOS = [
  { id: 'macos-arm64',   plataforma: 'darwin', arco: 'arm64', nodeDir: `node-v${VERSAO_NODE}-darwin-arm64`, exe: '' },
  { id: 'macos-x64',     plataforma: 'darwin', arco: 'x64',   nodeDir: `node-v${VERSAO_NODE}-darwin-x64`,   exe: '' },
  { id: 'linux-x64',     plataforma: 'linux',  arco: 'x64',   nodeDir: `node-v${VERSAO_NODE}-linux-x64`,    exe: '' },
  { id: 'linux-arm64',   plataforma: 'linux',  arco: 'arm64', nodeDir: `node-v${VERSAO_NODE}-linux-arm64`,  exe: '' },
  { id: 'windows-x64',   plataforma: 'win32',  arco: 'x64',   nodeDir: `node-v${VERSAO_NODE}-win-x64`,      exe: '.exe' }
];

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: RAIZ, ...opts });

const shq = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', cwd: RAIZ, ...opts }).trim();

function versaoDoApp() {
  return JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version;
}

// --------------------------------------------------------------- 1. o código

function juntarCodigo() {
  mkdirSync(SAIDA, { recursive: true });
  const alvo = join(SAIDA, 'nuvo.cjs');
  sh('npx', [
    '--yes', 'esbuild', 'bin/nuvo.mjs',
    '--bundle', '--platform=node', '--format=cjs', `--target=node22`,
    `--outfile=${relative(RAIZ, alvo)}`, '--log-level=error'
  ]);
  return alvo;
}

// ------------------------------------------------------------ 2. a interface

/** Todo arquivo de web/ vira um recurso do binário, com a chave = caminho. */
function recursosDaWeb() {
  const web = join(RAIZ, 'web');
  const mapa = {};
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else mapa[relative(web, caminho).split('\\').join('/')] = caminho;
    }
  };
  andar(web);
  return mapa;
}

// ------------------------------------------------------------------ 3. o blob

// O Node do Homebrew vem com o SEA desligado na compilação ("Single executable
// application is disabled"). O binário oficial não — e é ele que tem que gerar
// o blob de qualquer jeito, pra a versão bater com a do executável final.
function nodeOficialDaMaquina() {
  const arco = process.arch === 'arm64' ? 'arm64' : 'x64';
  const alvo = ALVOS.find((a) => a.plataforma === process.platform && a.arco === arco);
  if (!alvo) throw new Error(`não tenho binário oficial de Node pra ${process.platform}/${arco}`);
  return baixarNode(alvo);
}

function gerarBlob(entrada) {
  const assets = recursosDaWeb();
  const config = {
    main: entrada,
    output: join(SAIDA, 'nuvo.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets
  };
  const arquivo = join(SAIDA, 'sea-config.json');
  writeFileSync(arquivo, JSON.stringify(config, null, 2));
  sh(nodeOficialDaMaquina(), ['--experimental-sea-config', arquivo]);
  return { blob: config.output, recursos: Object.keys(assets).length };
}

// -------------------------------------------------- 4. o Node de cada sistema

function baixarNode(alvo) {
  mkdirSync(CACHE, { recursive: true });
  const ext = alvo.plataforma === 'win32' ? 'zip' : 'tar.gz';
  const nome = `${alvo.nodeDir}.${ext}`;
  const pacote = join(CACHE, nome);
  const pasta = join(CACHE, alvo.nodeDir);
  const binario = alvo.plataforma === 'win32'
    ? join(pasta, 'node.exe')
    : join(pasta, 'bin', 'node');

  if (existsSync(binario)) return binario;

  const url = `https://nodejs.org/dist/v${VERSAO_NODE}/${nome}`;
  console.log(`  baixando ${nome}`);
  sh('curl', ['-fsSL', '-o', pacote, url]);
  if (ext === 'zip') sh('unzip', ['-q', '-o', pacote, '-d', CACHE]);
  else sh('tar', ['-xzf', pacote, '-C', CACHE]);
  if (!existsSync(binario)) throw new Error(`o pacote de ${alvo.id} não trouxe o binário esperado`);
  return binario;
}

// ---------------------------------------------------------------- 5. injeção

function injetar(alvo, blob) {
  const origem = baixarNode(alvo);
  mkdirSync(DIST, { recursive: true });
  const destino = join(SAIDA, `nuvo-${alvo.id}${alvo.exe}`);
  rmSync(destino, { force: true });
  copyFileSync(origem, destino);
  chmodSync(destino, 0o755);

  // macOS recusa binário com assinatura quebrada: tira a que veio do Node,
  // injeta, e assina ad-hoc de novo.
  if (alvo.plataforma === 'darwin') {
    try { sh('codesign', ['--remove-signature', destino], { stdio: 'ignore' }); } catch {}
  }

  const args = [
    '--yes', 'postject', destino, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  ];
  if (alvo.plataforma === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
  sh('npx', args);

  if (alvo.plataforma === 'darwin') {
    // Sem assinatura o macOS mata o processo na hora ("killed: 9"). A ad-hoc
    // faz rodar; o aviso do Gatekeeper na primeira abertura continua.
    sh('codesign', ['--sign', '-', '--force', '--timestamp=none', destino]);
  }
  return destino;
}

// -------------------------------------------------------------- 6. embalagem

function sha256(arquivo) {
  return createHash('sha256').update(readFileSync(arquivo)).digest('hex');
}

function embalar(alvo, binario, versao) {
  mkdirSync(DIST, { recursive: true });
  const base = `nuvo-${versao}-${alvo.id}`;

  // O arquivo dentro do pacote chama `nuvo`, não `nuvo-linux-x64`:
  // é o nome que as instruções mandam rodar.
  const tmp = join(SAIDA, 'embalar');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const nome = alvo.plataforma === 'win32' ? 'nuvo.exe' : 'nuvo';
  const dentro = join(tmp, nome);
  copyFileSync(binario, dentro);
  chmodSync(dentro, 0o755);

  if (alvo.plataforma === 'win32') {
    const zip = join(DIST, `${base}.zip`);
    rmSync(zip, { force: true });
    // `--sequesterRsrc` é o que enfia uma pasta `__MACOSX` no zip: sujeira de
    // Mac chegando na máquina de quem usa Windows. Aqui não há fork nem
    // atributo estendido pra guardar — o binário veio do Node oficial.
    sh('ditto', ['-c', '-k', '--norsrc', '--noextattr', tmp, zip]);
    rmSync(tmp, { recursive: true, force: true });
    return zip;
  }

  const tgz = join(DIST, `${base}.tar.gz`);
  rmSync(tgz, { force: true });

  // No macOS o que vai é o `.app`. Quem prefere terminal continua atendido: o
  // binário de linha de comando é o `Nuvo.app/Contents/Resources/nuvo` de
  // dentro dele — uma cópia só de 144 MB, não duas.
  if (alvo.plataforma === 'darwin') {
    montarAppMac(dentro, versao, tmp);
    rmSync(dentro, { force: true });
    sh('tar', ['-czf', tgz, '-C', tmp, 'Nuvo.app']);
  } else {
    sh('tar', ['-czf', tgz, '-C', tmp, 'nuvo']);
  }

  rmSync(tmp, { recursive: true, force: true });
  return tgz;
}

// ------------------------------------------------------------------ execução

const versao = versaoDoApp();
const somente = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const alvos = somente.length ? ALVOS.filter((a) => somente.includes(a.id)) : ALVOS;

console.log(`Nuvo ${versao} — empacotando com Node ${VERSAO_NODE}\n`);

console.log('1. juntando o código');
const entrada = juntarCodigo();
console.log(`   ${(statSync(entrada).size / 1024).toFixed(0)} kB\n`);

console.log('2. gerando o blob com a interface dentro');
const { blob, recursos } = gerarBlob(entrada);
console.log(`   ${recursos} arquivos de interface, blob de ${(statSync(blob).size / 1e6).toFixed(1)} MB\n`);

console.log('3. injetando em cada sistema');
const feitos = [];
for (const alvo of alvos) {
  console.log(`\n   ${alvo.id}`);
  const binario = injetar(alvo, blob);
  const pacote = embalar(alvo, binario, versao);
  feitos.push({
    alvo: alvo.id,
    binario,
    pacote,
    bytes: statSync(pacote).size,
    sha256: sha256(pacote)
  });
}

console.log('\n\npronto:\n');
for (const f of feitos) {
  console.log(`  ${f.alvo.padEnd(14)} ${(f.bytes / 1e6).toFixed(1).padStart(6)} MB  ${f.pacote.split('/').pop()}`);
}
writeFileSync(join(DIST, 'pacotes.json'), JSON.stringify({ versao, node: VERSAO_NODE, pacotes: feitos }, null, 2));

// O arquivo de somas vai junto na versão publicada, e o instalador de uma linha
// (`docs/instalar.sh`) lê ele antes de descompactar: download cortado no meio
// vira erro dito em português, e não um app que abre e fecha sem explicar.
//
// Só as somas dos pacotes desta rodada — escrever "todas as que existem em
// dist/" publicaria a soma de versões antigas que ficaram na pasta.
const somas = feitos.map((f) => `${f.sha256}  ${f.pacote.split('/').pop()}`).join('\n');
writeFileSync(join(DIST, 'SHA256SUMS.txt'), `${somas}\n`);

console.log(`\nresumo em ${join(DIST, 'pacotes.json')}`);
console.log(`somas em  ${join(DIST, 'SHA256SUMS.txt')}`);
