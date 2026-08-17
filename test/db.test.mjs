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

test('banco anterior ao carimbo de embedding ganha a coluna sem perder fato', () => {
  // A coluna `embedding_model` diz qual modelo gerou cada vetor. Quem já tinha
  // memória gravada antes dela fica com carimbo nulo, que é o certo: ninguém
  // sabe qual modelo foi. O que não pode é a linha sumir, nem a busca por
  // palavra parar — e, com um modelo configurado, essas linhas têm que aparecer
  // como pendentes de recálculo em vez de simplesmente serem ignoradas calado.
  const saida = emProcessoNovo(`
    import { DatabaseSync } from 'node:sqlite';
    const { DB_PATH } = await import('./server/config.mjs');

    const antigo = new DatabaseSync(DB_PATH);
    antigo.exec(\`
      CREATE TABLE memories (id TEXT PRIMARY KEY, text TEXT, norm TEXT, kind TEXT, scope TEXT,
        project_id TEXT, source TEXT, pinned INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
        embedding BLOB, created_at TEXT, updated_at TEXT);
      CREATE TABLE chunks (id TEXT PRIMARY KEY, attachment_id TEXT, ord INTEGER, text TEXT,
        embedding BLOB, created_at TEXT);
      INSERT INTO memories (id, text, norm, kind, scope, source, created_at, updated_at)
        VALUES ('m1','O domínio do Miguel é nspx.dev','o dominio do miguel e nspx.dev','fact','global','manual','2020-01-01','2020-01-01');
    \`);
    antigo.close();

    const { db, all } = await import('./server/db.mjs');
    const { listMemories, reindexPending } = await import('./server/memory.mjs');
    const { patchConfig } = await import('./server/config.mjs');

    const colunas = (tabela) => all('PRAGMA table_info(' + tabela + ')').map((c) => c.name);
    const fatos = listMemories();
    const semModelo = reindexPending().total;
    patchConfig({ memory: { embeddingModel: 'algum:modelo' } });
    const comModelo = reindexPending();

    console.log(JSON.stringify({
      colunaMemories: colunas('memories').includes('embedding_model'),
      colunaChunks: colunas('chunks').includes('embedding_model'),
      fatos: fatos.length,
      texto: fatos[0]?.text,
      carimbo: all('SELECT embedding_model FROM memories')[0].embedding_model,
      buscaPorPalavra: db.prepare("SELECT COUNT(*) AS n FROM memories_fts WHERE memories_fts MATCH 'nspx'").get().n,
      semModelo,
      comModelo
    }));
  `);

  const r = JSON.parse(saida);
  assert.equal(r.colunaMemories, true);
  assert.equal(r.colunaChunks, true);
  assert.equal(r.fatos, 1, 'o fato antigo não pode sumir na migração');
  assert.equal(r.texto, 'O domínio do Miguel é nspx.dev');
  assert.equal(r.carimbo, null, 'linha antiga não tem modelo conhecido, e mentir seria pior');
  assert.equal(r.buscaPorPalavra, 1, 'a busca por palavra continua achando o fato antigo');
  assert.equal(r.semModelo, 0, 'sem modelo de embedding não há o que recalcular');
  assert.equal(r.comModelo.memories, 1, 'com modelo configurado, a linha antiga vira pendência');
  assert.equal(r.comModelo.total, 1);
});
