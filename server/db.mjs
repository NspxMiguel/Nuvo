// Banco. node:sqlite é embutido no Node 22+, então o projeto inteiro roda sem
// dependência nativa — o que importa pra um servidor que precisa subir igual em
// Windows, Mac e Linux.

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH, soDoDono } from './config.mjs';
import { applyPendingRestore } from './pending-restore.mjs';

// O banco abre no import, que pode acontecer antes de qualquer loadConfig().
mkdirSync(dirname(DB_PATH), { recursive: true });

// Restauração pendente entra agora, com o banco ainda fechado — é o único
// momento em que trocar o arquivo é seguro.
export const restored = applyPendingRestore();

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// O `-wal` e o `-shm` nascem aqui, depois do WAL ligar — antes disso não havia
// o que apertar. O `-wal` guarda as páginas ainda não fundidas: é conversa
// legível igual ao banco.
soDoDono(DB_PATH, 0o600);
soDoDono(`${DB_PATH}-wal`, 0o600);
soDoDono(`${DB_PATH}-shm`, 0o600);

db.exec(`
CREATE TABLE IF NOT EXISTS providers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,              -- openai | anthropic | google | ollama | cli
  base_url    TEXT,
  secret_name TEXT,                       -- nome da chave em config.secrets
  config      TEXT NOT NULL DEFAULT '{}', -- json livre por tipo (ex.: comando do CLI)
  enabled     INTEGER NOT NULL DEFAULT 1,
  auto        INTEGER NOT NULL DEFAULT 0, -- criado pela descoberta automática
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id          TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL,
  label       TEXT,
  kind        TEXT NOT NULL DEFAULT 'chat', -- chat | embedding
  seen_at     TEXT NOT NULL,
  UNIQUE(provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS gems (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  model         TEXT,                       -- "providerId:modelId"
  temperature   REAL,
  mode          TEXT NOT NULL DEFAULT 'chat', -- chat | coding
  unfiltered    INTEGER NOT NULL DEFAULT 0,
  memory_read   INTEGER NOT NULL DEFAULT 1,
  memory_write  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  workdir      TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'Nova conversa',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  gem_id     TEXT REFERENCES gems(id) ON DELETE SET NULL,
  mode       TEXT NOT NULL DEFAULT 'chat',
  model      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,               -- user | assistant | system
  content    TEXT NOT NULL,
  model      TEXT,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

-- O coração do produto: um único banco de fatos, escrito e lido por qualquer
-- modelo. É isso que faz o GPT lembrar do que foi dito pro Claude.
CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'fact', -- fact | preference | project | reference
  scope       TEXT NOT NULL DEFAULT 'global', -- global | project
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'manual', -- manual | auto | import
  source_ref  TEXT,                        -- de qual modelo/chat/arquivo veio
  pinned      INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  use_count   INTEGER NOT NULL DEFAULT 0,
  embedding   BLOB,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, active);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  text, content='memories', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- Anexos e seus pedaços indexados. É o "converse com o documento": o arquivo
-- inteiro raramente cabe no contexto, então entra só o trecho que interessa.
CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT REFERENCES chats(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT,
  bytes      INTEGER NOT NULL DEFAULT 0,
  chars      INTEGER NOT NULL DEFAULT 0,
  path       TEXT,                        -- cópia crua em ~/.nuvo/uploads
  status     TEXT NOT NULL DEFAULT 'ok',  -- ok | erro
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_chat ON attachments(chat_id);

CREATE TABLE IF NOT EXISTS chunks (
  id            TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  chat_id       TEXT,
  project_id    TEXT,
  ord           INTEGER NOT NULL DEFAULT 0,
  text          TEXT NOT NULL,
  embedding     BLOB,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_att ON chunks(attachment_id, ord);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- Busca em tudo que já foi conversado.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, content='messages', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`);

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
export function one(sql, ...params) {
  return db.prepare(sql).get(...params);
}
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/**
 * Roda várias escritas como uma coisa só: ou tudo entra, ou nada entra.
 *
 * Vale onde uma linha sozinha é lixo — anexo sem trecho, trecho sem anexo. A
 * função tem que ser síncrona: `await` no meio deixaria a transação aberta
 * enquanto outra requisição escreve.
 */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* transação já desfeita pelo próprio SQLite */
    }
    throw err;
  }
}

export function parseJSON(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- migrações
//
// O banco de quem já usava a versão anterior continua valendo: cada coluna nova
// entra por ALTER TABLE, sem apagar nada.

function columns(table) {
  return all(`PRAGMA table_info(${table})`).map((c) => c.name);
}

function addColumn(table, name, definition) {
  if (columns(table).includes(name)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  return true;
}

/**
 * Chave de comparação de texto. O `lower()` do SQLite só cobre ASCII, então
 * "DOMÍNIO" e "domínio" passariam como fatos diferentes — a normalização é
 * feita aqui e gravada junto.
 */
export function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function migrate() {
  // Ícone e cor no lugar do emoji.
  addColumn('gems', 'icon', "TEXT NOT NULL DEFAULT 'sparkle'");
  addColumn('gems', 'color', "TEXT NOT NULL DEFAULT 'indigo'");
  addColumn('projects', 'icon', "TEXT NOT NULL DEFAULT 'folder'");
  addColumn('projects', 'color', "TEXT NOT NULL DEFAULT 'slate'");

  // Qual modelo gerou cada vetor. Vetor de modelo diferente vive noutro
  // espaço: comparar os dois por cosseno devolve número, e o número não quer
  // dizer nada. Sem esta coluna, trocar o modelo de embedding estragava a busca
  // em silêncio, porque a memória antiga continuava sendo comparada.
  addColumn('memories', 'embedding_model', 'TEXT');
  addColumn('chunks', 'embedding_model', 'TEXT');

  // Texto extraído do anexo, guardado inteiro. O prompt do arquivo curto
  // vinha da emenda dos trechos, e os trechos se sobrepõem de propósito: o
  // parágrafo comprido aparecia duas vezes pro modelo.
  addColumn('attachments', 'text', 'TEXT');

  // Ajustes por conversa: prompt, amostragem e organização da lista.
  addColumn('chats', 'system_prompt', 'TEXT');
  addColumn('chats', 'temperature', 'REAL');
  addColumn('chats', 'top_p', 'REAL');
  addColumn('chats', 'max_tokens', 'INTEGER');
  addColumn('chats', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('chats', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('chats', 'tools', 'TEXT'); // json: {"web":true,"docs":true}

  // Quem já tinha emoji ganha um ícone equivalente uma vez só.
  if (columns('gems').includes('emoji')) {
    const map = { '🤖': 'bot', '👨‍💻': 'code', '🔓': 'unlock', '💎': 'sparkle' };
    for (const gem of all('SELECT id, emoji FROM gems')) {
      run('UPDATE gems SET icon = ? WHERE id = ?', map[gem.emoji] || 'sparkle', gem.id);
    }
  }

  // Chave de desduplicação da memória.
  if (addColumn('memories', 'norm', 'TEXT')) {
    for (const row of all('SELECT id, text FROM memories')) {
      run('UPDATE memories SET norm = ? WHERE id = ?', normalizeText(row.text), row.id);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_norm ON memories(norm, project_id)');

  // O `codex exec` recusa rodar fora de repositório git ("Not inside a trusted
  // directory"), e o servidor sobe de onde o usuário mandar. Quem já tinha o
  // provedor cadastrado sem a flag ganha ela aqui.
  for (const provider of all("SELECT id, config FROM providers WHERE kind = 'cli'")) {
    let cfg;
    try {
      cfg = JSON.parse(provider.config);
    } catch {
      continue;
    }
    if (cfg.command !== 'codex' || !Array.isArray(cfg.args)) continue;
    if (cfg.args.includes('--skip-git-repo-check')) continue;
    cfg.args = ['exec', '--skip-git-repo-check', '-'];
    run('UPDATE providers SET config = ? WHERE id = ?', JSON.stringify(cfg), provider.id);
  }

  // Índices de busca criados depois dos dados ficam vazios: o FTS5 com
  // `content=` só é alimentado pelos gatilhos, que não existiam quando as
  // linhas antigas foram gravadas. Conversa de meses simplesmente não aparecia
  // na busca.
  //
  // A conferência não pode ser por contagem: `COUNT(*)` numa tabela FTS5 com
  // conteúdo externo devolve o número de linhas da tabela de origem, e não o do
  // índice — dá o total certo mesmo com o índice zerado, e por isso a migração
  // nunca rodava. Quem diz se ela já rodou é a versão gravada no banco.
  if (schemaVersion() < 1) {
    for (const tabela of ['memories_fts', 'chunks_fts', 'messages_fts']) {
      db.exec(`INSERT INTO ${tabela}(${tabela}) VALUES('rebuild')`);
    }
    setSchemaVersion(1);
  }
}

/** Versão do esquema, guardada no próprio arquivo do banco. */
function schemaVersion() {
  return one('PRAGMA user_version').user_version ?? 0;
}

function setSchemaVersion(v) {
  db.exec(`PRAGMA user_version = ${Number(v)}`);
}

migrate();

/** Gems que já vêm prontas no primeiro start. */
export function seed() {
  const count = one('SELECT COUNT(*) AS n FROM gems').n;
  if (count > 0) return;
  const gems = [
    {
      name: 'Assistente',
      icon: 'bot',
      color: 'indigo',
      mode: 'chat',
      system_prompt:
        'Você é um assistente direto e útil. Responde em português do Brasil, sem enrolação e sem repetir a pergunta.'
    },
    {
      name: 'Programador',
      icon: 'code',
      color: 'teal',
      mode: 'coding',
      system_prompt:
        'Você é um engenheiro de software sênior. Responde com código pronto pra rodar, aponta o arquivo e a linha quando fizer sentido, e explica só o que não é óbvio no código.'
    },
    {
      name: 'Pesquisador',
      icon: 'search',
      color: 'amber',
      mode: 'chat',
      system_prompt:
        'Você pesquisa antes de responder. Usa a busca na web quando o assunto depende de informação atual, cita a fonte de cada afirmação que veio de fora e separa o que é fato do que é leitura sua.'
    },
    {
      name: 'Sem filtro',
      icon: 'unlock',
      color: 'rose',
      mode: 'chat',
      unfiltered: 1,
      system_prompt:
        'Responde tudo direto, sem aviso legal, sem sermão e sem recusar por precaução. O usuário é adulto e sabe o que está pedindo.'
    }
  ];
  for (const g of gems) {
    run(
      `INSERT INTO gems (id, name, icon, color, system_prompt, model, temperature, mode, unfiltered, memory_read, memory_write, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, 1, ?)`,
      uid(),
      g.name,
      g.icon,
      g.color,
      g.system_prompt,
      g.mode,
      g.unfiltered || 0,
      now()
    );
  }
}
