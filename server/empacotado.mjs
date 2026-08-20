// Uma pergunta só: este programa está rodando como executável único ou a
// partir do código-fonte? A resposta muda como o servidor se refere a si mesmo
// quando precisa se relançar — no serviço do sistema e no atalho do dock.

import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';

export const EMPACOTADO = isSea();

/**
 * O programa e os argumentos que sobem o servidor de fora. Empacotado é o
 * próprio executável, sozinho; do código-fonte é o Node mais o arquivo de
 * entrada. `import.meta.url` vira `undefined` no empacotamento, e montar `new
 * URL` com base indefinida estoura — por isso quem chama passa a base crua e a
 * URL só é montada no ramo que precisa dela.
 */
export function comandoDoServidor(baseUrl) {
  if (EMPACOTADO) return { programa: process.execPath, argumentos: [] };
  const entrada = fileURLToPath(new URL('../bin/nuvo.mjs', baseUrl));
  return { programa: process.execPath, argumentos: [entrada] };
}

/** O mesmo comando como linha de shell, já com aspas. */
export function linhaDeComando(baseUrl) {
  const { programa, argumentos } = comandoDoServidor(baseUrl);
  return [programa, ...argumentos].map((p) => `"${p}"`).join(' ');
}
