// Leitura da máquina e curadoria de modelos locais.
//
// A tela "IAs ligadas" precisa responder duas perguntas antes de mostrar
// qualquer botão de baixar: o que esta máquina aguenta, e qual modelo vale a
// pena pra ela. Sem isso a pessoa baixa 20 GB, o modelo entra em swap e ela
// conclui que "IA local é lenta" — quando o erro foi a escolha, não o produto.
//
// Nada aqui sai pra rede: é `node:os`, um comando do sistema e um catálogo
// escrito à mão.

import { totalmem, freemem, cpus, platform, arch, availableParallelism } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { all } from './db.mjs';

// Tudo em bytes por dentro; o catálogo fala em GB *binário* (1024³) porque é
// esse o número que a pessoa vê no "Sobre este Mac" e na página do Ollama.
const GB = 1024 ** 3;

/**
 * A regra do "cabe", escrita uma vez e usada em todo lugar.
 *
 * O peso do arquivo não é o custo real: além dos pesos, o runtime segura o
 * contexto (o KV cache cresce com a conversa) e algum overhead próprio. Por
 * isso o custo estimado é o tamanho vezes CUSTO_EXTRA.
 *
 * E a máquina não é só do modelo: sistema, navegador e o próprio IA Unifier
 * continuam rodando. A reserva é o maior entre 3 GB e 20% da RAM — em máquina
 * pequena 20% não sobra pra nada, em máquina grande 3 GB é pouco demais.
 *
 * Sobre o que sobra:
 *   - `folga`  — o modelo ocupa até 70% do orçamento; dá pra usar o computador
 *                normalmente enquanto ele responde;
 *   - `aperto` — cabe, mas toma quase tudo: vai funcionar e vai arrastar;
 *   - `nao`    — passa do orçamento; cairia em swap, o que é pior que não ter.
 *
 * Confere com o que o desenho promete: 32 GB de RAM → "cabe modelo de até uns
 * 15 GB com folga".
 */
const RESERVA_MINIMA = 3 * GB;
const RESERVA_FRACAO = 0.2;
const CUSTO_EXTRA = 1.2;
const MARGEM_FOLGA = 0.7;

// ---------------------------------------------------------------- a máquina

// Chip, número de núcleos e placa de vídeo não mudam enquanto o servidor está
// no ar, e descobrir a placa custa um processo filho. Lê uma vez e guarda.
let estaticoCache = null;

/** Roda um comando do sistema e devolve '' em vez de explodir. */
function rodar(exec, comando, args) {
  try {
    const saida = exec(comando, args, {
      encoding: 'utf8',
      // Prazo curto de propósito: isso roda no caminho de uma tela. Máquina
      // sem a ferramenta, ou com ela travada, não pode segurar a resposta.
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 * 1024 * 1024
    });
    return typeof saida === 'string' ? saida : String(saida ?? '');
  } catch {
    // Comando inexistente, sem permissão, estourou o prazo, devolveu lixo: em
    // todos os casos a resposta certa é "não sei", nunca derrubar a leitura.
    return '';
  }
}

/** "8192 MB", "8 GB", "24564" (MiB, do nvidia-smi) → bytes. */
function bytesDeTexto(texto, unidadePadrao = 'mb') {
  if (texto === null || texto === undefined) return 0;
  const achou = /([\d]+(?:[.,][\d]+)?)\s*(gib|gb|mib|mb|kib|kb)?/i.exec(String(texto));
  if (!achou) return 0;
  const n = Number(achou[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unidade = (achou[2] || unidadePadrao).toLowerCase();
  if (unidade.startsWith('g')) return Math.round(n * GB);
  if (unidade.startsWith('k')) return Math.round(n * 1024);
  return Math.round(n * 1024 * 1024);
}

/** Tira o enfeite de marca do nome do processador: gente não fala "(TM)". */
function limparChip(bruto) {
  if (!bruto) return null;
  const limpo = String(bruto)
    .replace(/\((?:R|TM)\)/gi, '')
    .replace(/\s+(?:CPU|Processor)\b/gi, '')
    .replace(/\s*@.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "unknown" aparece em ARM/Linux e em container: melhor não afirmar nada.
  return limpo && !/^unknown$/i.test(limpo) ? limpo : null;
}

/** Placa de vídeo no macOS. Em Apple Silicon não existe VRAM separada. */
function gpuMac(exec) {
  const saida = rodar(exec, 'system_profiler', ['SPDisplaysDataType', '-json']);
  if (!saida.trim()) return { nome: null, vram: 0 };
  let dados;
  try {
    dados = JSON.parse(saida);
  } catch {
    return { nome: null, vram: 0 };
  }
  const placas = dados?.SPDisplaysDataType;
  if (!Array.isArray(placas)) return { nome: null, vram: 0 };
  let nome = null;
  let vram = 0;
  for (const placa of placas) {
    if (!placa || typeof placa !== 'object') continue;
    nome = nome || placa.sppci_model || placa._name || null;
    // Só o campo de VRAM dedicada. O `spdisplays_vram_shared` da gráfica
    // integrada é um pedaço da própria RAM — somar seria contar duas vezes a
    // mesma memória e liberar modelo que não cabe.
    vram = Math.max(vram, bytesDeTexto(placa.spdisplays_vram || placa.sppci_vram));
  }
  return { nome: nome ? String(nome) : null, vram };
}

/** Placa de vídeo no Linux: nvidia-smi diz o tamanho, lspci diz o nome. */
function gpuLinux(exec) {
  const nvidia = rodar(exec, 'nvidia-smi', [
    '--query-gpu=memory.total,name',
    '--format=csv,noheader,nounits'
  ]);
  const linha = nvidia.split('\n').find((l) => l.includes(','));
  if (linha) {
    const [memoria, ...resto] = linha.split(',');
    // O nvidia-smi devolve MiB puro, sem unidade — daí o padrão explícito.
    const vram = bytesDeTexto(memoria.trim(), 'mib');
    if (vram > 0) return { nome: resto.join(',').trim() || 'GPU NVIDIA', vram };
  }
  const lspci = rodar(exec, 'lspci', []);
  const video = lspci.split('\n').find((l) => /VGA compatible|3D controller/i.test(l));
  // Sem nvidia-smi dá pra saber que existe placa, não quanta memória ela tem.
  // Zero aqui significa "meça pela RAM", que é o comportamento conservador.
  return { nome: video ? video.replace(/^.*?:\s*/, '').trim() : null, vram: 0 };
}

/** Memória no Linux: MemAvailable é a única leitura honesta de "livre". */
function memoriaLinux(ler) {
  try {
    const texto = ler('/proc/meminfo', 'utf8');
    const campo = (chave) => {
      const achou = new RegExp(`^${chave}:\\s+(\\d+)\\s*kB`, 'm').exec(texto);
      return achou ? Number(achou[1]) * 1024 : 0;
    };
    // MemFree ignora o cache, que o sistema devolve na hora que alguém pedir;
    // MemAvailable é o número que responde "quanto dá pra alocar agora".
    return { total: campo('MemTotal'), livre: campo('MemAvailable') || campo('MemFree') };
  } catch {
    return { total: 0, livre: 0 };
  }
}

/**
 * Memória livre no macOS. O `freemem()` do Node conta só a página nunca usada
 * e num Mac com uso normal devolve algo como 250 MB de 18 GB — o cartão da
 * máquina ficaria dizendo que não cabe nada. O que o sistema realmente entrega
 * é free + inactive + speculative + purgeable, que é o que o vm_stat mostra.
 */
function livreMac(exec) {
  const saida = rodar(exec, 'vm_stat', []);
  if (!saida.trim()) return 0;
  const pagina = Number(/page size of (\d+) bytes/.exec(saida)?.[1] || 0);
  if (!pagina) return 0;
  const paginas = (rotulo) => {
    const achou = new RegExp(`Pages ${rotulo}:\\s+(\\d+)`, 'i').exec(saida);
    return achou ? Number(achou[1]) : 0;
  };
  const soma = paginas('free') + paginas('inactive') + paginas('speculative') + paginas('purgeable');
  return soma > 0 ? soma * pagina : 0;
}

function lerEstatico(exec, ler) {
  const plataforma = platform();
  const arquitetura = arch();
  const lista = cpus();

  let chip = limparChip(lista[0]?.model);
  let nucleos = lista.length;
  const memLinux = plataforma === 'linux' ? memoriaLinux(ler) : { total: 0, livre: 0 };

  if (plataforma === 'linux' && !chip) {
    // Placa ARM e container costumam devolver "unknown" no os.cpus().
    try {
      const info = ler('/proc/cpuinfo', 'utf8');
      chip = limparChip(/^(?:model name|Hardware|Model)\s*:\s*(.+)$/m.exec(info)?.[1]);
    } catch {
      /* sem /proc, segue sem nome */
    }
  }
  if (!nucleos) {
    try {
      nucleos = availableParallelism();
    } catch {
      nucleos = 1;
    }
  }

  let gpu = { nome: null, vram: 0 };
  if (plataforma === 'darwin') gpu = gpuMac(exec);
  else if (plataforma === 'linux') gpu = gpuLinux(exec);
  // No Windows sobra o wmic, que está sendo removido e ainda por cima trunca a
  // VRAM em 4 GB. Número errado é pior que número ausente: fica em zero e a
  // conta corre pela RAM.

  // Apple Silicon: CPU e GPU dividem a mesma memória, então não existe VRAM
  // pra somar — o que decide o "cabe" é a RAM, e só ela.
  const compartilhada = plataforma === 'darwin' && arquitetura === 'arm64';
  const gpu_vram = compartilhada ? 0 : gpu.vram;

  return {
    ram_total: memLinux.total || totalmem(),
    chip: chip || gpu.nome || `${arquitetura} (${plataforma})`,
    cores: nucleos || 1,
    plataforma,
    arch: arquitetura,
    gpu: gpu.nome,
    gpu_vram,
    memoria_compartilhada: compartilhada
  };
}

/**
 * Retrato da máquina, em bytes.
 *
 * `exec` e `ler` existem pro teste conseguir encenar comando que falha; em
 * produção ninguém passa nada. Passar um deles pula o cache, porque o
 * resultado encenado não pode contaminar a leitura de verdade.
 */
export function readMachine({ exec = execFileSync, ler = readFileSync, cache = true } = {}) {
  const proprio = exec !== execFileSync || ler !== readFileSync;
  const usarCache = cache && !proprio;
  const estatico = usarCache && estaticoCache ? estaticoCache : lerEstatico(exec, ler);
  if (usarCache) estaticoCache = estatico;

  let ram_livre = 0;
  if (estatico.plataforma === 'linux') ram_livre = memoriaLinux(ler).livre;
  else if (estatico.plataforma === 'darwin') ram_livre = livreMac(exec);
  // Livre é a única coisa que muda a cada leitura, então nunca vem do cache.
  if (!ram_livre) ram_livre = freemem();

  return {
    ram_total: estatico.ram_total,
    ram_livre: Math.min(ram_livre, estatico.ram_total),
    chip: estatico.chip,
    cores: estatico.cores,
    plataforma: estatico.plataforma,
    arch: estatico.arch,
    gpu: estatico.gpu,
    gpu_vram: estatico.gpu_vram,
    memoria_compartilhada: estatico.memoria_compartilhada
  };
}

/** Esquece o que foi medido. Existe pro teste; o servidor não chama. */
export function forgetMachine() {
  estaticoCache = null;
}

// ------------------------------------------------------------- o "cabe"

/** Quantos bytes de modelo esta máquina pode carregar, no total. */
export function orcamento(maquina) {
  const ram = Number(maquina?.ram_total) || 0;
  const porRam = Math.max(0, ram - Math.max(RESERVA_MINIMA, ram * RESERVA_FRACAO));
  // Placa dedicada muda a conta: o modelo mora na VRAM e a RAM continua livre
  // pro resto. Guarda 1 GB pro que o sistema já pintou na tela.
  const vram = Number(maquina?.gpu_vram) || 0;
  const porVram = vram > 0 ? Math.max(0, vram - GB) : 0;
  return Math.max(porRam, porVram);
}

/** 'folga' | 'aperto' | 'nao' para um modelo de `gb` gigabytes. */
export function classificarCabe(gb, maquina) {
  const teto = orcamento(maquina);
  const custo = (Number(gb) || 0) * GB * CUSTO_EXTRA;
  if (!(teto > 0) || !(custo > 0)) return 'nao';
  if (custo <= teto * MARGEM_FOLGA) return 'folga';
  if (custo <= teto) return 'aperto';
  return 'nao';
}

/** Maior modelo, em GB, que ainda entra com folga — a frase do cartão. */
export function folgaMaxGb(maquina) {
  return Math.floor(orcamento(maquina) * MARGEM_FOLGA / CUSTO_EXTRA / GB);
}

// ------------------------------------------------------------- o catálogo

/**
 * Catálogo curado de modelos do Ollama.
 *
 * Não é a lista inteira do Ollama de propósito: uma lista com 200 nomes é
 * exatamente o problema que esta tela existe pra resolver. São os que valem a
 * pena, um por nicho, do que roda em notebook velho ao que só faz sentido em
 * estação de trabalho.
 *
 * `gb` é o tamanho do arquivo baixado na quantização padrão (a que o Ollama
 * entrega quando você pede o modelo pelo nome), em GB binário.
 * `compara` sempre cita outro modelo desta mesma lista — é o "por que este e
 * não aquele" que a pessoa realmente quer saber.
 */
export const CATALOGO = [
  {
    id: 'nomic-embed-text',
    nome_legivel: 'Nomic Embed Text',
    gb: 0.3,
    familia: 'nomic',
    pra_que:
      'Não conversa: transforma texto em número pra busca por significado, que é o que faz a memória do app achar o fato certo.',
    compara:
      'É o único daqui feito pra isso: pedir busca ao Llama 3.1 8B ocupa dez vezes mais memória e ainda acha o trecho errado.'
  },
  {
    id: 'llama3.2:1b',
    nome_legivel: 'Llama 3.2 1B',
    gb: 1.3,
    familia: 'llama',
    pra_que:
      'Responde na hora até em computador fraco; serve pra resumir texto, arrumar frase e tirar dúvida simples.',
    compara:
      'É o mais rápido da lista, mas também o que mais inventa coisa — só escolha ele se o Llama 3.2 3B estiver pesado demais aqui.'
  },
  {
    id: 'llama3.2:3b',
    nome_legivel: 'Llama 3.2 3B',
    gb: 2.0,
    familia: 'llama',
    pra_que:
      'O menor que ainda escreve português decente e aguenta uma conversa com várias idas e voltas sem se perder.',
    compara:
      'Ocupa o dobro do Llama 3.2 1B e acerta muito mais; se ainda sobrar memória, o Llama 3.1 8B é outro degrau acima.'
  },
  {
    id: 'phi4-mini',
    nome_legivel: 'Phi-4 Mini',
    gb: 2.5,
    familia: 'phi',
    pra_que:
      'Conta, lógica e problema que precisa de passo a passo — pensa melhor do que o tamanho dele sugere.',
    compara:
      'Raciocina melhor que o Llama 3.2 3B, do mesmo porte, mas escreve um português mais duro que o do Gemma 3 4B.'
  },
  {
    id: 'gemma3:4b',
    nome_legivel: 'Gemma 3 4B',
    gb: 3.3,
    familia: 'gemma',
    pra_que:
      'Escreve em português com naturalidade e ainda lê imagem, coisa que quase nenhum modelo pequeno faz.',
    compara:
      'Prefira ele ao Phi-4 Mini quando o que importa é o texto sair bonito, e o Phi quando a conta tem que sair certa.'
  },
  {
    id: 'mistral:7b',
    nome_legivel: 'Mistral 7B',
    gb: 4.1,
    familia: 'mistral',
    pra_que:
      'Cavalo de batalha equilibrado: resume, reescreve e segue instrução sem enrolação e sem sermão.',
    compara:
      'Responde mais rápido e mais direto que o Llama 3.1 8B, que em troca sabe mais sobre mais assunto.'
  },
  {
    id: 'qwen2.5-coder:7b',
    nome_legivel: 'Qwen 2.5 Coder 7B',
    gb: 4.7,
    familia: 'qwen',
    pra_que:
      'Escrever e consertar código: entende bem pedido do tipo "faz essa função e explica o que ela faz".',
    compara:
      'Programa bem melhor que o Llama 3.1 8B, do mesmo tamanho, e conversa bem pior sobre qualquer coisa que não seja código.'
  },
  {
    id: 'llama3.1:8b',
    nome_legivel: 'Llama 3.1 8B',
    gb: 4.9,
    familia: 'llama',
    pra_que:
      'O melhor "sabe um pouco de tudo" que cabe numa máquina comum — a escolha segura pro dia a dia.',
    compara:
      'Sabe mais que o Mistral 7B por pouca memória a mais; se você passa o dia programando, o Qwen 2.5 Coder 7B rende mais.'
  },
  {
    id: 'gemma3:12b',
    nome_legivel: 'Gemma 3 12B',
    gb: 8.1,
    familia: 'gemma',
    pra_que:
      'Texto longo em português com qualidade de modelo grande: redação, tradução e resumo de documento inteiro.',
    compara:
      'Escreve visivelmente melhor que o Gemma 3 4B e cabe em máquina onde o Gemma 3 27B nem tenta entrar.'
  },
  {
    id: 'deepseek-coder-v2:16b',
    nome_legivel: 'DeepSeek Coder V2 16B',
    gb: 8.9,
    familia: 'deepseek',
    pra_que:
      'Código de verdade: projeto grande, várias linguagens, refatoração e explicação de código que você não escreveu.',
    compara:
      'É o degrau acima do Qwen 2.5 Coder 7B — bem melhor no código difícil, em troca de quase o dobro de memória.'
  },
  {
    id: 'qwen2.5:14b',
    nome_legivel: 'Qwen 2.5 14B',
    gb: 9.0,
    familia: 'qwen',
    pra_que:
      'Resposta mais completa e raciocínio mais firme, sem perder o fio em conversa comprida.',
    compara:
      'Pensa melhor que o Llama 3.1 8B; só perde pro Gemma 3 12B, do mesmo tamanho, quando o assunto é escrever bonito.'
  },
  {
    id: 'gemma3:27b',
    nome_legivel: 'Gemma 3 27B',
    gb: 17,
    familia: 'gemma',
    pra_que:
      'Trabalho sério de escrita e análise, em nível de modelo pago, sem nada sair da sua máquina.',
    compara:
      'Dá um salto de qualidade sobre o Gemma 3 12B, mas ocupa o dobro e responde bem mais devagar.'
  },
  {
    id: 'qwen2.5:32b',
    nome_legivel: 'Qwen 2.5 32B',
    gb: 20,
    familia: 'qwen',
    pra_que:
      'Problema difícil que precisa de vários passos: análise, planejamento, matemática e código complicado.',
    compara:
      'Raciocina melhor que o Gemma 3 27B; se o que você quer é português mais natural, fique com o Gemma.'
  },
  {
    id: 'llama3.3:70b',
    nome_legivel: 'Llama 3.3 70B',
    gb: 43,
    familia: 'llama',
    pra_que:
      'O maior da lista: chega perto do que as IAs pagas entregam, e roda sem internet.',
    compara:
      'Só compensa sobre o Qwen 2.5 32B em máquina de 64 GB pra cima; abaixo disso ele engasga e você espera minutos por resposta.'
  }
];

const ORDEM_CABE = { folga: 0, aperto: 1, nao: 2 };

/** Modelos do Ollama já cadastrados no banco, em minúsculas. */
function idsInstalados() {
  try {
    return all(
      `SELECT m.model_id AS id
         FROM models m
         JOIN providers p ON p.id = m.provider_id
        WHERE p.kind = 'ollama'`
    ).map((linha) => String(linha.id || '').toLowerCase());
  } catch {
    // Banco fora do ar não pode apagar a recomendação: sem a marca de baixado
    // a tela continua útil.
    return [];
  }
}

/**
 * O nome no banco raramente é igual ao do catálogo: o Ollama guarda
 * `llama3.1:8b-instruct-q4_K_M` pra quem escolheu a quantização, e `:latest`
 * pra quem pediu o modelo sem tag nenhuma.
 */
function estaInstalado(id, instalados) {
  const alvo = String(id).toLowerCase();
  return instalados.some(
    (nome) => nome === alvo || nome === `${alvo}:latest` || nome.startsWith(`${alvo}-`)
  );
}

/**
 * O catálogo medido contra esta máquina.
 *
 * Ordem: o que já está baixado primeiro (é grátis usar), depois o que cabe com
 * folga, depois o apertado, e o que não cabe por último — dentro de cada grupo,
 * o maior primeiro, porque maior é melhor entre os que cabem. No grupo do "não
 * cabe" a ordem inverte: quem quase coube fica na frente, que é a informação
 * útil ali ("faltou pouco").
 */
export function recommendModels(maquina = readMachine()) {
  const instalados = idsInstalados();
  return CATALOGO.map((modelo) => ({
    ...modelo,
    cabe: classificarCabe(modelo.gb, maquina),
    instalado: estaInstalado(modelo.id, instalados)
  })).sort((a, b) => {
    if (a.instalado !== b.instalado) return a.instalado ? -1 : 1;
    if (a.cabe !== b.cabe) return ORDEM_CABE[a.cabe] - ORDEM_CABE[b.cabe];
    return a.cabe === 'nao' ? a.gb - b.gb : b.gb - a.gb;
  });
}
