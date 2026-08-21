// Quando mostrar cada cartão de novo.
//
// O jeito antigo (SM-2, o do Anki de sempre) guarda um "fator de facilidade" por
// cartão e multiplica o intervalo por ele. Funciona, e erra sempre do mesmo
// jeito: trata "eu lembrei" como um estado só, quando lembrar com esforço e
// lembrar de bate-pronto dizem coisas diferentes sobre quanto tempo a memória
// ainda dura.
//
// O FSRS modela três coisas por cartão, em vez de uma:
//   dificuldade   — o quanto ESTE cartão é difícil pra você (1 a 10);
//   estabilidade  — quantos dias a memória dura antes de cair pra 90%;
//   recuperação   — a chance de você lembrar AGORA, que cai com o tempo.
// Com isso ele chega na mesma retenção com 20 a 30% menos revisões — que é o
// mesmo que dizer: menos tempo estudando pelo mesmo resultado.
//
// Os pesos abaixo são os padrões publicados do FSRS. O algoritmo de verdade
// afina esses pesos com o histórico de quem usa, e isso aqui NÃO faz isso: com
// pouco histórico o padrão é melhor do que um ajuste feito em cima de trinta
// revisões. Fica anotado como o próximo passo honesto, não como se já existisse.
//
// Nada aqui toca o banco nem o relógio: entra o estado do cartão e a nota, sai o
// estado novo. É função pura pra poder ser testada sem esperar um dia passar.

/**
 * Os pesos padrão do FSRS-4.5. Dezessete números achados em cima de milhões de
 * revisões reais.
 *
 * A versão importa: o FSRS-5 calcula a dificuldade inicial com uma exponencial e
 * usa outro conjunto de pesos. Misturar a fórmula de um com os pesos do outro
 * deixava toda dificuldade inicial em 1,0 — o que dizia que todo cartão é fácil e
 * fazia os intervalos crescerem depressa demais.
 */
export const PESOS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755
];

/** Quanto a memória decai. Vem da curva de esquecimento, não de escolha nossa. */
const DECAIMENTO = -0.5;
const FATOR = 19 / 81;

/** As quatro notas. É o vocabulário do Anki, e é o que a tela mostra. */
export const NOTAS = { denovo: 1, dificil: 2, bom: 3, facil: 4 };

/** Retenção desejada: 90% é o padrão do FSRS e o ponto onde o custo por lembrança é menor. */
export const RETENCAO = 0.9;

const entre = (v, min, max) => Math.min(Math.max(v, min), max);

/** A chance de lembrar agora, depois de `dias` desde a última revisão. */
export function recuperacao(dias, estabilidade) {
  if (!(estabilidade > 0)) return 0;
  return (1 + (FATOR * dias) / estabilidade) ** DECAIMENTO;
}

/** Quantos dias até a memória cair para a retenção que a gente quer. */
export function intervalo(estabilidade) {
  const dias = (estabilidade / FATOR) * (RETENCAO ** (1 / DECAIMENTO) - 1);
  // Um dia é o mínimo: mostrar o mesmo cartão duas vezes no mesmo dia é
  // reconhecimento, não memória.
  return Math.max(1, Math.round(dias));
}

const estabilidadeInicial = (nota) => Math.max(PESOS[nota - 1], 0.1);

// FSRS-4.5: a dificuldade inicial anda em linha reta com a nota. Errar de
// primeira nasce difícil; acertar de bate-pronto nasce fácil.
const dificuldadeInicial = (nota) => entre(PESOS[4] - (nota - 3) * PESOS[5], 1, 10);

function proximaDificuldade(dificuldade, nota) {
  const delta = -PESOS[6] * (nota - 3);
  const movida = dificuldade + delta * ((10 - dificuldade) / 9);
  // Puxão de volta pro meio: sem ele todo cartão escorrega pro extremo com o
  // tempo, e a dificuldade para de significar alguma coisa.
  return entre(PESOS[7] * dificuldadeInicial(NOTAS.facil) + (1 - PESOS[7]) * movida, 1, 10);
}

function estabilidadeAoAcertar(dificuldade, estabilidade, r, nota) {
  const penaDoDificil = nota === NOTAS.dificil ? PESOS[15] : 1;
  const bonusDoFacil = nota === NOTAS.facil ? PESOS[16] : 1;
  return (
    estabilidade *
    (1 +
      Math.exp(PESOS[8]) *
        (11 - dificuldade) *
        estabilidade ** -PESOS[9] *
        (Math.exp(PESOS[10] * (1 - r)) - 1) *
        penaDoDificil *
        bonusDoFacil)
  );
}

function estabilidadeAoErrar(dificuldade, estabilidade, r) {
  return (
    PESOS[11] *
    dificuldade ** -PESOS[12] *
    ((estabilidade + 1) ** PESOS[13] - 1) *
    Math.exp(PESOS[14] * (1 - r))
  );
}

/**
 * O estado do cartão depois de uma revisão.
 *
 * @param {{dificuldade?: number, estabilidade?: number, estado?: string}} cartao
 * @param {number} nota 1 de novo, 2 difícil, 3 bom, 4 fácil
 * @param {number} diasParado quantos dias desde a última vez que ele apareceu
 * @returns {{dificuldade: number, estabilidade: number, estado: string, intervalo: number, lapso: boolean}}
 */
export function revisar(cartao = {}, nota = NOTAS.bom, diasParado = 0) {
  const grau = entre(Math.round(Number(nota) || NOTAS.bom), 1, 4);
  const novo = !cartao.estabilidade || cartao.estado === 'novo';

  if (novo) {
    const estabilidade = estabilidadeInicial(grau);
    const dificuldade = dificuldadeInicial(grau);
    return {
      dificuldade,
      estabilidade,
      // Errar de primeira não manda o cartão pra revisão: ele volta ainda hoje,
      // porque nunca chegou a ser aprendido.
      estado: grau === NOTAS.denovo ? 'aprendendo' : 'revisando',
      intervalo: grau === NOTAS.denovo ? 1 : intervalo(estabilidade),
      lapso: false
    };
  }

  const r = recuperacao(Math.max(diasParado, 0), cartao.estabilidade);
  const dificuldade = proximaDificuldade(entre(cartao.dificuldade || 5, 1, 10), grau);
  const errou = grau === NOTAS.denovo;
  const estabilidade = errou
    ? Math.min(estabilidadeAoErrar(dificuldade, cartao.estabilidade, r), cartao.estabilidade)
    : estabilidadeAoAcertar(dificuldade, cartao.estabilidade, r, grau);

  return {
    dificuldade,
    estabilidade: Math.max(estabilidade, 0.1),
    estado: errou ? 'aprendendo' : 'revisando',
    intervalo: errou ? 1 : intervalo(estabilidade),
    lapso: errou
  };
}

/** A data em que o cartão volta, em ISO, a partir de agora. */
export function quandoVolta(dias, agora = new Date()) {
  const data = new Date(agora.getTime());
  data.setDate(data.getDate() + Math.max(1, Math.round(dias)));
  return data.toISOString();
}
