// A loja sem internet.
//
// O app roda na máquina da pessoa e precisa abrir no avião. Uma vitrine que
// levanta exceção quando o GitHub não responde derruba a tela inteira por causa
// de uma seção secundária, então aqui se cobra o contrário: falha de rede vira
// resposta, com `de` dizendo de onde a lista veio.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers.mjs';

const temp = useTempHome();
after(() => temp.cleanup());

const { DATA_DIR } = await import('../server/config.mjs');
const { lojaEmCache } = await import('../server/loja.mjs');

const CACHE = join(DATA_DIR, 'loja.json');
const item = {
  id: 'alguem/coisa-mcp',
  categoria: 'mcp',
  nome: 'coisa-mcp',
  dono: 'alguem',
  descricao: 'MCP server',
  estrelas: 10,
  topicos: ['mcp-server'],
  mexido: '2026-08-01T00:00:00Z',
  criado: '2026-01-01T00:00:00Z',
  url: 'https://github.com/alguem/coisa-mcp'
};

function gravar(conteudo) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CACHE, JSON.stringify(conteudo));
}

test('sem rede e sem cache: lista vazia, não exceção', async () => {
  gravar({ versao: 1, quando: '', itens: [] });
  // Um milissegundo não dá pra alcançar o GitHub nem na melhor das redes, o que
  // torna este teste igual com ou sem internet na máquina de quem roda.
  const r = await lojaEmCache({ timeout: 1 });
  assert.deepEqual(r.itens, []);
  assert.equal(r.de, 'vazio');
  assert.ok(r.erro, 'o motivo tem que vir junto: "sem internet" e "espere um minuto" pedem coisas diferentes');
});

test('cache fresco não vai à rede', async () => {
  const quando = new Date().toISOString();
  gravar({ versao: 1, quando, itens: [item] });
  // `timeout: 1` provaria a ida à rede falhando; como ele devolve o cache, a
  // rede não foi consultada.
  const r = await lojaEmCache({ timeout: 1 });
  assert.equal(r.de, 'cache');
  assert.equal(r.itens.length, 1);
  assert.equal(r.erro, null);
});

test('cache vencido e rede caída: mostra a lista de ontem, e diz que é de ontem', async () => {
  const ontem = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  gravar({ versao: 1, quando: ontem, itens: [item] });
  const r = await lojaEmCache({ timeout: 1, validadeMs: 1000 });
  assert.equal(r.de, 'cache');
  assert.equal(r.quando, ontem);
  assert.ok(r.erro, 'sem o motivo, a tela não sabe dizer por que não atualizou');
});

test('carimbo no futuro não segura o cache pra sempre', async () => {
  // Relógio adiantado, ou banco copiado de outra máquina: a diferença dava
  // negativa, passava por "fresco" e a lista congelava até a data alcançar o
  // carimbo.
  const daquiAUmAno = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  gravar({ versao: 1, quando: daquiAUmAno, itens: [item] });
  const r = await lojaEmCache({ timeout: 1 });
  assert.ok(r.erro, 'devia ter tentado a rede em vez de aceitar o carimbo do futuro');
});

test('cache de outra versão de formato é descartado', async () => {
  gravar({ versao: 999, quando: new Date().toISOString(), itens: [item] });
  const r = await lojaEmCache({ timeout: 1 });
  assert.notEqual(r.de, 'cache');
});

test('arquivo corrompido não derruba a tela', async () => {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CACHE, '{ isto não é json');
  const r = await lojaEmCache({ timeout: 1 });
  assert.equal(r.de, 'vazio');
});
