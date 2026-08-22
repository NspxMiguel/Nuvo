// Texto que veio de um modelo, pronto pra virar tela.
//
// Modelo escreve HTML sem ninguém pedir: `<i>Escherichia coli</i>` no meio de
// uma questão, `<br>` no lugar de quebra de linha, `&nbsp;` colado. A tela
// escapa tudo — é o certo, senão qualquer modelo escreveria `<script>` na
// resposta —, mas o efeito é a pessoa lendo a marcação em vez do texto.
//
// A tira acontece na entrada, uma vez, e não em cada lugar que desenha: o que
// fica gravado no banco já é o texto limpo.

/** Só marca de verdade sai: `pH < 7` e `a < b` continuam inteiros. */
const MARCA = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;

const ENTIDADES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'"
};

/**
 * Tira a marcação que o modelo inventou e devolve texto corrido.
 *
 * `<br>` e `</p>` viram quebra de linha porque era isso que eles queriam dizer;
 * o resto simplesmente sai.
 */
export function semMarcacao(valor) {
  return String(valor ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(MARCA, '')
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Corta no limite, mas na palavra inteira.
 *
 * Cortar no caractere exato deixa a citação terminando em "com a estrutura do
 * c", que parece defeito de tela. Voltar até o último espaço e marcar com
 * reticências diz o que aconteceu: tinha mais, e o resto não coube.
 */
export function cortarNaPalavra(valor, limite) {
  const texto = String(valor ?? '').trim();
  if (texto.length <= limite) return texto;
  const pedaco = texto.slice(0, limite - 1);
  const espaco = pedaco.lastIndexOf(' ');
  // Palavra única maior que o limite (um endereço, uma fórmula): corta no seco.
  return (espaco > limite * 0.6 ? pedaco.slice(0, espaco) : pedaco).trimEnd() + '…';
}
