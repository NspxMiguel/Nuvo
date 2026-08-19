// Formatação de texto da interface que não depende de DOM nenhum — fica aqui
// separada justamente pra caber no `node --test`, como o md.js.

import { t, plural, formatarNumero } from './i18n.js';

// Uma casa decimal, nem mais nem menos: o tempo de resposta é "7,4 s" e nunca
// "7,40000001 s" nem "7 s". A vírgula sai do idioma em uso, não fixa no código.
const UMA_CASA = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

/**
 * Rodapé da resposta: tempo, tamanho e velocidade, e a palavra "token" nunca
 * sozinha. Parte que não tem número não vira texto.
 */
export function statsLine(stats) {
  const partes = [];
  if (stats.ms != null) partes.push(`${formatarNumero(stats.ms / 1000, UMA_CASA)} s`);
  if (stats.tokens) {
    const contagem = plural(stats.tokens, '1 palavra-token', '{n} palavras-token');
    partes.push(stats.estimated ? t('{contagem} (estimativa)', { contagem }) : contagem);
  }
  // Resposta curta gasta o tempo quase todo abrindo a CLI, então a taxa cai
  // abaixo de 1 e `Math.round` a mostrava como "0 por segundo" — número que não
  // é verdade nenhuma. Abaixo de 10 vai com uma casa; zerou, não se escreve.
  if (stats.tps) {
    const taxa = stats.tps < 10 ? Math.round(stats.tps * 10) / 10 : Math.round(stats.tps);
    if (taxa > 0) {
      const numero = formatarNumero(taxa, { maximumFractionDigits: 1 });
      partes.push(t('{taxa} por segundo', { taxa: numero }));
    }
  }
  return partes.join(' · ');
}
