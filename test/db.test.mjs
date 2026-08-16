// Migrações do banco. Como elas rodam no import de `db.mjs`, cada caso precisa
// de um processo próprio: dentro de um mesmo teste o módulo já está carregado e
// a migração já passou.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

/** Roda o script num processo limpo, com HOME próprio. */
function emProcessoNovo(script) {
  const home = mkdtempSync(join(tmpdir(), 'iaunifier-db-'));
  try {
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, IAUNIFIER_HOME: home },
      cwd: RAIZ,
      encoding: 'utf8'
    }).trim();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('banco anterior à busca ganha o índice preenchido no primeiro start', () => {
  // O FTS5 com conteúdo externo só é alimentado pelos gatilhos. Linha gravada
  // antes de o índice existir fica invisível pra sempre — e a conferência por
  // COUNT(*) não percebe, porque numa tabela dessas ela devolve o total da
  // tabela de origem, não o do índice.
  const saida = emProcessoNovo(`
    import { DatabaseSync } from 'node:sqlite';
    const { DB_PATH } = await import('./server/config.mjs');

    const antigo = new DatabaseSync(DB_PATH);
    antigo.exec(\`
      CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT, project_id TEXT, gem_id TEXT, mode TEXT,
        model TEXT, system_prompt TEXT, temperature REAL, top_p REAL, max_tokens INTEGER, tools TEXT,
        created_at TEXT, updated_at TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT, role TEXT, content TEXT, model TEXT,
        meta TEXT, created_at TEXT);
      INSERT INTO chats (id, title, created_at, updated_at) VALUES ('c1','velha','2020-01-01','2020-01-01');
      INSERT INTO messages (id, chat_id, role, content, created_at)
        VALUES ('m1','c1','user','eu prefiro café coado','2020-01-01');
    \`);
    antigo.close();

    const { db } = await import('./server/db.mjs');
    const achou = db.prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'coado'").get().n;
    const versao = db.prepare('PRAGMA user_version').get().user_version;
    console.log(JSON.stringify({ achou, versao }));
  `);

  const { achou, versao } = JSON.parse(saida);
  assert.equal(achou, 1, 'a conversa antiga tem que aparecer na busca depois da migração');
  assert.equal(versao, 1, 'a migração se marca como feita, pra não rodar de novo a cada start');
});

test('banco novo sobe com a busca funcionando e a versão marcada', () => {
  const saida = emProcessoNovo(`
    const { db, run, uid, now } = await import('./server/db.mjs');
    run('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?,?,?,?)', 'c1', 'nova', now(), now());
    run('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)',
      uid(), 'c1', 'user', 'memória entre modelos', now());
    const achou = db.prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'memória'").get().n;
    const versao = db.prepare('PRAGMA user_version').get().user_version;
    console.log(JSON.stringify({ achou, versao }));
  `);

  const { achou, versao } = JSON.parse(saida);
  assert.equal(achou, 1);
  assert.equal(versao, 1);
});
