// A loja: MCPs e skills que existem no GitHub, listados sozinhos.
//
// Lista curada envelhece na semana seguinte — alguém tem que lembrar de editar
// o código toda vez que aparece um servidor MCP novo, e ninguém lembra. Aqui a
// fonte é a busca do próprio GitHub por tópico: quem publica um MCP marca o
// repositório com `mcp-server`, e a lista se atualiza sozinha a partir disso.
//
// Sem chave de API. A busca do GitHub responde a quem não se identifica, com
// teto de dez pedidos por minuto por IP — apertado, e é exatamente por isso que
// o cache aqui vale seis horas e a atualização toda gasta quatro pedidos. Pedir
// chave ao usuário pra ver uma vitrine seria cobrar cadastro por olhar.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';
import { erroTraduzivel } from './erro-traduzivel.mjs';

const CACHE_PATH = join(DATA_DIR, 'loja.json');

/** Seis horas. Repositório não muda de estrela de minuto em minuto. */
const VALIDADE_MS = 6 * 60 * 60 * 1000;

/** Sobe quando o formato do item muda, pra invalidar cache de todo mundo. */
const VERSAO_CACHE = 1;

const UA = 'IAUnifier (loja de MCPs e skills)';

/** Quantos itens por busca. 100 é o teto do GitHub numa página só. */
const POR_BUSCA = 100;

/**
 * O que procurar, por categoria.
 *
 * São tópicos do GitHub, não palavras no README: tópico é declaração de quem
 * publicou ("isto é um servidor MCP"), enquanto texto livre traz todo
 * repositório que menciona a sigla de passagem. Acrescentar categoria aqui é o
 * jeito de crescer a loja — o resto do arquivo não precisa saber quais são.
 */
const FONTES = {
  mcp: {
    rotulo: 'Servidores MCP',
    consultas: ['topic:mcp-server', 'topic:model-context-protocol']
  },
  skill: {
    rotulo: 'Skills',
    consultas: ['topic:claude-skill', 'topic:agent-skills']
  }
};

export const CATEGORIAS = Object.entries(FONTES).map(([id, f]) => ({ id, rotulo: f.rotulo }));

const MES_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Quanto vale "não sei quando foi mexido". Dois anos: não zera o item — ele
 * ainda aparece e ainda é buscável —, mas ninguém o recomenda sem saber se
 * está vivo.
 */
const MESES_SEM_DATA = 24;

/**
 * A meia-fama: com este tanto de estrelas o projeto vale metade da nota de
 * popularidade possível, e daí pra cima o ganho é cada vez menor.
 */
const MEIA_FAMA = 2000;

/**
 * Como reconhecer que o repositório *é* a coisa, e não só conversa com ela.
 *
 * O tópico sozinho não separa: um construtor de currículos com quarenta mil
 * estrelas que ganhou um modo MCP marca `mcp-server` do mesmo jeito que um
 * servidor MCP marca. O que separa é como o projeto se apresenta — quem
 * escreveu um servidor MCP põe isso no nome ou na primeira linha da descrição,
 * e quem escreveu outra coisa fala da outra coisa.
 */
const IDENTIDADE = {
  mcp: { topico: 'mcp-server', diz: /\bmcp\b|model[- ]context[- ]protocol/i },
  skill: { topico: 'claude-skill', diz: /\bskills?\b/i }
};

/**
 * A nota de "recomendado".
 *
 * O ponto é ser diferente de "mais estrelas", que já existe ao lado. Ordenar
 * por estrela com um peso qualquer só devolve a mesma lista: os repositórios
 * enormes ganham de todos os outros por duas ordens de grandeza, e a primeira
 * versão desta função caiu nessa armadilha — o topo de "recomendado" era
 * `gemini-cli` e outros projetos de cem mil estrelas que apenas *falam* MCP.
 *
 * Então a fama satura: passar de duas mil estrelas não rende mais nada. O que
 * decide dali em diante é se o projeto está vivo, se ele é a coisa em si (o
 * tópico canônico da categoria, e não só um tópico vizinho) e se o autor se deu
 * ao trabalho de descrever e licenciar o que publicou.
 *
 * @param {object} item item já normalizado
 * @param {number} agora carimbo de tempo, pra conta ser determinística no teste
 */
export function nota(item, agora = Date.now()) {
  // Arquivado é o autor dizendo "não mexo mais nisto". Não some da lista — quem
  // procurar pelo nome ainda acha —, mas não se recomenda.
  if (item.arquivado) return 0;

  // Curva que satura sem nunca empatar: em duas mil estrelas vale 0,5, em cem
  // mil vale 0,6. Um teto duro seria mais simples, mas empatava a dúzia do topo
  // e aí a ordem entre eles virava sorteio.
  const L = Math.log10((item.estrelas || 0) + 1);
  const fama = L / (L + Math.log10(MEIA_FAMA));
  // Data ilegível vira "faz muito tempo", e não `NaN`. `NaN` não levanta erro:
  // ele se espalha pela conta, sai como nota, e aí `sort` compara `NaN` com
  // número — o resultado é uma lista embaralhada sem nada no console dizendo
  // por quê. Cache de um formato anterior é o jeito de isso acontecer.
  const carimbo = Date.parse(item.mexido || '');
  const meses = Number.isFinite(carimbo) ? Math.max(0, (agora - carimbo) / MES_MS) : MESES_SEM_DATA;
  // Cai pela metade a cada três meses sem um commit. Três e não seis porque em
  // MCP e skill três meses parado já é bastante tempo.
  const frescor = 1 / (1 + meses / 3);
  const id = IDENTIDADE[item.categoria];
  const temTopico = Boolean(id && item.topicos?.includes(id.topico));
  const seApresenta = Boolean(id?.diz.test(`${item.id} ${item.descricao}`));
  // Os dois sinais juntos valem inteiro; um só vale pouco mais da metade;
  // nenhum é um repositório que caiu aqui de raspão.
  const foco = temTopico && seApresenta ? 1 : temTopico || seApresenta ? 0.6 : 0.3;
  const caprichado = 1 + (item.descricao ? 0.15 : 0) + (item.licenca ? 0.15 : 0);

  return fama * frescor * foco * caprichado;
}

/** O que a tela precisa, e nada do resto que o GitHub manda. */
export function normalizar(bruto, categoria) {
  if (!bruto || typeof bruto.full_name !== 'string') return null;
  return {
    id: bruto.full_name,
    categoria,
    nome: String(bruto.name || bruto.full_name),
    dono: String(bruto.owner?.login || bruto.full_name.split('/')[0]),
    descricao: bruto.description ? String(bruto.description).slice(0, 300) : '',
    estrelas: Number(bruto.stargazers_count) || 0,
    linguagem: bruto.language ? String(bruto.language) : '',
    licenca: bruto.license?.spdx_id && bruto.license.spdx_id !== 'NOASSERTION' ? bruto.license.spdx_id : '',
    topicos: Array.isArray(bruto.topics) ? bruto.topics.slice(0, 6).map(String) : [],
    arquivado: Boolean(bruto.archived),
    criado: String(bruto.created_at || ''),
    mexido: String(bruto.pushed_at || bruto.updated_at || ''),
    url: String(bruto.html_url || `https://github.com/${bruto.full_name}`)
  };
}

async function buscarConsulta(consulta, { signal, timeout = 15000 } = {}) {
  const url = new URL('https://api.github.com/search/repositories');
  // `sort=stars` porque o teto é uma página: se for pra ver só 100 de mil, que
  // sejam as 100 que alguém já achou úteis. As outras ordens da tela reordenam
  // este mesmo conjunto, sem voltar à rede.
  url.searchParams.set('q', `${consulta} fork:false`);
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(POR_BUSCA));

  const res = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    headers: { accept: 'application/vnd.github+json', 'user-agent': UA }
  });

  if (res.status === 403 || res.status === 429) {
    // O teto de quem não se identifica é por IP e por minuto. Dizer isso é bem
    // melhor que "HTTP 403", que parece falta de permissão.
    await res.body?.cancel?.();
    throw erroTraduzivel('o GitHub pediu pra esperar: são dez buscas por minuto sem cadastro');
  }
  if (!res.ok) {
    await res.body?.cancel?.();
    throw erroTraduzivel('a busca no GitHub falhou: HTTP {status}', { status: res.status });
  }

  const dados = await res.json();
  if (!Array.isArray(dados?.items)) throw erroTraduzivel('o GitHub respondeu fora do formato');
  return dados.items;
}

/**
 * Vai à rede e monta a lista inteira.
 *
 * @returns {Promise<Array<object>>}
 */
export async function buscarLoja({ signal, timeout } = {}) {
  // Por id, não por índice: os tópicos se sobrepõem de propósito (quem publica
  // marca `mcp-server` *e* `model-context-protocol`), e sem isto o mesmo
  // repositório apareceria duas vezes na vitrine.
  const porId = new Map();

  for (const [categoria, fonte] of Object.entries(FONTES)) {
    for (const consulta of fonte.consultas) {
      const itens = await buscarConsulta(consulta, { signal, timeout });
      for (const bruto of itens) {
        const item = normalizar(bruto, categoria);
        if (!item) continue;
        // Primeira categoria que reivindicar o repositório fica com ele. Um
        // repositório que é as duas coisas é raro, e mostrá-lo nas duas abas
        // faria o contador de cada uma mentir.
        if (!porId.has(item.id)) porId.set(item.id, item);
      }
    }
  }

  return [...porId.values()];
}

// ------------------------------------------------------------------ cache

function lerCache() {
  try {
    const dados = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (!dados || dados.versao !== VERSAO_CACHE) return null;
    if (!Array.isArray(dados.itens) || typeof dados.quando !== 'string') return null;
    if (!Number.isFinite(Date.parse(dados.quando))) return null;
    const itens = dados.itens.filter((i) => i && typeof i.id === 'string');
    if (!itens.length) return null;
    return { quando: dados.quando, itens };
  } catch {
    // Arquivo que não existe, JSON pela metade, disco ilegível: em todos os
    // casos a resposta é "não tenho cache".
    return null;
  }
}

function gravarCache(conteudo) {
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CACHE_PATH, JSON.stringify({ versao: VERSAO_CACHE, ...conteudo }));
  } catch (err) {
    // Não pode derrubar a tela: a lista já está em memória. Mas engolir calado
    // apaga a proteção de cota que justifica o cache existir, e o teto de dez
    // buscas por minuto chega rápido quando toda abertura de tela vai à rede.
    console.warn(`loja: não deu pra gravar o cache em ${CACHE_PATH}: ${err.message}`);
  }
}

/**
 * A loja pronta pra tela: da rede quando o cache venceu, do disco quando não.
 *
 * Não levanta por falha de rede. O app roda na máquina da pessoa e precisa
 * abrir no avião: sem rede e sem cache a resposta é lista vazia com
 * `de: 'vazio'`, e a tela diz isso em vez de mostrar erro.
 *
 * @returns {Promise<{itens: Array<object>, de: 'rede'|'cache'|'vazio', quando: string|null, erro: string|null}>}
 */
export async function lojaEmCache({ signal, validadeMs = VALIDADE_MS, timeout, agora = Date.now() } = {}) {
  const cache = lerCache();
  // `Math.abs` porque carimbo no futuro também é carimbo errado: cache gravado
  // com o relógio adiantado passaria por fresco até a data alcançá-lo.
  if (cache && Math.abs(agora - Date.parse(cache.quando)) < validadeMs) {
    return { itens: cache.itens, de: 'cache', quando: cache.quando, erro: null };
  }

  try {
    const itens = await buscarLoja({ signal, timeout });
    // Lista vazia não é resposta: ou o tópico mudou de nome do lado deles, ou
    // deu algo errado no meio. Cair no cache velho mostra a lista de ontem, que
    // é melhor que uma vitrine vazia.
    if (!itens.length) throw erroTraduzivel('o GitHub devolveu lista vazia');
    const quando = new Date(agora).toISOString();
    gravarCache({ quando, itens });
    return { itens, de: 'rede', quando, erro: null };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // O motivo vai junto: sem ele, "sem internet" e "o GitHub pediu pra
    // esperar" viram a mesma tela vazia, e só a segunda passa sozinha.
    if (cache) return { itens: cache.itens, de: 'cache', quando: cache.quando, erro: err.message };
    return { itens: [], de: 'vazio', quando: null, erro: err.message };
  }
}
