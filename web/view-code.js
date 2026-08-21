// A tela Programar: a conversa de um lado, o que a IA fez do outro.
//
// O que separa esta tela da de conversa é o painel da direita. Quando quem
// responde é uma IA de linha de comando, o texto da resposta é a menor parte do
// que aconteceu: entre a pergunta e a resposta ela leu doze arquivos, escreveu
// três e rodou os testes duas vezes. Nada disso aparecia — de cá se via um
// cursor parado por dois minutos, sem saber se tinha travado. Cada evento
// `ferramenta` do stream vira uma linha aqui na hora em que chega, e a saída do
// comando fica a um toque.

import { api, stream, state, chatModels, escapeHtml, toast } from './core.js';
import { icon } from './icons.js';
import { renderMarkdown, wireCodeCopy } from './md.js';
import { statsLine } from './format.js';
import { t, plural, formatarNumero } from './i18n.js';

// O que sobrevive à troca de tela. `switchView` redesenha o painel inteiro toda
// vez que se volta pra cá, e sem isto a conversa e a lista do que a IA fez
// recomeçariam do zero a cada ida à tela de projetos e volta.
// A conversa de cada projeto, guardada por projeto. Sem isto a tela abria uma
// conversa nova a cada recarregamento: o painel de trabalho voltava vazio e o
// que a IA tinha feito ficava guardado na conversa anterior, invisível.
const CONVERSAS = 'nuvo.programar.conversas';

function conversasGuardadas() {
  try {
    return JSON.parse(localStorage.getItem(CONVERSAS) || '{}');
  } catch {
    return {};
  }
}

function guardarConversa(projetoId, chatId) {
  if (!projetoId) return;
  const mapa = conversasGuardadas();
  if (chatId) mapa[projetoId] = chatId;
  else delete mapa[projetoId];
  try {
    localStorage.setItem(CONVERSAS, JSON.stringify(mapa));
  } catch {
    /* navegador com armazenamento bloqueado: a tela só perde a memória disso */
  }
}

const estado = {
  projetoId: '',
  modelo: '',
  chatId: null,
  aba: 'arquivos',
  trabalho: [],
  arquivoAberto: null,
  painelAberto: false,
  transmitindo: null,
  anexos: []
};

/**
 * A frase de cada passo, escrita na língua da tela.
 *
 * O servidor manda a ação e o complemento separados justamente pra isto: ele
 * monta um `titulo` em português pra quem não souber montar, mas não sabe em
 * que idioma a tela está. Sem isto, "leu soma.mjs" aparecia em português no
 * meio de um painel em espanhol.
 */
function rotuloDoPasso(passo) {
  const alvo = passo.alvo || '';
  switch (passo.acao) {
    case 'ler':
      return t('leu {alvo}', { alvo: alvo || t('um arquivo') });
    case 'escrever':
      return t('escreveu {alvo}', { alvo: alvo || t('um arquivo') });
    case 'editar':
      return t('editou {alvo}', { alvo: alvo || t('um arquivo') });
    case 'rodar':
      return t('rodou {alvo}', { alvo: alvo || t('um comando') });
    case 'buscar':
      return t('buscou {alvo}', { alvo: alvo || t('no projeto') });
    default:
      // Ação que este app não conhece: o texto do servidor é melhor que nada,
      // e é o único que sabe o que aconteceu.
      return passo.titulo || t('usou {alvo}', { alvo: alvo || t('uma ferramenta') });
  }
}

const ICONE_DA_ACAO = {
  ler: 'file',
  escrever: 'save',
  editar: 'edit',
  rodar: 'play',
  buscar: 'search',
  outro: 'spark'
};

/**
 * Põe o evento de trabalho sempre na mesma forma `{ tipo, ... }`.
 *
 * O adaptador de CLI emite `{ evento: {...} }` e o servidor repassa; se um dia
 * ele repassar o tipo já na raiz do evento SSE (`{ type: 'ferramenta', ... }`),
 * a tela continua entendendo em vez de ignorar calada no `default` do switch.
 */
export function traduzirEvento(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (ev.evento && typeof ev.evento === 'object') return ev.evento;
  const tipo = ev.tipo || ev.type;
  if (tipo === 'ferramenta' || tipo === 'saida' || tipo === 'fim') return { ...ev, tipo };
  return null;
}

/** Tamanho de arquivo em kB, que é a unidade do resto do app. */
function tamanhoLegivel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1000) return t('{n} B', { n: formatarNumero(n) });
  return t('{n} kB', { n: formatarNumero(n / 1000, { maximumFractionDigits: n < 100_000 ? 1 : 0 }) });
}

/** A lista plana de caminhos vira pasta dentro de pasta. */
export function pastasDaLista(arquivos) {
  const raiz = { pastas: new Map(), arquivos: [] };
  for (const arq of arquivos || []) {
    const partes = String(arq.caminho || '').split('/').filter(Boolean);
    let no = raiz;
    for (const parte of partes.slice(0, -1)) {
      if (!no.pastas.has(parte)) no.pastas.set(parte, { pastas: new Map(), arquivos: [] });
      no = no.pastas.get(parte);
    }
    no.arquivos.push(arq);
  }
  return raiz;
}

// Onde o clipe da tela põe o arquivo anexado. Igual ao `PASTA_DE_ANEXOS` do
// servidor — o caminho que ele devolve começa por aqui.
const PASTA_DE_ANEXOS = '.nuvo/anexos';

export function htmlDaPasta(no, nivel = 0, caminho = '') {
  const pastas = [...no.pastas.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const arquivos = [...no.arquivos].sort((a, b) => String(a.caminho).localeCompare(String(b.caminho)));
  // Só o primeiro andar abre sozinho: um projeto de verdade tem centenas de
  // arquivos, e abrir tudo faz a aba nascer com uma rolagem de dez telas.
  //
  // A exceção é o caminho da pasta de anexos. Ela é o único motivo de o
  // servidor deixar uma pasta com ponto na frente entrar na árvore, e fechada
  // no segundo andar ela escondia justamente o arquivo que a pessoa acabou de
  // anexar: a árvore mostrava `.nuvo` → `anexos` e mais nada.
  const pastasHtml = pastas
    .map(([nome, filho]) => {
      const dentro = caminho ? `${caminho}/${nome}` : nome;
      const doAnexo = PASTA_DE_ANEXOS === dentro || PASTA_DE_ANEXOS.startsWith(`${dentro}/`);
      return `<details class="cd-pasta"${nivel === 0 || doAnexo ? ' open' : ''}>
           <summary><span class="ico">${icon('folder', 16)}</span><span class="cd-nome">${escapeHtml(
             nome
           )}</span></summary>
           <div class="cd-dentro">${htmlDaPasta(filho, nivel + 1, dentro)}</div>
         </details>`;
    })
    .join('');
  const arquivosHtml = arquivos
    .map(
      (arq) =>
        `<button type="button" class="cd-arq" data-caminho="${escapeHtml(arq.caminho)}">
           <span class="ico">${icon('file', 16)}</span>
           <span class="cd-nome">${escapeHtml(String(arq.caminho).split('/').pop())}</span>
           <span class="cd-bytes">${escapeHtml(tamanhoLegivel(arq.bytes))}</span>
         </button>`
    )
    .join('');
  return pastasHtml + arquivosHtml;
}

// Uma linha só com crases fecha o bloco de código do md.js (a cerca de
// fechamento dele é /^\s*```+\s*$/, com qualquer comprimento). Arquivo .md de
// projeto tem essa linha o tempo todo — o README abria cortado na primeira
// delas. Quando o texto tem uma, o destaque sai de cena e o arquivo aparece
// inteiro, que é o que a pessoa abriu pra ver.
const CERCA_SOLTA = /^[ \t]*`{3,}[ \t]*$/m;

function blocoDeCodigo(caminho, texto) {
  const ponto = String(caminho).lastIndexOf('.');
  const lang = ponto > 0 ? String(caminho).slice(ponto + 1).toLowerCase().replace(/[^\w+-]/g, '') : '';
  if (!CERCA_SOLTA.test(texto)) return renderMarkdown(`\`\`\`${lang}\n${texto}\n\`\`\``);
  return `<div class="code">
      <div class="code-head"><span>${escapeHtml(lang || t('texto'))}</span>
        <button class="code-copy" type="button" data-code="${encodeURIComponent(texto)}">${t(
          'copiar'
        )}</button></div>
      <pre><code>${escapeHtml(texto)}</code></pre>
    </div>`;
}

/** A conta do turno que o evento `fim` traz. Parte sem número não vira texto. */
function linhaDoFim({ ms, custo, turnos }) {
  const partes = [];
  if (ms != null) {
    partes.push(
      t('{n} s', {
        n: formatarNumero(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      })
    );
  }
  if (turnos) partes.push(plural(turnos, '1 ida e volta', '{n} idas e voltas'));
  if (custo) {
    partes.push(
      t('custou US$ {valor}', {
        valor: formatarNumero(custo, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
      })
    );
  }
  return partes.join(' · ');
}

/** As IAs que sabem mexer em arquivo primeiro: são as de linha de comando. */
function iasParaProgramar() {
  const daLinha = new Set(state.providers.filter((p) => p.kind === 'cli').map((p) => p.id));
  // `passoAPasso` vem do servidor e diz quem sabe contar o que está fazendo. O
  // `gemini` é CLI e mexe em arquivo, mas não fala JSONL: sem separar os dois,
  // escolhê-lo aqui deixava o painel de Trabalho vazio pra sempre.
  const contam = new Set(state.providers.filter((p) => p.passoAPasso).map((p) => p.id));
  const doId = (ref) => ref.slice(0, ref.indexOf(':'));
  return chatModels()
    .map((m) => ({ ...m, cli: daLinha.has(doId(m.ref)), passos: contam.has(doId(m.ref)) }))
    .sort((a, b) => Number(b.passos) - Number(a.passos) || Number(b.cli) - Number(a.cli));
}

function opcoesDeIa(modelos, escolhido) {
  const grupo = (lista, rotulo) =>
    lista.length
      ? `<optgroup label="${escapeHtml(rotulo)}">${lista
          .map(
            (m) =>
              `<option value="${escapeHtml(m.ref)}"${m.ref === escolhido ? ' selected' : ''}>${escapeHtml(
                m.label
              )}</option>`
          )
          .join('')}</optgroup>`
      : '';
  return (
    grupo(modelos.filter((m) => m.passos), t('Mexem nos arquivos e mostram o passo a passo')) +
    grupo(modelos.filter((m) => m.cli && !m.passos), t('Mexem nos arquivos, sem passo a passo')) +
    grupo(modelos.filter((m) => !m.cli), t('Só conversam'))
  );
}

function avisoDeTela(el, titulo, texto, rotulo, aoClicar) {
  el.className = `view panel${el.classList.contains('entra') ? ' entra' : ''}`;
  el.innerHTML = `<div class="panel-inner">
      <h2><span class="ico">${icon('code', 19)}</span> ${escapeHtml(t('Programar'))}</h2>
      <p class="hint">${escapeHtml(
        t('A IA mexe nos arquivos de uma pasta sua, e aqui você vê tudo que ela faz.')
      )}</p>
      <div class="card falta">
        <div><h3>${escapeHtml(titulo)}</h3><p>${escapeHtml(texto)}</p></div>
        <button id="cd-saida-daqui" class="primary" type="button">${escapeHtml(rotulo)}</button>
      </div>
    </div>`;
  el.querySelector('#cd-saida-daqui').onclick = aoClicar;
}

export async function renderCode(el, { switchView }) {
  // `switchView` redesenha a tela toda vez que se volta pra cá, e a troca de
  // idioma também. No meio de uma resposta isso arrancaria da página o nó que o
  // stream está preenchendo, e o resto do texto cairia no vazio.
  if (estado.transmitindo) return;

  const projetos = state.projects.filter((p) => p.workdir);
  if (!projetos.length) {
    return avisoDeTela(
      el,
      t('Falta dizer em qual pasta'),
      t('Esta tela precisa de um projeto com pasta de trabalho: é ela que a IA vai ler e alterar.'),
      t('Criar projeto'),
      () => switchView('projects')
    );
  }

  const modelos = iasParaProgramar();
  if (!modelos.length) {
    return avisoDeTela(
      el,
      t('Nenhuma IA ligada'),
      t('Para programar aqui, ligue uma IA — as de linha de comando são as que sabem mexer em arquivo.'),
      t('Ligar uma IA'),
      () => switchView('providers')
    );
  }

  if (!projetos.some((p) => p.id === estado.projetoId)) estado.projetoId = projetos[0].id;
  // Depois de recarregar a página o `estado` volta zerado: a conversa do
  // projeto é reencontrada aqui, e é ela que traz o painel de trabalho de volta.
  if (!estado.chatId) estado.chatId = conversasGuardadas()[estado.projetoId] || null;
  if (!modelos.some((m) => m.ref === estado.modelo)) {
    estado.modelo = (modelos.find((m) => m.passos) || modelos.find((m) => m.cli) || modelos[0]).ref;
  }

  el.className = `view code-tela${el.classList.contains('entra') ? ' entra' : ''}`;
  el.innerHTML = `
    <div class="code-topo">
      <select id="cd-projeto" title="${t('em qual pasta')}" aria-label="${t('em qual pasta')}">
        ${projetos
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}"${p.id === estado.projetoId ? ' selected' : ''}>${escapeHtml(
                p.name
              )}</option>`
          )
          .join('')}
      </select>
      <select id="cd-modelo" title="${t('qual IA responde')}" aria-label="${t('qual IA responde')}">
        ${opcoesDeIa(modelos, estado.modelo)}
      </select>
    </div>

    <div class="code-corpo">
      <div class="code-conversa">
        <div id="cd-msgs" class="cd-msgs"></div>
        <div id="cd-anexos" class="cd-anexos" hidden></div>
        <form id="cd-composer" class="cd-composer">
          <input id="cd-arquivo" type="file" multiple hidden />
          <button id="cd-anexar" class="icon" type="button" title="${t('Anexar arquivo')}"
            aria-label="${t('Anexar arquivo')}">${icon('paperclip', 19)}</button>
          <textarea id="cd-input" rows="1" placeholder="${t(
            'Peça uma mudança no código'
          )}"></textarea>
          <button id="cd-enviar" class="primary" type="submit" title="${t('enviar')}" aria-label="${t(
            'enviar'
          )}">${icon('arrowUp', 20)}</button>
          <button id="cd-parar" class="icon" type="button" hidden title="${t('parar')}" aria-label="${t(
            'parar a resposta'
          )}">${icon('stop', 18)}</button>
        </form>
      </div>

      <aside id="cd-painel" class="code-painel">
        <div class="code-faixa">
          <div class="segmentado" role="tablist">
            <button type="button" role="tab" data-aba="arquivos">${t('Arquivos')}</button>
            <button type="button" role="tab" data-aba="mudancas">${t('Mudanças')}</button>
            <button type="button" role="tab" data-aba="trabalho">${t(
              'Trabalho'
            )}<span id="cd-conta" class="cd-conta"></span></button>
          </div>
          <button id="cd-abrir" class="icon cd-abrir" type="button" aria-expanded="false"
            title="${t('abrir o painel')}" aria-label="${t('abrir o painel')}">${icon('chevron', 20)}</button>
        </div>
        <div id="cd-conteudo" class="code-conteudo"></div>
      </aside>
    </div>`;

  const msgs = el.querySelector('#cd-msgs');
  const conteudo = el.querySelector('#cd-conteudo');
  const painel = el.querySelector('#cd-painel');
  const campo = el.querySelector('#cd-input');
  const btnEnviar = el.querySelector('#cd-enviar');
  const btnParar = el.querySelector('#cd-parar');
  const barraAnexos = el.querySelector('#cd-anexos');
  const campoArquivo = el.querySelector('#cd-arquivo');
  const btnAnexar = el.querySelector('#cd-anexar');

  const projeto = () => `projeto=${encodeURIComponent(estado.projetoId)}`;
  const descer = () => {
    msgs.scrollTop = msgs.scrollHeight;
  };

  // ------------------------------------------------------------- o painel

  const marcarAbas = () => {
    for (const btn of el.querySelectorAll('.code-faixa [data-aba]')) {
      const sel = btn.dataset.aba === estado.aba;
      btn.classList.toggle('sel', sel);
      btn.setAttribute('aria-selected', String(sel));
    }
    // A conta é de ferramenta, não de linha: a linha do `fim` é o rodapé da
    // corrida e contá-la dizia "4 passos" para três arquivos mexidos.
    const passos = estado.trabalho.filter((p) => p.tipo !== 'fim').length;
    el.querySelector('#cd-conta').textContent = passos ? ` ${formatarNumero(passos)}` : '';
  };

  const abrirPainel = (aberto) => {
    estado.painelAberto = aberto;
    painel.classList.toggle('aberto', aberto);
    el.querySelector('#cd-abrir').setAttribute('aria-expanded', String(aberto));
  };

  const falha = (mensagem, refazer) => {
    conteudo.innerHTML = `<div class="aviso err">
        <div>${escapeHtml(mensagem)}</div>
        <button class="ghost" type="button">${t('Tentar de novo')}</button>
      </div>`;
    conteudo.querySelector('button').onclick = refazer;
  };

  async function mostrarArquivo(caminho) {
    estado.arquivoAberto = caminho;
    conteudo.innerHTML = `<p class="cd-esperando">${t('abrindo…')}</p>`;
    try {
      const dado = await api(`/codigo/arquivo?${projeto()}&caminho=${encodeURIComponent(caminho)}`);
      conteudo.innerHTML = `
        <div class="cd-cabeca">
          <button id="cd-voltar" class="ghost" type="button">${icon('chevron', 16)} ${t(
            'Voltar'
          )}</button>
          <span class="cd-caminho" title="${escapeHtml(dado.caminho || caminho)}">${escapeHtml(
            dado.caminho || caminho
          )}</span>
        </div>
        ${dado.truncado ? `<p class="cd-meta">${t('arquivo grande: mostrando só o começo')}</p>` : ''}
        ${
          // O servidor recusa arquivo com byte zero e devolve texto vazio: sem
          // este ramo a tela mostrava um bloco de código em branco, como se o
          // arquivo estivesse vazio.
          dado.binario
            ? `<p class="cd-meta">${t('este arquivo não é de texto, então não dá pra mostrar o conteúdo')}</p>`
            : blocoDeCodigo(dado.caminho || caminho, dado.texto || '')
        }
        <p class="cd-meta">${escapeHtml(tamanhoLegivel(dado.bytes))}</p>`;
      wireCodeCopy(conteudo);
      conteudo.querySelector('#cd-voltar').onclick = () => {
        estado.arquivoAberto = null;
        mostrarAba('arquivos');
      };
    } catch (err) {
      falha(err.message, () => mostrarArquivo(caminho));
    }
  }

  async function desenharArquivos() {
    if (estado.arquivoAberto) return mostrarArquivo(estado.arquivoAberto);
    conteudo.innerHTML = `<p class="cd-esperando">${t('lendo a pasta…')}</p>`;
    try {
      const dado = await api(`/codigo/arvore?${projeto()}`);
      const lista = dado.arquivos || [];
      conteudo.innerHTML = `
        <p class="cd-raiz" title="${escapeHtml(dado.raiz || '')}">${escapeHtml(dado.raiz || '')}</p>
        <div class="cd-arvore">${
          lista.length
            ? htmlDaPasta(pastasDaLista(lista))
            : `<p class="cd-meta">${t('nenhum arquivo de texto nesta pasta')}</p>`
        }</div>
        ${
          dado.cortado
            ? `<p class="cd-meta">${t('a pasta tem mais arquivos do que cabe nesta lista')}</p>`
            : ''
        }`;
      for (const btn of conteudo.querySelectorAll('.cd-arq')) {
        btn.onclick = () => mostrarArquivo(btn.dataset.caminho);
      }
    } catch (err) {
      falha(err.message, desenharArquivos);
    }
  }

  const ESTADOS = {
    novo: () => t('novo'),
    mudou: () => t('mudou'),
    apagado: () => t('apagado')
  };

  async function desenharMudancas() {
    conteudo.innerHTML = `<p class="cd-esperando">${t('vendo o que mudou…')}</p>`;
    try {
      const dado = await api(`/codigo/mudancas?${projeto()}`);
      const lista = dado.arquivos || [];
      // Sem git a resposta traz o motivo: dizer "esta pasta não é um
      // repositório do git" pra um prazo estourado é afirmar algo falso sobre
      // o projeto de quem está olhando.
      // Cada motivo é uma função com o `t()` dentro, e não um texto guardado
      // numa tabela: só assim a frase fica visível pra quem varre o código
      // atrás do que precisa de tradução — foi por ficar fora desse alcance que
      // a tela inteira nasceu sem dicionário.
      const POR_QUE = {
        'sem-repositorio': () => t('esta pasta não é um repositório do git'),
        'sem-git': () => t('o git não está instalado nesta máquina'),
        demorou: () => t('o git demorou demais pra responder nesta pasta'),
        'grande-demais': () => t('esta pasta tem mudanças demais pra listar de uma vez'),
        cancelado: () => t('a consulta foi cancelada'),
        falhou: () => t('não consegui perguntar ao git o que mudou aqui')
      };
      // Quando não há git, o motivo já explica a lista vazia — juntar "nada
      // mudou por enquanto" na frente dele dizia duas coisas que não combinam.
      const semGit = dado.git
        ? ''
        : `<p class="cd-meta">${(POR_QUE[dado.motivo] || POR_QUE.falhou)()}</p>`;
      conteudo.innerHTML =
        semGit +
        (lista.length
          ? `<div class="cd-arvore">${lista
              .map(
                (a) =>
                  `<button type="button" class="cd-arq cd-mud ${escapeHtml(a.estado)}"
                     data-caminho="${escapeHtml(a.caminho)}">
                     <span class="cd-nome">${escapeHtml(a.caminho)}</span>
                     <span class="cd-estado">${escapeHtml((ESTADOS[a.estado] || (() => a.estado))())}</span>
                   </button>`
              )
              .join('')}</div>`
          : dado.git
            ? `<p class="cd-meta">${t('nada mudou por enquanto')}</p>`
            : '');
      for (const btn of conteudo.querySelectorAll('.cd-mud')) {
        // Arquivo apagado não abre: o conteúdo dele não existe mais no disco.
        if (btn.classList.contains('apagado')) continue;
        btn.onclick = () => {
          estado.aba = 'arquivos';
          marcarAbas();
          mostrarArquivo(btn.dataset.caminho);
        };
      }
    } catch (err) {
      falha(err.message, desenharMudancas);
    }
  }

  function desenharTrabalho() {
    if (!estado.trabalho.length) {
      conteudo.innerHTML = `<p class="cd-meta">${t(
        'Aqui aparece cada arquivo que a IA ler ou escrever e cada comando que ela rodar.'
      )}</p>`;
      return;
    }
    conteudo.innerHTML = `<div class="cd-passos">${estado.trabalho
      .map((p, i) => {
        const temSaida = p.texto != null;
        const correndo = !temSaida && p.tipo !== 'fim' && Boolean(estado.transmitindo);
        if (p.tipo === 'fim') {
          return `<div class="cd-passo fim"><span class="ico">${icon('check', 17)}</span>
              <div class="cd-passo-txt"><b>${escapeHtml(t('terminou'))}</b>
              <span class="cd-cmd">${escapeHtml(p.titulo)}</span></div></div>`;
        }
        return `<div class="cd-passo${correndo ? ' correndo' : ''}${p.ok === false ? ' ruim' : ''}">
            <span class="ico">${icon(ICONE_DA_ACAO[p.acao] || ICONE_DA_ACAO.outro, 17)}</span>
            <div class="cd-passo-txt">
              <b>${escapeHtml(rotuloDoPasso(p) || p.arquivo || p.acao || '')}</b>
              ${p.comando ? `<span class="cd-cmd">${escapeHtml(p.comando)}</span>` : ''}
              ${
                temSaida
                  ? `<details class="cd-saida" data-i="${i}"${p.aberto ? ' open' : ''}>
                       <summary>${p.ok === false ? t('deu errado — ver a saída') : t('ver a saída')}</summary>
                       <pre>${escapeHtml(p.texto)}</pre>
                     </details>`
                  : ''
              }
            </div>
          </div>`;
      })
      .join('')}</div>`;
    // O `<details>` recomeça fechado a cada redesenho, e a lista é redesenhada a
    // cada evento que chega: sem guardar o estado, a saída que a pessoa abriu
    // fechava sozinha no passo seguinte.
    for (const det of conteudo.querySelectorAll('.cd-saida')) {
      det.ontoggle = () => {
        const passo = estado.trabalho[Number(det.dataset.i)];
        if (passo) passo.aberto = det.open;
      };
    }
    // Só durante a resposta: fora dela, quem rolou pra cima está lendo uma
    // saída antiga e seria jogado pro fim a cada redesenho.
    if (estado.transmitindo) conteudo.scrollTop = conteudo.scrollHeight;
  }

  function mostrarAba(nome) {
    estado.aba = nome;
    marcarAbas();
    if (nome === 'arquivos') return desenharArquivos();
    if (nome === 'mudancas') return desenharMudancas();
    return desenharTrabalho();
  }

  for (const btn of el.querySelectorAll('.code-faixa [data-aba]')) {
    btn.onclick = () => {
      // Numa tela estreita a faixa é o que sobra do painel: tocar numa aba
      // significa querer ver aquilo, não só escolher e continuar sem nada.
      if (!estado.painelAberto) abrirPainel(true);
      mostrarAba(btn.dataset.aba);
    };
  }
  el.querySelector('#cd-abrir').onclick = () => {
    abrirPainel(!estado.painelAberto);
    if (estado.painelAberto) mostrarAba(estado.aba);
  };

  // ----------------------------------------------------------- a conversa

  function mensagemEl(papel, texto) {
    const no = document.createElement('div');
    no.className = `msg ${papel}`;
    no.innerHTML = `<div class="body"></div><div class="stats oculta"></div>`;
    const corpo = no.querySelector('.body');
    if (papel === 'user') corpo.textContent = texto;
    else corpo.innerHTML = renderMarkdown(texto);
    msgs.appendChild(no);
    descer();
    return no;
  }

  function nota(texto, cls = '') {
    const no = document.createElement('div');
    no.className = `note ${cls}`;
    no.innerHTML = `<span class="ico">${icon(cls === 'err' ? 'alert' : 'spark', 17)}</span><span></span>`;
    no.querySelector('span:last-child').textContent = texto;
    msgs.appendChild(no);
    descer();
    return no;
  }

  function vazio() {
    const p = state.projects.find((x) => x.id === estado.projetoId);
    msgs.innerHTML = `<div class="cd-vazio">
        <span class="ico">${icon('code', 26)}</span>
        <b>${escapeHtml(p ? p.name : '')}</b>
        <span>${escapeHtml(p?.workdir || '')}</span>
        <p>${t('Peça uma mudança. Cada arquivo lido, escrito ou testado aparece no painel.')}</p>
      </div>`;
  }

  async function carregarConversa() {
    msgs.innerHTML = '';
    if (!estado.chatId) return vazio();
    try {
      const dado = await api(`/chats/${estado.chatId}`);
      let ultimoTrabalho = null;
      for (const m of dado.messages || []) {
        if (m.role === 'system') continue;
        if (m.content) mensagemEl(m.role, m.content);
        // O passo a passo é gravado no `meta` de cada resposta justamente pra
        // sobreviver ao recarregamento — sem ler daqui, ele era escrito e
        // nunca lido, e o painel voltava vazio depois de um F5.
        const meta = typeof m.meta === 'string' ? JSON.parse(m.meta || '{}') : m.meta || {};
        if (Array.isArray(meta.trabalho) && meta.trabalho.length) ultimoTrabalho = meta.trabalho;
      }
      // Só o do último turno: o painel é "o que ela fez agora", e empilhar as
      // respostas todas transformaria a aba num histórico que ninguém pediu.
      estado.trabalho = (ultimoTrabalho || []).map((passo) => ({
        tipo: 'ferramenta',
        id: null,
        acao: passo.acao || 'outro',
        titulo: passo.titulo || '',
        alvo: passo.alvo || '',
        arquivo: passo.arquivo || '',
        comando: passo.comando || '',
        // A saída de cada passo não é gravada — ela é grande e envelhece rápido.
        // O que volta é o passo e se ele deu certo.
        texto: null,
        ok: passo.ok ?? null,
        aberto: false
      }));
      marcarAbas();
      if (!msgs.children.length) vazio();
    } catch {
      // Conversa apagada na tela de conversas: recomeça em vez de insistir num
      // id que o servidor não conhece mais.
      estado.chatId = null;
      estado.trabalho = [];
      guardarConversa(estado.projetoId, null);
      vazio();
    }
  }

  async function garantirConversa() {
    if (estado.chatId) return estado.chatId;
    const chat = await api('/chats', {
      method: 'POST',
      body: {
        project_id: estado.projetoId,
        model: estado.modelo,
        // O modo é o que faz o servidor mandar a instrução de programar junto —
        // sem ele a IA responde explicando, em vez de mexer no arquivo.
        mode: 'coding'
      }
    });
    estado.chatId = chat.id;
    guardarConversa(estado.projetoId, chat.id);
    state.chats.unshift({ ...chat, message_count: 0 });
    return chat.id;
  }

  function receberEventoDeCodigo(evento) {
    if (evento.tipo === 'ferramenta') {
      estado.trabalho.push({
        tipo: 'ferramenta',
        id: evento.id,
        acao: evento.acao || 'outro',
        titulo: evento.titulo || '',
        alvo: evento.alvo || '',
        arquivo: evento.arquivo || '',
        comando: evento.comando || '',
        texto: null,
        ok: null,
        aberto: false
      });
      // A primeira ferramenta é o momento em que "a IA começou a trabalhar": é
      // o que a pessoa quer ver, então a aba vai junto. Quem está com um
      // arquivo aberto na tela fica onde está — puxar a aba debaixo de quem
      // está lendo é pior que atrasar a novidade em um toque.
      if (estado.trabalho.length === 1 && !(estado.aba === 'arquivos' && estado.arquivoAberto)) {
        estado.aba = 'trabalho';
      }
    } else if (evento.tipo === 'saida') {
      const passo = [...estado.trabalho].reverse().find((p) => p.id === evento.id && p.texto == null);
      if (passo) {
        passo.texto = evento.texto || '';
        passo.ok = evento.ok !== false;
        // Erro abre sozinho: é a linha que a pessoa vai querer ler.
        passo.aberto = evento.ok === false;
      }
    } else if (evento.tipo === 'fim') {
      const conta = linhaDoFim(evento);
      if (conta) estado.trabalho.push({ tipo: 'fim', titulo: conta, texto: null });
    }
    marcarAbas();
    if (estado.aba === 'trabalho') desenharTrabalho();
  }

  // ------------------------------------------------------------------ anexos
  //
  // Aqui o anexo não vira contexto do pedido, como na conversa: quem lê é a IA
  // de terminal, e ela lê arquivo do disco. Então o arquivo é gravado dentro da
  // pasta do projeto e o que vai no pedido é o caminho dele.

  function desenharAnexos() {
    barraAnexos.innerHTML = '';
    barraAnexos.hidden = !estado.anexos.length;
    for (const anexo of estado.anexos) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = anexo.caminho;
      chip.innerHTML = `
        <span class="nome">${escapeHtml(anexo.caminho.split('/').pop())}</span>
        <button type="button" title="${escapeHtml(t('tirar do pedido'))}"
          aria-label="${escapeHtml(t('tirar {nome} do pedido', { nome: anexo.caminho.split('/').pop() }))}"
          >${icon('close', 15)}</button>`;
      // Só tira da lista: o arquivo fica na pasta do projeto de propósito, que é
      // onde a pessoa mandou pôr. Apagar arquivo de projeto de alguém a partir
      // de um clique de "tirar da lista" seria uma surpresa ruim.
      chip.querySelector('button').onclick = () => {
        estado.anexos = estado.anexos.filter((a) => a !== anexo);
        desenharAnexos();
      };
      barraAnexos.appendChild(chip);
    }
  }

  async function anexar(arquivos) {
    for (const arquivo of arquivos) {
      try {
        const anexo = await api(
          `/codigo/anexo?${projeto()}&name=${encodeURIComponent(arquivo.name)}`,
          { method: 'POST', body: await arquivo.arrayBuffer(), raw: true }
        );
        estado.anexos.push(anexo);
      } catch (err) {
        toast(`${arquivo.name}: ${err.message}`, 'err');
      }
    }
    desenharAnexos();
    // O arquivo acabou de aparecer na pasta: a árvore aberta ao lado está
    // desatualizada no instante seguinte ao anexo.
    if (estado.aba === 'arquivos' && !estado.arquivoAberto) desenharArquivos();
  }

  /** O texto que vai pra IA, com os caminhos dos anexos por cima. */
  function comAnexos(texto) {
    if (!estado.anexos.length) return texto;
    const lista = estado.anexos.map((a) => `- ${a.caminho}`).join('\n');
    return `${t('Arquivos que anexei nesta pasta:')}\n${lista}\n\n${texto}`;
  }

  async function enviar(texto) {
    const controller = new AbortController();
    estado.transmitindo = controller;
    btnParar.hidden = false;
    btnEnviar.hidden = true;

    let respostaEl = null;
    let pensando = null;
    let resposta = '';
    // Cada pedido recomeça o painel. Sem isto a lista acumulava os turnos todos
    // com uma linha "terminou" no meio de cada um, e o pulo automático pra aba
    // Trabalho só acontecia no primeiro passo da sessão inteira.
    estado.trabalho = [];
    if (estado.aba === 'trabalho') desenharTrabalho();

    try {
      const chatId = await garantirConversa();
      await stream(
        `/chats/${chatId}/stream`,
        // `programar: true` é o que autoriza o modo estruturado no servidor —
        // e com ele a auto-aprovação de edição de arquivo. Só esta tela manda.
        { content: texto, model: estado.modelo, programar: true },
        (ev) => {
          const evento = traduzirEvento(ev);
          if (evento) return receberEventoDeCodigo(evento);
          switch (ev.type) {
            case 'user':
              msgs.querySelector('.cd-vazio')?.remove();
              mensagemEl('user', ev.message.content);
              break;
            case 'reasoning':
              if (!respostaEl) respostaEl = mensagemEl('assistant', '');
              if (!pensando) {
                const det = document.createElement('details');
                det.className = 'reasoning live';
                det.innerHTML = `<summary>${icon('spark', 17)} <span class="rot">${t(
                  'pensando…'
                )}</span></summary><div class="think"></div>`;
                respostaEl.querySelector('.body').before(det);
                pensando = det.querySelector('.think');
              }
              pensando.textContent += ev.text;
              pensando.scrollTop = pensando.scrollHeight;
              break;
            case 'delta':
              if (!respostaEl) respostaEl = mensagemEl('assistant', '');
              respostaEl.querySelector('.reasoning')?.classList.remove('live');
              resposta += ev.text;
              respostaEl.querySelector('.body').innerHTML = renderMarkdown(resposta);
              descer();
              break;
            case 'stats': {
              const linha = respostaEl?.querySelector('.stats');
              if (linha) {
                linha.textContent = statsLine(ev);
                linha.classList.toggle('oculta', !linha.textContent);
              }
              break;
            }
            case 'done':
              if (respostaEl) wireCodeCopy(respostaEl);
              break;
            case 'note':
            case 'phase':
              nota(ev.text);
              break;
            case 'error':
              nota(ev.message, 'err');
              break;
            default:
              break;
          }
        },
        controller.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') nota(err.message, 'err');
    } finally {
      estado.transmitindo = null;
      btnParar.hidden = true;
      btnEnviar.hidden = false;
      // A pasta mudou enquanto a IA trabalhava: o que está na tela é de antes.
      if (estado.aba === 'mudancas') desenharMudancas();
      else if (estado.aba === 'arquivos' && !estado.arquivoAberto) desenharArquivos();
      else desenharTrabalho();
    }
  }

  el.querySelector('#cd-composer').onsubmit = (ev) => {
    ev.preventDefault();
    const texto = campo.value.trim();
    if (!texto) return;
    if (estado.transmitindo) return;
    campo.value = '';
    campo.style.height = 'auto';
    const pedido = comAnexos(texto);
    estado.anexos = [];
    desenharAnexos();
    enviar(pedido);
  };

  btnAnexar.onclick = () => campoArquivo.click();
  campoArquivo.onchange = async () => {
    const escolhidos = [...campoArquivo.files];
    // Zerado antes de subir: sem isto, escolher o mesmo arquivo duas vezes
    // seguidas não dispara `change` na segunda.
    campoArquivo.value = '';
    if (escolhidos.length) await anexar(escolhidos);
  };

  // Arrastar pra cima do campo é o gesto que as pessoas tentam primeiro.
  campo.ondragover = (ev) => {
    ev.preventDefault();
    campo.classList.add('recebendo');
  };
  campo.ondragleave = () => campo.classList.remove('recebendo');
  campo.ondrop = async (ev) => {
    ev.preventDefault();
    campo.classList.remove('recebendo');
    const arquivos = [...(ev.dataTransfer?.files || [])];
    if (arquivos.length) await anexar(arquivos);
  };
  campo.onkeydown = (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      el.querySelector('#cd-composer').requestSubmit();
    }
  };
  campo.oninput = () => {
    campo.style.height = 'auto';
    // Mesmo teto do CSS: passar dele cortava o texto sem deixar rolagem à vista.
    campo.style.height = `${Math.min(campo.scrollHeight, 150)}px`;
  };
  btnParar.onclick = () => estado.transmitindo?.abort();

  el.querySelector('#cd-projeto').onchange = async (ev) => {
    // A conversa fica presa ao projeto (é dele que sai a pasta de trabalho), e
    // por isso trocar de pasta começa outra conversa em vez de mudar a de baixo
    // do que já foi respondido.
    estado.projetoId = ev.target.value;
    // Cada projeto tem a sua conversa: voltar pra um projeto de ontem devolve a
    // conversa de ontem, com o painel remontado do que ficou gravado.
    estado.chatId = conversasGuardadas()[estado.projetoId] || null;
    estado.trabalho = [];
    estado.arquivoAberto = null;
    await carregarConversa();
    mostrarAba(estado.aba);
  };
  el.querySelector('#cd-modelo').onchange = (ev) => {
    estado.modelo = ev.target.value;
    if (estado.chatId) {
      api(`/chats/${estado.chatId}`, { method: 'PATCH', body: { model: estado.modelo } }).catch(
        (err) => toast(err.message, 'err')
      );
    }
  };

  abrirPainel(estado.painelAberto);
  await carregarConversa();
  await mostrarAba(estado.aba);
}
