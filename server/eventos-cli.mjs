// Tradução do JSONL das IAs de linha de comando pro vocabulário de evento da
// tela de programar.
//
// As três CLIs que o app usa sabem falar JSON estruturado, e cada uma fala o
// seu dialeto: o `claude` manda blocos de mensagem da API, o `codex` manda
// itens de turno, o `opencode` manda partes de passo. Este arquivo é o único
// lugar que conhece os três — o resto do app recebe sempre { delta },
// { reasoning } ou { evento }.
//
// Nada aqui foi deduzido da documentação: cada regra saiu de uma execução de
// verdade, guardada em test/amostras/*.jsonl, e o teste roda essas amostras
// linha a linha. Formato que não aparece na amostra não é tratado, porque
// adivinhar campo de CLI dá evento errado na tela em vez de evento nenhum.

import { realpathSync } from 'node:fs';

/**
 * Como pedir JSONL a cada comando conhecido.
 *
 * `args` são só os argumentos que ligam o modo estruturado; modelo e o resto
 * continuam na configuração do provedor. Comando fora desta tabela não tem
 * modo estruturado que a gente conheça, e quem chama volta pro texto puro de
 * hoje.
 */
export const ARGS_ESTRUTURADO = {
  claude: {
    args: [
      '-p',
      '--output-format',
      'stream-json',
      // O `claude` recusa stream-json sem --verbose: reclama na saída de erro e
      // sai sem escrever uma linha sequer.
      '--verbose',
      // Sem isto o texto só chega quando o bloco inteiro termina — a resposta
      // aparece de uma vez, depois de segundos de tela parada. Com a bandeira
      // vêm as linhas 'stream_event', que é de onde sai cada { delta }.
      '--include-partial-messages',
      // No modo code a IA edita arquivo da pasta do projeto. No padrão ela para
      // e pergunta se pode, esperando uma resposta que ninguém vai digitar: o
      // processo fica pendurado até o prazo estourar.
      '--permission-mode',
      'acceptEdits'
    ],
    stdin: true
  },
  codex: {
    // O `-` do fim é o que manda o codex ler o pedido do stdin; `--json` troca
    // a saída bonita por uma linha de JSON por evento.
    args: ['exec', '--json', '--skip-git-repo-check', '-'],
    stdin: true
  },
  opencode: {
    args: ['run', '--format', 'json'],
    stdin: true
  }
};

/** Só o nome do binário, que é a chave das tabelas daqui. */
export function nomeDoComando(comando) {
  const nome = String(comando || '')
    .trim()
    .split(/[\\/]/)
    .pop()
    .toLowerCase();
  return nome.endsWith('.exe') ? nome.slice(0, -4) : nome;
}

const MARCA = '\n[...]\n';

/**
 * Corta pelo meio, guardando o começo e o fim.
 *
 * Saída de comando é assim: o começo diz o que ele fez e o fim diz se deu
 * certo. Cortar só o fim (o `slice` de sempre) joga fora justamente a linha do
 * erro, que é o que a pessoa está procurando quando abre o painel.
 */
export function cortar(texto, limite = 4000) {
  const inteiro = String(texto ?? '');
  if (inteiro.length <= limite) return inteiro;
  if (limite <= MARCA.length) return inteiro.slice(0, Math.max(limite, 0));
  const sobra = limite - MARCA.length;
  const inicio = Math.ceil(sobra / 2);
  const fim = sobra - inicio;
  return inteiro.slice(0, inicio) + MARCA + (fim > 0 ? inteiro.slice(inteiro.length - fim) : '');
}

/**
 * Uma linha de JSONL vira uma lista de pedaços pro adaptador.
 *
 * O terceiro argumento é a pasta do projeto, e é opcional de propósito: quem
 * chamar com dois argumentos continua funcionando. O contrato pede o caminho
 * relativo a essa pasta e nenhuma das três CLIs manda relativo — o `claude` e o
 * `opencode` mandam o caminho absoluto do arquivo. Sem a raiz o caminho passa
 * inteiro, que é o que existe, e a tela mostra só o nome do arquivo.
 *
 * Nunca levanta exceção: linha torta de um CLI derrubaria a conversa inteira, e
 * o preço de ignorá-la é uma linha a menos no painel.
 */
export function traduzirLinha(comando, linha, raiz = '') {
  try {
    const dados = lerJson(linha);
    if (!dados) return [];
    switch (nomeDoComando(comando)) {
      case 'claude':
        return traduzirClaude(dados, raiz);
      case 'codex':
        return traduzirCodex(dados, raiz);
      case 'opencode':
        return traduzirOpencode(dados, raiz);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/** JSON que não é objeto não é evento — `null` e `[1,2]` passam pelo parse. */
function lerJson(linha) {
  const texto = String(linha ?? '').trim();
  if (!texto.startsWith('{')) return null;
  try {
    const dados = JSON.parse(texto);
    return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- claude

function traduzirClaude(dados, raiz) {
  if (dados.type === 'stream_event') {
    const evento = dados.event || {};
    if (evento.type !== 'content_block_delta') return [];
    const pedaco = evento.delta || {};
    if (pedaco.type === 'text_delta' && pedaco.text) return [{ delta: pedaco.text }];
    if (pedaco.type === 'thinking_delta' && pedaco.thinking) return [{ reasoning: pedaco.thinking }];
    // O 'input_json_delta' chega picado no meio de uma chave (`{"file_pa`), então
    // não dá pra ler linha a linha. O bloco 'tool_use' inteiro vem logo depois,
    // na linha 'assistant', e é de lá que sai o evento de ferramenta.
    return [];
  }
  if (dados.type === 'assistant') return ferramentasDoClaude(dados.message, raiz);
  if (dados.type === 'user') return saidasDoClaude(dados.message);
  if (dados.type === 'result') {
    return [
      {
        evento: {
          tipo: 'fim',
          ms: numero(dados.duration_ms),
          custo: numero(dados.total_cost_usd),
          turnos: numero(dados.num_turns)
        }
      }
    ];
  }
  // 'system' (init, status, post_turn_summary) e 'rate_limit_event' não contam
  // nada sobre o trabalho; virariam linha muda no painel.
  return [];
}

/**
 * Da linha 'assistant' só aproveitamos 'tool_use'.
 *
 * Os blocos 'text' e 'thinking' repetem o que já foi enviado em pedaço pelos
 * 'stream_event' — na amostra test/amostras/claude-parcial.jsonl o delta "ok"
 * chega numa linha e a mensagem completa "ok" na linha seguinte. Emitir os dois
 * escreveria a resposta duas vezes na tela, e o streaming é o que faz a tela
 * andar enquanto o modelo pensa, então quem ganha é o delta. O custo dessa
 * escolha é que rodar o `claude` sem --include-partial-messages não mostra
 * texto nenhum — por isso a bandeira está em ARGS_ESTRUTURADO, e não é opcional.
 */
function ferramentasDoClaude(mensagem, raiz) {
  const blocos = mensagem?.content;
  if (!Array.isArray(blocos)) return [];
  const pecas = [];
  for (const bloco of blocos) {
    if (bloco?.type !== 'tool_use') continue;
    pecas.push(daFerramenta(bloco.id, bloco.name, bloco.input, raiz));
  }
  return pecas;
}

/** O resultado da ferramenta volta numa linha 'user', casado por tool_use_id. */
function saidasDoClaude(mensagem) {
  const blocos = mensagem?.content;
  if (!Array.isArray(blocos)) return [];
  const pecas = [];
  for (const bloco of blocos) {
    if (bloco?.type !== 'tool_result') continue;
    pecas.push({
      evento: {
        tipo: 'saida',
        id: String(bloco.tool_use_id || ''),
        texto: cortar(textoDeResultado(bloco.content)),
        ok: !bloco.is_error
      }
    });
  }
  return pecas;
}

/** O conteúdo do resultado é texto direto ou uma lista de blocos de texto. */
function textoDeResultado(conteudo) {
  if (typeof conteudo === 'string') return conteudo;
  if (!Array.isArray(conteudo)) return '';
  return conteudo
    .map((bloco) => (typeof bloco === 'string' ? bloco : bloco?.text || ''))
    .filter(Boolean)
    .join('\n');
}

// ----------------------------------------------------------------- codex

function traduzirCodex(dados, raiz) {
  const item = dados.item || {};
  // O 'item.started' é quem abre a ferramenta na tela; o 'item.completed'
  // repete os mesmos campos com a saída preenchida. Abrir de novo no completed
  // duplicaria a linha, então cada um cuida de uma metade.
  if (dados.type === 'item.started' && item.type === 'command_execution') {
    return [deLinhaDeShell(item.id, item.command, raiz)];
  }
  if (dados.type === 'item.completed') {
    if (item.type === 'command_execution') {
      return [
        {
          evento: {
            tipo: 'saida',
            id: String(item.id || ''),
            texto: cortar(item.aggregated_output || ''),
            ok: item.exit_code === 0
          }
        }
      ];
    }
    if (item.type === 'agent_message' && item.text) {
      // O codex não manda texto em pedaço: cada agent_message é um parágrafo
      // pronto. Na amostra vêm dois no mesmo turno ("Vou ler o arquivo." e
      // "soma"), e sem a linha em branco eles grudam num "arquivo.soma".
      return [{ delta: `${item.text}\n\n` }];
    }
    return [];
  }
  if (dados.type === 'turn.completed') {
    // O 'turn.completed' do codex só traz `usage` — não há duração, preço nem
    // contagem de turnos pra informar, e o contrato não tem campo pra tokens.
    // O evento vai mesmo assim porque é ele que marca o fim do trabalho.
    return [{ evento: { tipo: 'fim', ms: null, custo: null, turnos: null } }];
  }
  return [];
}

// -------------------------------------------------------------- opencode

function traduzirOpencode(dados, raiz) {
  const parte = dados.part || {};
  if (parte.type === 'tool') {
    const estado = parte.state || {};
    const pecas = [
      daFerramenta(parte.callID, parte.tool, estado.input, raiz)
    ];
    // O opencode manda a parte já resolvida quando a ferramenta é rápida; se
    // ainda estiver rodando ('pending', 'running') não há saída pra mostrar.
    if (estado.status === 'completed' || estado.status === 'error') {
      pecas.push({
        evento: {
          tipo: 'saida',
          id: String(parte.callID || ''),
          texto: cortar(typeof estado.output === 'string' ? estado.output : ''),
          ok: estado.status !== 'error'
        }
      });
    }
    return pecas;
  }
  if (parte.type === 'text' && parte.text) {
    // Sem separador entre partes, ao contrário do codex: aqui não há amostra de
    // dois textos no mesmo turno, e se o opencode mandar texto picado a linha em
    // branco quebraria a frase no meio.
    return [{ delta: parte.text }];
  }
  return [];
}

// ------------------------------------------------------- peças comuns

/** Nome de ferramenta (de qualquer um dos três) para ação do contrato. */
const ACAO_POR_FERRAMENTA = {
  read: 'ler',
  notebookread: 'ler',
  write: 'escrever',
  edit: 'editar',
  multiedit: 'editar',
  notebookedit: 'editar',
  patch: 'editar',
  apply_patch: 'editar',
  bash: 'rodar',
  shell: 'rodar',
  command_execution: 'rodar',
  grep: 'buscar',
  glob: 'buscar'
};

/** Onde cada CLI guarda o caminho, o comando e o termo de busca. */
const CHAVES_ARQUIVO = ['filePath', 'file_path', 'path', 'notebook_path', 'notebookPath'];
const CHAVES_COMANDO = ['command', 'cmd'];
const CHAVES_ALVO = ['pattern', 'query', 'regex'];

function primeiroCampo(entrada, chaves) {
  if (!entrada || typeof entrada !== 'object') return '';
  for (const chave of chaves) {
    const valor = entrada[chave];
    if (typeof valor === 'string' && valor) return valor;
  }
  return '';
}

/** Monta o evento de ferramenta a partir do nome e da entrada da chamada. */
function daFerramenta(id, nomeBruto, entrada, raiz) {
  const nome = String(nomeBruto || '');
  const acao = ACAO_POR_FERRAMENTA[nome.toLowerCase()] || 'outro';
  const comando = primeiroCampo(entrada, CHAVES_COMANDO);
  // Uma ferramenta de shell pode estar só lendo (`sed -n`) ou buscando
  // (`grep`); a linha de comando diz mais sobre o trabalho que o nome dela.
  if (acao === 'rodar' && comando) return deLinhaDeShell(id, comando, raiz);
  return montarFerramenta({
    id,
    acao,
    nome,
    arquivo: caminhoCurto(primeiroCampo(entrada, CHAVES_ARQUIVO), raiz),
    alvo: primeiroCampo(entrada, CHAVES_ALVO),
    comando
  });
}

/** Ferramenta cuja única descrição é a linha de shell que ela rodou. */
function deLinhaDeShell(id, comando, raiz) {
  const lido = lerLinhaDeShell(comando);
  return montarFerramenta({
    id,
    acao: lido.acao,
    arquivo: caminhoCurto(lido.arquivo, raiz),
    alvo: lido.alvo,
    comando: String(comando || '')
  });
}

function montarFerramenta({ id, acao, nome = '', arquivo = '', alvo = '', comando = '' }) {
  const evento = {
    tipo: 'ferramenta',
    id: String(id || ''),
    acao,
    titulo: titulo({ acao, nome, arquivo, alvo, comando })
  };
  if (arquivo) evento.arquivo = arquivo;
  if (acao === 'rodar' && comando) evento.comando = comando;
  return { evento };
}

/** Frase curta pra tela, no passado, como quem conta o que aconteceu. */
function titulo({ acao, nome, arquivo, alvo, comando }) {
  const naTela = paraTela(arquivo);
  switch (acao) {
    case 'ler':
      return `leu ${naTela || alvo || 'um arquivo'}`;
    case 'escrever':
      return `escreveu ${naTela || 'um arquivo'}`;
    case 'editar':
      return `editou ${naTela || 'um arquivo'}`;
    case 'rodar':
      return `rodou ${encurtar(semEnvoltorio(comando)) || 'um comando'}`;
    case 'buscar':
      return `buscou ${encurtar(alvo || naTela, 40) || 'no projeto'}`;
    default:
      return `usou ${nome || 'uma ferramenta'}`;
  }
}

/**
 * Caminho relativo à pasta do projeto quando ele estiver dentro dela.
 *
 * Sem `node:path` de propósito: o `relative()` resolveria contra o diretório do
 * servidor quando a raiz vier vazia, e aqui o que não é do projeto tem que
 * passar intacto.
 */
function caminhoCurto(bruto, raiz) {
  const caminho = String(bruto || '');
  const base = String(raiz || '').replace(/[\\/]+$/, '');
  if (!caminho || !base) return caminho;
  const normal = caminho.split('\\').join('/');
  for (const candidato of variantes(base)) {
    const prefixo = `${candidato.split('\\').join('/')}/`;
    if (normal.startsWith(prefixo)) return normal.slice(prefixo.length);
  }
  return normal;
}

/**
 * A pasta escrita dos dois jeitos: como veio e como o sistema de arquivos a
 * chama.
 *
 * No macOS `/tmp` é link pra `/private/tmp` e `/var` pra `/private/var`. O CLI
 * roda com o diretório já resolvido e reporta `/private/var/...`, enquanto o
 * `workdir` guardado pode ser o caminho cru — o prefixo não casava e o nome do
 * arquivo saía absoluto na tela e no que fica gravado.
 */
function variantes(base) {
  const lista = [base];
  try {
    const real = realpathSync(base);
    if (real !== base) lista.push(real);
  } catch {
    // Pasta que sumiu entre o começo do turno e agora: sobra o caminho cru,
    // que é exatamente o que havia antes desta função.
  }
  return lista;
}

/** Caminho absoluto na tela é uma linha inteira de ruído; fica só o nome. */
function paraTela(caminho) {
  const texto = String(caminho || '');
  if (!texto.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(texto)) return texto;
  return texto.split(/[\\/]/).pop() || texto;
}

function encurtar(texto, max = 60) {
  const limpo = String(texto || '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

function numero(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

// ------------------------------------------------------ linha de shell

/** Quebra a linha em palavras respeitando aspas, que é o que separa o
 *  `sed -n '1,200p' soma.mjs` de dentro do `/bin/zsh -lc "..."`. */
function palavras(linha) {
  const saida = [];
  let atual = '';
  let aspas = '';
  let aberto = false;
  for (const letra of String(linha || '')) {
    if (aspas) {
      if (letra === aspas) aspas = '';
      else atual += letra;
      continue;
    }
    if (letra === '"' || letra === "'") {
      aspas = letra;
      aberto = true;
      continue;
    }
    if (letra === ' ' || letra === '\t' || letra === '\n') {
      if (aberto) {
        saida.push(atual);
        atual = '';
        aberto = false;
      }
      continue;
    }
    atual += letra;
    aberto = true;
  }
  if (aberto) saida.push(atual);
  return saida;
}

const ENVOLTORIO = /^(?:ba|z|da|k)?sh$/;

/** O codex roda tudo dentro de `/bin/zsh -lc "..."`; o que interessa é o miolo. */
function semEnvoltorio(comando) {
  const partes = palavras(comando);
  if (partes.length >= 3 && ENVOLTORIO.test(nomeDoComando(partes[0])) && /^-[a-z]*c$/.test(partes[1])) {
    return partes.slice(2).join(' ');
  }
  return String(comando || '');
}

/** O que a linha de shell está fazendo de verdade, pra ação do contrato. */
function lerLinhaDeShell(bruto) {
  const linha = semEnvoltorio(bruto);
  // Cano, encadeamento e redirecionamento mudam o efeito: `cat a > b` escreve o
  // b, e `cat a && rm b` apaga. Fora do caso simples fica 'rodar', que nunca
  // mente sobre o que aconteceu.
  if (/[|;><&]/.test(linha)) return { acao: 'rodar' };
  const partes = palavras(linha);
  const programa = nomeDoComando(partes[0] || '');
  const args = partes.slice(1);
  const ultimo = args.at(-1) || '';
  const arquivo = ultimo.startsWith('-') ? '' : ultimo;
  if ((programa === 'cat' || programa === 'head' || programa === 'tail') && arquivo) {
    return { acao: 'ler', arquivo };
  }
  // `sed -n '1,200p' arquivo` é como o codex lê arquivo (amostra codex.jsonl).
  // O `-n` é o que separa leitura de escrita: `sed -i` altera o arquivo.
  if (programa === 'sed' && args.includes('-n') && arquivo) return { acao: 'ler', arquivo };
  if (programa === 'grep' || programa === 'egrep' || programa === 'rg' || programa === 'ag') {
    return { acao: 'buscar', alvo: args.find((a) => !a.startsWith('-')) || '' };
  }
  return { acao: 'rodar' };
}
