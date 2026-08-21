// Erro que atravessa a rede sem perder as peças.
//
// O servidor escreve em português: é a língua em que as mensagens nascem e ele
// não sabe em que idioma a tela está. Quem traduz é o cliente, que já tem os
// dicionários — e pra frase fixa isso basta, porque a frase inteira é a chave.
//
// A frase montada com variável não tem essa sorte: "não achei a pasta /a/b
// neste computador" nunca vai estar num dicionário, porque o caminho muda a
// cada máquina. Então o erro carrega as duas coisas — o molde em português
// (`{pasta}` no lugar do valor, que é o que o dicionário guarda) e os valores —
// e o `message` continua sendo a frase pronta, pra quem só quiser registrar no
// log ou mostrar no terminal não precisar saber de nada disso.

/** Substitui `{nome}` pelos valores. Mesma regra do `t()` do cliente. */
export function preencher(molde, valores = {}) {
  return String(molde).replace(/\{(\w+)\}/g, (inteiro, chave) =>
    chave in valores ? String(valores[chave]) : inteiro
  );
}

/**
 * @param {string} molde frase em português com `{nome}` onde entra variável
 * @param {Record<string, unknown>} [valores]
 * @param {string[]} [traduzir] quais valores são, eles próprios, frase a traduzir
 */
export function erroTraduzivel(molde, valores = {}, traduzir) {
  const err = new Error(preencher(molde, valores));
  err.i18n = { molde, valores };
  // Mensagem que embrulha outra: "o programa do terminal não rodou (X)", onde X
  // é uma frase que o dicionário também conhece. Sem esta lista o cliente
  // traduziria a casca e deixaria o miolo em português. Ela é explícita de
  // propósito — passar todo valor pelo dicionário traduziria também nome de
  // pasta e de modelo que por acaso batessem com uma chave.
  if (traduzir?.length) err.i18n.traduzir = traduzir;
  return err;
}

/**
 * O mesmo erro, com o código HTTP que ele merece.
 *
 * Sem isto tudo que o servidor levanta vira 500 — inclusive "professor não
 * encontrado", que não é falha do servidor, e "o professor precisa de um nome",
 * que é o pedido estando errado. O 500 mentiria sobre de quem é o problema, e
 * quem lê o log iria caçar defeito onde não tem.
 *
 * @param {number} status
 * @param {string} molde
 * @param {Record<string, unknown>} [valores]
 * @param {string[]} [traduzir]
 */
export function erroHttp(status, molde, valores = {}, traduzir) {
  const err = erroTraduzivel(molde, valores, traduzir);
  err.status = status;
  return err;
}

/**
 * O corpo JSON de uma falha: a frase pronta mais, quando o erro veio de
 * `erroTraduzivel`, o molde e os valores pro cliente remontar a frase no
 * idioma dele.
 *
 * O nome do campo é parâmetro porque o servidor já usava dois — `error` na
 * resposta de rota e `message` no evento de stream. Trocar um pelo outro aqui
 * calaria a tela que lê o campo antigo, sem erro nenhum aparecer.
 *
 * @param {unknown} err
 * @param {Record<string, unknown>} [extra] outros campos da resposta
 * @param {'error' | 'message'} [campo] onde a frase vai
 */
export function corpoDoErro(err, extra, campo = 'error') {
  const corpo = { [campo]: err?.message || String(err), ...extra };
  if (err?.i18n) corpo.i18n = err.i18n;
  return corpo;
}

/**
 * O mesmo mecanismo pra texto que não é erro — a nota que a conversa mostra
 * quando um anexo não entrou, ou quando a busca na web falhou no meio.
 *
 * @param {string} campo nome do campo que leva a frase (`text`, `message`)
 * @param {string} molde
 * @param {Record<string, unknown>} [valores]
 * @param {string[]} [traduzir]
 */
export function textoTraduzivel(campo, molde, valores = {}, traduzir) {
  const err = erroTraduzivel(molde, valores, traduzir);
  return { [campo]: err.message, i18n: err.i18n };
}
