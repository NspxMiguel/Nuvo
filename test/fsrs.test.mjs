// A conta que decide quando o cartão volta.
//
// Testar isto sem esperar um dia passar é o motivo de o `fsrs.mjs` ser função
// pura: entra estado e nota, sai estado. Nada de banco, nada de relógio.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { revisar, recuperacao, intervalo, quandoVolta, NOTAS, RETENCAO } = await import('../server/fsrs.mjs');
const cartoes = await import('../server/cartoes.mjs');
const estudos = await import('../server/estudos.mjs');

after(() => home.cleanup());

test('a curva de esquecimento passa por 90% exatamente na estabilidade', () => {
  // É a definição de estabilidade. Se isto sai do lugar, todo intervalo sai junto.
  for (const s of [1, 10, 365]) {
    assert.ok(Math.abs(recuperacao(s, s) - RETENCAO) < 1e-6, `S=${s} deu ${recuperacao(s, s)}`);
  }
  assert.ok(recuperacao(0, 10) === 1, 'sem tempo passado, lembra com certeza');
  // A curva é de potência, não exponencial: ela cai rápido no começo e depois
  // arrasta uma cauda longa. Cem vezes a estabilidade ainda deixa uns 20% — é
  // assim mesmo, e é por isso que cartão velho reaparece de vez em quando em vez
  // de sumir pra sempre.
  const longe = recuperacao(1000, 10);
  assert.ok(longe < 0.25 && longe > 0.1, `cauda fora do esperado: ${longe}`);
  let anterior = 1;
  for (const dias of [1, 5, 10, 30, 100]) {
    const agora = recuperacao(dias, 10);
    assert.ok(agora < anterior, `a curva subiu entre ${dias} dias e o anterior`);
    anterior = agora;
  }
});

test('a primeira resposta ordena os quatro caminhos', () => {
  const notas = [NOTAS.denovo, NOTAS.dificil, NOTAS.bom, NOTAS.facil];
  const saidas = notas.map((n) => revisar({}, n, 0));
  // Quanto mais fácil foi, mais longe volta e menos difícil o cartão é.
  for (let i = 1; i < saidas.length; i += 1) {
    assert.ok(
      saidas[i].estabilidade > saidas[i - 1].estabilidade,
      `estabilidade não cresceu de ${notas[i - 1]} pra ${notas[i]}`
    );
    assert.ok(
      saidas[i].dificuldade < saidas[i - 1].dificuldade,
      `dificuldade não caiu de ${notas[i - 1]} pra ${notas[i]}`
    );
  }
  // E a dificuldade não pode nascer colada no piso: se todo cartão nasce 1,0 a
  // dificuldade parou de significar alguma coisa. Foi o defeito de misturar a
  // fórmula do FSRS-5 com os pesos do 4.5.
  assert.ok(saidas[2].dificuldade > 3 && saidas[2].dificuldade < 8, `"bom" nasceu com ${saidas[2].dificuldade}`);
  assert.equal(revisar({}, NOTAS.denovo, 0).estado, 'aprendendo');
  assert.equal(revisar({}, NOTAS.bom, 0).estado, 'revisando');
});

test('acertar seguido afasta o cartão, e cada vez mais', () => {
  let c = {};
  const saltos = [];
  for (let i = 0; i < 4; i += 1) {
    c = revisar(c, NOTAS.bom, c.intervalo || 0);
    saltos.push(c.intervalo);
  }
  for (let i = 1; i < saltos.length; i += 1) {
    assert.ok(saltos[i] > saltos[i - 1], `intervalo encolheu: ${saltos.join(', ')}`);
  }
});

test('errar derruba a estabilidade e sobe a dificuldade', () => {
  let c = {};
  for (let i = 0; i < 4; i += 1) c = revisar(c, NOTAS.bom, c.intervalo);
  const antes = { ...c };
  const depois = revisar(c, NOTAS.denovo, c.intervalo);
  assert.ok(depois.estabilidade < antes.estabilidade, 'errar tinha que derrubar a estabilidade');
  assert.ok(depois.dificuldade > antes.dificuldade, 'errar tinha que subir a dificuldade');
  assert.equal(depois.intervalo, 1, 'cartão errado volta amanhã');
  assert.equal(depois.lapso, true);
});

test('a dificuldade nunca sai de 1 a 10, por pior que seja o histórico', () => {
  let c = {};
  for (let i = 0; i < 40; i += 1) {
    c = revisar(c, i % 2 ? NOTAS.denovo : NOTAS.facil, c.intervalo || 0);
    assert.ok(c.dificuldade >= 1 && c.dificuldade <= 10, `dificuldade escapou: ${c.dificuldade}`);
    assert.ok(c.estabilidade > 0, `estabilidade zerou: ${c.estabilidade}`);
  }
});

test('o mesmo cartão nunca volta no mesmo dia', () => {
  // Ver de novo em horas é reconhecimento, não memória.
  for (const s of [0.01, 0.1, 0.5]) {
    assert.ok(intervalo(s) >= 1, `estabilidade ${s} devolveu ${intervalo(s)}`);
  }
});

test('a data de volta anda os dias que a conta pediu', () => {
  const base = new Date('2026-08-21T12:00:00.000Z');
  assert.equal(quandoVolta(1, base).slice(0, 10), '2026-08-22');
  assert.equal(quandoVolta(11, base).slice(0, 10), '2026-09-01');
});

// ------------------------------------------------------------------ a fila

test('o baralho vira cartões, e o repetido não entra duas vezes', () => {
  const p = estudos.criarProfessor({ nome: 'Ana' });
  const saida = estudos.guardarSaida({
    professorId: p.id,
    tipo: 'flashcards',
    titulo: 'Cartões',
    json: {
      cartoes: [
        { frente: 'O que é osmose?', verso: 'Passagem de água pela membrana.' },
        { frente: 'O que é osmose?', verso: 'Duplicado, não pode entrar.' },
        { frente: 'Onde ocorre a glicólise?', verso: 'No citoplasma.' },
        { frente: '   ', verso: 'sem frente' }
      ]
    }
  });
  const fora = cartoes.semearCartoes(saida.id);
  assert.equal(fora.entraram, 2);
  assert.equal(cartoes.contagem(p.id).total, 2);
  // Semear de novo não duplica: a pessoa clica duas vezes sem querer.
  assert.equal(cartoes.semearCartoes(saida.id).entraram, 0);
  assert.equal(cartoes.contagem(p.id).total, 2);
});

test('responder tira o cartão da fila de hoje e grava a revisão', () => {
  const p = estudos.criarProfessor({ nome: 'Bia' });
  const saida = estudos.guardarSaida({
    professorId: p.id,
    tipo: 'flashcards',
    titulo: 'Cartões',
    json: { cartoes: [{ frente: 'Pergunta', verso: 'Resposta' }] }
  });
  cartoes.semearCartoes(saida.id);
  assert.equal(cartoes.fila(p.id).length, 1);

  const [cartao] = cartoes.fila(p.id);
  const depois = cartoes.responder(cartao.id, NOTAS.bom);
  assert.equal(depois.estado, 'revisando');
  assert.ok(depois.intervalo >= 1);
  assert.equal(cartoes.fila(p.id).length, 0, 'respondido não pode voltar hoje');
  assert.equal(cartoes.contagem(p.id).hoje, 0);
});

test('a previsão diz o preço de cada botão antes de apertar', () => {
  const p = estudos.criarProfessor({ nome: 'Caio' });
  const saida = estudos.guardarSaida({
    professorId: p.id,
    tipo: 'flashcards',
    titulo: 'Cartões',
    json: { cartoes: [{ frente: 'X', verso: 'Y' }] }
  });
  cartoes.semearCartoes(saida.id);
  const [cartao] = cartoes.fila(p.id);
  const prev = cartoes.previsao(cartao);
  assert.deepEqual(Object.keys(prev).sort(), ['bom', 'denovo', 'dificil', 'facil']);
  assert.ok(prev.facil > prev.bom, `fácil (${prev.facil}) tinha que ir mais longe que bom (${prev.bom})`);
  assert.ok(prev.bom >= prev.dificil);
  // Prever não pode gravar nada: o cartão continua novo.
  assert.equal(cartoes.fila(p.id).length, 1);
  assert.equal(cartoes.contagem(p.id).novos, 1);
});

test('nota inventada é recusada em vez de virar revisão torta', () => {
  const p = estudos.criarProfessor({ nome: 'Dani' });
  const saida = estudos.guardarSaida({
    professorId: p.id, tipo: 'flashcards', titulo: 'C',
    json: { cartoes: [{ frente: 'A', verso: 'B' }] }
  });
  cartoes.semearCartoes(saida.id);
  const [cartao] = cartoes.fila(p.id);
  for (const ruim of [0, 5, 'bom', null]) {
    assert.throws(() => cartoes.responder(cartao.id, ruim), /nota de revisão desconhecida/);
  }
});
