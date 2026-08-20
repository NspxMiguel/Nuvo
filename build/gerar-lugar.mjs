// `docs/lugar.js` é o `web/lugar.js` servido como script clássico.
//
// A landing não é um bundle: ela carrega `<script src>` solto, e `export` numa
// página sem `type="module"` é erro de sintaxe. Em vez de manter duas tabelas de
// fuso horário — que iam divergir na primeira vez que alguém mexesse numa só —,
// o arquivo do site é gerado deste, e um teste refaz a geração e compara.

import { readFileSync } from 'node:fs';

export const ORIGEM = new URL('../web/lugar.js', import.meta.url);
export const DESTINO = new URL('../docs/lugar.js', import.meta.url);

export function gerar(fonte = readFileSync(ORIGEM, 'utf8')) {
  const corpo = fonte
    .replace(/^export const ZONAS = .*$/m, '')
    .replace(/^export /gm, '')
    .trimEnd();
  return `${corpo}

  window.LUGAR = { idiomaDoLugar };
})();
`.replace(/^/, '// GERADO por build/gerar-lugar.mjs a partir de web/lugar.js — não edite aqui.\n(() => {\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(DESTINO, gerar());
  console.log('docs/lugar.js gerado');
}
