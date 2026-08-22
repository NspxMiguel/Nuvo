// Carimba a versão publicada nos botões de baixar da landing.
//
// Os links apontam pro arquivo exato de uma release (`v0.5.2/nuvo-0.5.2-…`), e o
// nome do arquivo tem a versão dentro: não dá pra escrever um link que sirva
// sempre. Escrever à mão apodrece — a landing ficou cinco releases atrás
// mandando todo mundo baixar a 0.2.2 —, então quem carimba é o release.
//
//     node build/landing-versao.mjs           # usa a versão do package.json
//     node build/landing-versao.mjs --conferir # só diz se está certa (para teste)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const LANDING = `${RAIZ}docs/index.html`;

export function versaoDoApp() {
  return JSON.parse(readFileSync(`${RAIZ}package.json`, 'utf8')).version;
}

/** Todas as versões que aparecem em link de download da landing. */
export function versoesNaLanding(html = readFileSync(LANDING, 'utf8')) {
  const achadas = new Set();
  for (const [, v] of html.matchAll(/releases\/download\/v(\d+\.\d+\.\d+)\//g)) achadas.add(v);
  for (const [, v] of html.matchAll(/nuvo-(\d+\.\d+\.\d+)-/g)) achadas.add(v);
  return [...achadas];
}

export function carimbar(versao = versaoDoApp()) {
  const antes = readFileSync(LANDING, 'utf8');
  const depois = antes
    .replace(/releases\/download\/v\d+\.\d+\.\d+\//g, `releases/download/v${versao}/`)
    .replace(/nuvo-\d+\.\d+\.\d+-/g, `nuvo-${versao}-`);
  if (depois !== antes) writeFileSync(LANDING, depois);
  return { versao, mudou: depois !== antes };
}

if (process.argv[1] && process.argv[1].endsWith('landing-versao.mjs')) {
  const versao = versaoDoApp();
  if (process.argv.includes('--conferir')) {
    const fora = versoesNaLanding().filter((v) => v !== versao);
    if (fora.length) {
      console.error(`a landing manda baixar ${fora.join(', ')} e a versão é ${versao}`);
      process.exit(1);
    }
    console.log(`landing em dia: ${versao}`);
  } else {
    const r = carimbar(versao);
    console.log(r.mudou ? `landing carimbada em ${r.versao}` : `landing já estava em ${r.versao}`);
  }
}
