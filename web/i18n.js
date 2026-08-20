// O idioma da interface.
//
// A chave da tradução é o próprio texto em português. Parece estranho perto de
// `chave.ponto.chave`, e é de propósito: são umas oitocentas frases escritas
// direto no meio da tela ao longo do app inteiro. Com chave inventada, cada uma
// vira duas coisas pra manter em dia — a chave e o texto —, e a primeira que
// alguém esquecer aparece pro usuário como `ajustes.memoria.titulo`. Com o
// português como chave, o dicionário de pt-BR não existe (o texto já está lá),
// nada quebra quando falta tradução, e a tela cai no português em vez de cair
// num identificador.
//
// O preço é que mexer no texto em português invalida a tradução daquela frase.
// É o preço certo: quem edita a frase quer mesmo revisar a tradução dela.

import { api } from './core.js';
import { idiomaDoLugar } from './lugar.js';

const GUARDADO = 'iaunifier.idioma';

/** Nomes dos idiomas, cada um escrito na própria língua. */
export const NOMES = {
  'pt-BR': 'Português',
  en: 'English',
  es: 'Español'
};

let atual = 'pt-BR';
let dicionario = {};
const ouvintes = new Set();

/** O idioma em uso, como etiqueta BCP 47. */
export const idioma = () => atual;

/** O que a pessoa escolheu na mão, ou `null` se ela nunca escolheu. */
export const idiomaEscolhido = () => localStorage.getItem(GUARDADO) || null;

/**
 * Traduz. Sem tradução, devolve o próprio português — que já é uma frase
 * pronta, não um identificador.
 *
 * @param {string} texto  a frase em pt-BR, exatamente como está no código
 * @param {Record<string, string|number>} [valores] trocas de `{nome}`
 */
export function t(texto, valores) {
  const traduzido = dicionario[texto] ?? texto;
  if (!valores) return traduzido;
  return traduzido.replace(/\{(\w+)\}/g, (inteiro, chave) =>
    chave in valores ? String(valores[chave]) : inteiro
  );
}

/**
 * Plural. Português e espanhol têm duas formas, inglês também — mas o corte
 * não é igual em toda língua, então quem traduz recebe as duas e decide.
 *
 * @param {number} n
 * @param {string} um    frase para 1, com `{n}` se quiser o número
 * @param {string} muitos frase para o resto
 */
export function plural(n, um, muitos, valores) {
  return t(n === 1 ? um : muitos, { n: formatarNumero(n), ...valores });
}

/** Número no formato do idioma em uso, não num `pt-BR` fixo no código. */
export function formatarNumero(n, opcoes) {
  try {
    return Number(n).toLocaleString(atual, opcoes);
  } catch {
    return String(n);
  }
}

/** Data no formato do idioma em uso. */
export function formatarData(valor, opcoes) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(atual, opcoes);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Avisa quem desenha a tela que o idioma mudou. */
export function aoTrocarIdioma(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

/**
 * Carrega o dicionário de um idioma.
 *
 * pt-BR não tem arquivo: o texto do código já é o pt-BR. Pedir um dicionário
 * vazio ao servidor só pra ele responder `{}` seria um pedido por carregamento
 * pra não mudar nada.
 */
async function carregar(alvo) {
  if (alvo === 'pt-BR') return {};
  try {
    const res = await fetch(`/idiomas/${encodeURIComponent(alvo)}.json`, { cache: 'no-cache' });
    if (!res.ok) return {};
    const json = await res.json();
    return json && typeof json === 'object' ? json : {};
  } catch {
    // Sem rede ou arquivo torto: a tela fica em português, que é pior que a
    // tradução e muito melhor que a tela em branco.
    return {};
  }
}

/**
 * Descobre e aplica o idioma na abertura.
 *
 * A ordem é: o que a pessoa escolheu, depois o que o servidor deduziu do
 * `Accept-Language` do navegador, depois o `navigator.language` como rede de
 * segurança pra quando o servidor não responder.
 *
 * Não há consulta de IP. Descobrir país por IP exige mandar o IP da pessoa pra
 * um serviço de fora, e a primeira tela do app promete que nada sai da máquina.
 * O navegador já carrega a resposta em todo pedido, de graça e mais certa: quem
 * usa VPN tem o IP num país e o idioma no dele.
 */
export async function iniciarIdioma(sugestao) {
  const escolhido = idiomaEscolhido();
  const doNavegador = (navigator.languages || [navigator.language || ''])
    .map((l) => String(l))
    .find((l) => l);

  // O lugar vem antes do idioma do sistema de propósito: quem programa roda o
  // computador em inglês e mora em outro país, e a pergunta que importa é onde
  // a pessoa está. Quem discordar troca no seletor, e a escolha à mão — que é a
  // primeira da lista — vence tudo daí em diante.
  const candidatos = [escolhido, idiomaDoLugar(), sugestao, doNavegador, 'pt-BR'].filter(Boolean);
  const disponiveis = Object.keys(NOMES);
  let alvo = 'pt-BR';
  for (const c of candidatos) {
    const exato = disponiveis.find((d) => d.toLowerCase() === String(c).toLowerCase());
    const lingua = disponiveis.find(
      (d) => d.split('-')[0].toLowerCase() === String(c).split('-')[0].toLowerCase()
    );
    if (exato || lingua) {
      alvo = exato || lingua;
      break;
    }
  }

  atual = alvo;
  dicionario = await carregar(alvo);
  document.documentElement.lang = alvo;
  return alvo;
}

/** Troca o idioma e guarda a escolha, que passa a ganhar de tudo. */
export async function trocarIdioma(alvo) {
  if (!Object.keys(NOMES).includes(alvo)) return atual;
  localStorage.setItem(GUARDADO, alvo);
  atual = alvo;
  dicionario = await carregar(alvo);
  document.documentElement.lang = alvo;
  // O servidor também precisa saber: as mensagens de erro dele saem prontas.
  api('/settings', { method: 'PATCH', body: { idioma: alvo } }).catch(() => {});
  for (const fn of ouvintes) {
    try {
      fn(alvo);
    } catch {
      /* uma tela que não redesenha não pode derrubar as outras */
    }
  }
  return alvo;
}

/**
 * Traduz o que está escrito no HTML.
 *
 * `data-i18n` troca o texto; `data-i18n-attr="title,aria-label"` troca atributo.
 * O texto original do arquivo é a chave, então marcar um elemento não exige
 * inventar nome nem mexer no que ele diz hoje.
 */
export function traduzirDocumento(raiz = document) {
  for (const el of raiz.querySelectorAll('[data-i18n]')) {
    const chave = el.dataset.i18n || el.textContent.trim();
    if (!el.dataset.i18n) el.dataset.i18n = chave;
    el.textContent = t(chave);
  }
  for (const el of raiz.querySelectorAll('[data-i18n-attr]')) {
    for (const attr of el.dataset.i18nAttr.split(',').map((a) => a.trim())) {
      const guardado = `i18n${attr.replace(/[^a-z]/gi, '')}`;
      const chave = el.dataset[guardado] || el.getAttribute(attr);
      if (!chave) continue;
      el.dataset[guardado] = chave;
      el.setAttribute(attr, t(chave));
    }
  }
}
