// Backup e restauração: o zip escrito à mão tem que ser legível pelo leitor
// que já existe, e a restauração não pode aceitar arquivo estranho.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const backup = await import('../server/backup.mjs');
const { DATA_DIR, DB_PATH, UPLOAD_DIR, CONFIG_PATH } = await import('../server/config.mjs');
const { run, all, one, uid, now } = await import('../server/db.mjs');
const { addMemory, listMemories } = await import('../server/memory.mjs');
const pendente = await import('../server/pending-restore.mjs');

after(() => home.cleanup());

test('zip escrito à mão volta idêntico pelo próprio leitor', () => {
  const conteudo = Buffer.from('linha um\nlinha dois\n'.repeat(500));
  const binario = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256));
  const arquivo = backup.zip([
    { name: 'texto.txt', data: conteudo },
    { name: 'uploads/coisa.bin', data: binario },
    { name: 'vazio.txt', data: Buffer.alloc(0) }
  ]);

  const lido = backup.unzip(arquivo);
  assert.deepEqual(lido.get('texto.txt'), conteudo);
  assert.deepEqual(lido.get('uploads/coisa.bin'), binario);
  assert.equal(lido.get('vazio.txt').length, 0);
  assert.ok(arquivo.length < conteudo.length, 'texto repetitivo tinha que comprimir');
});

test('o zip abre no descompactador do sistema', () => {
  const arquivo = backup.zip([{ name: 'oi.txt', data: Buffer.from('conteúdo com acento') }]);
  const caminho = join(DATA_DIR, 'teste-unzip.zip');
  writeFileSync(caminho, arquivo);
  // Se o `unzip` do sistema não existir, o teste não tem o que provar.
  let saida;
  try {
    saida = execFileSync('unzip', ['-p', caminho, 'oi.txt'], { encoding: 'utf8' });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  assert.equal(saida, 'conteúdo com acento');
});

test('backup leva banco, config e anexos', () => {
  addMemory({ text: 'Fato que precisa sobreviver ao backup.', kind: 'fact' });
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(join(UPLOAD_DIR, 'anexo.txt'), 'conteúdo do anexo');
  writeFileSync(CONFIG_PATH, JSON.stringify({ port: 4321 }));

  const { buffer } = backup.createBackup();
  const dentro = backup.unzip(buffer);

  assert.ok(dentro.has('data.db'));
  assert.ok(dentro.has('config.json'));
  assert.ok(dentro.has('uploads/anexo.txt'));
  assert.equal(dentro.get('uploads/anexo.txt').toString(), 'conteúdo do anexo');

  const manifest = JSON.parse(dentro.get('manifest.json').toString());
  assert.equal(manifest.signature, 'nuvo-backup');
  assert.equal(dentro.get('data.db').toString('utf8', 0, 15), 'SQLite format 3');
});

test('o banco do backup contém o que foi gravado até o momento da cópia', async () => {
  await addMemory({ text: 'Marco temporal do backup: pinguim de geladeira.', kind: 'fact' });
  const { buffer } = backup.createBackup();

  // Abre a cópia num banco separado e procura o fato lá dentro.
  const solto = join(DATA_DIR, 'copia.db');
  writeFileSync(solto, backup.unzip(buffer).get('data.db'));
  const { DatabaseSync } = await import('node:sqlite');
  const outro = new DatabaseSync(solto);
  const achado = outro
    .prepare('SELECT text FROM memories WHERE text LIKE ?')
    .get('%pinguim de geladeira%');
  outro.close();
  assert.ok(achado, 'o VACUUM INTO tinha que ter levado o WAL junto');
});

test('restauração recusa zip que não é backup', () => {
  const estranho = backup.zip([{ name: 'qualquer.txt', data: Buffer.from('nada a ver') }]);
  assert.throws(() => backup.restoreBackup(estranho), /não é um backup/);
});

test('restauração recusa arquivo que nem zip é', () => {
  assert.throws(() => backup.restoreBackup(Buffer.from('isso aqui é um txt')), /não parece um arquivo zip/);
});

test('restauração recusa backup com banco corrompido', () => {
  const ruim = backup.zip([
    {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify({ signature: 'nuvo-backup', version: 1 }))
    },
    { name: 'data.db', data: Buffer.from('não sou um banco') }
  ]);
  assert.throws(() => backup.restoreBackup(ruim), /faltando ou corrompido/);
});

test('restauração não toca no banco em uso, e a troca só vale no start seguinte', () => {
  const { STAGED_PATH, PREVIOUS_PATH, applyPendingRestore } = pendente;
  const { buffer } = backup.createBackup();
  const antes = readFileSync(DB_PATH);

  const resultado = backup.restoreBackup(buffer);
  assert.equal(resultado.db, true);
  assert.ok(existsSync(STAGED_PATH), 'o banco restaurado tem que esperar num arquivo à parte');
  assert.deepEqual(
    readFileSync(DB_PATH),
    antes,
    'escrever por cima do banco aberto desfaz a restauração: a conexão devolve as páginas antigas'
  );

  // O que o start faz antes de abrir a conexão.
  const troca = applyPendingRestore();
  assert.equal(troca.applied, true);
  assert.equal(troca.previous, PREVIOUS_PATH);
  assert.deepEqual(readFileSync(PREVIOUS_PATH), antes, 'o banco de antes tem que ficar guardado');
  assert.ok(!existsSync(STAGED_PATH), 'o arquivo de espera some depois da troca');
  assert.ok(!existsSync(`${DB_PATH}-wal`), 'o WAL antigo não pode sobrar apontando pro banco novo');

  // Sem restauração pendente, o start não mexe em nada.
  const semNada = applyPendingRestore();
  assert.equal(semNada.applied, false);
});

test('backup gravado pela versão anterior ainda restaura', () => {
  // A assinatura dentro do manifest levava o nome antigo do app. Recusá-la
  // transformaria a cópia de segurança de quem atualizou em lixo — justamente
  // no dia em que ela seria usada.
  const dentro = backup.unzip(backup.createBackup().buffer);
  const entradas = [...dentro].map(([name, data]) =>
    name === 'manifest.json'
      ? { name, data: Buffer.from(JSON.stringify({ ...JSON.parse(data.toString()), signature: 'iaunifier-backup' })) }
      : { name, data }
  );

  const resultado = backup.restoreBackup(backup.zip(entradas));
  assert.equal(resultado.db, true);
  pendente.applyPendingRestore();
});

test('restauração não escreve fora da pasta de anexos', () => {
  const malicioso = backup.zip([
    {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify({ signature: 'nuvo-backup', version: 1 }))
    },
    { name: 'data.db', data: readFileSync(DB_PATH) },
    { name: 'uploads/../../../fora.txt', data: Buffer.from('escapei') }
  ]);
  const resultado = backup.restoreBackup(malicioso);
  assert.equal(resultado.uploads, 1);
  assert.ok(existsSync(join(UPLOAD_DIR, 'fora.txt')), 'o caminho tinha que ter sido achatado');
  assert.ok(!existsSync(join(DATA_DIR, '..', '..', '..', 'fora.txt')));
});

test('backup automático roda uma vez por dia e guarda sete', () => {
  const dia = 24 * 60 * 60 * 1000;
  const inicio = Date.UTC(2026, 0, 1);

  const primeiro = backup.autoBackup({ now: inicio });
  assert.equal(primeiro.skipped, false);

  const segundo = backup.autoBackup({ now: inicio + 60_000 });
  assert.equal(segundo.skipped, true, 'não faz dois no mesmo dia');

  // Nove dias seguidos: sobram os sete últimos.
  for (let i = 1; i <= 9; i++) {
    const feito = backup.autoBackup({ now: inicio + i * dia });
    assert.equal(feito.skipped, false, `dia ${i} tinha que gerar cópia`);
  }
  const guardados = backup.listBackups();
  assert.equal(guardados.length, 7);
  assert.ok(guardados[0].bytes > 0);
});

test('zip que abre gigante é recusado em vez de derrubar o processo', () => {
  // 64 MB de zeros comprimem pra alguns kB. Sem teto, o `inflate` aloca tudo
  // antes de qualquer validação — e num app que aceita zip do usuário isso é
  // uma queda garantida.
  const bomba = backup.zip([
    {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify({ signature: 'nuvo-backup', version: 1 }))
    },
    { name: 'data.db', data: Buffer.alloc(600 * 1024 * 1024) }
  ]);
  assert.ok(bomba.length < 2 * 1024 * 1024, 'o zip da bomba tem que ser pequeno');
  assert.throws(() => backup.restoreBackup(bomba));
});

test('backup e config restaurado nascem legíveis só pelo dono', () => {
  // Os dois carregam o config.json inteiro, com as chaves de API dentro. Em
  // máquina compartilhada, 644 é o mesmo que publicar as chaves.
  if (process.platform === 'win32') return;

  const feito = backup.autoBackup({ now: Date.UTC(2030, 0, 1) });
  const modo = statSync(join(feito.dir, feito.name)).mode & 0o777;
  assert.equal(modo.toString(8), '600', `o zip do backup nasceu ${modo.toString(8)}`);

  const pasta = statSync(DATA_DIR).mode & 0o777;
  assert.equal(pasta.toString(8), '700', `a pasta de dados está ${pasta.toString(8)}`);
});

test('backup com um byte trocado é recusado, não restaurado', () => {
  // A soma de verificação existe pra isto e estava sendo escrita sem nunca ser
  // lida: de 40 backups com um único byte alterado, 38 passavam, e o banco
  // encostado pra troca vinha malformado — `PRAGMA integrity_check` respondia
  // "database disk image is malformed". Pendrive, disco velho ou sincronização
  // de nuvem bastam pra produzir esse byte.
  for (let i = 0; i < 20; i++) {
    addMemory({ text: `memória número ${i} com texto suficiente pra ocupar página`, kind: 'fact' });
  }
  const bom = backup.createBackup().buffer;

  let aceitos = 0;
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const estragado = Buffer.from(bom);
    estragado[400 + Math.floor(((estragado.length - 900) * tentativa) / 20)] ^= 0xff;
    try {
      backup.restoreBackup(estragado);
      aceitos += 1;
    } catch {
      /* recusado, que é o esperado */
    }
  }
  assert.equal(aceitos, 0, `${aceitos} backups corrompidos passariam`);
  // E o backup íntegro continua entrando.
  assert.equal(backup.restoreBackup(bom).db, true);
});

test('zip forjado apontando pra fora de si mesmo dá erro legível', () => {
  // Sem conferir os deslocamentos, `readUInt16LE` num ponteiro absurdo sobe um
  // RangeError sobre "memória fora do buffer" — que o usuário lê no lugar de
  // "esse arquivo não presta".
  const bom = backup.createBackup().buffer;
  const forjado = Buffer.from(bom);
  let fim = -1;
  for (let i = forjado.length - 22; i >= 0; i--) {
    if (forjado.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  forjado.writeUInt32LE(0x7ffffff0, forjado.readUInt32LE(fim + 16) + 42);
  assert.throws(() => backup.restoreBackup(forjado), (err) => {
    assert.ok(!(err instanceof RangeError), `vazou RangeError: ${err.message}`);
    assert.match(err.message, /zip|backup/i);
    return true;
  });
});

test('banco quebrado dentro de zip íntegro não toma o lugar do que funciona', () => {
  // O zip pode estar perfeito e o banco lá dentro não: veio de outra máquina,
  // de versão antiga, de disco que já tinha defeito quando o backup foi feito.
  // O cabeçalho "SQLite format 3" continua lá, então só o próprio SQLite
  // responde — e responde com o arquivo ainda de lado.
  const arquivos = backup.unzip(backup.createBackup().buffer);
  const banco = Buffer.from(arquivos.get('data.db'));
  // Logo depois dos 100 bytes de cabeçalho começa a página 1, que guarda o
  // esquema. Corromper ali sempre quebra o `integrity_check` e deixa o
  // "SQLite format 3" no lugar, que é o ponto do teste. Mirar no meio do arquivo
  // dependia do tamanho do banco: com tabelas novas o meio caiu numa página
  // vazia e o arquivo continuou íntegro.
  for (let i = 100; i < 700 && i < banco.length; i++) banco[i] ^= 0xa5;

  const refeito = backup.zip([
    { name: 'manifest.json', data: arquivos.get('manifest.json') },
    { name: 'data.db', data: banco }
  ]);

  assert.throws(() => backup.restoreBackup(refeito), /não abre/);
  assert.equal(existsSync(`${pendente.STAGED_PATH}.conferindo`), false, 'sobrou arquivo de conferência');
});
