// O retrato do professor: o que ele cobra, extraído do que ele já cobrou.
//
// Prova passada é amostra; material de aula é o universo. A distância entre os
// dois é a informação que interessa — o que ele ensinou e nunca cobrou, o que
// ele cobra toda vez, em que formato e em que nível. Um resumidor comum lê o
// material e devolve a matéria inteira; aqui a matéria inteira é justamente o
// que a gente quer poder descartar.
//
// O esqueleto não foi inventado: é a tabela de especificações que se usa pra
// montar prova de verdade — conteúdo × nível cognitivo × formato × peso. Ela é
// verificável, o que "estilo do professor" não é: cada achado sai daqui com o
// trecho literal que o sustenta, e a tela mostra esse trecho do lado.
//
// Duas passadas: uma leitura por prova, depois uma síntese sobre todas. Ler as
// seis de uma vez cabe no contexto de modelo grande e não cabe no de modelo
// local — e a leitura separada é a que produz citação confiável, porque o modelo
// está olhando um documento só quando cita.

import { complete, describeModel, parseJsonObject } from './complete.mjs';
import { listAttachments, textoDoAnexo } from './documents.mjs';
import { erroHttp } from './erro-traduzivel.mjs';
import { cortarNaPalavra, semMarcacao } from './texto-do-modelo.mjs';
import { acharProfessor, guardarLeitura, leituraGuardada, pastasDo } from './estudos.mjs';
import { now, run } from './db.mjs';
import { createHash } from 'node:crypto';

/** Os seis níveis de Bloom, do mais raso ao mais fundo. Enum fechado de propósito:
 *  é o que deixa a tela traduzir o rótulo e o gerador de simulado equilibrar a prova. */
export const NIVEIS = ['lembrar', 'entender', 'aplicar', 'analisar', 'avaliar', 'criar'];

/** Teto de texto por prova numa passada. Prova cabe folgado; apostila não, e
 *  apostila não é prova — quem passar disso é cortado com aviso. */
const TETO_POR_PROVA = 18_000;

/**
 * Impressão digital do que produziu uma leitura: os arquivos e o modelo.
 *
 * Trocar de modelo ou anexar outra prova na mesma pasta muda a leitura, então
 * muda a chave. Reaproveitar a leitura de um modelo com o nome de outro seria
 * mentira no campo "modelo" do retrato.
 */
/**
 * O erro é de tamanho do pedido?
 *
 * Cada provedor escreve de um jeito: 413, "request too large", "context length
 * exceeded", "maximum context". Encolher e tentar de novo só faz sentido nesses.
 */
function naoCoube(err) {
  if (err?.httpStatus === 413) return true;
  return /too large|context length|maximum context|reduce your message/i.test(String(err?.message || ''));
}

function impressao(provas, ref) {
  const fonte = provas
    .map((a) => `${a.id}:${a.chunks || 0}:${a.updated_at || a.created_at || ''}`)
    .sort()
    .join('|');
  return createHash('sha256').update(`${ref}\n${fonte}`).digest('hex').slice(0, 32);
}
const TETO_DO_UNIVERSO = 24_000;

const PROMPT_PROVA = `Você analisa UMA prova já aplicada e devolve a estrutura dela.

Devolva SOMENTE um objeto JSON, sem texto em volta, neste formato:
{
  "formato": {"n_questoes": 0, "tipos": [{"tipo": "discursiva|multipla escolha|verdadeiro ou falso|calculo|outro", "quantas": 0}], "pontuacao": "como a nota é distribuída, ou null"},
  "questoes": [
    {"n": 1,
     "tema": "o assunto cobrado, em até 6 palavras",
     "nivel": "lembrar|entender|aplicar|analisar|avaliar|criar",
     "tipo": "discursiva|multipla escolha|verdadeiro ou falso|calculo|outro",
     "verbo": "o verbo de comando usado (explique, calcule, justifique...)",
     "citacao": "o enunciado literal, no máximo 200 caracteres"}
  ],
  "observacoes": ["manias que você notou nesta prova, uma frase cada"]
}

Regras que não se negociam:
- "citacao" é texto LITERAL da prova. Não reescreva, não resuma, não invente.
- Se não conseguir ler alguma questão, deixe-a de fora em vez de adivinhar.
- "nivel" é o esforço que a questão exige de quem responde, não a dificuldade
  que você acha que ela tem: repetir definição é "lembrar"; usar a fórmula num
  caso novo é "aplicar"; comparar duas posições é "analisar".
- Se o documento não for uma prova, devolva {"formato": null, "questoes": [], "observacoes": ["não parece uma prova"]}.`;

const PROMPT_SINTESE = `Você é uma função que devolve JSON. Não escreve carta, não
dá conselho e não fala com o professor: o que sai daqui é lido por um programa.

Você recebe a leitura de várias provas do MESMO professor e o que ele ensina em aula.
Escreva o retrato dele: o que ele cobra, como cobra, e o que ensina sem cobrar.

Devolva SOMENTE um objeto JSON, sem texto em volta, neste formato:
{
  "formato": {"n_questoes": 0, "tipos": [{"tipo": "...", "peso": 0.0}], "pontuacao": "ou null"},
  "conteudo": [{"tema": "...", "peso": 0.0, "apareceu_em": ["nome da prova"], "citacao": "trecho literal de uma delas"}],
  "cognitivo": [{"nivel": "lembrar|entender|aplicar|analisar|avaliar|criar", "peso": 0.0}],
  "verbos": [{"verbo": "...", "vezes": 0, "exemplo": "trecho literal"}],
  "pegadinhas": [{"padrao": "o que ele faz pra derrubar quem decorou", "exemplo": "trecho literal"}],
  "manias": ["frase curta sobre um hábito dele"],
  "temas_da_aula": ["tema que aparece no material de aula, qualquer um"]
}

Regras que não se negociam:
- "peso" é fração de 0 a 1, e a soma de cada lista dá aproximadamente 1.
- Toda "citacao" e todo "exemplo" são texto LITERAL vindo do que você recebeu.
  Sem trecho pra sustentar, não escreva o item.
- "temas_da_aula" é a lista do que o material de aula cobre, sem filtrar nada:
  não é sua tarefa comparar com as provas nem decidir o que ele cobra. Liste
  tudo, inclusive o que também aparece nas provas. Sem material de aula, lista
  vazia.
- Com UMA prova só, não afirme padrão: descreva o que viu e nada além.`;

/**
 * As leituras das provas escritas como texto, não como JSON.
 *
 * Um array JSON no meio do pedido é um começo de resposta, e modelo devolvia a
 * própria lista de provas de volta em vez do retrato. Em texto não há array pra
 * continuar, e o pedido fica menor e legível.
 *
 * Medido, e sem vitória: `gpt-oss-120b` e `qwen3.6-27b` erram a forma dos dois
 * jeitos, três em três. O que decide este passo é o modelo — `gemini-2.5-flash`
 * acerta na primeira com JSON ou com texto —, e é por isso que a mensagem de
 * falha manda trocar de modelo.
 */
function emTexto(leituras) {
  return leituras
    .map((leitura) => {
      const cabeca = [
        `## ${leitura.nome}`,
        leitura.n_questoes ? `${leitura.n_questoes} questões` : '',
        leitura.pontuacao ? `pontuação: ${leitura.pontuacao}` : '',
        leitura.cortado ? '(o arquivo foi cortado no meio)' : ''
      ]
        .filter(Boolean)
        .join(' · ');
      const questoes = lista(leitura.questoes).map((q, i) => {
        const marca = [q.formato, q.tema, q.nivel, q.verbo ? `verbo "${q.verbo}"` : '', q.pontos ? `${q.pontos} ponto(s)` : '']
          .filter(Boolean)
          .join(' · ');
        return `${q.n || i + 1}. ${q.enunciado || ''}${marca ? `\n   [${marca}]` : ''}`;
      });
      return [cabeca, ...questoes].join('\n');
    })
    .join('\n\n');
}

/**
 * A ordem repetida no fim do pedido.
 *
 * O formato mora no prompt de sistema e, entre ele e a resposta, vem uma prova
 * inteira. Repetir no fim é barato e é onde o modelo costuma olhar por último.
 *
 * Não é bala de prata, e foi medido: com `openai/gpt-oss-120b` e
 * `qwen/qwen3.6-27b` o resultado é o mesmo com e sem a linha — os dois devolvem
 * uma estrutura inventada nas três tentativas. `gemini-2.5-flash` acerta na
 * primeira dos dois jeitos. Quem decide aqui é o modelo, e é por isso que a
 * mensagem de falha manda trocar de modelo em vez de mandar tentar de novo.
 *
 * O modo JSON do provedor (`json: true` em `complete`) piora este caso em vez de
 * ajudar: ligado, ele garante que a resposta é JSON e solta a forma — dois
 * modelos devolveram JSON válido com a estrutura deles. Aqui a forma é o que
 * importa, então ele fica desligado.
 */
const SO_O_JSON = 'Responda com o objeto JSON do formato acima, e nada mais.';
const SO_O_JSON_DURO =
  'Responda SOMENTE o objeto JSON do formato acima, começando em { e terminando em }. Nada antes, nada depois, sem cerca de markdown.';

const nada = (v) => v === null || v === undefined;

/** Fração entre 0 e 1, ou 0. Modelo devolve "40%", "0,4" e 40 pra mesma coisa. */
function fracao(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor > 1 ? valor / 100 : Math.max(valor, 0);
  const n = Number(String(valor ?? '').replace('%', '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : Math.max(n, 0);
}

const texto = (v, limite = 300) => cortarNaPalavra(semMarcacao(v), limite);
const lista = (v) => (Array.isArray(v) ? v : []);

/**
 * Confere a saída do modelo antes de gravar.
 *
 * Retrato malformado não vira retrato pela metade: ou ele tem forma, ou a pessoa
 * recebe um erro honesto. Um retrato com campo faltando apareceria na tela como
 * "este professor não cobra nada de aplicação", que é mentira com cara de dado.
 */
export function limparRetrato(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const conteudo = lista(bruto.conteudo)
    .map((c) => ({
      tema: texto(c.tema, 120),
      peso: fracao(c.peso),
      apareceu_em: lista(c.apareceu_em).map((x) => texto(x, 120)),
      citacao: texto(c.citacao)
    }))
    .filter((c) => c.tema);
  const cognitivo = lista(bruto.cognitivo)
    .map((c) => ({ nivel: NIVEIS.includes(c.nivel) ? c.nivel : null, peso: fracao(c.peso) }))
    .filter((c) => c.nivel);
  if (!conteudo.length && !cognitivo.length) return null;

  const temasDaAula = lista(bruto.temas_da_aula).map((t) => texto(t, 120)).filter(Boolean);

  return {
    versao: 1,
    formato: nada(bruto.formato)
      ? null
      : {
          n_questoes: Number(bruto.formato.n_questoes) || null,
          tipos: lista(bruto.formato.tipos)
            .map((t) => ({ tipo: texto(t.tipo, 60), peso: fracao(t.peso ?? t.quantas) }))
            .filter((t) => t.tipo),
          pontuacao: texto(bruto.formato.pontuacao, 200) || null
        },
    conteudo,
    cognitivo,
    verbos: lista(bruto.verbos)
      .map((v) => ({ verbo: texto(v.verbo, 40), vezes: Number(v.vezes) || 0, exemplo: texto(v.exemplo) }))
      .filter((v) => v.verbo),
    pegadinhas: lista(bruto.pegadinhas)
      .map((p) => ({ padrao: texto(p.padrao), exemplo: texto(p.exemplo) }))
      .filter((p) => p.padrao),
    manias: lista(bruto.manias).map((m) => texto(m)).filter(Boolean),
    temas_da_aula: temasDaAula,
    // O "ensina e nunca cobrou" é a diferença entre duas listas, e conta feita
    // por modelo no meio de outras seis saídas voltava vazia justamente quando
    // havia material de aula pra comparar. Aqui ela é conta, e dá pra conferir:
    // as duas listas ficam gravadas ao lado da resposta.
    so_na_aula: soNaAula(temasDaAula, conteudo)
  };
}

/** Sem acento, sem pontuação, em minúscula. É como os dois lados se comparam. */
const achatar = (texto) =>
  String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * As palavras de um tema que sozinhas já nomeiam um assunto.
 *
 * Seis letras é grosseiro e é o que funciona: "ciclo" tem cinco e aparece em
 * "ciclo de Krebs" e em "ciclo da água", que não são o mesmo assunto;
 * "genética" tem oito e aparece em "genética mendeliana" e em "engenharia
 * genética", que são. Palavra curta não some do texto — só não serve de prova
 * de que dois temas são o mesmo.
 */
const palavrasDe = (texto) => achatar(texto).split(' ').filter((p) => p.length >= 6);

/**
 * O que ele ensina e nunca cobrou.
 *
 * Um tema de aula é dado como cobrado quando um tema de prova o contém, é contido
 * por ele, ou divide com ele uma palavra que signifique alguma coisa. É frouxo de
 * propósito: dizer que ele nunca cobrou uma coisa que ele cobrou é o erro caro —
 * manda a pessoa estudar o que não cai e deixar de estudar o que cai.
 */
function soNaAula(temasDaAula, conteudo) {
  if (!temasDaAula.length || !conteudo.length) return [];
  const cobrados = conteudo.map((c) => ({ inteiro: achatar(c.tema), palavras: new Set(palavrasDe(c.tema)) }));
  return temasDaAula.filter((tema) => {
    const inteiro = achatar(tema);
    if (!inteiro) return false;
    const palavras = palavrasDe(tema);
    return !cobrados.some(
      (c) =>
        (c.inteiro && (c.inteiro.includes(inteiro) || inteiro.includes(c.inteiro))) ||
        palavras.some((p) => c.palavras.has(p))
    );
  });
}

/**
 * Quanto dá pra confiar no que saiu.
 *
 * Não é enfeite: com uma prova só o retrato é a descrição daquela prova, e
 * chamar isso de padrão do professor é o erro que os preditores de prova comerciais
 * cometem. A tela mostra esta nota junto do retrato, sempre.
 */
export function confianca({ provas, materiais }) {
  if (provas <= 1) return { provas, materiais, nota: 'palpite' };
  if (provas === 2) return { provas, materiais, nota: 'indicio' };
  if (provas >= 3 && materiais >= 1) return { provas, materiais, nota: 'boa' };
  return { provas, materiais, nota: 'media' };
}

function cortar(textoInteiro, teto) {
  const limpo = String(textoInteiro || '').trim();
  if (limpo.length <= teto) return { texto: limpo, cortado: false };
  return { texto: limpo.slice(0, teto), cortado: true };
}

/** Junta os anexos de um papel num bloco só, com o nome do arquivo por cima. */
function bloco(anexos, teto) {
  const partes = [];
  let sobra = teto;
  let cortado = false;
  for (const anexo of anexos) {
    if (sobra <= 0) {
      cortado = true;
      break;
    }
    const { texto: corpo, cortado: cortouEste } = cortar(textoDoAnexo(anexo.id), sobra);
    if (!corpo) continue;
    cortado = cortado || cortouEste;
    sobra -= corpo.length;
    partes.push(`## ${anexo.name}\n${corpo}`);
  }
  return { texto: partes.join('\n\n'), cortado };
}

/**
 * Monta o retrato e vai contando o que faz.
 *
 * @param {{professorId: string, ref: string, signal?: AbortSignal}} entrada
 */
export async function* montarRetrato({ professorId, ref, signal }) {
  const professor = acharProfessor(professorId);
  if (!ref) throw erroHttp(400, 'escolha uma IA pra montar o retrato');

  const pastas = pastasDo(professorId).map((pasta) => ({
    ...pasta,
    anexos: listAttachments({ pastaId: pasta.id }).filter((a) => a.status === 'ok')
  }));

  const comProva = pastas
    .map((pasta) => ({ pasta, provas: pasta.anexos.filter((a) => a.papel === 'prova') }))
    .filter((x) => x.provas.length);
  const materiais = pastas.flatMap((p) => p.anexos.filter((a) => a.papel !== 'prova'));

  if (!comProva.length) {
    throw erroHttp(400, 'sem nenhuma prova dele, não há o que retratar — anexe pelo menos uma');
  }

  yield {
    type: 'start',
    modelo: describeModel(ref),
    provas: comProva.length,
    materiais: materiais.length
  };

  // --- passada 1: uma leitura por prova ------------------------------------
  //
  // Uma prova que falha não leva as outras junto. Ler cinco provas leva minutos,
  // e um 429 de cota por minuto na terceira jogava fora o trabalho das duas
  // primeiras — com quatro provas lidas o retrato já vale, e dizer qual ficou de
  // fora é melhor do que não ter retrato nenhum.
  const leituras = [];
  for (const [i, { pasta, provas }] of comProva.entries()) {
    if (signal?.aborted) return;
    yield { type: 'lendo', nome: pasta.nome, n: i + 1, total: comProva.length };
    const { texto: corpo, cortado } = bloco(provas, TETO_POR_PROVA);
    if (!corpo) {
      yield { type: 'pulada', nome: pasta.nome, porque: 'não deu pra ler nenhum arquivo dela' };
      continue;
    }
    // Leitura já feita, mesma fonte e mesmo modelo: reaproveita. Sem isto, um
    // erro na síntese — que é o último passo — obrigava a reler tudo.
    const chave = impressao(provas, ref);
    let lido = leituraGuardada(pasta.id, chave);
    if (lido) {
      leituras.push({ nome: pasta.nome, cortado, ...lido });
      yield { type: 'lida', nome: pasta.nome, questoes: lista(lido.questoes).length, cortado, guardada: true };
      continue;
    }
    // Duas tentativas, como na síntese: modelo pequeno erra o formato na
    // primeira e acerta quando o pedido vira ordem. Sem isto, uma prova densa
    // saía como "a IA não devolveu a estrutura" na primeira topada.
    let erro = null;
    for (let tentativa = 0; tentativa < 2 && !lido?.questoes?.length; tentativa += 1) {
      if (signal?.aborted) return;
      try {
        const saida = await complete(ref, {
          system: PROMPT_PROVA,
          prompt:
            tentativa === 0
              ? `Prova: ${pasta.nome}\n\n${corpo}\n\n${SO_O_JSON}`
              : `Prova: ${pasta.nome}\n\n${corpo}\n\nDevolva SOMENTE o objeto JSON, começando em { e terminando em }. Nada antes, nada depois.`,
          temperature: 0,
          signal
        });
        lido = parseJsonObject(saida.text);
      } catch (err) {
        if (signal?.aborted) return;
        erro = err;
        break;
      }
    }
    if (erro) {
      yield { type: 'pulada', nome: pasta.nome, porque: erro?.message || String(erro) };
      continue;
    }
    if (!lido || !lista(lido.questoes).length) {
      yield { type: 'pulada', nome: pasta.nome, porque: 'a IA não devolveu a estrutura da prova' };
      continue;
    }
    guardarLeitura(pasta.id, chave, lido);
    leituras.push({ nome: pasta.nome, cortado, ...lido });
    yield {
      type: 'lida',
      nome: pasta.nome,
      questoes: lista(lido.questoes).length,
      cortado
    };
  }

  if (!leituras.length) {
    throw erroHttp(422, 'nenhuma das provas pôde ser lida — confira se os arquivos abrem');
  }

  // --- passada 2: a síntese ------------------------------------------------
  yield { type: 'sintetizando' };

  const monta = (teto) => {
    const universo = teto ? bloco(materiais, teto) : { texto: '' };
    return [
      `Professor: ${professor.nome}${professor.materia ? ` (${professor.materia})` : ''}`,
      `\n# Leitura das provas\n${emTexto(leituras)}`,
      universo.texto
        ? `\n# O que ele ensina em aula\n${universo.texto}`
        : '\n# O que ele ensina em aula\n(nada foi anexado)'
    ].join('\n');
  };

  // O pedido encolhe quando não cabe. Modelo de cota apertada recusa 9 mil
  // tokens com 413, e o pedaço grande do pedido é o material de aula — a
  // leitura das provas é o que não pode faltar. Cortar o material dá um retrato
  // com menos "ele ensina e nunca cobrou"; não cortar dá retrato nenhum.
  const tetos = [TETO_DO_UNIVERSO, Math.round(TETO_DO_UNIVERSO / 3), 0];
  let retrato = null;
  let apertado = false;
  for (const teto of tetos) {
    const entrada = monta(teto);
    for (let tentativa = 0; tentativa < 2 && !retrato; tentativa += 1) {
      if (signal?.aborted) return;
      let saida;
      try {
        saida = await complete(ref, {
          system: PROMPT_SINTESE,
          // A segunda tentativa é mais dura de propósito: modelo que já errou o
          // formato uma vez costuma errar de novo com o mesmo pedido.
          prompt: `${entrada}\n\n${tentativa === 0 ? SO_O_JSON : SO_O_JSON_DURO}`,
          temperature: 0,
          signal
        });
      } catch (err) {
        if (signal?.aborted) return;
        if (!naoCoube(err) || teto === 0) throw err;
        apertado = true;
        yield { type: 'apertando', teto };
        break;
      }
      retrato = limparRetrato(parseJsonObject(saida.text));
      if (!retrato && tentativa === 0) yield { type: 'repetindo' };
    }
    if (retrato) break;
  }

  if (!retrato) throw erroHttp(422, 'a IA não devolveu um retrato utilizável — tente com outro modelo');
  if (apertado) retrato.apertado = true;

  retrato.confianca = confianca({ provas: leituras.length, materiais: materiais.length });
  retrato.fontes = leituras.map((l) => ({ prova: l.nome, questoes: lista(l.questoes).length }));
  retrato.gerado_em = now();
  // O que a pessoa corrigiu à mão sobrevive: a máquina propõe, ela decide.
  retrato.correcoes = professor.retrato?.correcoes || [];

  run(
    'UPDATE professores SET retrato = ?, retrato_em = ?, retrato_modelo = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(retrato),
    retrato.gerado_em,
    ref,
    retrato.gerado_em,
    professorId
  );

  yield { type: 'retrato', retrato, modelo: describeModel(ref) };
}
