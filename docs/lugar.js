// GERADO por build/gerar-lugar.mjs a partir de web/lugar.js — não edite aqui.
(() => {
// O idioma de onde a pessoa está.
//
// `navigator.languages` responde o idioma do *sistema*, que não é a mesma
// pergunta: quem programa costuma rodar o computador em inglês e mora em outro
// lugar. Foi o que aconteceu — a landing abriu em inglês num navegador aberto
// do Brasil, porque o macOS estava em inglês e ninguém perguntou onde a pessoa
// estava.
//
// A localização vem do fuso horário, não do IP. `Intl.DateTimeFormat()` já sabe
// o fuso, então a resposta é local, instantânea, funciona sem internet, não
// depende de serviço de terceiro e não manda o endereço de ninguém pra lugar
// nenhum. Consulta de IP custaria uma requisição, um domínio a mais no CSP e o
// dado de localização saindo da máquina — pra responder pior, porque quem usa
// VPN aparece no país do servidor.
//
// A tabela só precisa listar português e espanhol: o que sobra cai em inglês,
// que é o padrão do resto do mundo. Fuso que a tabela não conhece devolve
// `null`, e aí quem chamou volta pro idioma do navegador.

/** Fusos dos países de língua portuguesa. */
const ZONAS_PT = [
  // Brasil
  'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife',
  'America/Belem', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande',
  'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco',
  'America/Eirunepe', 'America/Santarem', 'America/Maceio', 'America/Araguaina',
  'America/Noronha',
  // Portugal
  'Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira',
  // África e Timor-Leste
  'Africa/Luanda', 'Africa/Maputo', 'Atlantic/Cape_Verde', 'Africa/Bissau',
  'Africa/Sao_Tome', 'Asia/Dili'
];

/** Fusos dos países de língua espanhola. */
const ZONAS_ES = [
  // Espanha
  'Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta',
  // México
  'America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey',
  'America/Matamoros', 'America/Chihuahua', 'America/Ojinaga', 'America/Hermosillo',
  'America/Mazatlan', 'America/Bahia_Banderas', 'America/Tijuana',
  // América do Sul e Central
  'America/Bogota', 'America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter',
  'America/Lima', 'America/Caracas', 'America/Guayaquil', 'Pacific/Galapagos',
  'America/Guatemala', 'America/Havana', 'America/La_Paz', 'America/Santo_Domingo',
  'America/Tegucigalpa', 'America/Asuncion', 'America/El_Salvador',
  'America/Managua', 'America/Costa_Rica', 'America/Panama', 'America/Montevideo',
  'America/Puerto_Rico',
  // Guiné Equatorial
  'Africa/Malabo'
];

// A Argentina publica um fuso por província (`America/Argentina/Cordoba`,
// `.../Ushuaia`, e mais uma dúzia). Listar todos envelheceria mal, então o
// prefixo responde por todos de uma vez.
const PREFIXOS_ES = ['America/Argentina/'];

/**
 * O idioma sugerido pelo fuso horário, ou `null` quando o fuso não diz nada
 * sobre língua — caso em que quem chamou tem que olhar o navegador.
 *
 * @param {string} [zona] fuso a consultar; por padrão, o desta máquina
 * @returns {'pt-BR' | 'es' | 'en' | null}
 */
function idiomaDoLugar(zona) {
  let alvo = zona;
  if (alvo === undefined) {
    try {
      alvo = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }
  if (!alvo || typeof alvo !== 'string') return null;

  if (ZONAS_PT.includes(alvo)) return 'pt-BR';
  if (ZONAS_ES.includes(alvo) || PREFIXOS_ES.some((p) => alvo.startsWith(p))) return 'es';

  // Fuso de país que fala inglês, ou de país que não fala nenhuma das três: em
  // ambos o inglês é a melhor aposta, e é o que o resto do mundo espera. Só que
  // o fuso não é prova — `Etc/UTC` e `UTC` aparecem em máquina de servidor e em
  // navegador com proteção de impressão digital ligada, e aí o navegador sabe
  // mais do que o relógio.
  if (/^(Etc\/|UTC$|GMT)/.test(alvo)) return null;
  return 'en';
}

  window.LUGAR = { idiomaDoLugar };
})();
