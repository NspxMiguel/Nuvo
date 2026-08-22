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

const PROMPT_SINTESE = `Você recebe a leitura de várias provas do MESMO professor e o que ele ensina em aula.
Escreva o retrato dele: o que ele cobra, como cobra, e o que ensina sem cobrar.

Devolva SOMENTE um objeto JSON, sem texto em volta, neste formato:
{
  "formato": {"n_questoes": 0, "tipos": [{"tipo": "...", "peso": 0.0}], "pontuacao": "ou null"},
  "conteudo": [{"tema": "...", "peso": 0.0, "apareceu_em": ["nome da prova"], "citacao": "trecho literal de uma delas"}],
  "cognitivo": [{"nivel": "lembrar|entender|aplicar|analisar|avaliar|criar", "peso": 0.0}],
  "verbos": [{"verbo": "...", "vezes": 0, "exemplo": "trecho literal"}],
  "pegadinhas": [{"padrao": "o que ele faz pra derrubar quem decorou", "exemplo": "trecho literal"}],
  "manias": ["frase curta sobre um hábito dele"],
  "so_na_aula": ["tema que ele ensina e nunca cobrou"]
}

Regras que não se negociam:
- "peso" é fração de 0 a 1, e a soma de cada lista dá aproximadamente 1.
- Toda "citacao" e todo "exemplo" são texto LITERAL vindo do que você recebeu.
  Sem trecho pra sustentar, não escreva o item.
- "so_na_aula" sai da diferença entre o que aparece no material de aula e o que
  aparece nas provas. Se você não recebeu material de aula, devolva lista vazia
  em vez de inventar.
- Com UMA prova só, não afirme padrão: descreva o que viu e nada além.`;

const nada = (v) => v === null || v === undefined;

/** Fração entre 0 e 1, ou 0. Modelo devolve "40%", "0,4" e 40 pra mesma coisa. */
function fracao(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor > 1 ? valor / 100 : Math.max(valor, 0);
  const n = Number(String(valor ?? '').replace('%', '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : Math.max(n, 0);
}

const texto = (v, limite = 300) => String(v ?? '').trim().slice(0, limite);
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
    so_na_aula: lista(bruto.so_na_aula).map((s) => texto(s, 120)).filter(Boolean)
  };
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
    try {
      const saida = await complete(ref, {
        system: PROMPT_PROVA,
        prompt: `Prova: ${pasta.nome}\n\n${corpo}`,
        temperature: 0,
        signal
      });
      lido = parseJsonObject(saida.text);
    } catch (err) {
      if (signal?.aborted) return;
      yield { type: 'pulada', nome: pasta.nome, porque: err?.message || String(err) };
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
  const universo = bloco(materiais, TETO_DO_UNIVERSO);
  const entrada = [
    `Professor: ${professor.nome}${professor.materia ? ` (${professor.materia})` : ''}`,
    `\n# Leitura das provas\n${JSON.stringify(leituras, null, 1)}`,
    universo.texto
      ? `\n# O que ele ensina em aula\n${universo.texto}`
      : '\n# O que ele ensina em aula\n(nada foi anexado)'
  ].join('\n');

  let retrato = null;
  for (let tentativa = 0; tentativa < 2 && !retrato; tentativa += 1) {
    if (signal?.aborted) return;
    const saida = await complete(ref, {
      system: PROMPT_SINTESE,
      // A segunda tentativa é mais dura de propósito: modelo que já errou o
      // formato uma vez costuma errar de novo com o mesmo pedido.
      prompt: tentativa === 0 ? entrada : `${entrada}\n\nDevolva SOMENTE o objeto JSON. Nada antes, nada depois.`,
      temperature: 0,
      signal
    });
    retrato = limparRetrato(parseJsonObject(saida.text));
    if (!retrato && tentativa === 0) yield { type: 'repetindo' };
  }

  if (!retrato) throw erroHttp(422, 'a IA não devolveu um retrato utilizável — tente com outro modelo');

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
