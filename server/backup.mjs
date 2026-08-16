// Backup e restauração.
//
// Um arquivo .zip com tudo que importa: o banco (conversas, memória, gems,
// projetos, provedores), o config e os arquivos anexados. Sem dependência: o
// ZIP é escrito à mão, com `deflateRawSync` e `crc32` do próprio Node — o mesmo
// formato que o leitor de docx/pptx/epub já sabe abrir.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';
import { DATA_DIR, DB_PATH, CONFIG_PATH, UPLOAD_DIR } from './config.mjs';
import { STAGED_PATH, PREVIOUS_PATH } from './pending-restore.mjs';
import { db } from './db.mjs';

const SIGNATURE = 'iaunifier-backup';

// Teto de descompressão por entrada do zip, contra o arquivo pequeno que abre
// gigante. O banco inteiro de um uso caseiro cabe muito abaixo disso.
const MAX_INFLADO = 512 * 1024 * 1024;

// ------------------------------------------------------------------- escrita

/** Data no formato do MS-DOS, que é o que o cabeçalho do ZIP guarda. */
function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

/**
 * ZIP com deflate. Entradas em memória — o backup de uma instalação de casa
 * cabe folgado, e streaming aqui só complicaria o formato.
 * @param {Array<{name: string, data: Buffer}>} entries
 */
export function zip(entries, when = new Date()) {
  const { time, day } = dosTime(when);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.data;
    const deflated = deflateRawSync(raw, { level: 6 });
    // Arquivo já comprimido (jpg, pdf, zip) cresce ao deflatar: guarda cru.
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(stored ? 0 : 8, 8); // método
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // versão de origem
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + body.length;
  }

  const dirBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, dirBuffer, end]);
}

// ------------------------------------------------------------------- leitura

/** Lê o ZIP pelo diretório central — a única parte confiável do formato. */
export function unzip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66_000; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('não parece um arquivo zip');

  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pointer + 10);
    const compressed = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.subarray(start, start + compressed);
    // Teto por entrada: um zip de poucos kB pode abrir em centenas de MB, e a
    // restauração aceita arquivo de qualquer origem. Estourar aqui vira erro
    // tratado ("não deu pra restaurar"), não processo morto.
    files.set(
      name,
      method === 0 ? Buffer.from(body) : inflateRawSync(body, { maxOutputLength: MAX_INFLADO })
    );

    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// -------------------------------------------------------------------- backup

function uploads() {
  if (!existsSync(UPLOAD_DIR)) return [];
  return readdirSync(UPLOAD_DIR)
    .filter((name) => {
      try {
        return statSync(join(UPLOAD_DIR, name)).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => ({ name: `uploads/${name}`, data: readFileSync(join(UPLOAD_DIR, name)) }));
}

/**
 * Cópia completa, pronta pra guardar em outro lugar.
 *
 * O banco sai por `VACUUM INTO`, não por cópia do arquivo: com WAL ligado, o
 * `.db` sozinho pode estar desatualizado em relação ao que já foi gravado.
 */
export function createBackup() {
  const snapshot = join(DATA_DIR, `.backup-${process.pid}.db`);
  rmSync(snapshot, { force: true });
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);

  const entries = [
    {
      name: 'manifest.json',
      data: Buffer.from(
        JSON.stringify(
          {
            signature: SIGNATURE,
            version: 1,
            created_at: new Date().toISOString(),
            node: process.version
          },
          null,
          2
        )
      )
    },
    { name: 'data.db', data: readFileSync(snapshot) }
  ];
  if (existsSync(CONFIG_PATH)) entries.push({ name: 'config.json', data: readFileSync(CONFIG_PATH) });
  entries.push(...uploads());

  rmSync(snapshot, { force: true });
  return { buffer: zip(entries), files: entries.length };
}

/** Nome com data, pra não sobrescrever backup anterior por acidente. */
export function backupName(when = new Date()) {
  return `iaunifier-${when.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
}

/**
 * Data de um backup, lida do próprio nome.
 *
 * A data do arquivo no disco não serve: copiar a pasta pra outro computador,
 * restaurar de um pendrive ou sincronizar por nuvem carimba tudo com a hora de
 * agora, e aí o app acharia que acabou de fazer backup.
 */
export function backupDate(name) {
  const m = /^iaunifier-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.zip$/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`) || null;
}

// ---------------------------------------------------------------- restauração

/**
 * Prepara a restauração do conteúdo do backup.
 *
 * Anexos e configuração vão direto pro lugar; o banco fica em
 * `data.db.restaurar` e só toma o lugar do atual no próximo start, quando não
 * há conexão aberta pra desfazer a troca. O banco que estava valendo vai pra
 * `data.db.antes-da-restauracao` nessa hora, então o passo é reversível.
 *
 * @param {Buffer} buffer conteúdo do .zip
 * @param {{keepSecrets?: boolean}} options
 */
export function restoreBackup(buffer, { keepSecrets = false } = {}) {
  const files = unzip(buffer);

  const manifestRaw = files.get('manifest.json');
  if (!manifestRaw) throw new Error('esse zip não é um backup do IAUnifier (falta o manifest)');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw.toString('utf8'));
  } catch {
    throw new Error('o manifest do backup está corrompido');
  }
  if (manifest.signature !== SIGNATURE) {
    throw new Error('esse zip não é um backup do IAUnifier');
  }

  const database = files.get('data.db');
  if (!database || database.length < 512 || database.toString('utf8', 0, 15) !== 'SQLite format 3') {
    throw new Error('o banco dentro do backup está faltando ou corrompido');
  }

  const restored = { db: false, config: false, uploads: 0, previous: null };

  // Só depois de validar tudo é que o que está no disco é tocado.
  //
  // O banco vai pra um arquivo à parte, não por cima do que está em uso: a
  // conexão aberta neste processo ainda tem as páginas antigas em memória e as
  // escreveria de volta, desfazendo a restauração inteira em silêncio. A troca
  // acontece no próximo start, com o banco fechado.
  writeFileSync(STAGED_PATH, database);
  restored.db = true;
  restored.previous = existsSync(DB_PATH) ? PREVIOUS_PATH : null;

  const config = files.get('config.json');
  if (config && !keepSecrets) {
    writeFileSync(CONFIG_PATH, config);
    restored.config = true;
  }

  mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const [name, data] of files) {
    if (!name.startsWith('uploads/') || name.endsWith('/')) continue;
    // `basename` corta qualquer `../` que viesse num zip forjado.
    const safe = basename(name);
    if (!safe || safe.startsWith('.')) continue;
    writeFileSync(join(UPLOAD_DIR, safe), data);
    restored.uploads += 1;
  }

  return { ...restored, manifest };
}

// ------------------------------------------------------------- automático

const AUTO_DIR = join(DATA_DIR, 'backups');
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP = 7;

/**
 * Uma cópia por dia, sete dias guardados. Roda na subida do servidor: quem usa
 * em casa não vai configurar cron, e perder a memória de meses por um disco
 * cheio seria o pior defeito possível deste app.
 */
export function autoBackup({ now = Date.now() } = {}) {
  mkdirSync(AUTO_DIR, { recursive: true });
  const existing = readdirSync(AUTO_DIR)
    .filter((name) => name.endsWith('.zip'))
    .sort();

  const newest = existing.at(-1);
  if (newest) {
    const at = backupDate(newest);
    if (at !== null && now - at < DAY_MS) return { skipped: true, newest };
  }

  const { buffer } = createBackup();
  const name = backupName(new Date(now));
  writeFileSync(join(AUTO_DIR, name), buffer);

  for (const old of [...existing, name].slice(0, -KEEP)) {
    rmSync(join(AUTO_DIR, old), { force: true });
  }
  return { skipped: false, name, bytes: buffer.length, dir: AUTO_DIR };
}

export function listBackups() {
  if (!existsSync(AUTO_DIR)) return [];
  return readdirSync(AUTO_DIR)
    .filter((name) => name.endsWith('.zip'))
    .map((name) => {
      const info = statSync(join(AUTO_DIR, name));
      const at = backupDate(name) ?? info.mtimeMs;
      return { name, path: join(AUTO_DIR, name), bytes: info.size, at: new Date(at).toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}
