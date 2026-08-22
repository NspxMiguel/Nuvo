// O que o Estudos produz: simulado, guia, flashcards, resumo.
//
// Todos passam pelo mesmo funil: pega o material, põe o retrato do professor
// por cima, chama o modelo, confere a forma e grava. O retrato é o que faz a
// diferença — sem ele isto seria um resumidor a mais, e resumidor devolve a
// matéria inteira. Com ele, o que sai vem recortado pelo que ESTE professor
// cobra: o peso de cada tema, o nível que ele exige, o verbo que ele usa.
//
// Nenhum gerador recebe as provas passadas em texto. Duas razões: o retrato já
// destilou delas o que interessa, e um modelo com a prova na frente copia a
// questão em vez de escrever uma nova — o aluno decoraria a prova do ano
// passado, que é exatamente o hábito que a ferramenta deveria substituir.

import { complete, describeModel, parseJsonObject } from './complete.mjs';
import { getProvider, listProviders, parseRef } from './providers/index.mjs';
import { caminhoNoDisco, listAttachments, textoDoAnexo } from './documents.mjs';
import { gerarNoNotebookLM } from './notebooklm.mjs';
import { erroHttp } from './erro-traduzivel.mjs';
import { cortarNaPalavra, semMarcacao } from './texto-do-modelo.mjs';
import { acharProfessor, guardarSaida, pastasDo } from './estudos.mjs';

const TETO = 26_000;

const texto = (v, limite = 600) => cortarNaPalavra(semMarcacao(v), limite);
const lista = (v) => (Array.isArray(v) ? v : []);

/** O retrato virado prompt: é assim que o professor entra na cabeça do modelo. */
function retratoEmPalavras(retrato) {
  if (!retrato) return '';
  const linhas = [];
  if (retrato.formato) {
    const tipos = lista(retrato.formato.tipos)
      .map((t) => `${t.tipo} (${Math.round((t.peso || 0) * 100)}%)`)
      .join(', ');
    linhas.push(
      `Formato dele: ${retrato.formato.n_questoes || '?'} questões; ${tipos || 'formato variado'}.` +
        (retrato.formato.pontuacao ? ` Pontuação: ${retrato.formato.pontuacao}.` : '')
    );
  }
  if (lista(retrato.conteudo).length) {
    linhas.push(
      `Peso de cada tema nas provas dele: ${retrato.conteudo
        .map((c) => `${c.tema} ${Math.round((c.peso || 0) * 100)}%`)
        .join('; ')}.`
    );
  }
  if (lista(retrato.cognitivo).length) {
    linhas.push(
      `Nível do que ele pede: ${retrato.cognitivo
        .map((c) => `${c.nivel} ${Math.round((c.peso || 0) * 100)}%`)
        .join('; ')}.`
    );
  }
  if (lista(retrato.verbos).length) {
    linhas.push(`Verbos de comando que ele usa: ${retrato.verbos.map((v) => v.verbo).join(', ')}.`);
  }
  if (lista(retrato.pegadinhas).length) {
    linhas.push(`Como ele derruba quem decorou: ${retrato.pegadinhas.map((p) => p.padrao).join('; ')}.`);
  }
  if (lista(retrato.manias).length) linhas.push(`Manias dele: ${retrato.manias.join('; ')}.`);
  if (lista(retrato.so_na_aula).length) {
    linhas.push(
      `Ensina e nunca cobrou (peso baixo, não zero — pode estrear): ${retrato.so_na_aula.join('; ')}.`
    );
  }
  return linhas.join('\n');
}

const REGRAS_DE_FONTE = `Toda afirmação sai do material que você recebeu. Onde citar, cite literal.
Se o material não cobrir um tema que o retrato pede, diga isso no campo "faltou" em vez de inventar conteúdo.`;

/** O modelo escolhido pertence a um provedor NotebookLM? */
function ehRefDoNotebookLM(ref) {
  try {
    return getProvider(parseRef(ref).providerId)?.kind === 'notebooklm';
  } catch {
    return false;
  }
}

/**
 * Memória curta de quando o NotebookLM falhou.
 *
 * Tentar a primeira mão é abrir um Chrome sem janela e dirigir a tela do Google;
 * quando a sessão caiu, isso custa uns vinte segundos antes de desistir. Sem
 * lembrar da falha, cada geração pagaria esse pedágio de novo — e o padrão
 * "NotebookLM primeiro" viraria "o app trava vinte segundos toda vez".
 *
 * Meia hora é curto o bastante pra ele entrar na conta e voltar a valer sem
 * reiniciar nada, e longo o bastante pra uma tarde de estudo não pagar duas vezes.
 */
const DESCANSO = 30 * 60 * 1000;
let caiuEm = 0;
const descansando = () => caiuEm > 0 && Date.now() - caiuEm < DESCANSO;

/**
 * Vale tentar a primeira mão?
 *
 * Só quando existe um NotebookLM ligado na lista de IAs. Sem isso, cada geração
 * pagava vinte segundos abrindo um Chrome sem janela pra descobrir que não há
 * sessão — um pedágio em cima de quem nunca configurou o NotebookLM. Quem
 * configura ganha o padrão que ele pediu: o NotebookLM lê, a IA escolhida
 * termina.
 */
function temNotebookLM() {
  try {
    return listProviders({ enabledOnly: true }).some((p) => p.kind === 'notebooklm');
  } catch {
    return false;
  }
}

/** Só pros testes: esquece a última falha. */
export function esquecerFalhaDoNotebookLM() {
  caiuEm = 0;
}

/** Segunda mão: o que dizer quando a leitura veio pronta de fora. */
const RASCUNHO_ALHEIO = `O material abaixo já vem lido e organizado por outra ferramenta.
Não é fonte nova: não acrescente fato que não esteja nele, e não repita a estrutura dele por preguiça.
Seu trabalho é reescrever aquilo no formato pedido.`;

/** Segunda mão, com retrato: é aqui que o professor entra. */
const TOQUE_DO_PROFESSOR = `Agora o que importa: refaça isso do jeito DESTE professor.
Respeite o peso de cada tema, o nível cognitivo e o formato de questão do retrato.
Use os verbos de comando dele, na frequência em que ele usa.
Se ele tem mania — pedir exemplo do cotidiano, mandar justificar, cobrar sempre uma citação —, repita a mania.
O que sair tem que passar pelo teste do aluno dele: "isso é cara de prova do professor".`;

/** Sem retrato, dizer o que falta é melhor do que fingir que o toque existiu. */
const SEM_RETRATO = `Não existe retrato deste professor ainda, então nada de inventar mania nem estilo dele.
Fique no material, sem chutar como ele cobraria.`;

/**
 * Os formatos. Cada um diz o que pede ao modelo, como confere a resposta e o
 * título que vai pra lista.
 */
export const FORMATOS = {
  simulado: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Simulado de ${prof.materia || prof.nome}`,
    prompt: `Você escreve uma prova NOVA no estilo de um professor específico, para o aluno treinar.

Devolva SOMENTE um objeto JSON:
{
  "instrucoes": "cabeçalho da prova, como ele escreveria",
  "questoes": [
    {"n": 1, "enunciado": "...", "tipo": "discursiva|multipla escolha|verdadeiro ou falso|calculo",
     "alternativas": ["a) ...", "b) ..."],
     "valor": 1.5,
     "tema": "...", "nivel": "lembrar|entender|aplicar|analisar|avaliar|criar",
     "probabilidade": "alta|media|baixa",
     "porque": "que regra do retrato fez você escrever esta questão",
     "gabarito": "a resposta esperada",
     "fonte": "trecho literal do material que sustenta a resposta"}
  ],
  "faltou": ["tema que o retrato pede e o material não cobre"]
}

Regras:
- Escreva questões NOVAS. Não copie enunciado do material.
- A distribuição de temas, de níveis e de formatos segue o retrato, não o seu gosto.
- Use os verbos de comando do professor.
- "probabilidade" é o quanto aquele tema pesa no retrato: alta acima de 20%, média entre 8 e 20%, baixa abaixo disso.
- "alternativas" só existe em múltipla escolha e verdadeiro ou falso.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const questoes = lista(bruto?.questoes)
        .map((q, i) => ({
          n: Number(q.n) || i + 1,
          enunciado: texto(q.enunciado, 1200),
          tipo: texto(q.tipo, 40),
          alternativas: lista(q.alternativas).map((a) => texto(a, 400)),
          valor: Number(q.valor) || null,
          tema: texto(q.tema, 120),
          nivel: texto(q.nivel, 30),
          probabilidade: ['alta', 'media', 'baixa'].includes(q.probabilidade) ? q.probabilidade : 'media',
          porque: texto(q.porque, 300),
          gabarito: texto(q.gabarito, 2000),
          fonte: texto(q.fonte, 600)
        }))
        .filter((q) => q.enunciado);
      if (!questoes.length) return null;
      return { instrucoes: texto(bruto.instrucoes, 600), questoes, faltou: lista(bruto.faltou).map((f) => texto(f, 160)) };
    }
  },

  guia: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Guia de estudo de ${prof.materia || prof.nome}`,
    prompt: `Você escreve um guia de estudo recortado pelo que UM professor específico cobra.

Devolva SOMENTE um objeto JSON:
{
  "temas": [
    {"tema": "...", "peso": 0.0, "por_que_cai": "uma frase, ancorada no retrato",
     "o_que_saber": ["ponto que precisa estar sabido"],
     "como_ele_cobra": "o formato e o nível em que este tema costuma aparecer",
     "fonte": "trecho literal do material"}
  ],
  "pule": [{"tema": "...", "por_que": "está no material e ele nunca cobrou"}],
  "faltou": ["tema que o retrato pede e o material não cobre"]
}

Regras:
- A ordem é do que mais cai para o que menos cai. Estudar não é ler o livro na ordem do livro.
- "pule" é o que economiza tempo: material que ele ensina e não cobra.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const temas = lista(bruto?.temas)
        .map((t) => ({
          tema: texto(t.tema, 120),
          peso: Number(t.peso) > 1 ? Number(t.peso) / 100 : Number(t.peso) || 0,
          por_que_cai: texto(t.por_que_cai, 300),
          o_que_saber: lista(t.o_que_saber).map((x) => texto(x, 300)),
          como_ele_cobra: texto(t.como_ele_cobra, 300),
          fonte: texto(t.fonte, 600)
        }))
        .filter((t) => t.tema);
      if (!temas.length) return null;
      return {
        temas,
        pule: lista(bruto.pule).map((p) => ({ tema: texto(p.tema, 120), por_que: texto(p.por_que, 200) })),
        faltou: lista(bruto.faltou).map((f) => texto(f, 160))
      };
    }
  },

  flashcards: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Cartões de ${prof.materia || prof.nome}`,
    prompt: `Você escreve cartões de memorização a partir de um material de estudo.

Devolva SOMENTE um objeto JSON:
{"cartoes": [{"frente": "a pergunta", "verso": "a resposta", "tema": "...", "fonte": "trecho literal do material"}]}

Regras:
- Uma ideia por cartão. Frente que se responde em uma frase.
- Nada de "o que é X?" para tudo: varie — compare, explique por quê, dê o exemplo.
- Entre 15 e 40 cartões, priorizando o que o professor mais cobra.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const cartoes = lista(bruto?.cartoes)
        .map((c) => ({
          frente: texto(c.frente, 400),
          verso: texto(c.verso, 1200),
          tema: texto(c.tema, 120),
          fonte: texto(c.fonte, 600)
        }))
        .filter((c) => c.frente && c.verso);
      return cartoes.length ? { cartoes } : null;
    }
  },

  resumo: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Resumo de ${prof.materia || prof.nome}`,
    prompt: `Você resume um material de estudo para quem vai fazer prova.

Devolva SOMENTE um objeto JSON:
{
  "abertura": "dois parágrafos dizendo do que o material trata e como as partes se ligam",
  "secoes": [{"titulo": "...", "pontos": ["frase curta e completa"], "fonte": "trecho literal"}],
  "termos": [{"termo": "...", "definicao": "uma frase"}]
}

Regras:
- Ponto é frase completa, não tópico solto de duas palavras.
- Termo que o material define entra em "termos"; não invente definição de fora.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const secoes = lista(bruto?.secoes)
        .map((s) => ({
          titulo: texto(s.titulo, 160),
          pontos: lista(s.pontos).map((p) => texto(p, 500)),
          fonte: texto(s.fonte, 600)
        }))
        .filter((s) => s.titulo && s.pontos.length);
      if (!secoes.length) return null;
      return {
        abertura: texto(bruto.abertura, 2000),
        secoes,
        termos: lista(bruto.termos)
          .map((t) => ({ termo: texto(t.termo, 120), definicao: texto(t.definicao, 500) }))
          .filter((t) => t.termo)
      };
    }
  },

  mapa: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Mapa de ${prof.materia || prof.nome}`,
    prompt: `Você desenha o mapa mental de um material de estudo.

Devolva SOMENTE um objeto JSON:
{"centro": "o assunto do material, em até 4 palavras",
 "ramos": [{"nome": "...", "peso": 0.0, "folhas": ["...", "..."]}]}

Regras:
- Entre 3 e 7 ramos. Mais que isso vira lista, e lista já existe no resumo.
- Cada ramo com 2 a 6 folhas. Folha é um conceito, não uma frase.
- "peso" é o quanto aquele ramo ocupa do material, de 0 a 1.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const ramos = lista(bruto?.ramos)
        .map((r) => ({
          nome: texto(r.nome, 60),
          peso: Number(r.peso) > 1 ? Number(r.peso) / 100 : Number(r.peso) || 0,
          folhas: lista(r.folhas).map((f) => texto(f, 60)).filter(Boolean).slice(0, 8)
        }))
        .filter((r) => r.nome)
        .slice(0, 8);
      return ramos.length ? { centro: texto(bruto.centro, 60) || '—', ramos } : null;
    }
  },

  linha: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Linha do tempo de ${prof.materia || prof.nome}`,
    prompt: `Você monta a linha do tempo do que o material descreve.

Devolva SOMENTE um objeto JSON:
{"marcos": [{"quando": "1789 | século XIX | fase clara", "o_que": "...", "porque_importa": "uma frase", "fonte": "trecho literal"}]}

Regras:
- Serve pra data e também pra etapa de processo (glicólise → ciclo de Krebs → cadeia).
- Em ordem. Se o material não tem nada sequencial, devolva {"marcos": []}.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const marcos = lista(bruto?.marcos)
        .map((m) => ({
          quando: texto(m.quando, 60),
          o_que: texto(m.o_que, 300),
          porque_importa: texto(m.porque_importa, 300),
          fonte: texto(m.fonte, 600)
        }))
        .filter((m) => m.quando && m.o_que);
      return marcos.length ? { marcos } : null;
    }
  },

  podcast: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Conversa sobre ${prof.materia || prof.nome}`,
    prompt: `Você escreve o roteiro de uma conversa de dois minutos entre duas pessoas explicando a matéria.

Devolva SOMENTE um objeto JSON:
{"titulo": "...", "falas": [{"quem": "a|b", "texto": "uma ou duas frases"}]}

Regras:
- "a" pergunta e duvida como um aluno que não entendeu; "b" explica.
- Fala curta: isto vai ser lido em voz alta, e parágrafo longo em voz sintética cansa.
- Entre 14 e 30 falas, cobrindo o que o professor mais cobra primeiro.
- Nada de "olá, sejam bem-vindos ao podcast". Comece pela matéria.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const falas = lista(bruto?.falas)
        .map((f) => ({ quem: f.quem === 'a' ? 'a' : 'b', texto: texto(f.texto, 700) }))
        .filter((f) => f.texto);
      return falas.length >= 4 ? { titulo: texto(bruto.titulo, 160), falas } : null;
    }
  },
  quiz: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Quiz de ${prof.materia || prof.nome}`,
    prompt: `Você escreve um quiz de múltipla escolha pra alguém treinar rápido.

Devolva SOMENTE um objeto JSON:
{"questoes": [{"enunciado": "...", "alternativas": ["...", "...", "...", "..."],
  "certa": 0, "porque": "por que a certa é certa, uma frase",
  "erro_comum": "qual alternativa errada engana mais, e por quê",
  "tema": "...", "fonte": "trecho literal do material"}]}

Regras:
- Quatro alternativas, exatamente uma certa. "certa" é o índice, começando em 0.
- As erradas têm que ser plausíveis: alternativa absurda não ensina nada.
- Entre 8 e 20 questões.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const questoes = lista(bruto?.questoes)
        .map((q) => {
          const alternativas = lista(q.alternativas).map((a) => texto(a, 400)).filter(Boolean);
          const certa = Number(q.certa);
          return {
            enunciado: texto(q.enunciado, 900),
            alternativas,
            certa: Number.isInteger(certa) && certa >= 0 && certa < alternativas.length ? certa : -1,
            porque: texto(q.porque, 500),
            erro_comum: texto(q.erro_comum, 500),
            tema: texto(q.tema, 120),
            fonte: texto(q.fonte, 600)
          };
        })
        // Questão sem gabarito válido é pior que questão nenhuma: ela ensina errado.
        .filter((q) => q.enunciado && q.alternativas.length >= 2 && q.certa >= 0);
      return questoes.length ? { questoes } : null;
    }
  },

  infografico: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Infográfico de ${prof.materia || prof.nome}`,
    prompt: `Você resume a matéria numa página só, do jeito que cabe num cartaz.

Devolva SOMENTE um objeto JSON:
{"titulo": "...", "linha_fina": "uma frase que resume tudo",
 "numeros": [{"valor": "8", "rotulo": "questões por prova"}],
 "blocos": [{"titulo": "...", "texto": "duas frases no máximo", "peso": 0.0}],
 "sequencia": ["etapa", "etapa", "etapa"],
 "lembre": ["a coisa que não pode esquecer na hora da prova"]}

Regras:
- Três a seis blocos. Isto é um cartaz, não um capítulo.
- "numeros" são os dados que se olha e entende na hora: quantidade, peso, ordem.
- "sequencia" só existe se a matéria tiver uma; senão, lista vazia.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const blocos = lista(bruto?.blocos)
        .map((b) => ({
          titulo: texto(b.titulo, 80),
          texto: texto(b.texto, 400),
          peso: Number(b.peso) > 1 ? Number(b.peso) / 100 : Number(b.peso) || 0
        }))
        .filter((b) => b.titulo)
        .slice(0, 6);
      if (!blocos.length) return null;
      return {
        titulo: texto(bruto.titulo, 120),
        linha_fina: texto(bruto.linha_fina, 300),
        numeros: lista(bruto.numeros)
          .map((n) => ({ valor: texto(n.valor, 12), rotulo: texto(n.rotulo, 60) }))
          .filter((n) => n.valor)
          .slice(0, 4),
        blocos,
        sequencia: lista(bruto.sequencia).map((x) => texto(x, 60)).filter(Boolean).slice(0, 7),
        lembre: lista(bruto.lembre).map((x) => texto(x, 200)).filter(Boolean).slice(0, 5)
      };
    }
  },

  slides: {
    papeis: ['conteudo', 'material'],
    titulo: (prof) => `Slides de ${prof.materia || prof.nome}`,
    prompt: `Você monta uma sequência de slides pra revisar a matéria.

Devolva SOMENTE um objeto JSON:
{"slides": [{"titulo": "...", "pontos": ["frase curta"], "nota": "o que dizer neste slide", "fonte": "trecho literal"}]}

Regras:
- Entre 8 e 16 slides, na ordem do que mais cai pro que menos cai.
- No máximo 5 pontos por slide, e ponto é frase curta, não parágrafo.
- O primeiro slide é o assunto e o que vai ser coberto; o último é o que revisar na véspera.
${REGRAS_DE_FONTE}`,
    conferir: (bruto) => {
      const slides = lista(bruto?.slides)
        .map((s) => ({
          titulo: texto(s.titulo, 120),
          pontos: lista(s.pontos).map((x) => texto(x, 300)).filter(Boolean).slice(0, 6),
          nota: texto(s.nota, 600),
          fonte: texto(s.fonte, 600)
        }))
        .filter((s) => s.titulo);
      return slides.length ? { slides } : null;
    }
  }
};

export const TIPOS = Object.keys(FORMATOS);

/**
 * Junta o material dos papéis que este formato usa, com o nome do arquivo por cima.
 *
 * `escolhidas` é a seleção que a tela faz nas caixinhas da coluna da esquerda:
 * o que está desmarcado não entra no que for gerado. Sem lista, entra tudo.
 */
function material(professorId, papeis, escolhidas) {
  // Lista vazia é "não escolhi nenhuma", não "não escolhi". Tratar `[]` como
  // ausência fazia o oposto do pedido: quem desmarcava todas as pastas na
  // coluna da esquerda recebia um simulado feito com TODAS elas.
  const so = Array.isArray(escolhidas) ? new Set(escolhidas) : null;
  const pastas = pastasDo(professorId).filter((p) => !so || so.has(p.id));
  const anexos = pastas
    .flatMap((p) => listAttachments({ pastaId: p.id }))
    .filter((a) => a.status === 'ok' && papeis.includes(a.papel));

  const partes = [];
  const fontes = [];
  let sobra = TETO;
  let cortado = false;
  for (const anexo of anexos) {
    if (sobra <= 0) {
      cortado = true;
      break;
    }
    const corpo = String(textoDoAnexo(anexo.id) || '').trim().slice(0, sobra);
    if (!corpo) continue;
    sobra -= corpo.length;
    partes.push(`## ${anexo.name}\n${corpo}`);
    fontes.push({ anexo: anexo.id, nome: anexo.name, papel: anexo.papel });
  }
  return { texto: partes.join('\n\n'), fontes, cortado, quantos: anexos.length };
}

/**
 * Gera um dos formatos e vai contando.
 *
 * @param {{professorId: string, tipo: string, ref: string, pastaId?: string|null, signal?: AbortSignal}} entrada
 */
/**
 * Rascunho do NotebookLM: a primeira mão.
 *
 * Devolve o texto corrido que ele produziu, ou `null` quando não deu — sessão
 * caída, tela mudada, sem material em disco. Falhar aqui não derruba a geração:
 * a segunda mão lê os arquivos direto, que é o que ela fazia antes de existir
 * primeira mão nenhuma.
 */
async function* rascunhoDoNotebookLM({ professorId, tipo, formato, pastas, signal, sessao }) {
  const so = Array.isArray(pastas) ? new Set(pastas) : null;
  const arquivos = pastasDo(professorId)
    .filter((p) => !so || so.has(p.id))
    .flatMap((p) => listAttachments({ pastaId: p.id }))
    .filter((a) => formato.papeis.includes(a.papel))
    .map((a) => ({ id: a.id, nome: a.name, caminho: caminhoNoDisco(a.id) }))
    .filter((a) => a.caminho);
  if (!arquivos.length) return null;

  // `for await` não enxerga o `return` de um gerador — o valor final só sai pelo
  // `next()`. Com o laço, `texto` nunca chegava e toda geração pelo NotebookLM
  // morria em "não devolveu nada utilizável".
  const it = gerarNoNotebookLM({ arquivos, tipo, signal, sessao });
  let passo = await it.next();
  while (!passo.done) {
    yield passo.value;
    passo = await it.next();
  }
  const texto = String(passo.value?.texto || '').trim();
  return texto
    ? { texto, fontes: arquivos.map((a) => ({ anexo: a.id, nome: a.nome, papel: 'notebooklm' })) }
    : null;
}

/**
 * Gera um formato com as duas mãos.
 *
 * Primeira mão: o NotebookLM lê o material e devolve o rascunho. Ele é bom
 * nisso, já está pago e não gasta a cota de ninguém.
 *
 * Segunda mão: a IA escolhida pega esse rascunho e aplica o retrato — o peso de
 * cada tema, o nível que ele exige, os verbos dele. É o passo que transforma
 * "um simulado de biologia" em "a prova que ESTE professor faria".
 *
 * Sem NotebookLM na jogada (não configurado, sessão caída, ou porque quem
 * escolheu foi ele mesmo no seletor) o funil continua inteiro: a segunda mão lê
 * os arquivos direto. Nenhuma das duas é ponto único de falha.
 */
export async function* gerarFormato({
  professorId,
  tipo,
  ref,
  pastas = null,
  signal,
  notebooklm = true,
  // Injetada só pelos testes, como em `gerarNoNotebookLM`: a tela do Google não
  // entra na suíte, mas o contrato entre as duas mãos entra.
  sessao = null
}) {
  const formato = FORMATOS[tipo];
  if (!formato) throw erroHttp(400, 'não sei gerar isso');
  if (!ref) throw erroHttp(400, 'escolha uma IA pra gerar');

  const professor = acharProfessor(professorId);
  const soNotebookLM = ehRefDoNotebookLM(ref);

  const primeiraMao = soNotebookLM || (notebooklm && temNotebookLM() && !descansando());
  yield {
    type: 'start',
    tipo,
    modelo: soNotebookLM ? 'NotebookLM' : describeModel(ref),
    // Quem lê é uma coisa, quem finaliza é outra: a tela mostra as duas etapas
    // porque elas demoram e a pessoa precisa saber em qual está.
    rascunho: primeiraMao ? 'NotebookLM' : null,
    toque: soNotebookLM ? null : describeModel(ref),
    retrato: !!professor.retrato,
    arquivos: 0,
    cortado: false
  };

  // --- primeira mão -------------------------------------------------------
  let rascunho = null;
  if (primeiraMao) {
    try {
      rascunho = yield* rascunhoDoNotebookLM({ professorId, tipo, formato, pastas, signal, sessao });
      if (rascunho) caiuEm = 0;
    } catch (err) {
      if (signal?.aborted) return;
      if (soNotebookLM) throw err;
      caiuEm = Date.now();
      yield { type: 'passo', o_que: 'o NotebookLM não respondeu; lendo o material aqui mesmo' };
    }
  }

  if (soNotebookLM) {
    if (!rascunho) throw erroHttp(422, 'o NotebookLM não devolveu nada utilizável');
    const salvo = guardarSaida({
      professorId,
      pastaId: Array.isArray(pastas) && pastas.length === 1 ? pastas[0] : null,
      tipo,
      titulo: formato.titulo(professor),
      // Texto corrido, não o JSON dos nossos moldes: guardar como texto é
      // honesto, e a tela desenha texto quando não há estrutura.
      json: { texto: rascunho.texto },
      fontes: rascunho.fontes,
      modelo: 'notebooklm'
    });
    yield { type: 'pronto', saida: salvo };
    return;
  }

  // --- segunda mão --------------------------------------------------------
  const fonte = rascunho
    ? { texto: rascunho.texto, fontes: rascunho.fontes, cortado: false, quantos: rascunho.fontes.length }
    : material(professorId, formato.papeis, pastas);
  if (!fonte.texto) {
    throw erroHttp(400, 'não há material pra ler — anexe o conteúdo da matéria antes');
  }

  yield {
    type: 'etapa',
    o_que: rascunho ? 'toque' : 'sozinho',
    modelo: describeModel(ref),
    arquivos: fonte.quantos,
    cortado: fonte.cortado
  };

  const retrato = retratoEmPalavras(professor.retrato);
  const entrada = [
    `Professor: ${professor.nome}${professor.materia ? ` (${professor.materia})` : ''}`,
    retrato ? `\n# Retrato do professor\n${retrato}` : '',
    rascunho
      ? `\n# Rascunho (leitura do material feita pelo NotebookLM)\n${rascunho.texto}`
      : `\n# Material\n${fonte.texto}`
  ]
    .filter(Boolean)
    .join('\n');

  const sistema = [
    formato.prompt,
    rascunho ? RASCUNHO_ALHEIO : '',
    retrato ? TOQUE_DO_PROFESSOR : SEM_RETRATO
  ]
    .filter(Boolean)
    .join('\n\n');

  let pronto = null;
  for (let tentativa = 0; tentativa < 2 && !pronto; tentativa += 1) {
    if (signal?.aborted) return;
    if (tentativa) yield { type: 'repetindo' };
    const saida = await complete(ref, {
      system: sistema,
      // A última linha é a que o modelo obedece: o formato mora no prompt de
      // sistema e entre ele e a resposta vem o material inteiro.
      prompt: `${entrada}\n\n${
        tentativa === 0
          ? 'Responda com o objeto JSON do formato acima, e nada mais.'
          : 'Responda SOMENTE o objeto JSON do formato acima, começando em { e terminando em }. Nada antes, nada depois, sem cerca de markdown.'
      }`,
      temperature: tentativa === 0 ? 0.3 : 0,
      signal
    });
    pronto = formato.conferir(parseJsonObject(saida.text));
  }

  if (!pronto) throw erroHttp(422, 'a IA não devolveu algo utilizável — tente com outro modelo');

  const salvo = guardarSaida({
    professorId,
    pastaId: Array.isArray(pastas) && pastas.length === 1 ? pastas[0] : null,
    tipo,
    titulo: formato.titulo(professor),
    json: pronto,
    fontes: fonte.fontes,
    modelo: rascunho ? `notebooklm+${ref}` : ref
  });

  yield { type: 'pronto', saida: salvo };
}
