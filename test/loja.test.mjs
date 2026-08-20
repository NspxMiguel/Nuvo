// A loja: o que entra na vitrine e em que ordem.
//
// O miolo aqui é a nota de "recomendado". Ela é uma decisão de produto, não um
// detalhe: se ela empatar com "mais estrelas", o filtro que ele pediu não
// existe de verdade — vira o mesmo botão com dois nomes. Duas versões desta
// função caíram exatamente nisso antes de o teste existir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIAS, normalizar, nota } from '../server/loja.mjs';

const AGORA = Date.parse('2026-08-20T12:00:00Z');
const dias = (n) => new Date(AGORA - n * 86400000).toISOString();

/** Um item completo e vivo, do qual cada caso muda uma coisa só. */
const base = {
  id: 'alguem/coisa-mcp',
  categoria: 'mcp',
  descricao: 'An MCP server for something',
  estrelas: 500,
  licenca: 'MIT',
  topicos: ['mcp-server'],
  arquivado: false,
  mexido: dias(1)
};
const com = (mudanca) => ({ ...base, ...mudanca });

test('arquivado não se recomenda', () => {
  // Não some da lista — quem procurar pelo nome ainda acha —, mas o autor já
  // disse que não mexe mais nisso.
  assert.equal(nota(com({ arquivado: true, estrelas: 50000 }), AGORA), 0);
});

test('projeto parado vale menos que projeto vivo', () => {
  const vivo = nota(com({ mexido: dias(2) }), AGORA);
  const parado = nota(com({ mexido: dias(400) }), AGORA);
  assert.ok(parado < vivo * 0.4, `parado ${parado} devia ficar bem abaixo de ${vivo}`);
});

test('a fama satura: cem mil estrelas não valem cinquenta vezes duas mil', () => {
  // É esta curva que impede "recomendado" de virar "mais estrelas".
  const duasMil = nota(com({ estrelas: 2000 }), AGORA);
  const cemMil = nota(com({ estrelas: 100000 }), AGORA);
  assert.ok(cemMil > duasMil, 'mais estrelas ainda conta alguma coisa');
  assert.ok(cemMil < duasMil * 1.35, `cem mil (${cemMil}) perto demais de cinquenta vezes duas mil`);
});

test('o repositório que só fala do assunto perde pro que é o assunto', () => {
  // Um construtor de currículos com quarenta mil estrelas que ganhou um modo
  // MCP marca `mcp-server` igual a um servidor MCP. O que separa é como o
  // projeto se apresenta.
  const eh = nota(com({ id: 'alguem/postgres-mcp', descricao: 'MCP server for Postgres' }), AGORA);
  const soFala = nota(com({ id: 'alguem/gerador-de-curriculo', descricao: 'A resume builder', estrelas: 40000 }), AGORA);
  assert.ok(eh > soFala, `${eh} devia ganhar de ${soFala}, mesmo com oitenta vezes menos estrelas`);
});

test('descrição e licença contam, mas não viram o jogo', () => {
  const cheio = nota(base, AGORA);
  const pelado = nota(com({ descricao: '', licenca: '' }), AGORA);
  assert.ok(cheio > pelado);
  assert.ok(cheio < pelado * 1.4, 'capricho não pode pesar mais que estar vivo');
});

test('a ordem de recomendado não é a ordem de estrelas', () => {
  // O teste que teria pego as duas versões erradas da fórmula.
  const itens = [
    com({ id: 'grande/parado', estrelas: 90000, mexido: dias(500), topicos: [], descricao: 'A dashboard' }),
    com({ id: 'medio/vivo-mcp', estrelas: 3000, mexido: dias(1) }),
    com({ id: 'pequeno/novo-mcp', estrelas: 200, mexido: dias(3) })
  ];
  const porNota = [...itens].sort((a, b) => nota(b, AGORA) - nota(a, AGORA)).map((i) => i.id);
  const porEstrela = [...itens].sort((a, b) => b.estrelas - a.estrelas).map((i) => i.id);
  assert.notDeepEqual(porNota, porEstrela);
  assert.equal(porNota[0], 'medio/vivo-mcp');
});

test('a nota é determinística: o mesmo item, o mesmo instante, a mesma nota', () => {
  assert.equal(nota(base, AGORA), nota({ ...base }, AGORA));
});

test('item sem data não quebra a conta', () => {
  // O GitHub sempre manda `pushed_at`, mas cache velho de um formato anterior
  // pode não ter. `NaN` na nota estragaria a ordenação inteira em silêncio.
  for (const mexido of ['', null, undefined, 'nem data isso é']) {
    const n = nota(com({ mexido }), AGORA);
    assert.ok(Number.isFinite(n), `${mexido} deu ${n}`);
  }
});

test('normalizar guarda o que a tela usa e larga o resto', () => {
  const item = normalizar(
    {
      full_name: 'dono/repo',
      name: 'repo',
      owner: { login: 'dono' },
      description: 'faz coisa',
      stargazers_count: 42,
      language: 'Go',
      license: { spdx_id: 'MIT' },
      topics: ['mcp-server', 'a', 'b', 'c', 'd', 'e', 'f'],
      archived: false,
      created_at: '2026-01-01T00:00:00Z',
      pushed_at: '2026-08-01T00:00:00Z',
      html_url: 'https://github.com/dono/repo',
      // campos que o GitHub manda aos montes e a tela não usa
      forks_count: 9,
      watchers: 3,
      owner_extra: { tudo: 'isso' }
    },
    'mcp'
  );
  assert.equal(item.id, 'dono/repo');
  assert.equal(item.estrelas, 42);
  assert.equal(item.licenca, 'MIT');
  assert.equal(item.topicos.length, 6, 'seis tópicos bastam pra uma linha');
  assert.ok(!('forks_count' in item), 'o resto do GitHub não vai pro cache');
});

test('licença indefinida não vira o rótulo "NOASSERTION"', () => {
  // O GitHub responde `NOASSERTION` quando não reconhece a licença. Mostrar
  // isso ao lado de "MIT" e "Apache-2.0" parece nome de licença.
  const item = normalizar({ full_name: 'a/b', license: { spdx_id: 'NOASSERTION' } }, 'mcp');
  assert.equal(item.licenca, '');
});

test('lixo na resposta não vira item', () => {
  for (const bruto of [null, undefined, {}, { full_name: 42 }, 'texto']) {
    assert.equal(normalizar(bruto, 'mcp'), null, String(bruto));
  }
});

test('as categorias saem prontas pra tela', () => {
  assert.ok(CATEGORIAS.length >= 2);
  for (const c of CATEGORIAS) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.rotulo, 'string');
  }
});
