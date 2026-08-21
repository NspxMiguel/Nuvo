// Estudos: um professor por vez.
//
// A ideia que sustenta a tela: prova passada é amostra do que ele cobra,
// material de aula é o universo do que ele ensina — e a diferença entre os dois
// é a previsão. Por isso o retrato é a primeira coisa que aparece, e as três
// caixas de material ficam visivelmente separadas.
//
// Sem abas e sem pilha de cartões: material à esquerda, trabalho no meio,
// estúdio à direita, cada região com rolagem própria. Abaixo de 1200px vira uma
// região por vez, escolhida por um segmentado de três palavras.
//
// Entrar aqui recolhe a gaveta do app: nesta tela o material É a barra lateral,
// e sem isso as três colunas não cabem num 1280. Sair devolve a gaveta.

import {
  api, stream, state, escapeHtml, paintIcons, toast, iconPicker, modelOptions, modelLabel
} from './core.js';
import { icon } from './icons.js';
import { t, plural, formatarNumero, formatarData } from './i18n.js';

/** Navegação da tela — não é dado do app, então não mora no `state`. */
const aqui = {
  professorId: null,
  regiao: 'retrato',     // material | retrato | estudio, só usado no estreito
  pastaAberta: null,
  saidaAberta: null,
  revisando: false,
  cartao: 0,
  /** A IA escolhida no estúdio. Guardada aqui porque a tela é redesenhada a cada
   *  ação, e sem isto o seletor voltava sozinho pro padrão depois de gerar. */
  modelo: null,
  /** Quantos cartões a rodada tinha quando começou. Ver a explicação no contador. */
  totalDaRodada: 0,
  /** Fontes desmarcadas. Guardar o que está FORA deixa o padrão ser "tudo entra". */
  fora: new Set()
};

/**
 * Os dez geradores, na ordem em que aparecem no estúdio.
 *
 * `toque` diz se o retrato do professor muda o resultado. Slide e linha do tempo
 * são a matéria organizada — o professor não muda isso. Simulado, quiz e guia
 * são a prova dele, e sem o retrato saem genéricos.
 *
 * Nenhum deles fica trancado: metade do estúdio ficava cinza num professor novo
 * e parecia app quebrado. Sem retrato eles geram, e a etiqueta diz o que a
 * pessoa está perdendo.
 */
const LADRILHOS = [
  { id: 'simulado', ico: 'file', cor: 'amber', nome: () => t('Simulado'), toque: true },
  { id: 'guia', ico: 'book', cor: 'teal', nome: () => t('Guia'), toque: true },
  { id: 'flashcards', ico: 'layers', cor: 'indigo', nome: () => t('Cartões'), toque: true },
  { id: 'quiz', ico: 'check', cor: 'teal', nome: () => t('Quiz'), toque: true },
  { id: 'resumo', ico: 'edit', cor: 'sky', nome: () => t('Resumo'), toque: false },
  { id: 'mapa', ico: 'spark', cor: 'violet', nome: () => t('Mapa mental'), toque: false },
  { id: 'linha', ico: 'activity', cor: 'lime', nome: () => t('Linha do tempo'), toque: false },
  { id: 'podcast', ico: 'speaker', cor: 'rose', nome: () => t('Áudio'), toque: false },
  { id: 'infografico', ico: 'cpu', cor: 'amber', nome: () => t('Infográfico'), toque: false },
  { id: 'slides', ico: 'file', cor: 'slate', nome: () => t('Slides'), toque: false }
];

/** Um ladrilho do estúdio. `temRetrato` só muda a etiqueta, nunca destranca. */
const ladrilho = (l, temRetrato) =>
  `<button class="est-lad" style="--t:var(--${l.cor})" data-gerar="${l.id}">
    <span class="ico">${icon(l.ico, 18)}</span>
    <span class="nm">${escapeHtml(l.nome())}</span>
    ${
      l.toque
        ? `<span class="marca${temRetrato ? ' com' : ''}">${
            temRetrato ? t('com o jeito dele') : t('sem o retrato')
          }</span>`
        : ''
    }
  </button>`;

const acharLadrilho = (id) => LADRILHOS.find((l) => l.id === id);

/**
 * Os três papéis, com a palavra que a pessoa lê.
 *
 * O papel é a coisa mais importante de um arquivo aqui dentro e era a única
 * que a tela não dizia: a prova, o que ela cobrou, e o que ele ensinou sem
 * cobrar entravam na lista com a mesma cara. É a diferença entre os dois
 * últimos que vira previsão, então ela aparece em todo lugar em que um arquivo
 * aparece — mesma palavra, mesma cor, da lista ao estúdio.
 */
const PAPEIS = {
  prova: { cor: 'amber', curto: () => t('Prova'), longo: () => t('a prova em si') },
  conteudo: { cor: 'teal', curto: () => t('Caiu'), longo: () => t('caiu nesta prova') },
  material: { cor: 'slate', curto: () => t('Aula'), longo: () => t('dado em aula') }
};
const papelDe = (p) => PAPEIS[p] || PAPEIS.material;

/** A etiqueta de papel, do tamanho de uma palavra. */
const selo = (papel) =>
  `<span class="est-selo" style="--t:var(--${papelDe(papel).cor})">${escapeHtml(
    papelDe(papel).curto()
  )}</span>`;

/** Quantos arquivos de cada papel a pasta tem, dito em etiqueta e não em total. */
function contagemDePapeis(anexos = []) {
  return ['prova', 'conteudo', 'material']
    .map((papel) => [papel, anexos.filter((a) => a.papel === papel).length])
    .filter(([, n]) => n > 0);
}

/**
 * O que a data de uma avaliação quer dizer hoje.
 *
 * "A2" sozinho não responde a única pergunta que quem estuda faz ao abrir a
 * tela: já foi ou está vindo? Sem data, a resposta é honesta — "sem data" —, e
 * não um silêncio que parece estado.
 */
function quandoDiz(quando) {
  if (!quando) return { classe: 'sem', txt: () => t('sem data') };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const [ano, mes, dia] = quando.split('-').map(Number);
  const alvo = new Date(ano, mes - 1, dia);
  const dias = Math.round((alvo - hoje) / 86_400_000);

  if (dias < 0) return { classe: 'passou', dias, txt: () => t('já foi') };
  if (dias === 0) return { classe: 'hoje', dias, txt: () => t('é hoje') };
  if (dias === 1) return { classe: 'perto', dias, txt: () => t('é amanhã') };
  if (dias <= 7) return { classe: 'perto', dias, txt: () => plural(dias, 'em 1 dia', 'em {n} dias') };
  return {
    classe: 'longe',
    dias,
    txt: () => formatarData(`${quando}T12:00:00.000Z`, { day: '2-digit', month: 'short' }) || quando
  };
}

/**
 * As que ainda vêm primeiro, da mais próxima pra mais distante; depois as sem
 * data; e as que já passaram por último, da mais recente pra trás. É a ordem em
 * que elas importam pra quem tem prova marcada.
 */
function porUrgencia(a, b) {
  const qa = quandoDiz(a.quando);
  const qb = quandoDiz(b.quando);
  const peso = (q) => (q.classe === 'passou' ? 2 : q.classe === 'sem' ? 1 : 0);
  if (peso(qa) !== peso(qb)) return peso(qa) - peso(qb);
  if (qa.dias == null || qb.dias == null) return 0;
  return peso(qa) === 2 ? qb.dias - qa.dias : qa.dias - qb.dias;
}

/**
 * As três formas de organizar, e o que cada uma faz nascer.
 *
 * Os nomes das pastas saem daqui, do lado do cliente, e viajam no pedido de
 * criação: o servidor não tem `t()`, e uma pasta semeada em português apareceria
 * assim pra quem lê o app em inglês.
 */
const ORGANIZACOES = [
  {
    id: 'pastas',
    nome: () => t('Pastas que eu crio'),
    dica: () => t('Você dá o nome de cada uma. Serve pra qualquer escola.'),
    semear: () => [{ nome: t('Material da aula'), tipo: 'material' }]
  },
  {
    id: 'periodo',
    nome: () => t('Trimestre com A1 e A2'),
    dica: () => t('Já nasce com as seis avaliações do ano montadas.'),
    semear: () => [
      ...[1, 2, 3].flatMap((tri) =>
        ['A1', 'A2'].map((prova) => ({
          nome: t('{n}º trimestre · {prova}', { n: formatarNumero(tri), prova }),
          tipo: 'prova'
        }))
      ),
      { nome: t('Material da aula'), tipo: 'material' }
    ]
  },
  {
    id: 'etiquetas',
    nome: () => t('Tudo junto, com etiquetas'),
    dica: () => t('Um monte só, e você marca cada arquivo depois.'),
    semear: () => [
      { nome: t('Provas'), tipo: 'prova' },
      { nome: t('Material da aula'), tipo: 'material' }
    ]
  }
];

const acharOrganizacao = (id) => ORGANIZACOES.find((o) => o.id === id) || ORGANIZACOES[0];

/** Quanto aquele tema pesa no retrato, dito em palavra em vez de número. */
const PROBABILIDADE = {
  alta: () => t('cai bastante'),
  media: () => t('pode cair'),
  baixa: () => t('cai pouco')
};

/** "1 dia", "15 dias", "3 meses" — mês só quando passa de dois, senão fica pedante. */
function emDias(dias) {
  const n = Math.max(1, Math.round(Number(dias) || 1));
  if (n < 60) return plural(n, '1 dia', '{n} dias');
  return plural(Math.round(n / 30), '1 mês', '{n} meses');
}

/** Como cada nível de Bloom se chama, e o que ele quer dizer em português de gente. */
const NIVEIS = {
  lembrar: { nome: () => t('lembrar'), exp: () => t('repetir o que está escrito') },
  entender: { nome: () => t('entender'), exp: () => t('explicar com as próprias palavras') },
  aplicar: { nome: () => t('aplicar'), exp: () => t('usar num caso novo') },
  analisar: { nome: () => t('analisar'), exp: () => t('comparar, separar as partes') },
  avaliar: { nome: () => t('avaliar'), exp: () => t('julgar e defender o julgamento') },
  criar: { nome: () => t('criar'), exp: () => t('montar algo que não estava lá') }
};

const CONFIANCA = {
  palpite: () => t('ainda é palpite — uma prova só descreve aquela prova, não o professor'),
  indicio: () => t('dá pra ver tendência, ainda não previsão. Com quatro provas os pesos param de oscilar'),
  media: () => t('as provas batem entre si, mas falta o material de aula pra saber o que ele não cobra'),
  boa: () => t('provas e material de aula batendo — dá pra confiar nos pesos')
};

const CORES = ['indigo', 'teal', 'amber', 'rose', 'violet', 'sky', 'lime', 'slate'];
const porcento = (f) => Math.round((Number(f) || 0) * 100);
const inicial = (nome) => (nome || '?').trim().charAt(0).toUpperCase();

/** A barra empilhada e a legenda: peso se lê melhor visto do que lido. */
const barra = (itens) =>
  `<div class="est-barra">${itens
    .map((i) => `<i style="--t:var(--${i.cor});width:${i.pct}%"></i>`)
    .join('')}</div>`;

const legenda = (itens) =>
  `<ul class="est-leg">${itens
    .map(
      (i) => `<li><span class="pt" style="--t:var(--${i.cor})"></span>
      <span class="nm">${escapeHtml(i.nome)}${
        i.exp ? ` <small>· ${escapeHtml(i.exp)}</small>` : ''
      }</span><b>${formatarNumero(i.pct)}%</b></li>`
    )
    .join('')}</ul>`;

/**
 * Fatia a lista em barra: o que sobra depois dos maiores vira "resto".
 *
 * Oito faixas de 4% viram um borrão colorido que não diz nada. Cinco e um resto
 * é o que ainda se lê de longe.
 */
function fatiar(itens, quantas = 5) {
  const ordenado = [...itens].sort((a, b) => b.peso - a.peso);
  const cabeca = ordenado.slice(0, quantas).map((x, i) => ({
    nome: x.nome,
    exp: x.exp,
    pct: porcento(x.peso),
    cor: CORES[i % CORES.length]
  }));
  const resto = ordenado.slice(quantas).reduce((n, x) => n + porcento(x.peso), 0);
  if (resto > 0) cabeca.push({ nome: t('resto'), pct: resto, cor: 'slate' });
  return cabeca;
}

// ------------------------------------------------------------------- a tela

export async function renderEstudos(el, ctx) {
  // Dentro de um professor o material é a barra lateral: as três colunas não
  // cabem num 1280 com a gaveta aberta, então ela recolhe — e o movimento é o
  // aviso. Na lista de professores não há três colunas, e recolher ali só
  // tirava o menu do app de quem ainda nem escolheu com quem vai estudar.
  const app = document.querySelector('#app');
  if (aqui.professorId) {
    if (app && !app.classList.contains('recolhido')) {
      // Guarda que fomos nós: quem já estava com a gaveta recolhida não pode
      // recebê-la de volta ao sair daqui, porque nunca pediu isso.
      app.dataset.recolhiPorEstudos = '1';
      app.classList.add('recolhido');
    }
  } else {
    sairDeEstudos();
  }

  if (!aqui.professorId) return telaDaLista(el, ctx);
  return telaDoProfessor(el, ctx);
}

/** Devolve a gaveta ao sair — só se tiver sido a gente a recolher. */
export function sairDeEstudos() {
  const app = document.querySelector('#app');
  if (!app?.dataset.recolhiPorEstudos) return;
  delete app.dataset.recolhiPorEstudos;
  app.classList.remove('recolhido');
}

async function telaDaLista(el, ctx) {
  const professores = await api('/professores');
  el.className = 'view panel';
  el.innerHTML = `<div class="panel-inner">
    <h2>${t('Estudos')}</h2>
    <p class="hint">${t(
      'Um professor por vez. O app lê as provas dele e devolve o material recortado pelo jeito dele cobrar.'
    )}</p>
    <div class="est-profs">
      ${professores
        .map(
          (p) => `<button class="est-prof" data-prof="${escapeHtml(p.id)}">
            ${fotoDo(p, 44)}
            <span class="rot"><b>${escapeHtml(p.nome)}</b><small>${escapeHtml(
              p.materia || t('sem matéria')
            )}</small></span>
            <span class="est-selo${p.retrato ? '' : ' sem'}">${
              p.retrato ? `${icon('check', 16)} ${t('com retrato')}` : t('sem prova ainda')
            }</span>
          </button>`
        )
        .join('')}
      <button class="est-add" id="est-novo">${icon('plus', 18)} ${t('Adicionar professor')}</button>
    </div>
    <div id="est-form"></div>
  </div>`;

  for (const botao of el.querySelectorAll('[data-prof]')) {
    botao.onclick = () => {
      aqui.professorId = botao.dataset.prof;
      aqui.regiao = 'retrato';
      aqui.pastaAberta = null;
      aqui.saidaAberta = null;
      aqui.fora.clear();
      ctx.switchView('estudos');
    };
  }
  el.querySelector('#est-novo').onclick = () => formularioDeProfessor(el.querySelector('#est-form'), ctx);
  paintIcons(el);
}

function fotoDo(p, tamanho) {
  const estilo = `--t:var(--${p.cor || 'indigo'});width:${tamanho}px;height:${tamanho}px`;
  if (!p.foto) return `<span class="est-foto" style="${estilo}">${escapeHtml(inicial(p.nome))}</span>`;
  return `<span class="est-foto" style="${estilo}"><img src="/api/professores/${encodeURIComponent(
    p.id
  )}/foto?v=${encodeURIComponent(p.updated_at || '')}" alt="" /></span>`;
}

// -------------------------------------------------------------- o professor

async function telaDoProfessor(el, ctx) {
  let prof;
  try {
    prof = await api(`/professores/${aqui.professorId}`);
  } catch {
    aqui.professorId = null;
    return telaDaLista(el, ctx);
  }

  const [saidas, cartoes] = await Promise.all([
    api(`/professores/${prof.id}/saidas`),
    api(`/professores/${prof.id}/cartoes`).catch(() => ({ contagem: { hoje: 0 }, cartoes: [] }))
  ]);

  el.className = 'view';
  if (aqui.revisando && cartoes.cartoes.length) {
    if (!aqui.totalDaRodada) aqui.totalDaRodada = cartoes.cartoes.length;
    el.innerHTML = `<div class="est">${telaDeRevisar(prof, cartoes)}</div>`;
    return ligarRevisao(el, prof, cartoes, ctx);
  }

  const provas = prof.pastas.filter((p) => p.tipo === 'prova').sort(porUrgencia);
  const aula = prof.pastas.filter((p) => p.tipo === 'material');
  const pasta = prof.pastas.find((p) => p.id === aqui.pastaAberta);
  const saida = saidas.find((s) => s.id === aqui.saidaAberta);

  const meio = saida
    ? desenharSaida(saida)
    : pasta
      ? avaliacaoAberta(prof, pasta)
      : desenharRetrato(prof);

  el.innerHTML = `<div class="est">
    <header class="est-topo">
      <button class="est-foto-btn" id="est-foto" title="${t('trocar a foto')}"
        aria-label="${t('trocar a foto')}">${fotoDo(prof, 54)}</button>
      <div class="est-quem">
        <h2>${escapeHtml(prof.nome)}</h2>
        <div class="sub">${escapeHtml(prof.materia || t('sem matéria'))} · <b>${plural(
          prof.material.provas,
          '1 prova',
          '{n} provas'
        )}</b> · ${plural(
          prof.material.conteudos + prof.material.materiais,
          '1 arquivo',
          '{n} arquivos'
        )}</div>
      </div>
      <div class="acoes">
        ${
          cartoes.contagem.hoje
            ? `<button class="est-rev" id="est-revisar">${icon('layers', 18)} ${t(
                'Revisar'
              )} <b>${formatarNumero(cartoes.contagem.hoje)}</b></button>`
            : ''
        }
        <button class="icon" id="est-trocar" title="${t('trocar de professor')}"
          aria-label="${t('trocar de professor')}">${icon('users', 20)}</button>
      </div>
    </header>

    <div class="est-abas">
      <div class="segmentado" role="tablist">
        ${[
          ['material', t('Material')],
          ['retrato', t('Retrato')],
          ['estudio', t('Estúdio')]
        ]
          .map(
            ([k, r]) =>
              `<button type="button" role="tab" data-regiao="${k}" class="${
                aqui.regiao === k ? 'sel' : ''
              }" aria-selected="${aqui.regiao === k}">${escapeHtml(r)}</button>`
          )
          .join('')}
      </div>
    </div>

    <div class="est-cols" data-aba="${aqui.regiao}">
      <aside class="est-mat">
        <div class="est-rot">${t('Avaliações')} <span class="n">${formatarNumero(provas.length)}</span></div>
        ${
          provas.length
            ? provas.map((p) => linhaDeFonte(p)).join('')
            : `<p class="est-nada">${t('Nenhuma prova dele ainda. É a prova que diz o que cai.')}</p>`
        }
        <div class="est-rot">${t('Material de aula')} <span class="n">${formatarNumero(aula.length)}</span></div>
        ${aula.map((p) => linhaDeFonte(p)).join('')}
        <button class="est-add" id="est-nova-pasta">${icon('plus', 18)} ${t('Adicionar material')}</button>
        <p class="est-nada">${t('O que está marcado entra nas respostas e no que for gerado.')}</p>
      </aside>

      <div class="est-mid">${meio}</div>

      <aside class="est-lado">
        <div class="est-rot">${t('Estúdio')}</div>
        <div class="est-quem-gera">${icon('bot', 16)}
          <select id="est-modelo" aria-label="${t('IA que dá o toque do professor')}">${modelOptions(
            aqui.modelo || state.model
          )}</select>
        </div>
        <p class="est-nada est-duas">${t(
          'O NotebookLM lê o material. Esta IA reescreve com o jeito do professor.'
        )}</p>
        <div class="est-rot">${t('Gerar')}</div>
        <div class="est-lads">
          ${LADRILHOS.map((l) => ladrilho(l, !!prof.retrato)).join('')}
        </div>
        ${
          saidas.length
            ? `<div class="est-rot">${t('Já gerado')} <span class="n">${formatarNumero(saidas.length)}</span></div>
               ${saidas.map((s) => linhaDeSaida(s)).join('')}`
            : ''
        }
      </aside>
    </div>
  </div>`;

  ligarProfessor(el, prof, saidas, ctx);
  paintIcons(el);
}

function linhaDeFonte(pasta) {
  const marcada = !aqui.fora.has(pasta.id);
  const aberta = pasta.id === aqui.pastaAberta;
  const q = pasta.tipo === 'prova' ? quandoDiz(pasta.quando) : null;
  const papeis = contagemDePapeis(pasta.anexos);
  return `<div class="est-fonte${marcada ? ' on' : ''}${aberta ? ' sel' : ''}${
    q ? ` q-${q.classe}` : ''
  }" data-pasta="${escapeHtml(pasta.id)}">
    <button class="cx" data-marcar aria-pressed="${marcada}"
      aria-label="${t('usar {nome} no que for gerado', { nome: escapeHtml(pasta.nome) })}">${icon('check', 13)}</button>
    <button class="rot" data-abrir>
      <span class="nm">${escapeHtml(pasta.nome)}</span>
      <span class="baixo">${
        q ? `<span class="qd">${escapeHtml(q.txt())}</span>` : ''
      }${
        papeis.length
          ? papeis.map(([papel, n]) => `${selo(papel)}<i class="est-n">${formatarNumero(n)}</i>`).join('')
          : `<span class="qd">${t('vazia')}</span>`
      }</span>
    </button>
  </div>${
    // Aberta, a pasta mostra os arquivos com o papel de cada um: o total nunca
    // respondeu "qual destes é a prova e qual é só matéria de aula".
    aberta && pasta.anexos.length
      ? `<div class="est-arqs">${pasta.anexos
          .map(
            (a) => `<div class="est-arq" style="--t:var(--${papelDe(a.papel).cor})">
              <span class="nm">${escapeHtml(a.name)}</span>${selo(a.papel)}
            </div>`
          )
          .join('')}</div>`
      : ''
  }`;
}

/**
 * Quem fez, dito com as duas mãos.
 *
 * `notebooklm+<ref>` é o caminho padrão, e `modelLabel` sozinho não conhece esse
 * formato: a lista dizia só "default", que é o nome do modelo do CLI e não
 * informa nada — nem quem leu, nem quem deu o toque.
 */
function quemFez(modelo) {
  if (!modelo) return '';
  if (modelo === 'notebooklm') return 'NotebookLM';
  const [primeira, ...resto] = String(modelo).split('+');
  return primeira === 'notebooklm' && resto.length
    ? `NotebookLM → ${modelLabel(resto.join('+'))}`
    : modelLabel(modelo);
}

function linhaDeSaida(s) {
  const l = acharLadrilho(s.tipo);
  return `<button class="est-feito" style="--t:var(--${l?.cor || 'slate'})" data-saida="${escapeHtml(s.id)}">
    <span class="ico">${icon(l?.ico || 'file', 18)}</span>
    <span class="rot">${escapeHtml(s.titulo)}<small>${escapeHtml(
      [formatarData(s.created_at, { day: '2-digit', month: 'short' }), quemFez(s.modelo)]
        .filter(Boolean)
        .join(' · ')
    )}</small></span>
    ${icon('chevron', 16)}
  </button>`;
}

/**
 * Os três passos da tela, com o atual aceso.
 *
 * O meio ficava vazio num professor novo e a pergunta que sobrava era "e agora?".
 * Três linhas respondem: o que entra, o que o app faz com isso, e o que sai.
 */
function comoFunciona(prof) {
  const temProva = prof.material.provas > 0;
  const passos = [
    {
      feito: prof.material.provas + prof.material.conteudos + prof.material.materiais > 0,
      agora: !temProva,
      titulo: () => t('1. Jogue as provas antigas dele aqui'),
      exp: () => t('Prova é amostra: é ela que diz o que ele cobra. Matéria de aula entra depois, e é o contraste entre as duas que vira previsão.')
    },
    {
      feito: false,
      agora: temProva,
      titulo: () => t('2. O app lê as provas e monta o retrato'),
      exp: () => t('Peso de cada tema, nível que ele exige, verbo que ele usa, o que ele ensina e nunca cobrou — cada achado com a citação da prova de onde saiu.')
    },
    {
      feito: false,
      agora: false,
      titulo: () => t('3. Tudo que o estúdio gerar sai com o jeito dele'),
      exp: () => t('O NotebookLM lê o material e rascunha; a IA escolhida reescreve com o retrato por cima. Simulado, guia, cartões e quiz saem com cara de prova dele.')
    }
  ];
  return `<ol class="est-passos">${passos
    .map(
      (p) => `<li class="${p.agora ? 'agora' : p.feito ? 'feito' : ''}">
        <b>${escapeHtml(p.titulo())}</b>
        <span>${escapeHtml(p.exp())}</span>
      </li>`
    )
    .join('')}</ol>`;
}

// ---------------------------------------------------------------- o retrato

function desenharRetrato(prof) {
  const r = prof.retrato;
  if (!r) {
    // Com prova anexada, o que falta é mandar montar — e sem este botão não
    // havia como: o retrato ficava impossível de existir e os geradores que
    // dependem dele, trancados pra sempre.
    const temProva = prof.material.provas > 0;
    return `<div class="est-sec" style="margin-top:22px">
      <p class="veredito" style="margin:0">${
        temProva
          ? t('As provas estão aqui. Falta ler.')
          : t('Ainda não tem retrato. Falta uma prova dele.')
      }</p>
      <div class="est-conf"><span class="pt"></span><span>${t(
        'Com uma prova o app já mostra o que ele cobra; com quatro, os pesos param de oscilar. Material de aula sozinho não diz o que cai.'
      )}</span></div>
      <div class="row">${
        temProva
          ? `<button class="primary" id="est-montar">${icon('sparkle', 18)} ${t('Montar o retrato')}</button>`
          : `<button class="primary" id="est-primeira-prova">${icon('upload', 18)} ${t(
              'Adicionar uma prova dele'
            )}</button>`
      }</div>
      <div id="est-andar" class="est-andar" role="status"></div>
      ${comoFunciona(prof)}
    </div>`;
  }

  const conf = r.confianca || {};
  const cobra = fatiar((r.conteudo || []).map((c) => ({ nome: c.tema, peso: c.peso })));
  const pede = fatiar(
    (r.cognitivo || []).map((c) => ({
      nome: (NIVEIS[c.nivel]?.nome || (() => c.nivel))(),
      exp: NIVEIS[c.nivel]?.exp(),
      peso: c.peso
    })),
    6
  );

  return `
    <p class="veredito">${escapeHtml(vereditoDe(prof, r))}</p>
    <div class="est-conf"><span class="pt"></span>
      <span>${t('Confiança')} <b>${escapeHtml(conf.nota || '—')}</b> — ${escapeHtml(
        (CONFIANCA[conf.nota] || (() => t('sem nota de confiança')))()
      )}</span>
      <button class="ghost" id="est-montar">${icon('refresh', 16)} ${t('Refazer')}</button></div>
    <div id="est-andar" class="est-andar" role="status"></div>

    ${
      r.formato
        ? `<div class="est-sec">
            <h3>${t('Como a prova dele é')}</h3>
            <div class="est-fatos">${fatosDoFormato(r.formato)}</div>
          </div>`
        : ''
    }

    ${
      cobra.length
        ? `<div class="est-sec"><h3>${t('O que ele cobra')}</h3>${barra(cobra)}${legenda(cobra)}</div>`
        : ''
    }
    ${
      pede.length
        ? `<div class="est-sec"><h3>${t('O que ele pede')}</h3>${barra(pede)}${legenda(pede)}</div>`
        : ''
    }
    ${
      r.verbos?.length
        ? `<div class="est-sec"><h3>${t('Os verbos que ele usa')}</h3>
             <div class="est-verbos">${r.verbos
               .map(
                 (v) =>
                   `<span class="est-verbo" title="${escapeHtml(v.exemplo || '')}">${escapeHtml(
                     v.verbo
                   )} <b>${formatarNumero(v.vezes)}×</b></span>`
               )
               .join('')}</div></div>`
        : ''
    }
    ${achadosEmHtml(r)}
    ${
      r.so_na_aula?.length
        ? `<div class="est-sec">
            <h3>${t('Ensina e nunca cobrou')}</h3>
            <p class="est-explica">${t(
              '{quantos} aparecem no material de aula e não caíram em nenhuma das {provas}. Estudar isso por último é a aposta que o app faria.',
              {
                quantos: plural(r.so_na_aula.length, '1 assunto', '{n} assuntos'),
                provas: plural(conf.provas || 0, '1 prova', '{n} provas')
              }
            )}</p>
            <div class="est-nunca">${r.so_na_aula
              .map((n) => `<span>${escapeHtml(n)}</span>`)
              .join('')}</div>
          </div>`
        : ''
    }`;
}

/**
 * A frase que resume o professor.
 *
 * Montada aqui e não pedida ao modelo: o retrato já tem os números, e uma frase
 * derivada deles nunca desmente o que está logo abaixo — uma frase gerada
 * desmentiria de vez em quando, e aí a tela inteira perde a credibilidade.
 */
function vereditoDe(prof, r) {
  const tema = (r.conteudo || [])[0];
  const nivel = [...(r.cognitivo || [])].sort((a, b) => b.peso - a.peso)[0];
  const tipo = (r.formato?.tipos || [])[0];
  const partes = [];
  if (tema) partes.push(t('cobra {tema} acima de tudo', { tema: tema.tema }));
  if (nivel) {
    partes.push(
      t('e pede {nivel}, não decoreba', { nivel: (NIVEIS[nivel.nivel]?.nome || (() => nivel.nivel))() })
    );
  }
  if (!partes.length) return t('{nome} — ainda pouco material pra concluir alguma coisa', { nome: prof.nome });
  return `${prof.nome} ${partes.join(' ')}${
    tipo ? t(', em prova de {tipo}', { tipo: tipo.tipo }) : ''
  }.`;
}

function fatosDoFormato(f) {
  const fatos = [];
  if (f.n_questoes) fatos.push([formatarNumero(f.n_questoes), t('questões por prova')]);
  const maior = [...(f.tipos || [])].sort((a, b) => b.peso - a.peso)[0];
  if (maior) fatos.push([`${formatarNumero(porcento(maior.peso))}%`, maior.tipo]);
  if (f.pontuacao) fatos.push([f.pontuacao.split(/[;,.]/)[0].trim().slice(0, 14), t('pontuação')]);
  return fatos
    .map(
      ([v, r]) => `<div><span class="v">${escapeHtml(v)}</span><span class="r">${escapeHtml(r)}</span></div>`
    )
    .join('');
}

/** Pegadinhas e manias, cada achado com o trecho literal da prova ao lado. */
function achadosEmHtml(r) {
  const achados = [
    ...(r.pegadinhas || []).map((p) => ({ tipo: t('pegadinha'), tit: p.padrao, trecho: p.exemplo })),
    ...(r.manias || []).map((m) => ({ tipo: t('mania'), tit: m, trecho: '' }))
  ];
  if (!achados.length) return '';
  return `<div class="est-sec"><h3>${t('Pegadinhas e manias')}</h3>
    ${achados
      .map(
        (a) => `<div class="est-achado">
          <div><h4>${escapeHtml(a.tit)}</h4></div>
          ${
            a.trecho
              ? `<blockquote>“${escapeHtml(a.trecho)}”<cite>${escapeHtml(a.tipo)}</cite></blockquote>`
              : `<blockquote class="sem"><cite>${escapeHtml(a.tipo)}</cite></blockquote>`
          }
        </div>`
      )
      .join('')}</div>`;
}

// ------------------------------------------------------- a avaliação aberta

function avaliacaoAberta(prof, pasta) {
  const conta = (papel) => pasta.anexos.filter((a) => a.papel === papel);
  const provas = conta('prova');
  const conteudos = conta('conteudo');
  const aulas = conta('material');
  const r = prof.retrato;
  const nunca = r?.so_na_aula?.length || 0;

  // Uma caixa por papel, e nada além do que ela precisa dizer. A versão de antes
  // tinha sobrenome ("o documento") em cima do nome ("A prova") e dois
  // parágrafos de explicação: três caixas passavam de 800 px e quem abria uma
  // prova de três arquivos rolava a tela pra ver o terceiro.
  const caixa = (papel, titulo, explica, itens) => `
    <div class="est-caixa" style="--t:var(--${papelDe(papel).cor})">
      <div class="cab">
        ${selo(papel)}
        <h4>${escapeHtml(titulo)}</h4>
        <span class="quantos">${
          itens.length ? plural(itens.length, '1 arquivo', '{n} arquivos') : t('vazio')
        }</span>
      </div>
      <p class="exp">${escapeHtml(explica)}</p>
      ${
        itens.length
          ? `<ul>${itens
              .map(
                (a) =>
                  `<li>${escapeHtml(a.name)} <span class="pes">${
                    a.status === 'ok'
                      ? plural(a.chunks || 0, '1 trecho', '{n} trechos')
                      : escapeHtml(a.note || t('não deu pra ler'))
                  }</span></li>`
              )
              .join('')}</ul>`
          : ''
      }
      <button class="ghost" data-add="${papel}">${icon('plus', 15)} ${t('Adicionar')}</button>
    </div>`;

  return `
    <button class="est-volta" data-volta>${icon('chevron', 17)} ${t('Retrato do professor')}</button>
    <header class="est-cabeca-av">
      <h2>${escapeHtml(pasta.nome)}</h2>
      <div class="sub">${plural(pasta.anexos.length, '1 arquivo', '{n} arquivos')}</div>
      ${
        pasta.tipo === 'prova'
          ? `<label class="est-quando q-${quandoDiz(pasta.quando).classe}">
               <span>${escapeHtml(quandoDiz(pasta.quando).txt())}</span>
               <input type="date" data-quando value="${escapeHtml(pasta.quando || '')}"
                 aria-label="${t('dia da prova')}" />
             </label>`
          : ''
      }
      <div class="acoes">
        <button class="icon" data-ren title="${t('renomear')}" aria-label="${t('renomear a pasta')}">${icon('edit', 18)}</button>
        <button class="icon danger" data-del title="${t('apagar')}" aria-label="${t('apagar a pasta')}">${icon('trash', 18)}</button>
      </div>
    </header>

    <div class="est-tri">
      ${
        pasta.tipo === 'prova'
          ? caixa('prova', t('A prova'),
              t('O arquivo como ele entregou. Todo achado do retrato aponta pra uma linha daqui.'),
              provas) +
            caixa('conteudo', t('O que esta prova cobrou'),
              t('Só o que caiu de verdade. É a amostra do jeito dele.'),
              conteudos)
          : ''
      }
      ${caixa('material', t('Dado em aula'),
        t('O que ele ensinou no período. É maior do que o que ele cobra, e essa diferença é a previsão.'),
        aulas)}
    </div>

    ${
      nunca
        ? `<p class="est-gap">${t(
            'A diferença entre as duas últimas caixas é a previsão: {quantos} que ele ensina e nunca cobrou.',
            { quantos: plural(nunca, '1 assunto', '{n} assuntos') }
          )}</p>`
        : ''
    }

    <div class="est-fazer">
      <div class="est-rot">${t('O que fazer com isto')}</div>
      <div class="est-lads">
        ${['resumo', 'simulado', 'flashcards', 'guia']
          .map((id) => ladrilho(acharLadrilho(id), !!r))
          .join('')}
      </div>
      <p class="est-nada">${t('Sai do que está marcado na coluna da esquerda. O resto está no Estúdio.')}</p>
    </div>`;
}

// ------------------------------------------------------------- revisar

function telaDeRevisar(prof, fila) {
  const cartao = fila.cartoes[aqui.cartao % fila.cartoes.length];
  const notas = [
    { valor: 1, nome: () => t('Errei'), id: 'denovo', cls: 'dura' },
    { valor: 2, nome: () => t('Difícil'), id: 'dificil', cls: '' },
    { valor: 3, nome: () => t('Bom'), id: 'bom', cls: '' },
    { valor: 4, nome: () => t('Fácil'), id: 'facil', cls: 'facil' }
  ];
  const emDias = (d) => {
    const n = Math.max(1, Math.round(Number(d) || 1));
    if (n === 1) return t('volta hoje');
    return n < 60 ? plural(n, '1 dia', '{n} dias') : plural(Math.round(n / 30), '1 mês', '{n} meses');
  };

  return `<div class="est-revisar">
    <div class="est-passo">${t('cartão {n} de {total}', {
      // O total é o da fila em que esta rodada começou, e não o que sobra agora:
      // com os dois andando ao mesmo tempo, o contador mostrava "4 de 12" e
      // depois "5 de 9" — o numerador subindo enquanto o denominador encolhia.
      n: formatarNumero(aqui.cartao + 1),
      total: formatarNumero(aqui.totalDaRodada || fila.cartoes.length)
    })}${prof.materia ? ` · ${escapeHtml(prof.materia)}` : ''}</div>
    <div class="est-cartao" data-cartao="${escapeHtml(cartao.id)}">
      <div class="frente">${escapeHtml(cartao.frente)}</div>
      <div class="verso" hidden>${escapeHtml(cartao.verso)}</div>
      ${cartao.fonte ? `<div class="fonte" hidden>${escapeHtml(cartao.fonte)}</div>` : ''}
    </div>
    <div class="est-notas" hidden>${notas
      .map(
        (n) =>
          `<button class="est-nota ${n.cls}" data-nota="${n.valor}">${escapeHtml(
            n.nome()
          )}<small>${escapeHtml(emDias(cartao.previsao?.[n.id]))}</small></button>`
      )
      .join('')}</div>
    <div class="row" style="justify-content:center">
      <button class="primary" data-mostrar>${t('Mostrar a resposta')}</button>
    </div>
    <button class="ghost" data-sair-rev>${icon('close', 17)} ${t('Sair da revisão')}</button>
  </div>`;
}

function ligarRevisao(el, prof, fila, ctx) {
  const q = (s) => el.querySelector(s);
  const mostrar = () => {
    q('.verso').hidden = false;
    if (q('.fonte')) q('.fonte').hidden = false;
    q('.est-notas').hidden = false;
    q('[data-mostrar]').closest('.row').hidden = true;
    q('[data-nota="3"]')?.focus();
  };
  q('[data-mostrar]').onclick = mostrar;
  q('[data-mostrar]').focus();

  const responder = async (nota) => {
    const id = q('.est-cartao').dataset.cartao;
    try {
      await api(`/cartoes/${id}/responder`, { method: 'POST', body: { nota } });
    } catch (err) {
      toast(err.message || t('não deu pra gravar a revisão'), 'err');
    }
    aqui.cartao += 1;
    if (aqui.cartao >= aqui.totalDaRodada || aqui.cartao >= fila.cartoes.length) {
      aqui.cartao = 0;
      aqui.totalDaRodada = 0;
      aqui.revisando = false;
      toast(t('Por hoje acabou'), 'ok');
    }
    ctx.switchView('estudos');
  };
  for (const b of el.querySelectorAll('[data-nota]')) b.onclick = () => responder(Number(b.dataset.nota));
  q('[data-sair-rev]').onclick = () => {
    aqui.revisando = false;
    aqui.cartao = 0;
    aqui.totalDaRodada = 0;
    ctx.switchView('estudos');
  };
  // Espaço mostra, número responde: cem cartões não se faz com o mouse.
  el.onkeydown = (ev) => {
    if (ev.key === ' ' && q('.verso') && q('.verso').hidden) {
      ev.preventDefault();
      return mostrar();
    }
    // A tela é redesenhada inteira ao sair da revisão, e este `onkeydown` ficava
    // preso no elemento antigo: qualquer tecla dentro de Estudos quebrava em
    // "Cannot read properties of null".
    if (!q('.verso')) return;
    if (!q('.verso').hidden && ['1', '2', '3', '4'].includes(ev.key)) {
      ev.preventDefault();
      responder(Number(ev.key));
    }
  };
  el.tabIndex = 0;
  paintIcons(el);
}

// -------------------------------------------------------------- a ligação

function ligarProfessor(el, prof, saidas, ctx) {
  const q = (s) => el.querySelector(s);
  const repintar = () => ctx.switchView('estudos');

  for (const b of el.querySelectorAll('[data-regiao]')) {
    b.onclick = () => {
      aqui.regiao = b.dataset.regiao;
      repintar();
    };
  }
  q('#est-trocar').onclick = () => {
    aqui.professorId = null;
    aqui.pastaAberta = null;
    aqui.saidaAberta = null;
    repintar();
  };
  q('#est-revisar')?.addEventListener('click', () => {
    aqui.revisando = true;
    aqui.cartao = 0;
    aqui.totalDaRodada = 0;
    repintar();
  });
  q('#est-foto').onclick = () => escolherFoto(prof, ctx);

  for (const linha of el.querySelectorAll('[data-pasta]')) {
    const id = linha.dataset.pasta;
    linha.querySelector('[data-marcar]').onclick = () => {
      if (aqui.fora.has(id)) aqui.fora.delete(id);
      else aqui.fora.add(id);
      repintar();
    };
    linha.querySelector('[data-abrir]').onclick = () => {
      aqui.pastaAberta = aqui.pastaAberta === id ? null : id;
      aqui.saidaAberta = null;
      aqui.regiao = 'retrato';
      repintar();
    };
  }

  q('#est-nova-pasta').onclick = () => criarPasta(prof, ctx, q('.est-mat'));
  q('[data-volta]')?.addEventListener('click', () => {
    aqui.pastaAberta = null;
    aqui.saidaAberta = null;
    repintar();
  });
  q('#est-primeira-prova')?.addEventListener('click', () => criarPasta(prof, ctx, q('.est-mat')));
  q('#est-montar')?.addEventListener('click', (ev) => montarRetrato(el, prof, ev.currentTarget, q('#est-modelo').value, ctx));

  for (const b of el.querySelectorAll('[data-add]')) {
    b.onclick = () => enviarArquivos(aqui.pastaAberta, b.dataset.add, ctx);
  }
  q('[data-quando]')?.addEventListener('change', async (ev) => {
    await api(`/pastas/${aqui.pastaAberta}`, { method: 'PATCH', body: { quando: ev.target.value || null } });
    repintar();
  });
  q('[data-ren]')?.addEventListener('click', () => {
    const pasta = prof.pastas.find((p) => p.id === aqui.pastaAberta);
    pedirNome(q('.est-cabeca-av'), {
      valor: pasta.nome,
      dica: t('Nome da pasta'),
      aoConfirmar: async (nome) => {
        await api(`/pastas/${pasta.id}`, { method: 'PATCH', body: { nome } });
        repintar();
      }
    });
  });
  ligarApagar(q('[data-del]'), async () => {
    await api(`/pastas/${aqui.pastaAberta}`, { method: 'DELETE' });
    aqui.pastaAberta = null;
    repintar();
  });

  for (const b of el.querySelectorAll('[data-saida]')) {
    b.onclick = () => {
      aqui.saidaAberta = aqui.saidaAberta === b.dataset.saida ? null : b.dataset.saida;
      aqui.pastaAberta = null;
      aqui.regiao = 'retrato';
      repintar();
    };
  }
  q('[data-fechar-saida]')?.addEventListener('click', () => {
    aqui.saidaAberta = null;
    repintar();
  });
  ligarApagar(q('[data-apagar-saida]'), async () => {
    await api(`/saidas/${aqui.saidaAberta}`, { method: 'DELETE' });
    aqui.saidaAberta = null;
    repintar();
  });

  const seletor = q('#est-modelo');
  seletor.onchange = () => {
    aqui.modelo = seletor.value;
  };
  for (const b of el.querySelectorAll('[data-gerar]')) {
    b.onclick = () => gerar(el, prof, b, seletor.value, ctx);
  }


  // As saídas que têm vida própria.
  const saida = saidas.find((s) => s.id === aqui.saidaAberta);
  if (saida) {
    ligarPodcast(el, saida.json);
    ligarQuiz(el, saida.json);
    ligarSlides(el, saida.json);
    q('[data-act=revisar]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const { entraram } = await api(`/saidas/${saida.id}/cartoes`, { method: 'POST' });
        toast(
          entraram
            ? plural(entraram, '1 cartão entrou na revisão', '{n} cartões entraram na revisão')
            : t('todos esses cartões já estavam na revisão'),
          entraram ? 'ok' : ''
        );
        repintar();
      } catch (err) {
        toast(err.message || t('não deu pra mandar pra revisão'), 'err');
      }
    });
  }
}

/** Apagar em dois toques, com o botão dizendo o que vai acontecer. */
function ligarApagar(botao, aoConfirmar) {
  if (!botao) return;
  let armado = 0;
  const original = botao.innerHTML;
  botao.onclick = async () => {
    if (!armado) {
      armado = window.setTimeout(() => {
        armado = 0;
        botao.classList.remove('armado');
        botao.innerHTML = original;
      }, 4000);
      botao.classList.add('armado');
      botao.innerHTML = `${icon('trash', 16)} <span>${t('apagar mesmo?')}</span>`;
      return;
    }
    window.clearTimeout(armado);
    await aoConfirmar();
  };
}

/** Manda montar o retrato, contando o que está sendo lido. */
async function montarRetrato(el, prof, botao, ref, ctx) {
  if (!ref) return toast(t('escolha uma IA pra montar o retrato'), 'err');
  const andar = el.querySelector('#est-andar');
  const dizer = (frase) => {
    if (andar) andar.textContent = frase;
  };
  botao.disabled = true;
  try {
    await stream(`/professores/${prof.id}/retrato`, { model: ref }, (ev) => {
      if (ev.type === 'start') {
        dizer(
          t('lendo {provas} e {materiais}', {
            provas: plural(ev.provas, '1 prova', '{n} provas'),
            materiais: plural(ev.materiais, '1 material', '{n} materiais')
          })
        );
      }
      if (ev.type === 'lendo') dizer(t('lendo {nome}…', { nome: ev.nome }));
      if (ev.type === 'lida') {
        dizer(t('{nome}: {questoes}', { nome: ev.nome, questoes: plural(ev.questoes, '1 questão', '{n} questões') }));
      }
      if (ev.type === 'pulada') dizer(t('{nome} ficou de fora — {porque}', { nome: ev.nome, porque: ev.porque }));
      if (ev.type === 'sintetizando') dizer(t('juntando tudo…'));
      if (ev.type === 'repetindo') dizer(t('a resposta veio torta, pedindo de novo…'));
      if (ev.type === 'error') throw new Error(ev.message);
    });
    toast(t('retrato pronto'), 'ok');
  } catch (err) {
    toast(err.message || t('não deu pra montar o retrato'), 'err');
  } finally {
    botao.disabled = false;
    ctx.switchView('estudos');
  }
}

async function gerar(el, prof, botao, ref, ctx) {
  const tipo = botao.dataset.gerar;
  if (!ref) return toast(t('escolha uma IA pra gerar'), 'err');
  const rotulo = botao.querySelector('.nm');
  const antes = rotulo?.textContent;
  botao.classList.add('ocupado');
  botao.disabled = true;

  // O relógio andando é o que separa "está trabalhando" de "travou".
  //
  // Um simulado leva de trinta segundos a um minuto, e um rótulo parado em
  // "gerando…" nesse tempo parece a tela morta — foi assim que apareceu no teste.
  // Os dois primeiros segundos ficam sem número: um "1 s" que pisca e some é
  // ruído, não informação.
  const inicio = Date.now();
  let fase = t('gerando…');
  const pintar = () => {
    if (!rotulo) return;
    const seg = Math.round((Date.now() - inicio) / 1000);
    rotulo.textContent = seg >= 2 ? `${fase} ${formatarNumero(seg)} s` : fase;
  };
  pintar();
  const relogio = window.setInterval(pintar, 1000);

  const pastas = prof.pastas.filter((p) => !aqui.fora.has(p.id)).map((p) => p.id);
  try {
    await stream(`/professores/${prof.id}/gerar`, { tipo, model: ref, pastas }, (ev) => {
      if (ev.type === 'start') fase = ev.rascunho ? t('NotebookLM lendo…') : t('lendo…');
      if (ev.type === 'passo' && ev.o_que) fase = ev.o_que;
      // A segunda mão é a que interessa: é ela que põe o professor no resultado,
      // e sem dizer isso a espera parece o mesmo passo demorando o dobro.
      if (ev.type === 'etapa') {
        fase =
          ev.o_que === 'toque'
            ? t('{ia} dando o toque do professor…', { ia: ev.modelo })
            : t('lendo {arquivos}…', {
                arquivos: plural(ev.arquivos || 0, '1 arquivo', '{n} arquivos')
              });
      }
      if (ev.type === 'repetindo') fase = t('de novo…');
      if (ev.type === 'pronto') aqui.saidaAberta = ev.saida.id;
      if (ev.type === 'error') throw new Error(ev.message);
      pintar();
    });
    toast(t('pronto'), 'ok');
  } catch (err) {
    toast(err.message || t('não deu pra gerar'), 'err');
  } finally {
    window.clearInterval(relogio);
    botao.classList.remove('ocupado');
    botao.disabled = false;
    if (rotulo && antes) rotulo.textContent = antes;
    ctx.switchView('estudos');
  }
}

// -------------------------------------------------------- as saídas abertas

function desenharSaida(saida) {
  const j = saida.json || {};
  const l = acharLadrilho(saida.tipo);
  const desenhar = {
    simulado: () => desenharSimulado(j),
    guia: () => desenharGuia(j),
    flashcards: () => desenharCartoes(j),
    resumo: () => desenharResumo(j),
    mapa: () => desenharMapa(j),
    linha: () => desenharLinha(j),
    podcast: () => desenharPodcast(j),
    quiz: () => desenharQuiz(j),
    infografico: () => desenharInfografico(j),
    slides: () => desenharSlides(j)
  }[saida.tipo];

  return `
    <button class="est-volta" data-fechar-saida>${icon('chevron', 17)} ${t('Retrato do professor')}</button>
    <header class="est-cabeca-av">
      <h2>${escapeHtml(saida.titulo)}</h2>
      <div class="sub">${escapeHtml(
        [
          l ? l.nome() : saida.tipo,
          formatarData(saida.created_at, { day: '2-digit', month: 'short' }),
          quemFez(saida.modelo)
        ]
          .filter(Boolean)
          .join(' · ')
      )}</div>
      <div class="acoes">
        <button class="icon danger" data-apagar-saida title="${t('apagar')}"
          aria-label="${t('apagar')}">${icon('trash', 18)}</button>
      </div>
    </header>
    <div class="est-saida">
      ${desenhar ? desenhar() : ''}
      ${faltouEmHtml(j.faltou)}
    </div>`;
}

// ----------------------------------------------------------- pequenas ações

function criarPasta(prof, ctx, host) {
  pedirNome(host, {
    dica: t('A1 do 1º trimestre'),
    aoConfirmar: async (nome) => {
      const pasta = await api(`/professores/${prof.id}/pastas`, {
        method: 'POST',
        body: { nome, tipo: 'prova' }
      });
      aqui.pastaAberta = pasta.id;
      ctx.switchView('estudos');
    }
  });
}

function enviarArquivos(pastaId, papel, ctx) {
  if (!pastaId) return;
  const campo = document.createElement('input');
  campo.type = 'file';
  campo.multiple = true;
  campo.onchange = async () => {
    const arquivos = [...(campo.files || [])];
    if (!arquivos.length) return;
    let erros = 0;
    for (const arquivo of arquivos) {
      try {
        await api(
          `/attachments?pasta=${encodeURIComponent(pastaId)}&papel=${encodeURIComponent(
            papel
          )}&name=${encodeURIComponent(arquivo.name)}`,
          { method: 'POST', body: await arquivo.arrayBuffer(), raw: true }
        );
      } catch {
        erros += 1;
      }
    }
    if (erros) toast(plural(erros, '1 arquivo não entrou', '{n} arquivos não entraram'), 'err');
    else toast(plural(arquivos.length, '1 arquivo entrou', '{n} arquivos entraram'), 'ok');
    ctx.switchView('estudos');
  };
  campo.click();
}

function escolherFoto(prof, ctx) {
  const campo = document.createElement('input');
  campo.type = 'file';
  campo.accept = 'image/png,image/jpeg,image/webp';
  campo.onchange = async () => {
    const arquivo = campo.files?.[0];
    if (!arquivo) return;
    try {
      await api(`/professores/${prof.id}/foto`, {
        method: 'POST',
        body: await arquivo.arrayBuffer(),
        raw: true
      });
      ctx.switchView('estudos');
    } catch (err) {
      toast(err.message || t('não deu pra guardar a foto'), 'err');
    }
  };
  campo.click();
}
/**
 * O que o retrato pedia e o material não tinha.
 *
 * Fica visível de propósito: um simulado que calou sobre um tema de 8% parece
 * dizer que aquele tema não cai. Dizer o que faltou é o que transforma um buraco
 * numa instrução — anexe isto aqui.
 */
function faltouEmHtml(faltou) {
  if (!faltou?.length) return '';
  return `<div class="aviso warn est-faltou">
    <b>${t('Ficou de fora por falta de material')}</b>
    <ul class="ret-lista">${faltou.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
  </div>`;
}

function desenharSimulado(j) {
  // O cabeçalho da prova é o que o professor escreveria em cima da folha, não
  // código: num `<pre>` sem regra de estilo ele saía em monoespaçada e sem
  // quebra de linha, e um cabeçalho comprido rolava a tela pro lado.
  return `${j.instrucoes ? `<p class="est-instrucoes">${escapeHtml(j.instrucoes)}</p>` : ''}
    ${(j.questoes || [])
      .map(
        (q) => `<div class="est-questao">
          <div class="est-q-topo">
            <b>${formatarNumero(q.n)}.</b>
            <span class="tag prob-${escapeHtml(q.probabilidade)}">${escapeHtml(
              (PROBABILIDADE[q.probabilidade] || (() => q.probabilidade))()
            )}</span>
            ${q.tema ? `<span class="meta">${escapeHtml(q.tema)}</span>` : ''}
            ${q.valor ? `<span class="meta">${formatarNumero(q.valor)}</span>` : ''}
          </div>
          <p class="est-enunciado">${escapeHtml(q.enunciado)}</p>
          ${
            q.alternativas?.length
              ? `<ul class="est-alts">${q.alternativas
                  .map((a) => `<li>${escapeHtml(a)}</li>`)
                  .join('')}</ul>`
              : ''
          }
          <details class="est-gabarito">
            <summary>${t('ver a resposta')}</summary>
            <p>${escapeHtml(q.gabarito)}</p>
            ${q.porque ? `<p class="meta">${t('por que esta questão')}: ${escapeHtml(q.porque)}</p>` : ''}
            ${q.fonte ? `<p class="ret-cita">${escapeHtml(q.fonte)}</p>` : ''}
          </details>
        </div>`
      )
      .join('')}`;
}

function desenharGuia(j) {
  return `${(j.temas || [])
    .map(
      (tema) => `<div class="ret-linha">
        <div class="ret-rot"><b>${escapeHtml(tema.tema)}</b>
          ${tema.como_ele_cobra ? `<span class="meta">${escapeHtml(tema.como_ele_cobra)}</span>` : ''}
        </div>
        <div class="progress"><span style="width:${Math.min(
          Math.round((tema.peso || 0) * 100),
          100
        )}%"></span></div>
        <span class="ret-num">${porcento(tema.peso)}</span>
        ${tema.por_que_cai ? `<p class="meta">${escapeHtml(tema.por_que_cai)}</p>` : ''}
        <ul class="ret-lista">${(tema.o_que_saber || [])
          .map((x) => `<li>${escapeHtml(x)}</li>`)
          .join('')}</ul>
        ${tema.fonte ? `<p class="ret-cita">${escapeHtml(tema.fonte)}</p>` : ''}
      </div>`
    )
    .join('')}
    ${
      j.pule?.length
        ? `<div class="aviso ok est-pule"><b>${t('Dá pra pular')}</b>
             <ul class="ret-lista">${j.pule
               .map(
                 (p) =>
                   `<li>${escapeHtml(p.tema)}${
                     p.por_que ? ` — <span class="muted">${escapeHtml(p.por_que)}</span>` : ''
                   }</li>`
               )
               .join('')}</ul></div>`
        : ''
    }`;
}

function desenharCartoes(j) {
  return `<div class="row">
      <button data-act="revisar" class="primary" type="button">
        <span data-icon="play" data-size="16"></span> ${t('Mandar pra revisão')}
      </button>
      <span class="meta">${plural((j.cartoes || []).length, '1 cartão', '{n} cartões')}</span>
    </div>
    <div class="est-cartoes">${(j.cartoes || [])
      .map(
        (c) => `<details class="est-cartao">
          <summary>${escapeHtml(c.frente)}</summary>
          <p>${escapeHtml(c.verso)}</p>
          ${c.tema ? `<p class="meta">${escapeHtml(c.tema)}</p>` : ''}
        </details>`
      )
      .join('')}</div>`;
}

function desenharResumo(j) {
  return `${j.abertura ? `<p class="est-abertura">${escapeHtml(j.abertura)}</p>` : ''}
    ${(j.secoes || [])
      .map(
        (s) => `<div class="est-secao">
          <h4>${escapeHtml(s.titulo)}</h4>
          <ul class="ret-lista">${(s.pontos || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
          ${s.fonte ? `<p class="ret-cita">${escapeHtml(s.fonte)}</p>` : ''}
        </div>`
      )
      .join('')}
    ${
      j.termos?.length
        ? `<div class="grupo-rot">${t('Termos')}</div>
           <dl class="est-termos">${j.termos
             .map(
               (x) => `<dt>${escapeHtml(x.termo)}</dt><dd>${escapeHtml(x.definicao)}</dd>`
             )
             .join('')}</dl>`
        : ''
    }`;
}

/**
 * O mapa mental, desenhado em SVG aqui mesmo.
 *
 * Sem biblioteca: um mapa mental é um círculo no meio e ramos em volta, e a
 * conta que põe cada ramo no lugar cabe em dez linhas. Trazer uma biblioteca de
 * grafo pra isso seria a primeira dependência do projeto — por um desenho.
 */
function desenharMapa(j) {
  const ramos = (j.ramos || []).slice(0, 8);
  if (!ramos.length) return '';

  // O tamanho sai do conteúdo, não de um número fixo: com seis ramos de cinco
  // folhas cada, uma caixa pequena faz as folhas de um ramo entrarem por cima do
  // ramo vizinho — que foi exatamente o que aconteceu na primeira versão.
  const maisFolhas = Math.max(...ramos.map((r) => (r.folhas || []).length), 0);
  const L = 900;
  const A = Math.max(520, 260 + maisFolhas * 20 + ramos.length * 26);
  const cx = L / 2;
  const cy = A / 2;
  const raio = Math.min(cx - 210, cy - 90);

  const cores = ['indigo', 'teal', 'amber', 'rose', 'violet', 'sky', 'lime', 'slate'];
  // Uma volta inteira dividida pelos ramos, começando no topo. Metade de um
  // passo de deslocamento evita que o primeiro ramo caia exatamente em cima do
  // centro quando são dois ou quatro.
  const passo = (Math.PI * 2) / ramos.length;

  const quebrar = (frase, porLinha) => {
    const linhas = [];
    let atual = '';
    for (const palavra of String(frase).split(/\s+/)) {
      if ((`${atual} ${palavra}`).trim().length > porLinha && atual) {
        linhas.push(atual);
        atual = palavra;
      } else {
        atual = (`${atual} ${palavra}`).trim();
      }
    }
    if (atual) linhas.push(atual);
    return linhas;
  };

  const partes = ramos.map((ramo, i) => {
    const ang = i * passo + passo / 2 - Math.PI / 2;
    const x = cx + Math.cos(ang) * raio;
    const y = cy + Math.sin(ang) * raio;
    const cor = `var(--${cores[i % cores.length]})`;
    const caminho = `M ${cx} ${cy} Q ${(cx + x) / 2 + Math.cos(ang) * 24} ${
      (cy + y) / 2 + Math.sin(ang) * 24
    } ${x} ${y}`;

    // Ramo à esquerda escreve pra esquerda; ramo em cima ou embaixo escreve
    // centralizado, senão o texto atravessa o meio do desenho.
    const eixo = Math.cos(ang);
    const ancora = eixo < -0.35 ? 'end' : eixo > 0.35 ? 'start' : 'middle';
    const dx = ancora === 'end' ? -14 : ancora === 'start' ? 14 : 0;
    const paraCima = Math.sin(ang) < -0.35 && ancora === 'middle';
    const base = y + (ancora === 'middle' ? (paraCima ? -30 : 26) : 5);
    const folhas = (ramo.folhas || [])
      .slice(0, 6)
      .map(
        (folha, k) =>
          `<text x="${x + dx}" y="${base + 20 + k * 18}" text-anchor="${ancora}"
             class="mapa-folha">${escapeHtml(folha)}</text>`
      )
      .join('');

    return `<path d="${caminho}" stroke="${cor}" class="mapa-traco" />
      <circle cx="${x}" cy="${y}" r="${5 + Math.round((ramo.peso || 0) * 12)}" fill="${cor}" />
      <text x="${x + dx}" y="${base}" text-anchor="${ancora}" class="mapa-ramo">${escapeHtml(
        ramo.nome
      )}</text>
      ${folhas}`;
  });

  // O centro cabe em até três linhas dentro do círculo; o raio acompanha.
  const todasDoCentro = quebrar(j.centro || '', 16);
  const linhasDoCentro = todasDoCentro.slice(0, 3);
  // Vírgula pendurada no fim quando o resto não coube: "Célula, metabolismo,
  // genética," anuncia um quarto item que não está lá.
  if (linhasDoCentro.length && todasDoCentro.length > linhasDoCentro.length) {
    const ultima = linhasDoCentro.length - 1;
    linhasDoCentro[ultima] = `${linhasDoCentro[ultima].replace(/[,;·\s]+$/, '')}…`;
  }
  const raioDoCentro = 34 + linhasDoCentro.length * 9;

  return `<div class="est-mapa">
    <svg viewBox="0 0 ${L} ${A}" role="img" aria-label="${t('mapa mental da matéria')}">
      ${partes.join('')}
      <circle cx="${cx}" cy="${cy}" r="${raioDoCentro}" class="mapa-centro" />
      ${linhasDoCentro
        .map(
          (linha, k) =>
            `<text x="${cx}" y="${
              cy + 5 - ((linhasDoCentro.length - 1) * 16) / 2 + k * 16
            }" text-anchor="middle" class="mapa-centro-txt">${escapeHtml(linha)}</text>`
        )
        .join('')}
    </svg>
  </div>`;
}

function desenharLinha(j) {
  const marcos = j.marcos || [];
  if (!marcos.length) return `<p class="meta">${t('o material não tem nada em sequência')}</p>`;
  return `<ol class="est-linha">${marcos
    .map(
      (m) => `<li>
        <span class="est-quando">${escapeHtml(m.quando)}</span>
        <div>
          <b>${escapeHtml(m.o_que)}</b>
          ${m.porque_importa ? `<p class="meta">${escapeHtml(m.porque_importa)}</p>` : ''}
          ${m.fonte ? `<p class="ret-cita">${escapeHtml(m.fonte)}</p>` : ''}
        </div>
      </li>`
    )
    .join('')}</ol>`;
}

function desenharPodcast(j) {
  const falas = j.falas || [];
  return `<div class="row">
      <button data-act="ouvir" class="primary" type="button">
        <span data-icon="speaker" data-size="16"></span> ${t('Ouvir')}
      </button>
      <button data-act="parar" class="ghost" type="button" hidden>
        <span data-icon="stop" data-size="16"></span> ${t('Parar')}
      </button>
      <span class="meta">${plural(falas.length, '1 fala', '{n} falas')}</span>
    </div>
    <div class="est-falas">${falas
      .map(
        (f, i) =>
          `<p class="est-fala quem-${escapeHtml(f.quem)}" data-fala="${i}">${escapeHtml(f.texto)}</p>`
      )
      .join('')}</div>`;
}

/**
 * Lê a conversa em voz alta, com duas vozes.
 *
 * Usa o `speechSynthesis` do próprio navegador — o mesmo que o modo voz do app
 * já usa. Não é a voz do NotebookLM, e não finge ser: é de graça, funciona sem
 * rede e sai na hora, o que pra ouvir no caminho da escola é o que importa.
 */
function ligarPodcast(host, j) {
  const ouvir = host.querySelector('[data-act=ouvir]');
  if (!ouvir || !j.falas?.length) return;
  const parar = host.querySelector('[data-act=parar]');

  if (!('speechSynthesis' in window)) {
    ouvir.disabled = true;
    ouvir.title = t('este navegador não lê em voz alta');
    return;
  }

  const vozes = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('pt'));
  const escolher = (quem) => vozes[quem === 'a' ? 0 : 1 % Math.max(vozes.length, 1)] || vozes[0] || null;

  let tocando = false;
  const limpar = () => {
    tocando = false;
    speechSynthesis.cancel();
    ouvir.hidden = false;
    parar.hidden = true;
    for (const p of host.querySelectorAll('.est-fala')) p.classList.remove('falando');
  };

  ouvir.onclick = async () => {
    tocando = true;
    ouvir.hidden = true;
    parar.hidden = false;
    for (const [i, fala] of j.falas.entries()) {
      if (!tocando) return;
      const alvo = host.querySelector(`[data-fala="${i}"]`);
      alvo?.classList.add('falando');
      alvo?.scrollIntoView({ block: 'nearest' });
      await new Promise((resolve) => {
        const dito = new SpeechSynthesisUtterance(fala.texto);
        const voz = escolher(fala.quem);
        if (voz) dito.voice = voz;
        // Quem pergunta fala um tom acima: com uma voz só, as duas pessoas
        // viram uma pessoa lendo, e a conversa perde a graça toda.
        dito.pitch = fala.quem === 'a' ? 1.15 : 0.92;
        dito.rate = 1.02;
        dito.onend = resolve;
        dito.onerror = resolve;
        speechSynthesis.speak(dito);
      });
      alvo?.classList.remove('falando');
    }
    limpar();
  };
  parar.onclick = limpar;
}

/**
 * Quiz de múltipla escolha, corrigido no clique.
 *
 * O gabarito sozinho não ensina: o que ensina é saber por que a errada que você
 * escolheu parecia certa. Por isso cada questão traz também o erro comum.
 */
function desenharQuiz(j) {
  const questoes = j.questoes || [];
  return `<div class="row">
      <span class="meta">${plural(questoes.length, '1 questão', '{n} questões')}</span>
      <span class="grow"></span>
      <span id="quiz-placar" class="tag"></span>
    </div>
    <div class="est-quiz">${questoes
      .map(
        (q, i) => `<div class="est-questao" data-quiz="${i}" data-certa="${q.certa}">
          <div class="est-q-topo"><b>${formatarNumero(i + 1)}.</b>
            ${q.tema ? `<span class="meta">${escapeHtml(q.tema)}</span>` : ''}
          </div>
          <p class="est-enunciado">${escapeHtml(q.enunciado)}</p>
          <div class="quiz-alts">${q.alternativas
            .map(
              (alt, k) =>
                `<button type="button" class="quiz-alt" data-alt="${k}">
                  <span class="quiz-letra">${String.fromCharCode(97 + k)}</span>
                  <span>${escapeHtml(alt)}</span>
                </button>`
            )
            .join('')}</div>
          <div class="quiz-porque" hidden>
            ${q.porque ? `<p>${escapeHtml(q.porque)}</p>` : ''}
            ${q.erro_comum ? `<p class="meta">${escapeHtml(q.erro_comum)}</p>` : ''}
            ${q.fonte ? `<p class="ret-cita">${escapeHtml(q.fonte)}</p>` : ''}
          </div>
        </div>`
      )
      .join('')}</div>`;
}

function ligarQuiz(host, j) {
  const bloco = host.querySelector('.est-quiz');
  if (!bloco) return;
  const placar = host.querySelector('#quiz-placar');
  const total = (j.questoes || []).length;
  let respondidas = 0;
  let acertos = 0;

  for (const caixa of bloco.querySelectorAll('[data-quiz]')) {
    const certa = Number(caixa.dataset.certa);
    for (const botao of caixa.querySelectorAll('.quiz-alt')) {
      botao.onclick = () => {
        // Responde uma vez: poder trocar depois de ver a resposta transforma o
        // quiz num gabarito com passos a mais.
        if (caixa.dataset.feito) return;
        caixa.dataset.feito = '1';
        const escolha = Number(botao.dataset.alt);
        respondidas += 1;
        if (escolha === certa) acertos += 1;
        for (const b of caixa.querySelectorAll('.quiz-alt')) {
          const k = Number(b.dataset.alt);
          if (k === certa) b.classList.add('certa');
          else if (k === escolha) b.classList.add('errada');
          b.disabled = true;
        }
        caixa.querySelector('.quiz-porque').hidden = false;
        placar.textContent = t('{acertos} de {respondidas}', {
          acertos: formatarNumero(acertos),
          respondidas: formatarNumero(respondidas)
        });
        if (respondidas === total) {
          placar.classList.add(acertos / total >= 0.7 ? 'ok' : 'warn');
        }
      };
    }
  }
}

/** O infográfico: uma página só, desenhada com o que já existe no CSS. */
function desenharInfografico(j) {
  return `<div class="est-info">
    <h2>${escapeHtml(j.titulo || '')}</h2>
    ${j.linha_fina ? `<p class="info-fina">${escapeHtml(j.linha_fina)}</p>` : ''}
    ${
      j.numeros?.length
        ? `<div class="info-numeros">${j.numeros
            .map(
              (n) =>
                `<div><b>${escapeHtml(n.valor)}</b><span>${escapeHtml(n.rotulo)}</span></div>`
            )
            .join('')}</div>`
        : ''
    }
    <div class="info-blocos">${(j.blocos || [])
      .map(
        (b) => `<div class="info-bloco">
          <h3>${escapeHtml(b.titulo)}</h3>
          <p>${escapeHtml(b.texto)}</p>
          <div class="progress"><span style="width:${Math.min(
            Math.round((b.peso || 0) * 100),
            100
          )}%"></span></div>
        </div>`
      )
      .join('')}</div>
    ${
      j.sequencia?.length
        ? `<div class="info-seq">${j.sequencia
            .map((x) => `<span>${escapeHtml(x)}</span>`)
            .join('<i aria-hidden="true">→</i>')}</div>`
        : ''
    }
    ${
      j.lembre?.length
        ? `<div class="aviso warn info-lembre"><b>${t('Não esqueça')}</b>
             <ul class="ret-lista">${j.lembre
               .map((x) => `<li>${escapeHtml(x)}</li>`)
               .join('')}</ul></div>`
        : ''
    }
  </div>`;
}

/**
 * Slides: um por vez, com as setas do teclado.
 *
 * Imprimir sai pelo próprio navegador — o CSS de impressão põe um slide por
 * página. Exportar pra PowerPoint exigiria montar um zip OOXML na mão, e o PDF
 * resolve o que ele quer fazer com isso (abrir no celular e revisar).
 */
function desenharSlides(j) {
  const slides = j.slides || [];
  return `<div class="row est-slides-topo">
      <button data-slide="-1" class="icon" type="button" title="${t('slide anterior')}"
        aria-label="${t('slide anterior')}"><span data-icon="chevron" data-size="18"></span></button>
      <span id="slide-conta" class="tag"></span>
      <button data-slide="1" class="icon vira" type="button" title="${t('próximo slide')}"
        aria-label="${t('próximo slide')}"><span data-icon="chevron" data-size="18"></span></button>
      <span class="grow"></span>
      <button data-act="imprimir" class="ghost" type="button">
        <span data-icon="download" data-size="16"></span> ${t('Imprimir em PDF')}
      </button>
    </div>
    <div class="est-slides">${slides
      .map(
        (s, i) => `<article class="est-slide" data-i="${i}"${i ? ' hidden' : ''}>
          <h3>${escapeHtml(s.titulo)}</h3>
          <ul>${(s.pontos || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
          ${s.nota ? `<p class="meta slide-nota">${escapeHtml(s.nota)}</p>` : ''}
          ${s.fonte ? `<p class="ret-cita">${escapeHtml(s.fonte)}</p>` : ''}
        </article>`
      )
      .join('')}</div>`;
}

function ligarSlides(host, j) {
  const caixa = host.querySelector('.est-slides');
  if (!caixa) return;
  const slides = [...caixa.querySelectorAll('.est-slide')];
  const conta = host.querySelector('#slide-conta');
  let atual = 0;

  const mostrar = (i) => {
    atual = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, k) => {
      s.hidden = k !== atual;
    });
    conta.textContent = t('{n} de {total}', {
      n: formatarNumero(atual + 1),
      total: formatarNumero(slides.length)
    });
    for (const b of host.querySelectorAll('[data-slide]')) {
      b.disabled = Number(b.dataset.slide) < 0 ? atual === 0 : atual === slides.length - 1;
    }
  };

  for (const botao of host.querySelectorAll('[data-slide]')) {
    botao.onclick = () => mostrar(atual + Number(botao.dataset.slide));
  }
  caixa.tabIndex = 0;
  caixa.onkeydown = (ev) => {
    if (ev.key === 'ArrowRight') mostrar(atual + 1);
    if (ev.key === 'ArrowLeft') mostrar(atual - 1);
  };
  host.querySelector('[data-act=imprimir]').onclick = () => {
    // Todos visíveis só durante a impressão: o CSS de impressão quebra a página
    // entre um e outro, e depois a tela volta a mostrar um por vez.
    document.body.classList.add('imprimindo-slides');
    slides.forEach((s) => {
      s.hidden = false;
    });
    const voltar = () => {
      document.body.classList.remove('imprimindo-slides');
      mostrar(atual);
      removeEventListener('afterprint', voltar);
    };
    addEventListener('afterprint', voltar);
    print();
  };
  mostrar(0);
}

/**
 * Nome novo escrito no lugar onde a coisa vai ficar, e não numa caixa por cima.
 *
 * Diálogo de navegador trava a janela e, num app sem barra de endereço, parece
 * defeito do sistema. Aqui o campo nasce na lista, com o nome sugerido já
 * selecionado: Enter confirma, Esc desiste, e quem só queria ver a lista não
 * precisou fechar nada.
 */
function pedirNome(host, { valor = '', dica = '', aoConfirmar }) {
  const linha = document.createElement('div');
  linha.className = 'est-batismo';
  linha.innerHTML = `<input type="text" aria-label="${dica || t('nome')}" placeholder="${escapeHtml(
    dica
  )}" />`;
  host.appendChild(linha);
  const campo = linha.querySelector('input');
  campo.value = valor;
  campo.focus();
  campo.select();

  let fechado = false;
  const sair = () => {
    if (fechado) return;
    fechado = true;
    linha.remove();
  };
  campo.onkeydown = (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      return sair();
    }
    if (ev.key !== 'Enter') return;
    const nome = campo.value.trim();
    sair();
    if (nome) aoConfirmar(nome);
  };
  // Clicar fora é desistir, não confirmar: confirmar o que a pessoa não terminou
  // de escrever cria pasta com nome pela metade.
  campo.onblur = sair;
  return linha;
}

/**
 * O formulário do professor novo, com a escolha da organização.
 *
 * A escolha aparece aqui e não nos Ajustes porque ela é por professor: a escola
 * dele pode ser de trimestre e o curso de fora, de módulo.
 */
function formularioDeProfessor(host, ctx) {
  if (host.dataset.aberto === '1') {
    host.innerHTML = '';
    host.dataset.aberto = '0';
    return;
  }
  host.dataset.aberto = '1';
  host.innerHTML = `
    <div class="card">
      <h3>${t('Professor novo')}</h3>
      <label class="field">${t('Nome')} <input id="pf-nome" placeholder="${t('Marcos')}" /></label>
      <label class="field">${t('Matéria')} <input id="pf-materia" placeholder="${t('Biologia')}" /></label>
      <label class="field">${t('Cor')}<div id="pf-cor"></div></label>
      <div class="grupo-rot">${t('Como você quer organizar as provas dele')}</div>
      <div id="pf-org" class="org-lista"></div>
      <div class="row">
        <button id="pf-criar" class="primary" type="button">
          <span data-icon="check"></span> ${t('Criar professor')}
        </button>
      </div>
    </div>`;

  const escolhida = { id: 'pastas' };
  const lista = host.querySelector('#pf-org');
  const pintarOrg = () => {
    lista.innerHTML = ORGANIZACOES.map(
      (o) => `<button type="button" class="org-op${o.id === escolhida.id ? ' sel' : ''}"
        data-org="${o.id}" aria-pressed="${o.id === escolhida.id}">
        <b>${escapeHtml(o.nome())}</b><span class="meta">${escapeHtml(o.dica())}</span>
      </button>`
    ).join('');
    for (const btn of lista.querySelectorAll('[data-org]')) {
      btn.onclick = () => {
        escolhida.id = btn.dataset.org;
        pintarOrg();
      };
    }
  };
  pintarOrg();

  const cor = iconPicker(host.querySelector('#pf-cor'), { icon: 'book', color: 'indigo' });

  host.querySelector('#pf-criar').onclick = async () => {
    const nome = host.querySelector('#pf-nome').value.trim();
    if (!nome) return toast(t('o professor precisa de um nome'), 'err');
    const org = acharOrganizacao(escolhida.id);
    const novo = await api('/professores', {
      method: 'POST',
      body: {
        nome,
        materia: host.querySelector('#pf-materia').value.trim() || null,
        cor: cor.color,
        organizacao: org.id,
        pastas: org.semear()
      }
    });
    aqui.professorId = novo.id;
    aqui.pastaId = novo.pastas[0]?.id || null;
    ctx.switchView('estudos');
    toast(t('professor criado'), 'ok');
  };

  paintIcons(host);
}
