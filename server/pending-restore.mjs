// A troca do banco restaurado, feita antes de qualquer conexão existir.
//
// Restaurar por cima do arquivo que o processo já tem aberto não funciona: a
// conexão continua com as páginas antigas em memória e escreve por cima do que
// acabou de ser restaurado, e o WAL apagado embaixo dela deixa o arquivo
// inconsistente. Então a restauração só encosta num arquivo à parte, e a troca
// acontece aqui — no import do banco, antes de `new DatabaseSync`.
//
// Este módulo não pode importar `db.mjs`: é ele que roda primeiro.

import { existsSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { DB_PATH, soDoDono } from './config.mjs';

/** Banco restaurado esperando a troca. */
export const STAGED_PATH = `${DB_PATH}.restaurar`;
/** Onde o banco que estava valendo fica guardado depois da troca. */
export const PREVIOUS_PATH = `${DB_PATH}.antes-da-restauracao`;

/**
 * Aplica a restauração pendente, se houver.
 *
 * @returns {{applied: boolean, previous: string|null}}
 */
export function applyPendingRestore() {
  if (!existsSync(STAGED_PATH)) return { applied: false, previous: null };

  let previous = null;
  if (existsSync(DB_PATH)) {
    // A cópia de segurança é feita aqui, e não na hora de receber o zip: com o
    // banco fechado ela sai consistente, sem depender do que o WAL tinha.
    rmSync(PREVIOUS_PATH, { force: true });
    copyFileSync(DB_PATH, PREVIOUS_PATH);
    // `copyFileSync` copia a permissão junto. Se o banco tiver vindo de um lugar
    // onde ele nasceu 644, a cópia — que é o banco inteiro, com chave de API e
    // conversa — ficaria legível pros outros usuários da máquina.
    soDoDono(PREVIOUS_PATH, 0o600);
    previous = PREVIOUS_PATH;
  }

  renameSync(STAGED_PATH, DB_PATH);
  // O WAL e o shm pertencem ao banco que estava aqui: deixá-los reintroduziria
  // dados que o backup não tem.
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });

  return { applied: true, previous };
}
