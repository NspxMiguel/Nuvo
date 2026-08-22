// O retrato do professor: o que a gente aceita como retrato, e o que a gente
// recusa. Nada aqui chama modelo — o que está sob teste é a peneira que fica
// entre a resposta da IA e o banco.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { limparRetrato, confianca, NIVEIS } = await import('../server/retrato.mjs');
const { parseJsonObject } = await import('../server/complete.mjs');

after(() => home.cleanup());

const bom = {
  formato: { n_questoes: 8, tipos: [{ tipo: 'discursiva', peso: 0.75 }], pontuacao: '10 pontos' },
  conteudo: [{ tema: 'Revolução Francesa', peso: 0.4, apareceu_em: ['A1'], citacao: 'Justifique...' }],
  cognitivo: [{ nivel: 'aplicar', peso: 0.5 }],
  verbos: [{ verbo: 'justifique', vezes: 7, exemplo: 'Justifique...' }],
  pegadinhas: [{ padrao: 'inverte causa e efeito', exemplo: '...' }],
  manias: ['sempre pede exemplo do cotidiano'],
  temas_da_aula: ['Revolução Francesa', 'Comuna de Paris']
};

test('retrato com forma passa e chega inteiro do outro lado', () => {
  const fora = limparRetrato(bom);
  assert.equal(fora.versao, 1);
  assert.equal(fora.conteudo[0].tema, 'Revolução Francesa');
  assert.equal(fora.cognitivo[0].nivel, 'aplicar');
  assert.equal(fora.verbos[0].vezes, 7);
  assert.equal(fora.manias[0], 'sempre pede exemplo do cotidiano');
  // "Comuna de Paris" está no material de aula e não aparece nas provas: a
  // diferença entre as duas listas é o que vira "ensina e nunca cobrou".
  assert.deepEqual(fora.so_na_aula, ['Comuna de Paris']);
});

test('retrato sem conteúdo e sem nível é recusado, não gravado pela metade', () => {
  // É a diferença entre "não consegui" e "este professor não cobra nada de
  // aplicação" — a segunda é mentira com cara de dado.
  assert.equal(limparRetrato({ manias: ['fala rápido'] }), null);
  assert.equal(limparRetrato({}), null);
  assert.equal(limparRetrato(null), null);
  assert.equal(limparRetrato('{"conteudo":[]}'), null);
});

test('nível fora da escala de Bloom é descartado, não inventado', () => {
  const fora = limparRetrato({
    ...bom,
    cognitivo: [{ nivel: 'difícil', peso: 0.9 }, { nivel: 'analisar', peso: 0.1 }]
  });
  assert.deepEqual(fora.cognitivo.map((c) => c.nivel), ['analisar']);
  assert.ok(NIVEIS.includes('analisar'));
});

test('peso chega em três formatos diferentes e sai sempre como fração', () => {
  // O modelo devolve 0.4, "0,4" e "40%" pra mesma coisa, e às vezes 40.
  const casos = [
    [0.4, 0.4],
    ['0,4', 0.4],
    ['40%', 0.4],
    [40, 0.4],
    ['sei lá', 0],
    [-1, 0]
  ];
  for (const [entrada, esperado] of casos) {
    const fora = limparRetrato({ ...bom, conteudo: [{ tema: 'X', peso: entrada }] });
    assert.ok(
      Math.abs(fora.conteudo[0].peso - esperado) < 1e-9,
      `peso ${JSON.stringify(entrada)} virou ${fora.conteudo[0].peso}, esperava ${esperado}`
    );
  }
});

test('item sem tema não entra, mesmo com peso bonito', () => {
  const fora = limparRetrato({ ...bom, conteudo: [{ tema: '  ', peso: 0.9 }, bom.conteudo[0]] });
  assert.equal(fora.conteudo.length, 1);
});

test('a confiança diz na cara quando ainda é palpite', () => {
  assert.equal(confianca({ provas: 1, materiais: 5 }).nota, 'palpite');
  assert.equal(confianca({ provas: 2, materiais: 0 }).nota, 'indicio');
  assert.equal(confianca({ provas: 4, materiais: 2 }).nota, 'boa');
  assert.equal(confianca({ provas: 4, materiais: 0 }).nota, 'media');
});

test('o JSON é achado mesmo com conversa em volta', () => {
  assert.deepEqual(parseJsonObject('Claro! Aqui está:\n```json\n{"a":1}\n```\nEspero ter ajudado.'), {
    a: 1
  });
  // Chave dentro de texto não fecha o objeto antes da hora.
  assert.deepEqual(parseJsonObject('{"citacao":"use a chave }","b":2}'), {
    citacao: 'use a chave }',
    b: 2
  });
  assert.equal(parseJsonObject('não vou responder isso'), null);
  assert.equal(parseJsonObject('[1,2,3]'), null);
});

test('"ensina e nunca cobrou" é conta, não palpite do modelo', () => {
  // Era um campo entre sete que o modelo tinha que preencher fazendo diferença
  // de conjunto de cabeça — e voltava vazio justamente quando havia material de
  // aula pra comparar, que é quando ele vale alguma coisa.
  const r = limparRetrato({
    conteudo: [
      { tema: 'Respiração celular', peso: 0.4 },
      { tema: 'Fotossíntese', peso: 0.3 },
      { tema: 'Genética mendeliana', peso: 0.3 }
    ],
    cognitivo: [{ nivel: 'aplicar', peso: 1 }],
    temas_da_aula: [
      'Respiração celular',
      'fotossintese',
      'Biotecnologia e engenharia genética',
      'Bioluminescência',
      'Plantas C4'
    ]
  });

  assert.deepEqual(r.so_na_aula, ['Bioluminescência', 'Plantas C4']);
  assert.equal(r.temas_da_aula.length, 5, 'as duas listas ficam gravadas pra dar pra conferir');
});

test('sem material de aula não se inventa o que ele deixou de cobrar', () => {
  const r = limparRetrato({
    conteudo: [{ tema: 'Respiração celular', peso: 1 }],
    cognitivo: [{ nivel: 'lembrar', peso: 1 }],
    so_na_aula: ['isto veio do modelo e não vale nada sem material']
  });
  assert.deepEqual(r.so_na_aula, [], 'sem lista de aula, a diferença é vazia');
});

test('a comparação é frouxa de propósito: errar pra menos é o lado barato', () => {
  // Dizer que ele nunca cobrou uma coisa que ele cobrou manda estudar o que não
  // cai e deixar de estudar o que cai. Na dúvida, o tema conta como cobrado.
  const r = limparRetrato({
    conteudo: [{ tema: 'Ciclo de Krebs', peso: 1 }],
    cognitivo: [{ nivel: 'lembrar', peso: 1 }],
    temas_da_aula: ['ciclo de krebs', 'O ciclo de Krebs e a matriz mitocondrial', 'Ciclo da água']
  });
  assert.equal(r.so_na_aula.includes('ciclo de krebs'), false, 'acento e caixa não separam tema');
  assert.equal(
    r.so_na_aula.includes('O ciclo de Krebs e a matriz mitocondrial'),
    false,
    'tema que contém o outro conta como cobrado'
  );
  assert.deepEqual(r.so_na_aula, ['Ciclo da água'], 'e "ciclo" sozinho não faz dois temas virarem um');
});
