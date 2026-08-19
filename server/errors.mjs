// Mensagem de erro que diz o que fazer.
//
// "fetch failed" e "HTTP 401" não ajudam ninguém: o que o usuário precisa saber
// é se o Ollama está desligado, se a chave venceu ou se acabou o crédito. Cada
// regra abaixo traduz um defeito real que aparece em uso de casa.

const RULES = [
  {
    match: (m, kind) => /ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH/i.test(m) && kind === 'ollama',
    text: (_, provider) =>
      `o Ollama não respondeu em ${provider?.base_url || 'localhost'}. Abra o app do Ollama (ou rode \`ollama serve\`) e tente de novo.`
  },
  {
    match: (m, kind) => /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(m) && kind === 'lmstudio',
    text: (_, provider) =>
      `o LM Studio não respondeu em ${provider?.base_url || 'localhost'}. No LM Studio, aba Developer, ligue o servidor local.`
  },
  {
    match: (m) => /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed/i.test(m),
    text: (_, provider) =>
      `não consegui falar com ${provider?.base_url || 'o provedor'}. Confira se o endereço está certo e se o serviço está no ar.`
  },
  {
    match: (m) => /\b(ETIMEDOUT|timeout|AbortError)\b/i.test(m),
    text: () => 'o provedor demorou demais e o pedido foi cortado. Tente de novo; se for modelo local, ele pode estar carregando na memória.'
  },
  {
    match: (m) => /\b401\b|invalid[_ ]api[_ ]key|unauthorized/i.test(m),
    text: (_, provider) =>
      `a chave de ${provider?.name || 'API'} foi recusada. Gere uma nova no painel de quem fornece a IA e salve de novo em "IAs ligadas", no botão Trocar chave.`
  },
  {
    match: (m) => /\b403\b|permission|not allowed/i.test(m),
    text: () => 'a chave existe mas não tem permissão pra esse modelo. Confira no painel do provedor se o modelo está liberado pra sua conta.'
  },
  {
    match: (m) => /\b404\b|model[_ ]not[_ ]found|does not exist/i.test(m),
    text: () => 'esse modelo não existe mais nessa IA. Abra "IAs ligadas" e clique em Atualizar modelos no cartão dela.'
  },
  {
    match: (m) => /\b429\b|rate[_ ]limit|too many requests/i.test(m),
    text: () => 'o provedor pediu pra esperar (limite de uso). Espere alguns segundos, ou troque de modelo pra continuar agora.'
  },
  {
    match: (m) => /insufficient|quota|credit|billing/i.test(m),
    text: () => 'a conta do provedor está sem crédito. Ou recarrega no painel dele, ou usa um modelo local enquanto isso.'
  },
  {
    match: (m) => /\b5\d\d\b|overloaded|server error/i.test(m),
    text: () => 'o provedor está com problema do lado dele. Tente de novo em instantes ou escolha outro modelo.'
  },
  {
    match: (m) => /context|too many tokens|maximum context length/i.test(m),
    text: () => 'a conversa passou do tamanho que esse modelo aguenta. Comece uma conversa nova, ou escolha um modelo de contexto maior.'
  },
  {
    match: (m) => /sem comando|ENOENT|spawn/i.test(m),
    text: (_, provider) =>
      `o programa do terminal não rodou${provider?.name ? ` (${provider.name})` : ''}. Confira o caminho do executável em "IAs ligadas", no campo Ajuste do programa do terminal.`
  }
];

/**
 * @param {Error|string} err
 * @param {{name?: string, kind?: string, base_url?: string}} [provider]
 * @returns {string} mensagem pronta pra mostrar na tela
 */
export function explainProviderError(err, provider = null) {
  // `String(err)` num Error sem mensagem devolve "Error", que não é mensagem
  // nenhuma — por isso o campo é lido antes de recorrer ao objeto.
  const raw = err instanceof Error ? err.message : err;
  const message = String(raw ?? '').trim();
  if (!message) return 'o provedor falhou sem dizer o motivo.';

  for (const rule of RULES) {
    if (rule.match(message, provider?.kind)) {
      // O texto original vai junto, entre parênteses: quem sabe ler agradece,
      // e quem não sabe já tem a frase de cima.
      return `${rule.text(message, provider)} (${message})`;
    }
  }
  return message;
}
