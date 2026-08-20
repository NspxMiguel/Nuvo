// Catálogo de modelos do Hugging Face, sem lista escrita à mão.
//
// O `CATALOGO` do machine.mjs é curadoria: sete modelos escolhidos a dedo, com
// texto explicando pra que serve cada um. Isso envelhece — modelo novo sai toda
// semana e a lista fica falando de coisa de seis meses atrás. Aqui é o
// contrário: a lista vem do Hugging Face na hora, ordenada por download, e o
// que ela perde em explicação ganha em estar certa hoje.
//
// Duas chamadas de rede, e só isso:
//   - a listagem (`/api/models`), uma vez por dia, guardada em disco;
//   - o manifesto de um modelo (`/v2/{id}/manifests/latest`), sob demanda,
//     quando alguém abre o cartão e quer saber o tamanho do download.
//
// A listagem NÃO pede `expand[]=gguf`: esse campo arrasta o chat_template
// inteiro de cada repositório e a resposta pula de 22 KB pra 521 KB, pra
// entregar nada que a tela use.
//
// Nenhuma das duas manda token, cookie ou identificação de quem está usando: o
// que sai daqui é o mesmo pedido anônimo que qualquer pessoa faz no navegador.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';
import { erroTraduzivel } from './erro-traduzivel.mjs';

const CACHE_PATH = join(DATA_DIR, 'catalogo-hf.json');

// Um dia. A lista muda por posição de ranking, não por conteúdo: baixar de novo
// a cada abertura de tela gastaria a cota de pedidos pra ver a mesma coisa.
const VALIDADE_MS = 24 * 60 * 60 * 1000;

// Formato do arquivo de cache. Subir este número descarta o cache de todo mundo
// na próxima leitura, que é o jeito de mudar o formato do item sem quebrar a
// tela de quem já tem arquivo gravado.
const VERSAO_CACHE = 1;

// Teto do recuo do 429 quando já existe cache velho no disco: a resposta boa já
// está em mãos, então esperar é opcional e curto.
const ESPERA_COM_CACHE_MS = 2000;

// Igual ao machine.mjs: GB binário, que é o número do "Sobre este Mac" e o que
// a régua do `classificarCabe` espera receber.
const GB = 1024 ** 3;

const UA = 'Nuvo (catálogo de modelos locais)';

// Teto anônimo do Hugging Face: 500 pedidos por 5 minutos por IP. Montar o
// catálogo inteiro custa 1 + 100 chamadas, então cabe — mas cabe uma vez, não
// dez. É por isso que a listagem tem cache em disco e o manifesto é sob demanda.
const LIMITE_DA_LISTA = 100;

// ------------------------------------------------------------------ família

// Sobrenome do modelo, pra tela poder agrupar "os Qwen", "os Llama". Sai das
// etiquetas do repositório, que é onde o autor declara a arquitetura.
//
// A ordem de teste é do nome mais longo pro mais curto: `codellama` contém
// `llama` dentro, e testando na ordem alfabética todo CodeLlama viraria Llama.
const FAMILIAS = [
  'codellama', 'tinyllama', 'stablelm', 'starcoder', 'nemotron', 'internlm',
  'wizardlm', 'moondream', 'minicpm', 'codestral', 'magistral', 'devstral',
  'pixtral', 'mixtral', 'mistral', 'deepseek', 'granite', 'smollm', 'openchat',
  'baichuan', 'dolphin', 'hermes', 'falcon', 'zephyr', 'vicuna', 'pythia',
  'exaone', 'sailor', 'nomic', 'gemma', 'qwen', 'llama', 'phi', 'olmo',
  'solar', 'orca', 'bloom', 'gpt-oss', 'command-r', 'kimi', 'glm', 'aya',
  'yi', 'mpt', 'bge'
].sort((a, b) => b.length - a.length);

// A busca dentro da etiqueta é presa a começo e fim de palavra, com dígito
// liberado no fim porque a versão gruda no nome (`qwen3`, `phi4`, `gemma3`).
// Sem essa trava, `yi` casava com `roleplaying` e `llama` com `codellama`.
const FAMILIAS_REGEX = FAMILIAS.map((familia) => [
  familia,
  new RegExp(`(?<![a-z])${familia}(?![a-z])`, 'i')
]);

// Etiqueta que só serve pra máquina: referência de artigo, repositório de
// origem, região do bucket. Ninguém quer isso como crachá na tela.
const TAGS_RUIDO = /^(arxiv|base_model|doi|region|dataset|paper|license):/i;

// Etiqueta que é o nome do PROGRAMA que roda o modelo, não da família dele.
// Um em cada cinco repositórios da lista traz `llama.cpp`, e como `llama` casa
// ali dentro, todo Qwen convertido com llama.cpp virava família Llama.
const TAGS_DE_FERRAMENTA = /^(llama[._-]?cpp|llamafile|llama[._-]factory|ollama|text-generation-inference|transformers|unsloth|endpoints_compatible)$/i;

// Palavra que fica feia com só a primeira letra maiúscula: "Gpt Oss" em vez de
// "GPT OSS". O resto do nome mantém a caixa que o autor escolheu.
const SIGLAS = new Set(['gpt', 'oss', 'moe', 'vl', 'llm', 'ai', 'sft', 'dpo', 'qat', 'it']);

/**
 * O id do repositório escrito pra gente ler.
 *
 * `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF` → `Qwen3 Coder 30B A3B Instruct`.
 * O dono do repositório sai porque a tela já mostra o id inteiro embaixo, e o
 * `GGUF` sai porque todo modelo desta lista é GGUF — repetir isso cem vezes não
 * distingue nada.
 */
function nomeLegivel(id) {
  const semDono = String(id).split('/').pop() || String(id);
  const partes = semDono
    .replace(/\.gguf$/i, '')
    .split(/[-_\s]+/)
    .filter((parte) => parte && !/^i?gguf$/i.test(parte))
    .map((parte) => {
      // `30b`, `8x7b`, `1.5b`: tamanho é sempre B maiúsculo pra não virar bit.
      // O `x` do meio fica minúsculo porque ali ele é multiplicação, não sigla:
      // subindo a palavra inteira o Mixtral saía como `8X7B`, e o nome que todo
      // mundo escreve é `8x7B`.
      if (/^\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?b$/i.test(parte)) return parte.toUpperCase().replace(/X/g, 'x');
      if (SIGLAS.has(parte.toLowerCase())) return parte.toUpperCase();
      return parte;
    });
  const nome = partes.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!nome) return String(id);
  // Só a primeira letra: capitalizar palavra por palavra estragaria nome que o
  // autor escreveu de propósito em caixa mista, tipo `deepseek-v4` ou `gpt-oss`.
  return nome[0].toUpperCase() + nome.slice(1);
}

/** A família derivada das etiquetas; `outros` quando nenhuma bate. */
function familiaDe(id, tags) {
  const marcas = [];
  for (const tag of tags) {
    const limpo = String(tag).toLowerCase().trim();
    if (!limpo || TAGS_DE_FERRAMENTA.test(limpo)) continue;
    // `base_model:quantized:Qwen/Qwen3-...` carrega o nome do modelo de origem
    // depois dos dois-pontos, e é aí que a família aparece quando o autor não
    // etiquetou a arquitetura direto.
    marcas.push(limpo.includes(':') ? limpo.slice(limpo.lastIndexOf(':') + 1) : limpo);
  }
  // Etiqueta exata primeiro: `qwen` cravado vale mais que `qwen` achado no meio
  // do nome de outro repositório.
  for (const familia of FAMILIAS) if (marcas.includes(familia)) return familia;
  // Depois, na ordem em que o repositório escreveu: a arquitetura aparece antes
  // do `base_model`, e é ela que manda quando as duas discordam — modelo Qwen
  // destilado de um Llama é Qwen.
  for (const marca of marcas) {
    for (const [familia, regex] of FAMILIAS_REGEX) if (regex.test(marca)) return familia;
  }
  // O id é o último recurso: repositório sem etiqueta de arquitetura quase
  // sempre carrega o nome da família no próprio nome do arquivo.
  for (const [familia, regex] of FAMILIAS_REGEX) if (regex.test(id)) return familia;
  return 'outros';
}

/**
 * Etiquetas que valem crachá na tela.
 *
 * Tudo em minúscula porque o mesmo repositório traz `GGUF` e `gguf` na mesma
 * lista, e sem normalizar a tela mostra o crachá duas vezes.
 */
function tagsUteis(tags) {
  const vistas = new Set();
  const saida = [];
  for (const tag of tags) {
    const limpo = String(tag).trim().toLowerCase();
    if (!limpo || TAGS_RUIDO.test(limpo) || vistas.has(limpo)) continue;
    vistas.add(limpo);
    saida.push(limpo);
    if (saida.length >= 24) break;
  }
  return saida;
}

// -------------------------------------------------------------------- rede

/**
 * Prazo estourado, já em português e com código pra quem chamou reconhecer.
 *
 * O `fetch` e a leitura do corpo rejeitam com `AbortError` — "This operation
 * was aborted", em inglês. Traduzir aqui na borda é o que impede esse texto de
 * aparecer ao lado do cartão do modelo, numa tela em português, como se fosse
 * defeito do repositório.
 */
function erroDePrazo(timeout) {
  const err = new Error(`o Hugging Face não respondeu em ${Math.round(timeout / 1000)}s`);
  err.code = 'PRAZO';
  return err;
}

/** Cancelamento pedido por quem chamou, separado de falha de rede. */
function erroCancelado() {
  const err = new Error('a busca no Hugging Face foi cancelada');
  err.code = 'CANCELADO';
  return err;
}

function ehAborto(err) {
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
}

/**
 * Solta o corpo que ninguém vai ler.
 *
 * No undici a conexão só volta pro pool quando o corpo é consumido ou
 * cancelado: sair de um 429 ou de um 401 sem fazer isso segura o soquete até o
 * coletor de lixo passar, justamente no caminho que roda quando a cota já está
 * apertada.
 */
async function soltarCorpo(res) {
  const corpo = res?.body;
  if (!corpo) return;
  try {
    if (typeof corpo.cancel === 'function') await corpo.cancel();
    else if (typeof corpo.getReader === 'function') await corpo.getReader().cancel();
  } catch {
    // Corpo já fechado ou já lido: não há o que soltar.
  }
}

/**
 * A resposta com o prazo ainda de pé, porque o corpo também tem que caber nele.
 *
 * Defeito concreto que isto conserta: com o `clearTimeout` logo depois do
 * `await fetch`, um servidor que responde `200` + `content-type: json`, escreve
 * `[` e para (proxy, portal cativo, CDN meia-boca) deixava o `res.json()`
 * pendurado pra sempre — e o `GET /api/catalogo`, que chama sem signal, nunca
 * respondia. O prazo cobria só a chegada dos cabeçalhos.
 */
function comPrazoNoCorpo(res, { corrida, encerrar }) {
  const ateOFim = async (promessa) => {
    try {
      return await corrida(promessa);
    } finally {
      encerrar();
    }
  };
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    json: () => ateOFim(res.json()),
    text: () => ateOFim(res.text()),
    /** Sai sem ler: solta o corpo e para o relógio. */
    async descartar() {
      try {
        await soltarCorpo(res);
      } finally {
        encerrar();
      }
    }
  };
}

/** Fetch com prazo que vale até o fim do corpo, não só até o cabeçalho. */
async function buscarComPrazo(url, { signal, timeout = 15000 } = {}) {
  // Cancelado antes de começar não dispara evento nenhum: sem esta linha o
  // pedido sairia mesmo depois de quem pediu já ter desistido.
  if (signal?.aborted) throw erroCancelado();

  const ctrl = new AbortController();
  let estourou = false;
  let interromper;
  const interrupcao = new Promise((_, reject) => {
    interromper = reject;
  });
  // No caminho normal ninguém espera esta promessa (o corpo chega antes do
  // prazo); sem este catch vazio, o dia em que ela rejeita derruba o processo
  // por unhandledRejection.
  interrupcao.catch(() => {});

  const timer = setTimeout(() => {
    estourou = true;
    ctrl.abort();
    interromper(erroDePrazo(timeout));
  }, timeout);

  const aoAbortar = () => {
    ctrl.abort();
    interromper(erroCancelado());
  };
  signal?.addEventListener?.('abort', aoAbortar, { once: true });

  // Defeito concreto: sem tirar o ouvinte no caminho de sucesso, 50 medições
  // com o mesmo AbortController deixavam 50 ouvintes pendurados no signal de
  // quem chamou, cada um segurando o controller interno daquele pedido.
  const encerrar = () => {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', aoAbortar);
  };

  const corrida = async (promessa) => {
    try {
      return await Promise.race([promessa, interrupcao]);
    } catch (err) {
      if (err?.code === 'PRAZO' || err?.code === 'CANCELADO') throw err;
      if (!ehAborto(err)) throw err;
      // O AbortError cru chega aqui quando o `fetch` reage ao nosso controller
      // antes de a interrupção resolver a corrida. Traduzir na borda.
      throw estourou ? erroDePrazo(timeout) : erroCancelado();
    }
  };

  let res;
  try {
    res = await corrida(
      fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'application/json' }
      })
    );
  } catch (err) {
    encerrar();
    throw err;
  }
  return comPrazoNoCorpo(res, { corrida, encerrar });
}

/**
 * Segundos que faltam pra janela de cota virar, lidos do cabeçalho `ratelimit`.
 *
 * O formato é `"api";r=499;t=58`: `r` é quanto sobrou, `t` é quanto falta pro
 * contador zerar. Num 429 o `r` é zero e o `t` é a espera de verdade.
 */
function esperaDoCabecalho(cabecalho, esperaMaxMs) {
  const achou = /(?:^|;)\s*t\s*=\s*(\d+)/i.exec(String(cabecalho || ''));
  // Sem cabeçalho legível ainda vale tentar de novo, só que rápido: pode ter
  // sido um pico de um segundo, e desistir na primeira negativa devolveria a
  // tela vazia por nada.
  const ms = achou ? Number(achou[1]) * 1000 : 2000;
  // A janela é de 5 minutos. Esperar os 5 minutos inteiros congelaria a tela
  // pra sempre — melhor devolver o 429 e deixar quem chamou cair no cache.
  return Math.min(Math.max(ms, 0), esperaMaxMs);
}

function dormir(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(erroCancelado());
    const aoAbortar = () => {
      clearTimeout(timer);
      reject(erroCancelado());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', aoAbortar);
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', aoAbortar, { once: true });
  });
}

/** Pedido com prazo e com uma espera quando o Hugging Face pede calma. */
async function pedir(url, { signal, timeout, tentativas = 3, esperaMaxMs = 60000 } = {}) {
  for (let tentativa = 1; ; tentativa += 1) {
    const res = await buscarComPrazo(url, { signal, timeout });
    if (res.status !== 429 || tentativa >= tentativas) return res;
    const espera = esperaDoCabecalho(res.headers?.get?.('ratelimit'), esperaMaxMs);
    // O corpo do 429 ninguém lê: soltar antes de dormir devolve o soquete pro
    // pool em vez de deixá-lo preso durante a espera inteira.
    await res.descartar();
    await dormir(espera, signal);
  }
}

function urlDaLista(limite) {
  const params = new URLSearchParams({
    // `apps=ollama` é o filtro que importa: devolve só repositório que o Ollama
    // consegue puxar. Tentar o mesmo com `library=gguf` não funciona — o
    // parâmetro é ignorado calado e a resposta volta cheia de BERT.
    apps: 'ollama',
    pipeline_tag: 'text-generation',
    gated: 'false',
    // `sort=trending` devolve 400; o nome do campo é `trendingScore`. Download
    // é ordenação mais honesta pra "as IAs mais conhecidas", que é o pedido.
    sort: 'downloads',
    direction: '-1',
    limit: String(limite)
  });
  for (const campo of ['gated', 'downloads', 'likes', 'tags', 'lastModified']) {
    params.append('expand[]', campo);
  }
  return `https://huggingface.co/api/models?${params}`;
}

/** Um item da resposta virado no formato da tela; `null` se não servir. */
function normalizar(bruto) {
  const id = typeof bruto?.id === 'string' ? bruto.id.trim() : '';
  if (!id) return null;
  // O filtro `gated=false` já deveria ter tirado esses, mas modelo com licença
  // pra aceitar é botão de baixar que não baixa: fora da lista.
  if (bruto.gated) return null;
  const tags = Array.isArray(bruto.tags) ? bruto.tags : [];
  return {
    id,
    nome_legivel: nomeLegivel(id),
    downloads: Number.isFinite(bruto.downloads) ? bruto.downloads : 0,
    likes: Number.isFinite(bruto.likes) ? bruto.likes : 0,
    familia: familiaDe(id, tags),
    tags: tagsUteis(tags),
    atualizado: typeof bruto.lastModified === 'string' ? bruto.lastModified : null
  };
}

/**
 * Os modelos mais baixados que o Ollama consegue puxar.
 *
 * Levanta exceção quando a rede ou o formato falham — quem quer a versão que
 * nunca falha usa `catalogoEmCache`.
 *
 * @returns {Promise<Array<{id: string, nome_legivel: string, downloads: number,
 *   likes: number, familia: string, tags: string[], atualizado: string|null}>>}
 */
export async function buscarCatalogo({ limite = LIMITE_DA_LISTA, signal, timeout, tentativas, esperaMaxMs } = {}) {
  const pedido = Math.trunc(Number(limite));
  const alvo = urlDaLista(Math.min(Math.max(Number.isFinite(pedido) ? pedido : LIMITE_DA_LISTA, 1), LIMITE_DA_LISTA));
  const res = await pedir(alvo, { signal, timeout, tentativas, esperaMaxMs });
  if (!res.ok) {
    await res.descartar();
    throw erroTraduzivel('catálogo do Hugging Face falhou: HTTP {status}', { status: res.status });
  }
  const bruto = await res.json();
  if (!Array.isArray(bruto)) throw new Error('catálogo do Hugging Face veio fora do formato');
  return bruto.map(normalizar).filter(Boolean);
}

// ---------------------------------------------------------------- medição

/** Mensagem de erro do corpo, sem explodir se o corpo não for JSON. */
async function motivoDoCorpo(res) {
  try {
    const texto = await res.text();
    try {
      const dados = JSON.parse(texto);
      return String(dados?.error || texto || '').trim();
    } catch {
      return String(texto || '').trim();
    }
  } catch {
    return '';
  }
}

/**
 * Tamanho real do download e se dá pra baixar.
 *
 * O manifesto do registro do Ollama responde as duas coisas de uma vez, e é por
 * isso que ele é o filtro de risco da tela: o número em `layers[]` é o arquivo
 * que vai descer, e o código de erro diz por que não desceria.
 *
 *   200                                → `ok`, com o tamanho
 *   400 "Repository is not GGUF"       → `sem_gguf`
 *   400 "only contains sharded GGUF"   → `fragmentado` (o `apps=ollama` deixa passar)
 *   401/403                            → `gated`
 *
 * `cancelado` é estado próprio, e não `erro`: quem passou o `signal` e desistiu
 * precisa distinguir isso de "o repositório está quebrado".
 *
 * @returns {Promise<{gb: number|null, estado: 'ok'|'sem_gguf'|'fragmentado'|'gated'|'cancelado'|'erro', motivo?: string}>}
 */
export async function medirModelo(id, { signal, timeout, tentativas, esperaMaxMs } = {}) {
  const limpo = String(id ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!limpo) return { gb: null, estado: 'erro', motivo: 'sem id de modelo' };

  // Codifica pedaço por pedaço pra barra entre dono e repositório continuar
  // sendo caminho, e não virar `%2F`.
  //
  // `.` e `..` caem fora antes disso porque `encodeURIComponent` não codifica
  // ponto: o `fetch` normalizava a URL e `a/../../settings/tokens` chegava no
  // servidor como `/settings/tokens/manifests/latest`, fora do `/v2/`. O id vem
  // cru do query string, e id nenhum pode escolher a rota.
  const partes = limpo.split('/').filter((parte) => parte && parte !== '.' && parte !== '..');
  if (!partes.length) return { gb: null, estado: 'erro', motivo: 'sem id de modelo' };
  const caminho = partes.map(encodeURIComponent).join('/');

  let res;
  try {
    res = await pedir(`https://huggingface.co/v2/${caminho}/manifests/latest`, {
      signal,
      timeout,
      tentativas,
      esperaMaxMs
    });
  } catch (err) {
    if (err?.code === 'CANCELADO') {
      return { gb: null, estado: 'cancelado', motivo: 'a medição foi cancelada' };
    }
    return { gb: null, estado: 'erro', motivo: err.message };
  }

  if (res.status === 401 || res.status === 403) {
    await res.descartar();
    return {
      gb: null,
      estado: 'gated',
      motivo: 'precisa aceitar a licença no site do modelo'
    };
  }

  if (res.status === 400) {
    const motivo = await motivoDoCorpo(res);
    if (/shard/i.test(motivo)) {
      return {
        gb: null,
        estado: 'fragmentado',
        motivo: 'o modelo está partido em vários arquivos e o Ollama não baixa assim'
      };
    }
    return { gb: null, estado: 'sem_gguf', motivo: motivo || 'o repositório não é GGUF' };
  }

  // 404 aqui não é falha de rede: é repositório que não tem manifesto nenhum pra
  // puxar. Pra quem chama dá no mesmo que não ser GGUF — não baixa, e tentar de
  // novo não muda —, então vale o mesmo estado em vez de um `erro` que convida
  // a repetir o pedido.
  if (res.status === 404) {
    await res.descartar();
    return { gb: null, estado: 'sem_gguf', motivo: 'não existe manifesto pra esse repositório' };
  }

  if (!res.ok) {
    const motivo = await motivoDoCorpo(res);
    return { gb: null, estado: 'erro', motivo: motivo || `HTTP ${res.status}` };
  }

  let manifesto;
  try {
    manifesto = await res.json();
  } catch (err) {
    // Corpo que trava depois do 200 e cancelamento no meio da leitura chegam
    // por aqui: dizer "fora do formato" pra esses dois é acusar o repositório
    // de um defeito que é da conexão.
    if (err?.code === 'CANCELADO') {
      return { gb: null, estado: 'cancelado', motivo: 'a medição foi cancelada' };
    }
    if (err?.code === 'PRAZO') return { gb: null, estado: 'erro', motivo: err.message };
    return { gb: null, estado: 'erro', motivo: 'o manifesto veio fora do formato' };
  }

  const camadas = Array.isArray(manifesto?.layers) ? manifesto.layers : [];
  // As outras camadas são o template do chat e os parâmetros, uns poucos
  // quilobytes. O peso do download está só nesta.
  const modelo = camadas.find((c) => c?.mediaType === 'application/vnd.ollama.image.model');
  if (!modelo || !Number.isFinite(modelo.size) || modelo.size <= 0) {
    // Sem o tamanho não dá pra prometer que cabe na máquina, e prometer errado
    // é justamente o defeito que a tela existe pra evitar.
    return { gb: null, estado: 'erro', motivo: 'o manifesto não diz o tamanho do modelo' };
  }

  return { gb: Math.round((modelo.size / GB) * 10) / 10, estado: 'ok' };
}

// ------------------------------------------------------------------ cache

function lerCache() {
  try {
    const dados = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (!dados || !Array.isArray(dados.modelos) || typeof dados.quando !== 'string') return null;
    // O carimbo de versão só serve pra alguma coisa se alguém conferir: sem
    // isto, o dia em que o formato do item mudar (renomear `nome_legivel`, por
    // exemplo) todo mundo que já tem cache vê a tela quebrada por 24h, sem jeito
    // de invalidar.
    if (dados.versao !== VERSAO_CACHE) return null;
    if (!Number.isFinite(Date.parse(dados.quando))) return null;
    const modelos = dados.modelos.filter((m) => m && typeof m.id === 'string');
    if (!modelos.length) return null;
    return { quando: dados.quando, modelos };
  } catch {
    // Arquivo que não existe, JSON pela metade de um desligamento no meio da
    // escrita, disco ilegível: em todos os casos a resposta é "não tenho cache".
    return null;
  }
}

function gravarCache(conteudo) {
  try {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CACHE_PATH, JSON.stringify({ versao: VERSAO_CACHE, ...conteudo }));
  } catch (err) {
    // Disco cheio ou pasta só de leitura não pode derrubar a tela: o catálogo
    // já está em memória, só não vai sobreviver ao próximo start.
    //
    // Mas engolir calado apaga a proteção de cota que justifica este cache
    // existir: com `~/.nuvo` só-leitura, três aberturas de tela viravam
    // três idas à rede (1 listagem + N manifestos cada) e ninguém ficava
    // sabendo — até chegar o 429.
    console.warn(`catálogo do Hugging Face: não deu pra gravar o cache em ${CACHE_PATH}: ${err.message}`);
  }
}

/**
 * O catálogo pronto pra tela: da rede quando vale a pena, do disco quando não.
 *
 * Não levanta exceção por falha de rede. O app roda na máquina da pessoa e
 * precisa abrir no avião: sem rede e sem cache a resposta é lista vazia com
 * `de: 'vazio'`, e quem chama é que decide cair no catálogo curado do
 * machine.mjs. A única exceção que sai daqui é o cancelamento pelo `signal`.
 *
 * @returns {Promise<{modelos: Array<object>, de: 'rede'|'cache'|'vazio', quando: string|null}>}
 */
export async function catalogoEmCache({
  signal,
  limite = LIMITE_DA_LISTA,
  validadeMs = VALIDADE_MS,
  timeout,
  tentativas,
  esperaMaxMs
} = {}) {
  const cache = lerCache();
  const agora = Date.now();
  // `Math.abs` porque carimbo no futuro também é carimbo errado: cache gravado
  // com o relógio adiantado (ou copiado de outra máquina) dava diferença
  // negativa, passava por "fresco" e a tela ficava presa nele até a data
  // alcançar o carimbo — 400 dias à frente, medido, sem um pedido de rede.
  if (cache && Math.abs(agora - Date.parse(cache.quando)) < validadeMs) {
    return { modelos: cache.modelos, de: 'cache', quando: cache.quando };
  }

  // Com cache velho em mãos, o recuo do 429 é curto: a lista que ele devolveria
  // já estava lida em memória no milissegundo zero. Com o teto padrão de 60s e
  // três tentativas, um `ratelimit: "api";r=0;t=241` fazia o `GET /api/catalogo`
  // dormir 120s pra no fim entregar exatamente esse cache.
  const recuo = cache
    ? { tentativas: tentativas ?? 2, esperaMaxMs: esperaMaxMs ?? ESPERA_COM_CACHE_MS }
    : { tentativas, esperaMaxMs };

  try {
    const modelos = await buscarCatalogo({ limite, signal, timeout, ...recuo });
    // Lista vazia não é resposta: ou o filtro mudou de nome do lado deles, ou
    // deu algo errado no meio. Cair no cache velho mostra modelo de ontem, que
    // é melhor que uma tela sem nada.
    if (!modelos.length) throw new Error('o Hugging Face devolveu lista vazia');
    const quando = new Date(agora).toISOString();
    gravarCache({ quando, modelos });
    return { modelos, de: 'rede', quando };
  } catch (err) {
    // Cancelamento é pedido explícito de parar, não falha de rede: devolver o
    // cache velho aqui esconderia de quem cancelou que ele mesmo desistiu, e
    // `de: 'vazio'` mentiria dizendo que não há catálogo nenhum.
    if (err?.code === 'CANCELADO') throw err;
    if (cache) return { modelos: cache.modelos, de: 'cache', quando: cache.quando };
    return { modelos: [], de: 'vazio', quando: null };
  }
}
