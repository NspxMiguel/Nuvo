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
import { listAttachments, textoDoAnexo } from './documents.mjs';
import { erroHttp } from './erro-traduzivel.mjs';
import { acharProfessor, guardarSaida, pastasDo } from './estudos.mjs';

const TETO = 26_000;

const texto = (v, limite = 600) => String(v ?? '').trim().slice(0, limite);
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

/**
 * Os formatos. Cada um diz o que pede ao modelo, como confere a resposta e o
 * título que vai pra lista.
 */
export const FORMATOS = {
  simulado: {
    papeis: ['conteudo', 'material'],
    precisaRetrato: true,
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
    precisaRetrato: true,
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
    precisaRetrato: false,
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
    precisaRetrato: false,
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
  }
};

export const TIPOS = Object.keys(FORMATOS);

/** Junta o material dos papéis que este formato usa, com o nome do arquivo por cima. */
function material(professorId, papeis, pastaId) {
  const pastas = pastasDo(professorId).filter((p) => !pastaId || p.id === pastaId);
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
export async function* gerarFormato({ professorId, tipo, ref, pastaId = null, signal }) {
  const formato = FORMATOS[tipo];
  if (!formato) throw erroHttp(400, 'não sei gerar isso');
  if (!ref) throw erroHttp(400, 'escolha uma IA pra gerar');

  const professor = acharProfessor(professorId);
  if (formato.precisaRetrato && !professor.retrato) {
    throw erroHttp(400, 'monte o retrato do professor primeiro — é ele que recorta o que sai daqui');
  }

  const fonte = material(professorId, formato.papeis, pastaId);
  if (!fonte.texto) {
    throw erroHttp(400, 'não há material pra ler — anexe o conteúdo da matéria antes');
  }

  yield { type: 'start', tipo, modelo: describeModel(ref), arquivos: fonte.quantos, cortado: fonte.cortado };

  const retrato = retratoEmPalavras(professor.retrato);
  const entrada = [
    `Professor: ${professor.nome}${professor.materia ? ` (${professor.materia})` : ''}`,
    retrato ? `\n# Retrato do professor\n${retrato}` : '',
    `\n# Material\n${fonte.texto}`
  ]
    .filter(Boolean)
    .join('\n');

  let pronto = null;
  for (let tentativa = 0; tentativa < 2 && !pronto; tentativa += 1) {
    if (signal?.aborted) return;
    if (tentativa) yield { type: 'repetindo' };
    const saida = await complete(ref, {
      system: formato.prompt,
      prompt: tentativa === 0 ? entrada : `${entrada}\n\nDevolva SOMENTE o objeto JSON. Nada antes, nada depois.`,
      temperature: tentativa === 0 ? 0.3 : 0,
      signal
    });
    pronto = formato.conferir(parseJsonObject(saida.text));
  }

  if (!pronto) throw erroHttp(422, 'a IA não devolveu algo utilizável — tente com outro modelo');

  const salvo = guardarSaida({
    professorId,
    pastaId,
    tipo,
    titulo: formato.titulo(professor),
    json: pronto,
    fontes: fonte.fontes,
    modelo: ref
  });

  yield { type: 'pronto', saida: salvo };
}
