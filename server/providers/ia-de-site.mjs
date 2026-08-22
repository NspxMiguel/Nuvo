// As IAs de site como provedores do app.
//
// Um provedor só, com um "modelo" por site: escolher `ChatGPT` no seletor manda
// a pergunta pra tela do ChatGPT. Não tem chave, não tem cobrança por token e
// não tem lista vinda da rede — o que existe é a conta que ele já tem lá dentro.

import { disponivel, perguntarNoSite, SITES } from '../ia-de-site.mjs';
import { erroHttp } from '../erro-traduzivel.mjs';

export const kind = 'site';

/**
 * Um modelo por site. A lista é fixa e local de propósito: ela precisa funcionar
 * antes de ele ter entrado em site nenhum, senão não daria nem pra adicionar.
 */
export async function listModels() {
  return SITES.map((s) => ({ model_id: s.id, label: s.nome, kind: 'chat' }));
}

/**
 * O botão "testar" abre o site e vê se a tela responde.
 *
 * Testa o primeiro da lista configurada, que é o suficiente pra dizer se o
 * navegador do app abre e se a automação enxerga a página.
 */
export async function check(ctx) {
  const site = ctx?.config?.site || SITES[0].id;
  const { ok, porque } = await disponivel({ site });
  if (!ok) throw erroHttp(503, porque || 'o site não respondeu');
  return await listModels();
}

export async function* stream(ctx, req) {
  const pergunta = [...(req.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
  const gerador = perguntarNoSite({ site: req.model, pergunta, signal: req.signal });
  let passo = await gerador.next();
  while (!passo.done) {
    // Cada passo da tela vira raciocínio visível: sem isso são dois minutos de
    // silêncio enquanto um navegador invisível trabalha.
    if (passo.value?.passo) yield { reasoning: `${passo.value.passo}\n` };
    passo = await gerador.next();
  }
  const texto = passo.value?.texto;
  if (!texto) throw erroHttp(422, 'o site não devolveu nada utilizável');
  yield { delta: texto };
}
