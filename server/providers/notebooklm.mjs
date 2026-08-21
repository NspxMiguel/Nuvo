// O NotebookLM como uma IA do app.
//
// Não é uma API: quem responde é a tela do Google, dirigida pelo Chrome próprio
// do app. Por isso este adaptador não se parece com os outros — não tem chave,
// não tem lista de modelos vinda da rede, e o que ele manda não é um prompt: é
// um notebook novo, com os arquivos da conversa dentro, e uma pergunta no chat.
//
// A consequência que interessa: **NotebookLM sem arquivo não é NotebookLM.** Ele
// responde a partir do que foi subido, e sem fonte nenhuma responderia como uma
// IA comum — o que seria pior do que recusar, porque pareceria que funcionou.

import { perguntarNoNotebookLM } from '../notebooklm.mjs';
import { erroHttp } from '../erro-traduzivel.mjs';

export const kind = 'notebooklm';

/**
 * Um "modelo" só, porque do lado de fora não existe escolha: é o NotebookLM.
 * A lista existe porque o resto do app espera provedor com modelo dentro.
 */
export async function listModels() {
  return [{ model_id: 'notebook', label: 'NotebookLM', kind: 'chat' }];
}

/**
 * Os arquivos que a conversa carrega, no formato que o navegador precisa.
 *
 * Vêm em `req.arquivos`, montados por quem chama — este módulo não fala com o
 * banco: adaptador que consulta banco vira duas fontes de verdade sobre o que a
 * conversa tem anexado.
 */
export async function* stream(ctx, req) {
  const arquivos = Array.isArray(req.arquivos) ? req.arquivos : [];
  if (!arquivos.length) {
    throw erroHttp(400, 'o NotebookLM responde a partir de arquivos — anexe pelo menos um');
  }

  const pergunta = [...(req.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';

  const gerador = perguntarNoNotebookLM({ arquivos, pergunta, signal: req.signal });
  let passo = await gerador.next();
  while (!passo.done) {
    // Cada passo da tela vira raciocínio visível: a pessoa vê "criando um
    // notebook", "enviando 3 arquivos". Sem isso são dois minutos de silêncio.
    if (passo.value?.o_que) yield { reasoning: `${passo.value.o_que}\n` };
    passo = await gerador.next();
  }

  const texto = passo.value?.texto;
  if (!texto) throw erroHttp(422, 'o NotebookLM não devolveu nada utilizável');
  yield { delta: texto };
}
