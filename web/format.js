// Formatação de texto da interface que não depende de DOM nenhum — fica aqui
// separada justamente pra caber no `node --test`, como o md.js.

/**
 * Rodapé da resposta: tempo, tamanho e velocidade, e a palavra "token" nunca
 * sozinha. Parte que não tem número não vira texto.
 */
export function statsLine(stats) {
  const partes = [];
  if (stats.ms != null) partes.push(`${(stats.ms / 1000).toFixed(1).replace('.', ',')} s`);
  if (stats.tokens) {
    const unidade = stats.tokens === 1 ? 'palavra-token' : 'palavras-token';
    partes.push(
      `${stats.tokens.toLocaleString('pt-BR')} ${unidade}${stats.estimated ? ' (estimativa)' : ''}`
    );
  }
  // Resposta curta gasta o tempo quase todo abrindo a CLI, então a taxa cai
  // abaixo de 1 e `Math.round` a mostrava como "0 por segundo" — número que não
  // é verdade nenhuma. Abaixo de 10 vai com uma casa; zerou, não se escreve.
  if (stats.tps) {
    const taxa = stats.tps < 10 ? Math.round(stats.tps * 10) / 10 : Math.round(stats.tps);
    if (taxa > 0) partes.push(`${taxa.toLocaleString('pt-BR')} por segundo`);
  }
  return partes.join(' · ');
}
