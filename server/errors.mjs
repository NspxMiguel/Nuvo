// Mensagem de erro que diz o que fazer.
//
// "fetch failed" e "HTTP 401" não ajudam ninguém: o que o usuário precisa saber
// é se o Ollama está desligado, se a chave venceu ou se acabou o crédito. Cada
// regra abaixo traduz um defeito real que aparece em uso de casa.
//
// A regra devolve o molde e os valores, não a frase pronta, porque a frase tem
// que chegar na tela no idioma dela — e o nome do provedor, o endereço e a
// mensagem crua do defeito mudam a cada máquina, então nenhum dicionário
// guardaria a frase inteira. Ver `erro-traduzivel.mjs`.

import { erroTraduzivel } from './erro-traduzivel.mjs';

const RULES = [
  {
    match: (m, kind) => /ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH/i.test(m) && kind === 'ollama',
    molde: 'o Ollama não respondeu em {endereco}. Abra o app do Ollama (ou rode `ollama serve`) e tente de novo. ({cru})',
    valores: (provider) => ({ endereco: provider?.base_url || 'localhost' })
  },
  {
    match: (m, kind) => /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(m) && kind === 'lmstudio',
    molde: 'o LM Studio não respondeu em {endereco}. No LM Studio, aba Developer, ligue o servidor local. ({cru})',
    valores: (provider) => ({ endereco: provider?.base_url || 'localhost' })
  },
  {
    match: (m) => /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed/i.test(m),
    molde: 'não consegui falar com {onde}. Confira se o endereço está certo e se o serviço está no ar. ({cru})',
    valores: (provider) => ({ onde: provider?.base_url || 'o provedor' })
  },
  {
    match: (m) => /\b(ETIMEDOUT|timeout|AbortError)\b/i.test(m),
    molde:
      'o provedor demorou demais e o pedido foi cortado. Tente de novo; se for modelo local, ele pode estar carregando na memória. ({cru})'
  },
  {
    match: (m) => /\b401\b|invalid[_ ]api[_ ]key|unauthorized/i.test(m),
    molde:
      'a chave de {ia} foi recusada. Gere uma nova no painel de quem fornece a IA e salve de novo em "IAs ligadas", no botão Trocar chave. ({cru})',
    valores: (provider) => ({ ia: provider?.name || 'API' })
  },
  {
    match: (m) => /\b403\b|permission|not allowed/i.test(m),
    molde:
      'a chave existe mas não tem permissão pra esse modelo. Confira no painel do provedor se o modelo está liberado pra sua conta. ({cru})'
  },
  {
    match: (m) => /\b404\b|model[_ ]not[_ ]found|does not exist/i.test(m),
    molde: 'esse modelo não existe mais nessa IA. Abra "IAs ligadas" e clique em Atualizar modelos no cartão dela. ({cru})'
  },
  {
    match: (m) => /\b429\b|rate[_ ]limit|too many requests/i.test(m),
    molde: 'o provedor pediu pra esperar (limite de uso). Espere alguns segundos, ou troque de modelo pra continuar agora. ({cru})'
  },
  {
    match: (m) => /insufficient|quota|credit|billing/i.test(m),
    molde: 'a conta do provedor está sem crédito. Ou recarrega no painel dele, ou usa um modelo local enquanto isso. ({cru})'
  },
  {
    match: (m) => /\b5\d\d\b|overloaded|server error/i.test(m),
    molde: 'o provedor está com problema do lado dele. Tente de novo em instantes ou escolha outro modelo. ({cru})'
  },
  {
    match: (m) => /context|too many tokens|maximum context length/i.test(m),
    molde: 'a conversa passou do tamanho que esse modelo aguenta. Comece uma conversa nova, ou escolha um modelo de contexto maior. ({cru})'
  },
  {
    match: (m) => /sem comando|ENOENT|spawn/i.test(m),
    molde:
      'o programa do terminal não rodou{ia}. Confira o caminho do executável em "IAs ligadas", no campo Ajuste do programa do terminal. ({cru})',
    valores: (provider) => ({ ia: provider?.name ? ` (${provider.name})` : '' })
  }
];

/**
 * @param {Error|string} err
 * @param {{name?: string, kind?: string, base_url?: string}} [provider]
 * @returns {Error} erro com a frase pronta em português e o molde pra traduzir
 */
export function explainProviderError(err, provider = null) {
  // `String(err)` num Error sem mensagem devolve "Error", que não é mensagem
  // nenhuma — por isso o campo é lido antes de recorrer ao objeto.
  const raw = err instanceof Error ? err.message : err;
  const message = String(raw ?? '').trim();
  if (!message) return erroTraduzivel('o provedor falhou sem dizer o motivo.');

  for (const rule of RULES) {
    if (rule.match(message, provider?.kind)) {
      // O texto original vai junto, entre parênteses: quem sabe ler agradece,
      // e quem não sabe já tem a frase de cima. Ele entra em `traduzir` porque
      // costuma ser uma das frases fixas do próprio servidor.
      return erroTraduzivel(rule.molde, { ...rule.valores?.(provider), cru: message }, ['cru']);
    }
  }
  // Defeito que nenhuma regra reconhece: a frase crua é o que há, e o cliente
  // ainda tenta o dicionário de frase inteira em cima dela.
  return erroTraduzivel(message);
}
