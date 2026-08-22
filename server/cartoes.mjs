// Os cartões e a fila de revisão.
//
// O que o NotebookLM e companhia entregam para de pé: eles geram os cartões e
// entregam a pilha. A pilha não é estudo — estudo é ver o cartão certo no dia
// certo, e é isso que mora aqui.

import { all, one, run, tx, uid, now } from './db.mjs';
import { erroHttp } from './erro-traduzivel.mjs';
import { acharProfessor, acharSaida } from './estudos.mjs';
import { NOTAS, quandoVolta, revisar } from './fsrs.mjs';

const texto = (v, limite = 1200) => String(v ?? '').trim().slice(0, limite);

/** Cria os cartões de uma saída de flashcards. Repetido não entra duas vezes. */
export function semearCartoes(saidaId) {
  const saida = acharSaida(saidaId);
  if (saida.tipo !== 'flashcards') throw erroHttp(400, 'esta saída não é um baralho de cartões');
  const cartoes = Array.isArray(saida.json?.cartoes) ? saida.json.cartoes : [];
  if (!cartoes.length) throw erroHttp(400, 'este baralho está vazio');

  const jaTem = new Set(
    all('SELECT frente FROM cartoes WHERE professor_id = ?', saida.professor_id).map((c) => c.frente)
  );
  const agora = now();
  let entraram = 0;
  tx(() => {
    for (const cartao of cartoes) {
      const frente = texto(cartao.frente, 400);
      const verso = texto(cartao.verso);
      if (!frente || !verso || jaTem.has(frente)) continue;
      jaTem.add(frente);
      entraram += 1;
      run(
        `INSERT INTO cartoes (id, professor_id, saida_id, frente, verso, tema, fonte, estado, volta_em, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?)`,
        uid(),
        saida.professor_id,
        saida.id,
        frente,
        verso,
        texto(cartao.tema, 120) || null,
        texto(cartao.fonte, 600) || null,
        agora,
        agora
      );
    }
  });
  return { entraram, repetidos: cartoes.length - entraram };
}

/**
 * O que vence hoje.
 *
 * Cartão novo entra na fila junto com o que vence, e não numa fila separada: o
 * que interessa é a próxima coisa a fazer, e dividir em duas listas faz a pessoa
 * escolher entre "aprender" e "revisar" quando ela só queria estudar.
 */
export function fila(professorId, { limite = 40, agora = now() } = {}) {
  acharProfessor(professorId);
  return all(
    `SELECT * FROM cartoes
     WHERE professor_id = ? AND estado != 'suspenso' AND (volta_em IS NULL OR volta_em <= ?)
     ORDER BY CASE estado WHEN 'aprendendo' THEN 0 WHEN 'novo' THEN 1 ELSE 2 END, volta_em
     LIMIT ?`,
    professorId,
    agora,
    limite
  );
}

/** Quantos vencem hoje, quantos são novos, quantos existem. Pro contador do menu. */
export function contagem(professorId, { agora = now() } = {}) {
  const linha = one(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN estado = 'novo' THEN 1 ELSE 0 END) AS novos,
       SUM(CASE WHEN estado != 'suspenso' AND (volta_em IS NULL OR volta_em <= ?) THEN 1 ELSE 0 END) AS hoje
     FROM cartoes WHERE professor_id = ?`,
    agora,
    professorId
  );
  return { total: linha?.total || 0, novos: linha?.novos || 0, hoje: linha?.hoje || 0 };
}

const DIA = 24 * 60 * 60 * 1000;

/** Responde um cartão e devolve onde ele foi parar. */
export function responder(cartaoId, nota, { agora = new Date() } = {}) {
  const cartao = one('SELECT * FROM cartoes WHERE id = ?', cartaoId);
  if (!cartao) throw erroHttp(404, 'cartão não encontrado');
  const grau = Number(nota);
  if (!Object.values(NOTAS).includes(grau)) throw erroHttp(400, 'nota de revisão desconhecida');

  const parado = cartao.revisado_em
    ? Math.max(0, (agora.getTime() - new Date(cartao.revisado_em).getTime()) / DIA)
    : 0;
  const saiu = revisar(cartao, grau, parado);
  const quando = agora.toISOString();

  tx(() => {
    run(
      `UPDATE cartoes SET dificuldade = ?, estabilidade = ?, estado = ?, revisado_em = ?,
         volta_em = ?, lapsos = lapsos + ? WHERE id = ?`,
      saiu.dificuldade,
      saiu.estabilidade,
      saiu.estado,
      quando,
      quandoVolta(saiu.intervalo, agora),
      saiu.lapso ? 1 : 0,
      cartaoId
    );
    run(
      'INSERT INTO revisoes (id, cartao_id, nota, intervalo, estabilidade, revisado_em) VALUES (?, ?, ?, ?, ?, ?)',
      uid(),
      cartaoId,
      grau,
      saiu.intervalo,
      saiu.estabilidade,
      quando
    );
  });

  return { ...one('SELECT * FROM cartoes WHERE id = ?', cartaoId), intervalo: saiu.intervalo };
}

/**
 * O que aconteceria com cada nota, sem gravar nada.
 *
 * A tela mostra isto nos quatro botões ("de novo · 1d", "bom · 15d"): saber o
 * preço antes de clicar é o que faz a pessoa responder com honestidade em vez de
 * apertar "bom" pra fila diminuir.
 */
export function previsao(cartao, { agora = new Date() } = {}) {
  const parado = cartao.revisado_em
    ? Math.max(0, (agora.getTime() - new Date(cartao.revisado_em).getTime()) / DIA)
    : 0;
  return Object.fromEntries(
    Object.entries(NOTAS).map(([nome, grau]) => [nome, revisar(cartao, grau, parado).intervalo])
  );
}

export function apagarCartao(id) {
  if (!one('SELECT id FROM cartoes WHERE id = ?', id)) throw erroHttp(404, 'cartão não encontrado');
  run('DELETE FROM cartoes WHERE id = ?', id);
  return { ok: true };
}

/**
 * O estado que um cartão tinha antes de ser suspenso.
 *
 * Quem foi suspenso antes desta versão não guardou nada, então o estado é
 * deduzido do próprio cartão: sem revisão nenhuma ele é novo de novo; com
 * revisão, volta pra fila normal.
 */
function estadoDeVolta(cartao) {
  if (cartao.estado_antes) return cartao.estado_antes;
  return cartao.revisado_em ? 'revisando' : 'novo';
}

export function suspenderCartao(id, suspenso = true) {
  const cartao = one('SELECT * FROM cartoes WHERE id = ?', id);
  if (!cartao) throw erroHttp(404, 'cartão não encontrado');
  if (suspenso) {
    // Suspender duas vezes não pode gravar 'suspenso' como estado anterior.
    const antes = cartao.estado === 'suspenso' ? cartao.estado_antes : cartao.estado;
    run('UPDATE cartoes SET estado = ?, estado_antes = ? WHERE id = ?', 'suspenso', antes || null, id);
  } else {
    run(
      'UPDATE cartoes SET estado = ?, estado_antes = NULL WHERE id = ?',
      estadoDeVolta(cartao),
      id
    );
  }
  return one('SELECT * FROM cartoes WHERE id = ?', id);
}
