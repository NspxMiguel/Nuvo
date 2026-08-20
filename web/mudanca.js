// O que o navegador guardou quando o app se chamava IAUnifier.
//
// As chaves do `localStorage` levavam o nome do app dentro (`iaunifier.token`,
// `iaunifier.idioma`, ...). Trocar o nome sem trazer o conteúdo junto teria um
// efeito bem visível: a aba que já usava o app abriria pedindo o token de novo,
// no idioma errado, sem o modelo escolhido. Nada disso dá erro na tela — só
// parece que o app esqueceu quem é a pessoa.
//
// Este arquivo não importa nada de propósito. `core.js` e `i18n.js` se importam
// em ciclo, e um módulo folha roda antes do corpo dos dois, qualquer que seja a
// ordem de entrada. Assim a cópia acontece antes da primeira leitura.

const CHAVES = ['token', 'idioma', 'model', 'gem', 'theme', 'loja', 'council', 'programar.conversas'];

/**
 * Copia cada chave de `iaunifier.*` para `nuvo.*`, uma vez.
 *
 * Copia em vez de mover: quem abrir uma versão antiga do app no mesmo navegador
 * — de uma aba guardada, de um service worker que ainda não trocou — continua
 * achando o que precisa. As duas passam a existir; a antiga simplesmente para
 * de ser lida.
 */
export function trazerOQueEraDoNomeAntigo() {
  if (typeof localStorage === 'undefined') return 0;
  let trazidas = 0;
  for (const chave of CHAVES) {
    try {
      const antiga = localStorage.getItem(`iaunifier.${chave}`);
      if (antiga === null) continue;
      if (localStorage.getItem(`nuvo.${chave}`) !== null) continue;
      localStorage.setItem(`nuvo.${chave}`, antiga);
      trazidas += 1;
    } catch {
      // Navegador com armazenamento bloqueado: sem o que trazer e sem o que
      // quebrar. O app funciona pedindo o token de novo.
    }
  }
  return trazidas;
}

trazerOQueEraDoNomeAntigo();
