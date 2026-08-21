// Modo agente de navegador: o modelo dirige o Chrome passo a passo.
//
// A diferença pra busca de uma vez só (`web.mjs`) é quem decide o caminho. Lá,
// o servidor busca, lê três páginas e entrega tudo junto — serve pra pergunta
// que se responde com o primeiro resultado. Aqui o modelo olha a página, decide
// o próximo passo, olha de novo, e para quando achou. É o que dá conta de
// "entra nesse site, acha a página tal e me diz o preço": ninguém sabe de
// antemão em que link clicar.
//
// Nenhum provedor daqui tem chamada de ferramenta — nem os CLIs, nem o Ollama.
// Então o protocolo é texto: o modelo responde uma linha `ACAO:` e nós
// executamos. Custa um pouco de precisão perto de uma API com ferramentas, e em
// troca funciona igual em todo modelo que o app suporta, inclusive local.

import { abrirNavegador, lerPagina, executar, acharNavegador } from './navegador.mjs';
import { complete, describeModel } from './complete.mjs';

export const PASSOS_PADRAO = 8;

const ENDERECO_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?=[:/]|$)/i;

/** Menor é melhor: primeiro custo zero, depois APIs conhecidas por serem baratas. */
function faixaEconomica(modelo) {
  if (modelo.kind === 'ollama' || ENDERECO_LOCAL.test(modelo.baseUrl || '')) return 0;
  const identidade = `${modelo.nome || ''} ${modelo.baseUrl || ''}`.toLowerCase();
  if (/groq|api\.groq\.com/.test(identidade)) return 1;
  if (/deepseek|api\.deepseek\.com/.test(identidade)) return 2;
  return 99;
}

/**
 * Resolve os dois papéis sem deixar configuração velha derrubar o turno.
 *
 * `modelos` só traz modelos de conversa ligados. Uma escolha apagada ou de IA
 * desligada cai no automático; sem alternativa econômica, cai na IA atual.
 */
export function escolherModelosDoAgente({ atual, navegar, responder, modelos = [] }) {
  const disponivel = (ref) => Boolean(ref && modelos.some((modelo) => modelo.ref === ref));
  const modeloResponder = disponivel(responder) ? responder : atual;
  const automatico = modelos
    .map((modelo, ordem) => ({ modelo, ordem, faixa: faixaEconomica(modelo) }))
    .filter((item) => item.faixa < 99)
    .sort((a, b) => a.faixa - b.faixa || a.ordem - b.ordem)[0]?.modelo;
  const modeloNavegar = disponivel(navegar) ? navegar : automatico?.ref || modeloResponder;
  return {
    navegar: modeloNavegar,
    responder: modeloResponder,
    automatico: navegar ? null : automatico?.ref || null
  };
}

/** A página do buscador é caminho, não fonte. */
const ehBuscador = (url) => /^https?:\/\/(duckduckgo|www\.google|bing)\./.test(String(url || ''));

/** Endereço que o agente não abre, mesmo se o modelo pedir. */
function enderecoProibido(url) {
  const u = String(url || '').trim().toLowerCase();
  // `file://` daria a ele o disco inteiro e `chrome://` mexe no próprio
  // navegador. Nenhum dos dois é "navegar na web", que é o que foi pedido.
  if (/^(file|chrome|chrome-extension|devtools|view-source):/.test(u)) {
    return 'esse tipo de endereço não é web — o agente só abre http e https';
  }
  return null;
}

const INSTRUCOES = `Você está dirigindo um navegador de verdade pra responder à pergunta do usuário.

A cada rodada eu te mostro a página em que você está: o endereço, o texto visível
e a lista numerada do que dá pra clicar ou preencher. Você responde com UMA ação,
nesse formato exato, sempre na última linha:

ACAO: buscar <termo>          — pesquisa na web
ACAO: navegar <url>           — abre um endereço
ACAO: clicar <número>         — clica no elemento daquele número
ACAO: escrever <número> <texto> — preenche o campo e aperta Enter
ACAO: rolar baixo             — vê o resto da página (ou "rolar cima")
ACAO: voltar                  — volta uma página
ACAO: pronto                  — você já tem a resposta

Antes da linha ACAO, escreva uma frase curta dizendo por que esse passo.

Regras:
- um passo por vez, nunca duas linhas ACAO;
- o número tem que existir na lista desta página, não invente;
- se a página não tem o que você quer, volte ou busque outra coisa em vez de
  insistir no mesmo clique;
- termine com "ACAO: pronto" assim que o que você leu já responde à pergunta;
- você não preenche campo de senha e não faz login — se a página exigir conta,
  pare com "ACAO: pronto" e diga que precisa de login.`;

/** A última linha `ACAO:` do que o modelo escreveu, já separada. */
export function lerAcao(texto) {
  const linhas = String(texto || '').split('\n');
  for (let i = linhas.length - 1; i >= 0; i--) {
    // Modelo pequeno enfeita: "**ACAO:** clicar 3", "1. AÇÃO: ...". O que
    // importa é a palavra e o que vem depois dos dois pontos.
    const m = linhas[i].match(/A[ÇC][ÃA]O\s*:?\s*\**\s*(.+)$/i);
    if (!m) continue;
    const corpo = m[1].replace(/\*+/g, '').trim();
    const [primeira, ...resto] = corpo.split(/\s+/);
    const acao = primeira
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const rabo = resto.join(' ').trim();
    if (acao === 'pronto' || acao === 'responder' || acao === 'terminar') return { acao: 'pronto' };
    if (acao === 'escrever' || acao === 'digitar') {
      const [n, ...palavras] = resto;
      return { acao: 'escrever', alvo: n, texto: palavras.join(' ').replace(/^["']|["']$/g, '') };
    }
    if (['buscar', 'pesquisar', 'navegar', 'abrir', 'clicar', 'rolar', 'voltar'].includes(acao)) {
      const nome = { pesquisar: 'buscar', abrir: 'navegar' }[acao] || acao;
      return { acao: nome, alvo: rabo };
    }
  }
  return null;
}

/** A página do jeito que o modelo lê. */
function descreverPagina(p, passo, total) {
  const lista = p.elementos
    .map((e) => `[${e.n}] ${e.escrevivel ? 'campo' : e.tag === 'a' ? 'link' : 'botão'} ${e.rotulo}`)
    .join('\n');
  return [
    `Passo ${passo} de ${total}.`,
    `Endereço: ${p.url}`,
    `Título: ${p.titulo}`,
    '',
    'Texto da página:',
    p.texto + (p.cortado ? '\n[…texto cortado, use "rolar baixo" pra ver o resto]' : ''),
    '',
    'Dá pra clicar ou preencher:',
    lista || '(nada)'
  ].join('\n');
}

/**
 * Roda o agente e vai contando o que faz.
 *
 * Devolve, no fim, o bloco de contexto pra resposta final — a mesma forma que a
 * busca simples usa, então quem chama não precisa saber qual dos dois rodou.
 *
 * @param {{pergunta: string, modelRef: string, passos?: number,
 *          janela?: boolean, signal?: AbortSignal}} opcoes
 * @returns {AsyncGenerator<object, {block: string, visitadas: Array}>}
 */
export async function* navegarComAgente({
  pergunta,
  modelRef,
  passos = PASSOS_PADRAO,
  janela = false,
  signal
}) {
  if (!acharNavegador()) throw new Error('nenhum Chrome, Chromium, Edge ou Brave encontrado nesta máquina');

  yield { type: 'phase', text: 'abrindo o navegador' };
  const { sessao, encerrar } = await abrirNavegador({ janela, signal });

  const visitadas = [];
  const anotacoes = [];
  const conversa = [];
  const nomeDoModelo = describeModel(modelRef);

  try {
    // O primeiro passo é sempre uma busca pela pergunta: começar em `about:blank`
    // gastaria uma rodada de modelo só pra ele pedir o óbvio.
    let ultimo = await executar(sessao, { acao: 'buscar', alvo: pergunta });
    yield { type: 'agent-step', n: 0, acao: 'buscar', descricao: ultimo };

    for (let passo = 1; passo <= passos; passo++) {
      if (signal?.aborted) break;

      const pagina = await lerPagina(sessao);
      // O buscador fica de fora da lista de fontes: o título dele é a própria
      // pergunta, então aparecia no rodapé como se fosse a página que respondeu.
      if (!ehBuscador(pagina.url) && !visitadas.some((v) => v.url === pagina.url)) {
        visitadas.push({ url: pagina.url, titulo: pagina.titulo });
        yield { type: 'agent-page', url: pagina.url, titulo: pagina.titulo };
      }
      anotacoes.push({ url: pagina.url, titulo: pagina.titulo, texto: pagina.texto });

      conversa.push({ role: 'user', content: descreverPagina(pagina, passo, passos) });

      const { text } = await complete(modelRef, {
        system: `${INSTRUCOES}\n\nPergunta do usuário: ${pergunta}`,
        messages: conversa,
        maxTokens: 400,
        signal
      });
      conversa.push({ role: 'assistant', content: text });

      const decisao = lerAcao(text);
      if (!decisao || decisao.acao === 'pronto') {
        yield {
          type: 'agent-step', n: passo, acao: 'pronto', descricao: 'já tenho o que precisava',
          modelo: nomeDoModelo, modeloRef: modelRef
        };
        break;
      }

      const motivo = text
        .split('\n')
        .find((l) => l.trim() && !/A[ÇC][ÃA]O\s*:/i.test(l))
        ?.replace(/\*+/g, '')
        .trim()
        .slice(0, 120);

      const bloqueio = decisao.acao === 'navegar' ? enderecoProibido(decisao.alvo) : null;
      if (bloqueio) {
        conversa.push({ role: 'user', content: `Não fiz: ${bloqueio}.` });
        yield {
          type: 'agent-step', n: passo, acao: decisao.acao, descricao: bloqueio, erro: true,
          modelo: nomeDoModelo, modeloRef: modelRef
        };
        continue;
      }

      try {
        ultimo = await executar(sessao, decisao);
        yield {
          type: 'agent-step', n: passo, acao: decisao.acao, descricao: ultimo, motivo,
          modelo: nomeDoModelo, modeloRef: modelRef
        };
      } catch (err) {
        // Erro de passo não derruba a ida inteira: o modelo recebe o motivo e
        // tenta outro caminho, que é o que uma pessoa faria.
        conversa.push({ role: 'user', content: `Esse passo falhou: ${err.message}. Tente outro caminho.` });
        yield {
          type: 'agent-step', n: passo, acao: decisao.acao, descricao: err.message, erro: true,
          modelo: nomeDoModelo, modeloRef: modelRef
        };
      }

      // Só as últimas rodadas vão pro modelo: página inteira é cara, e o
      // histórico cresce rápido demais pra caber em modelo local.
      if (conversa.length > 8) conversa.splice(0, conversa.length - 8);
    }
  } finally {
    await encerrar();
  }

  // A página do buscador é o caminho, não a fonte: dela sai menu, rodapé e
  // banner de cookie, que ocupam o mesmo lugar que a página onde a resposta
  // estava. Ela só entra no contexto quando o agente não chegou a lugar nenhum.
  const uteis = anotacoes.filter((a) => !ehBuscador(a.url));
  const fonte = uteis.length ? uteis : anotacoes;

  // Mesma URL lida em dois passos vira o mesmo texto duas vezes — e rolar a
  // página é exatamente o que faz isso acontecer. Fica a leitura mais completa.
  const porUrl = new Map();
  for (const a of fonte) {
    const antes = porUrl.get(a.url);
    if (!antes || a.texto.length > antes.texto.length) porUrl.set(a.url, a);
  }

  const block = porUrl.size
    ? [
        'Páginas que você abriu no navegador pra responder isto:',
        ...[...porUrl.values()]
          .slice(-3)
          .map((a, i) => `[${i + 1}] ${a.titulo} — ${a.url}\n${a.texto.slice(0, 2500)}`)
      ].join('\n\n')
    : '';

  return { block, visitadas };
}
