// Conselho de IAs: o mesmo prompt em vários modelos ao mesmo tempo.
//
// Três modos, do mais barato pro mais caro:
//   comparar — as respostas lado a lado, você julga;
//   conselho — as respostas mais uma síntese feita por um modelo juiz;
//   votação — cada modelo avalia as respostas dos outros sem saber de quem é
//             cada uma, e o resultado é a nota média.
//
// A votação é cega de propósito: modelo que sabe qual resposta é a dele tende a
// votar nela.

import { complete, describeModel, parseJsonArray } from './complete.mjs';
import { corpoDoErro, erroTraduzivel, textoTraduzivel } from './erro-traduzivel.mjs';

const SYNTH_PROMPT = `Você recebe várias respostas independentes à mesma pergunta e escreve a resposta final.

Não escolha uma e descarte o resto: aproveite o que cada uma tem de melhor.
Onde elas divergirem em fato, diga que divergem e qual parece mais sustentada.
Onde só uma trouxer algo relevante, incorpore.
Não mencione "resposta A" ou "os modelos" — escreva a resposta final direto,
como se fosse sua. Português do Brasil.`;

const JUDGE_PROMPT = `Você avalia respostas candidatas a uma mesma pergunta.

Devolva SOMENTE um array JSON, um objeto por candidata, na mesma ordem em que
aparecem, no formato:
[{"nota": 0-10, "porque": "uma frase"}]

Critérios, nesta ordem: está correta; responde o que foi perguntado; é
específica em vez de genérica; não inventa fato. Estilo conta pouco.
Seja duro: nota 10 é resposta que você não melhoraria.`;

/**
 * @param {{prompt: string, system?: string, refs: string[], mode?: 'compare'|'council'|'vote',
 *          judge?: string, temperature?: number, signal?: AbortSignal}} input
 */
export async function* runCouncil({ prompt, system, refs, mode = 'council', judge, temperature, signal }) {
  const models = [...new Set(refs)].filter(Boolean);
  if (models.length < 2) throw new Error('o conselho precisa de pelo menos dois modelos');

  yield { type: 'start', models: models.map((ref) => ({ ref, label: describeModel(ref) })), mode };

  // Todos respondem ao mesmo tempo: o custo em tempo é o do modelo mais lento,
  // não a soma.
  const answers = await Promise.all(
    models.map(async (ref) => {
      try {
        const out = await complete(ref, { system, prompt, temperature, signal });
        return { ref, label: describeModel(ref), text: out.text, ms: out.ms, error: null };
      } catch (err) {
        return { ref, label: describeModel(ref), text: '', ms: 0, ...corpoDoErro(err) };
      }
    })
  );

  for (const answer of answers) yield { type: 'answer', ...answer };

  const good = answers.filter((a) => a.text && !a.error);
  if (!good.length) {
    yield { type: 'error', message: 'nenhum modelo respondeu' };
    return;
  }
  if (mode === 'compare' || good.length < 2) {
    yield { type: 'done' };
    return;
  }

  const judgeRef = judge || good[0].ref;

  if (mode === 'vote') {
    yield { type: 'phase', text: 'votação cega' };

    // Cada jurado vê as candidatas embaralhadas e sem nome. O índice original
    // fica guardado aqui pra devolver a nota ao dono depois.
    const scores = new Map(good.map((a) => [a.ref, []]));
    const rounds = await Promise.all(
      good.map(async (voter, seed) => {
        // Ordem diferente por jurado, derivada do índice — sem sorteio, o que
        // mantém o resultado reproduzível.
        const order = good.map((_, i) => (i + seed) % good.length);
        const list = order
          .map((idx, position) => `### Candidata ${position + 1}\n${good[idx].text}`)
          .join('\n\n');
        try {
          const out = await complete(voter.ref, {
            system: JUDGE_PROMPT,
            prompt: `Pergunta:\n${prompt}\n\n${list}`,
            temperature: 0,
            maxTokens: 900,
            signal
          });
          const parsed = parseJsonArray(out.text) || [];
          return { voter, order, parsed };
        } catch (err) {
          return { voter, order, parsed: [], ...corpoDoErro(err) };
        }
      })
    );

    // Cédula fora da escala é anulada, não ajustada. Um jurado que responde de
    // 0 a 100 — o que modelo local faz com frequência — decide sozinho a
    // votação inteira: o 80 dele enterra o 10 de todos os outros, e vence a
    // resposta que a maioria pôs em último. Cortar em 10 não resolve, porque
    // mantém o voto errado com peso máximo; o que não dá pra ler não vota.
    let anuladas = 0;
    for (const round of rounds) {
      const dentroDaEscala = round.order.every((_, position) => {
        const grade = Number(round.parsed[position]?.nota);
        return !Number.isFinite(grade) || (grade >= 0 && grade <= 10);
      });
      if (!dentroDaEscala) {
        anuladas++;
        continue;
      }
      round.order.forEach((idx, position) => {
        const vote = round.parsed[position];
        const grade = Number(vote?.nota);
        if (Number.isFinite(grade)) {
          scores.get(good[idx].ref).push({ from: round.voter.label, nota: grade, porque: vote.porque });
        }
      });
    }

    const ranked = good
      .map((answer) => {
        const votes = scores.get(answer.ref);
        const average = votes.length ? votes.reduce((s, v) => s + v.nota, 0) / votes.length : null;
        return { ref: answer.ref, label: answer.label, average, votes };
      })
      .sort((a, b) => (b.average ?? -1) - (a.average ?? -1));

    yield { type: 'votes', ranked, anuladas };

    const winner = ranked[0];
    if (winner?.average != null) {
      yield {
        type: 'winner',
        ref: winner.ref,
        label: winner.label,
        average: Number(winner.average.toFixed(2)),
        text: good.find((a) => a.ref === winner.ref).text
      };
    }
    yield { type: 'done' };
    return;
  }

  // Conselho: um modelo costura a resposta final.
  yield { type: 'phase', ...textoTraduzivel('text', 'sintetizando com {ia}', { ia: describeModel(judgeRef) }) };
  const list = good.map((a, i) => `### Resposta ${i + 1}\n${a.text}`).join('\n\n');
  try {
    const final = await complete(judgeRef, {
      system: SYNTH_PROMPT,
      prompt: `Pergunta:\n${prompt}\n\n${list}`,
      maxTokens: 3000,
      signal
    });
    yield { type: 'synthesis', ref: judgeRef, label: describeModel(judgeRef), text: final.text, ms: final.ms };
  } catch (err) {
    yield {
      type: 'error',
      ...corpoDoErro(erroTraduzivel('a síntese falhou: {causa}', { causa: err.message }), undefined, 'message')
    };
  }
  yield { type: 'done' };
}
