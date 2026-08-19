// Qual idioma o app fala.
//
// O pedido era "puxa localização + idioma via localização ip". Descobrir país
// por IP exige mandar o IP da pessoa pra um serviço de fora — e o app promete,
// na primeira tela, que nada sai da máquina. Trocar essa promessa por um
// palpite de país seria um mau negócio, ainda mais porque o palpite pior:
// quem usa VPN cai no país errado, e quem mora fora do Brasil falando português
// cai no idioma errado.
//
// O navegador já sabe a resposta e a manda em todo pedido. `Accept-Language` é
// a lista de idiomas que a pessoa configurou, na ordem que ela escolheu, com
// peso. É de graça, é instantâneo, não vaza nada e acerta mais.
//
// A escolha manual, quando existe, ganha de tudo: é a única fonte que a pessoa
// controla de propósito.

/** Os idiomas que o app tem, em ordem de preferência quando nada casa. */
export const IDIOMAS = ['pt-BR', 'en', 'es'];
export const PADRAO = 'pt-BR';

/**
 * Lê `Accept-Language` e devolve as etiquetas em ordem de preferência.
 *
 * O formato é `pt-BR,pt;q=0.9,en;q=0.8`. Sem `q` vale 1. Ordenar por `q` não
 * basta: navegador manda empate com frequência, e a ordem de chegada é o
 * desempate que a pessoa configurou na mão.
 *
 * @param {string|undefined} cabecalho
 * @returns {string[]}
 */
export function lerAceitos(cabecalho) {
  if (!cabecalho || typeof cabecalho !== 'string') return [];
  return cabecalho
    .split(',')
    .map((parte, ordem) => {
      const [etiqueta, ...params] = parte.trim().split(';');
      const q = params
        .map((p) => p.trim().match(/^q=([\d.]+)$/i))
        .find(Boolean);
      // `q` que não dá pra ler vale 1, como se não estivesse lá: o idioma
      // continua sendo um que a pessoa configurou.
      const peso = q ? Number(q[1]) : 1;
      return { etiqueta: etiqueta.trim(), peso: Number.isFinite(peso) ? peso : 1, ordem };
    })
    .filter((x) => x.etiqueta && x.peso > 0)
    .sort((a, b) => b.peso - a.peso || a.ordem - b.ordem)
    .map((x) => x.etiqueta);
}

/** `pt-br` e `PT_BR` viram `pt-BR`; `PT` vira `pt`. */
function normalizar(etiqueta) {
  const [lingua, regiao] = String(etiqueta).replace(/_/g, '-').split('-');
  if (!lingua) return '';
  return regiao ? `${lingua.toLowerCase()}-${regiao.toUpperCase()}` : lingua.toLowerCase();
}

/**
 * O idioma que o app vai falar.
 *
 * @param {{escolhido?: string|null, aceito?: string|undefined,
 *          disponiveis?: string[]}} opcoes
 * @returns {string} uma etiqueta de `disponiveis`
 */
export function escolherIdioma({ escolhido = null, aceito = undefined, disponiveis = IDIOMAS } = {}) {
  const lista = disponiveis.length ? disponiveis : [PADRAO];
  const mapa = new Map(lista.map((d) => [normalizar(d), d]));
  const porLingua = new Map();
  // `pt` tem que cair em `pt-BR`, e o primeiro da lista é quem representa a
  // língua — senão `es` cairia num `es-MX` só porque ele veio depois.
  for (const d of lista) {
    const lingua = normalizar(d).split('-')[0];
    if (!porLingua.has(lingua)) porLingua.set(lingua, d);
  }

  const tentar = (etiqueta) => {
    if (!etiqueta) return null;
    const n = normalizar(etiqueta);
    if (mapa.has(n)) return mapa.get(n);
    const lingua = n.split('-')[0];
    return porLingua.get(lingua) || null;
  };

  // `*` no Accept-Language quer dizer "qualquer um serve": não é escolha, é
  // ausência dela, então cai no padrão em vez de arrastar pro primeiro da lista.
  const daPessoa = tentar(escolhido);
  if (daPessoa) return daPessoa;

  for (const etiqueta of lerAceitos(aceito)) {
    if (etiqueta === '*') break;
    const achado = tentar(etiqueta);
    if (achado) return achado;
  }

  return tentar(PADRAO) || lista[0];
}
