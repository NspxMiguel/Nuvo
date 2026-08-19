// Interface do IAUnifier. Sem build: ES modules servidos direto.

import {
  $, $$, api, stream, state, refreshState, chatModels, modelLabel, fillSelect,
  escapeHtml, toast, paintIcons, modelOptions, origemDoFato
} from './core.js';
import { icon } from './icons.js';
import { ligarBrilho, roseta } from './glow.js';
import { renderMarkdown, wireCodeCopy } from './md.js';
import { statsLine } from './format.js';
import {
  iniciarIdioma, traduzirDocumento, aoTrocarIdioma, t, plural, formatarNumero
} from './i18n.js';
import { views } from './views.js';

// A malha de pontinhos do rodapé nasce ao abrir o app, ao voltar pra uma
// conversa e quando a resposta começa a chegar. Uma declaração só: dois
// `ligarBrilho` no mesmo canvas desenhariam um por cima do outro.
const brilho = ligarBrilho($('#glow'));

// -------------------------------------------------------------------- tema

const doSistema = matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme, { guardar = true } = {}) {
  document.documentElement.dataset.theme = theme;
  if (guardar) localStorage.setItem('iaunifier.theme', theme);
  $('#btn-theme').innerHTML = icon(theme === 'light' ? 'sun' : 'moon', 18);
  // A cor da barra do navegador vem daqui. Fixa no HTML, o celular ficava com a
  // barra escura por cima da página clara — a emenda aparece o tempo todo.
  const cor = getComputedStyle(document.body).backgroundColor;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && cor) meta.setAttribute('content', cor);
}

// Enquanto ninguém escolheu, o tema é o do aparelho: abrir o app de madrugada
// não pode dar um clarão. A escolha manual, quando existe, ganha do sistema.
const escolhido = localStorage.getItem('iaunifier.theme');
applyTheme(escolhido || (doSistema.matches ? 'dark' : 'light'), { guardar: false });
doSistema.addEventListener('change', (e) => {
  if (!localStorage.getItem('iaunifier.theme')) {
    applyTheme(e.matches ? 'dark' : 'light', { guardar: false });
  }
});

/**
 * O que dizer quando o pedido falha.
 *
 * `fetch` recusado por falta de rede levanta `TypeError: Failed to fetch`, em
 * inglês e sem contexto. Num app que roda no servidor de casa, esse erro quer
 * dizer uma coisa só, e é uma coisa que a pessoa resolve: o servidor não está no
 * ar, ou o celular saiu do alcance.
 */
function falhaLegivel(err) {
  const cru = String(err?.message || err || '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(cru)) {
    return t('o servidor não respondeu. Ele roda na sua máquina — confira se está ligado e na mesma rede.');
  }
  return cru || t('não deu pra falar com o servidor');
}

// -------------------------------------------------------------------- boot

// Trocar idioma redesenha tudo que está na tela: o dicionário só vale pro
// que for escrito a partir de agora, e o que já está escrito ficaria pra trás.
aoTrocarIdioma(() => {
  traduzirDocumento();
  renderSidebar();
  renderTopbar();
  renderView();
});

async function load() {
  await refreshState();
  // O idioma entra antes do primeiro desenho: trocar depois faria a tela
  // aparecer em português e piscar pro idioma certo.
  await iniciarIdioma(state.settings?.idiomaSugerido);
  traduzirDocumento();
  renderSidebar();
  renderTopbar();
  renderView();
  const ligadas = state.providers.filter((p) => p.enabled).length;
  const modelos = chatModels().length;
  $('#side-status').textContent =
    `${plural(ligadas, '1 IA ligada', '{n} IAs ligadas')} · ${plural(modelos, '1 modelo', '{n} modelos')}`;
  // O contador da Memória não vem no /state; é um pedido solto que não segura
  // a tela — se falhar, o número simplesmente não aparece.
  api('/memories')
    .then((lista) => {
      $('#n-memoria').textContent = lista.length ? String(lista.length) : '';
    })
    .catch(() => {});
}

// ---------------------------------------------------------------- sidebar

/** O globo é interruptor: o estado precisa aparecer, não só tingir. */
function pintarWeb() {
  const btn = $('#btn-web');
  btn.classList.toggle('on', state.useWeb);
  btn.setAttribute('aria-pressed', String(Boolean(state.useWeb)));
  const rotulo = state.useWeb
    ? t('modo agente de navegador ligado nesta conversa')
    : t('modo agente de navegador desligado nesta conversa');
  btn.title = rotulo;
  btn.setAttribute('aria-label', rotulo);
}

/** A faixa de anônimo mora no topo de #messages e é redesenhada com a lista. */
function pintarAnon() {
  $('.anon-faixa')?.remove();
  if (!$('#app').classList.contains('anon')) return;
  $('#messages').insertAdjacentHTML(
    'afterbegin',
    `<div class="anon-faixa">
       <span class="ico">${icon('alert', 17)}</span>
       <span><b>${t('Conversa anônima.')}</b> ${t(
         'Não entra no histórico, não aprende nada sobre você e não usa a memória. Some quando você fechar ou trocar de conversa.'
       )}</span>
     </div>`
  );
}

/** O modo anônimo aparece de longe: destaque cinza e brilho quase apagado. */
// O histórico da conversa anônima vive aqui e em lugar nenhum mais: nem no
// banco, nem no localStorage. Fechar a aba apaga, que é o que a faixa promete.
// A janela é a mesma que o servidor usaria, pra o corte não mudar de tamanho.
const ANON_JANELA = 30;
let anonHistorico = [];

function toggleAnon() {
  const ligado = $('#app').classList.toggle('anon');
  anonHistorico = [];
  // Entrar e sair do anônimo começa uma tela limpa. Sem isso a resposta
  // anônima cairia dentro da conversa aberta e, ao desligar, ficaria uma
  // mensagem na tela que não existe em conversa nenhuma — a faixa diz que ela
  // some ao trocar de conversa, e é aqui que ela some.
  limparConversa();
  const btn = $('#btn-anon');
  btn.classList.toggle('on', ligado);
  btn.setAttribute('aria-pressed', String(ligado));
  $('#input').placeholder = ligado
    ? t('Conversa anônima — nada fica guardado')
    : t('Fale com qualquer IA');
  pintarAnon();
  toast(
    ligado
      ? t('conversa anônima ligada — nada daqui é guardado')
      : t('voltou ao normal — a próxima conversa entra no histórico')
  );
}

/**
 * Texto puro: sem ícone e sem cartão. Cada botão de ação custa 44px fixos de
 * hitbox, e no celular eles aparecem em toda linha — com quatro deles sobrava
 * menos de 90px pro título. Ficam os dois que a linha não tem como oferecer
 * de outro jeito; fixar e arquivar voltam quando tiverem outra casa.
 */
function chatRow(chat) {
  const item = document.createElement('div');
  item.className = `chat-item${chat.id === state.chatId ? ' active' : ''}`;
  item.innerHTML = `
    <span class="label">${escapeHtml(chat.title)}</span>
    <span class="row-actions">
      <button class="icon" data-act="rename" title="${t('renomear')}" aria-label="${t(
        'renomear conversa'
      )}">${icon('edit', 17)}</button>
      <button class="icon" data-act="del" title="${t('apagar')}" aria-label="${t(
        'apagar conversa'
      )}">${icon('trash', 17)}</button>
    </span>`;

  item.onclick = () => openChat(chat.id);
  item.querySelector('[data-act=rename]').onclick = (ev) => {
    ev.stopPropagation();
    startRename(item, chat);
  };
  item.querySelector('[data-act=del]').onclick = async (ev) => {
    ev.stopPropagation();
    if (!confirm(t('Apagar "{titulo}"?', { titulo: chat.title }))) return;
    await api(`/chats/${chat.id}`, { method: 'DELETE' });
    if (state.chatId === chat.id) newChat();
    await load();
  };
  return item;
}

/** Troca o rótulo por um campo, ali mesmo — sem prompt do navegador. */
function startRename(item, chat) {
  const label = item.querySelector('.label');
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = chat.title;
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (save && title && title !== chat.title) {
      await api(`/chats/${chat.id}`, { method: 'PATCH', body: { title } });
    }
    await load();
  };

  input.onclick = (ev) => ev.stopPropagation();
  input.onblur = () => finish(true);
  input.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') finish(false);
  };
}

/** O mesmo renomear, começando pelo título no topo. */
function renameFromTopbar(chat) {
  const title = $('#chat-title');
  const input = document.createElement('input');
  input.className = 'rename topbar';
  input.value = chat.title;
  title.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const novo = input.value.trim();
    input.replaceWith(title);
    if (save && novo && novo !== chat.title) {
      await api(`/chats/${chat.id}`, { method: 'PATCH', body: { title: novo } });
      await load();
    } else {
      renderTopbar();
    }
  };
  input.onblur = () => finish(true);
  input.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') finish(false);
  };
}

/** Arquivadas ficam guardadas atrás de um botão; a lista normal não as mostra. */
let showingArchived = false;

/**
 * Rótulo do grupo pela data da última mensagem. A lista já vem do servidor
 * ordenada por updated_at desc, então basta quebrar quando o rótulo muda.
 */
function grupoDaData(iso) {
  const dia = new Date(iso);
  if (Number.isNaN(dia.getTime())) return t('Mais antigas');
  const zero = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((zero(new Date()) - zero(dia)) / 86400000);
  if (dias <= 0) return t('Hoje');
  if (dias === 1) return t('Ontem');
  if (dias < 7) return t('Últimos 7 dias');
  if (dias < 30) return t('Últimos 30 dias');
  return t('Mais antigas');
}

async function renderSidebar(filter = '') {
  const list = $('#chat-list');
  list.innerHTML = '';
  const query = filter.trim().toLowerCase();
  const source = showingArchived
    ? (await api('/chats?all=1')).filter((c) => c.archived)
    : state.chats;
  const chats = query ? source.filter((c) => c.title.toLowerCase().includes(query)) : source;

  const pinned = chats.filter((c) => c.pinned);
  const rest = chats.filter((c) => !c.pinned);

  if (pinned.length) {
    list.insertAdjacentHTML('beforeend', `<div class="list-label">${t('Fixadas')}</div>`);
    for (const chat of pinned) list.appendChild(chatRow(chat));
  }
  let grupo = '';
  for (const chat of rest) {
    const rotulo = grupoDaData(chat.updated_at);
    if (rotulo !== grupo) {
      grupo = rotulo;
      list.insertAdjacentHTML('beforeend', `<div class="list-label">${rotulo}</div>`);
    }
    list.appendChild(chatRow(chat));
  }
  if (!chats.length) {
    list.insertAdjacentHTML(
      'beforeend',
      `<div class="list-label">${showingArchived ? t('nada arquivado') : t('nada por aqui')}</div>`
    );
  }

  const toggle = document.createElement('button');
  toggle.className = 'link-btn';
  toggle.innerHTML = `${icon('archive', 13)} ${
    showingArchived ? t('voltar às conversas') : t('ver arquivadas')
  }`;
  toggle.onclick = () => {
    showingArchived = !showingArchived;
    renderSidebar();
  };
  list.appendChild(toggle);
}

/** Busca do servidor: procura dentro das mensagens e da memória, não só no título. */
async function deepSearch(query) {
  if (query.trim().length < 3) return renderSidebar(query);
  const { chats, memories } = await api(`/search?q=${encodeURIComponent(query)}`);
  const list = $('#chat-list');
  list.innerHTML = '';

  if (chats.length) {
    list.insertAdjacentHTML('beforeend', `<div class="list-label">${t('Nas mensagens')}</div>`);
    for (const hit of chats) {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.innerHTML = `<span class="label" title="${escapeHtml(hit.excerpt)}">${escapeHtml(
        hit.title
      )} — ${escapeHtml(hit.excerpt)}</span>`;
      item.onclick = () => openChat(hit.chat_id, hit.id);
      list.appendChild(item);
    }
  }
  if (memories.length) {
    list.insertAdjacentHTML('beforeend', `<div class="list-label">${t('Na memória')}</div>`);
    for (const m of memories) {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.innerHTML = `<span class="label">${escapeHtml(m.text)}</span>`;
      item.onclick = () => switchView('memory');
      list.appendChild(item);
    }
  }
  if (!chats.length && !memories.length) {
    list.insertAdjacentHTML('beforeend', `<div class="list-label">${t('nada encontrado')}</div>`);
  }
}

// ----------------------------------------------------------------- topbar

function renderTopbar() {
  fillSelect(
    $('#sel-model'),
    chatModels().map((m) => ({ value: m.ref, label: m.label })),
    state.model,
    chatModels().length ? null : t('nenhuma IA ligada')
  );
  fillSelect(
    $('#sel-gem'),
    state.gems.map((g) => ({ value: g.id, label: g.name })),
    state.gemId,
    t('sem perfil')
  );
  fillSelect(
    $('#sel-project'),
    state.projects.map((p) => ({ value: p.id, label: p.name })),
    state.projectId,
    t('sem projeto')
  );
  const chat = state.chats.find((c) => c.id === state.chatId);
  const title = $('#chat-title');
  title.textContent = chat ? chat.title : '';
  title.title = chat ? t('clique duas vezes pra renomear') : '';
  title.ondblclick = chat ? () => renameFromTopbar(chat) : null;
  // No celular a barra de cima é menu · nome · web · anônimo; o botão de nova
  // conversa só existe no computador, e lá quem o esconde com a lateral aberta
  // é o CSS (@media min-width:761px).
  $('#btn-new-chat-top').hidden = noCelular();
  pintarWeb();
}

// -------------------------------------------------------------------- chat

function messageEl(role, text, meta = {}) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.dataset.id = meta.id || '';
  // Quem falou não é mais uma linha de texto: a fala do usuário é bolha à
  // direita e a resposta é texto largo sem caixa. `.msg.user` é flex com
  // `justify-content:flex-end`, então os botões só cabem numa segunda linha —
  // na mesma linha eles roubam ~132px e a bolha para de encostar na borda.
  el.innerHTML =
    role === 'user'
      ? `<div class="body"></div>
         <div class="actions" style="flex-basis:100%;justify-content:flex-end"></div>`
      : `<div class="body"></div>
         <div class="stats oculta"></div>
         <div class="actions"></div>`;
  if (role === 'user') el.style.flexWrap = 'wrap';

  const body = el.querySelector('.body');
  // `.msg.user .body` tem `white-space: pre-wrap`: a fala continua texto puro.
  if (role === 'user') body.textContent = text;
  else body.innerHTML = renderMarkdown(text);

  $('#messages').appendChild(el);
  scrollDown();
  return el;
}

function wireActions(el, { id, role, text }) {
  const actions = el.querySelector('.actions');
  actions.innerHTML = '';

  const add = (name, title, handler) => {
    const btn = document.createElement('button');
    btn.className = 'icon';
    btn.title = title;
    // O SVG entra com aria-hidden, então sem isto o botão é anônimo pra quem
    // usa leitor de tela — e no toque o title não aparece pra ninguém.
    btn.setAttribute('aria-label', title);
    btn.innerHTML = icon(name, 18);
    btn.onclick = handler;
    actions.appendChild(btn);
    return btn;
  };

  add('copy', t('copiar'), async () => {
    await navigator.clipboard.writeText(text);
    toast(t('copiado'), 'ok');
  });

  if (role === 'assistant') {
    add('refresh', t('refazer com o modelo atual'), () => regenerate(id));
    add('speaker', t('ler em voz alta'), () => speak(text));
  }
  if (role === 'user') {
    add('edit', t('editar e reenviar'), () => {
      $('#input').value = text;
      $('#input').focus();
      autosize($('#input'));
    });
  }
  add('trash', t('apagar'), async () => {
    await api(`/messages/${id}`, { method: 'DELETE' });
    el.remove();
  });
}

function addNote(text, cls = '', iconName = 'brain') {
  const el = document.createElement('div');
  el.className = `note ${cls}`;
  el.innerHTML = `<span class="ico">${icon(iconName, 17)}</span><span>${text}</span>`;
  $('#messages').appendChild(el);
  scrollDown();
  return el;
}

/**
 * Rodapé da resposta: o que a memória entregou ao modelo neste turno. Uma
 * linha só; os fatos ficam a um toque, com a origem na coluna da direita.
 */
function memFoot(items) {
  const quantas = `<b>${plural(items.length, '1 coisa', '{n} coisas')}</b>`;
  return `<details class="mem-foot">
    <summary>${icon('brain', 17)} <span>${t('usei {quantas} que já sei sobre você', {
      quantas
    })}</span></summary>
    <div class="fatos">${items
      .map(
        (m) =>
          `<div class="fato"><span>${escapeHtml(m.text)}</span><span class="de">${origemDoFato(
            m
          )}</span></div>`
      )
      .join('')}</div>
    <div class="row"><button type="button" class="ghost" data-act="abrir">${icon(
      'brain',
      17
    )} ${t('Abrir memória')}</button></div>
  </details>`;
}

function scrollDown() {
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
}

function renderMessages(focusId) {
  const box = $('#messages');
  box.innerHTML = '';
  for (const m of state.messages) {
    if (m.role === 'system') continue;
    const meta = typeof m.meta === 'string' ? JSON.parse(m.meta || '{}') : m.meta || {};
    const el = messageEl(m.role, m.content, {
      id: m.id,
      label: meta.provider ? `${meta.provider}` : modelLabel(m.model)
    });
    if (meta.reasoning) {
      prependReasoning(el, meta.reasoning);
      // No histórico não existe quanto tempo o modelo pensou: só o rótulo.
      endReasoning(el, null);
    }
    if (meta.stats) setStats(el, meta.stats);
    wireActions(el, { id: m.id, role: m.role, text: m.content });
    wireCodeCopy(el);
    if (focusId === m.id) setTimeout(() => el.scrollIntoView({ block: 'center' }), 50);
  }
  // As duas funções escrevem #messages inteiro: sem isto o aviso de conversa
  // anônima some na primeira resposta.
  if (!state.messages.length) renderEmptyState();
  else pintarAnon();
}

/**
 * Primeira abertura: sem IA ligada nada nesta tela funciona. Em vez do vazio
 * de sempre, os três passos que tiram o app do zero.
 */
function renderFirstRun() {
  // IA cadastrada mas sem nada que responda é outro problema: aí não falta
  // descobrir nada, falta ligar ou atualizar o que já está lá.
  const desligados = state.providers.filter((p) => !p.enabled).length;
  const quantas = plural(state.providers.length, '1 IA', '{n} IAs');
  const explicacao = !state.providers.length
    ? t('O app roda na sua máquina. Vou procurar IA instalada nela — nada sai daqui.')
    : desligados
      ? t('Você já ligou {quantas}, mas nenhuma está pronta pra responder — {desligadas}.', {
          quantas,
          desligadas: plural(desligados, '1 está desligada', '{n} estão desligadas')
        })
      : t('Você já ligou {quantas}, mas nenhuma está pronta pra responder.', { quantas });

  $('#messages').innerHTML = `
    <div class="first-run">
      <div class="badge-row">${roseta(58, 'bloom')}</div>
      <h2>${
        state.providers.length
          ? t('Nenhuma IA pronta pra responder')
          : `${t('Nada ligado ainda.')}<br />${t('Deixa eu ver o que tem aqui.')}`
      }</h2>
      <p>${escapeHtml(explicacao)}</p>
      <ol class="steps">
        <li style="animation-delay:420ms">
          <strong>${t('Procurar o que já existe na máquina')}</strong>
          <span>${t(
            'Ollama, LM Studio, LocalAI, llama.cpp e os programas de terminal do Claude, do Codex e do Gemini — se estiverem instalados, entram sozinhos.'
          )}</span>
          <div id="fr-achados"></div>
          <button id="fr-discover" class="primary"><span data-icon="search"></span> ${t(
            'Procurar agora'
          )}</button>
        </li>
        <li style="animation-delay:520ms">
          <strong>${t('Ou usar uma IA paga por uso')}</strong>
          <span>OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter. ${t(
            'Você cola a chave uma vez e ela fica no servidor, nunca no navegador.'
          )}</span>
          <button id="fr-providers"><span data-icon="plug"></span> ${t(
            'Abrir IAs ligadas'
          )}</button>
        </li>
        <li style="animation-delay:620ms">
          <strong>${t('Depois é só conversar')}</strong>
          <span>${t(
            'O que você contar pra uma IA, as outras lembram: a memória é uma só, compartilhada entre todas.'
          )}</span>
        </li>
      </ol>
    </div>`;
  paintIcons($('#messages'));
  $('#fr-discover').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = t('procurando…');
    try {
      const { found } = await api('/discover', { method: 'POST' });
      // O achado entra na tela com etiqueta, não em torrada que some. A folha
      // só tem .tag.on/.off/.warn — 'ok' (que o protótipo escreve) sairia cinza.
      // E a etiqueta não pode ser <span>: `.first-run .steps span` (0-2-1) pinta
      // de cinza qualquer span do passo e venceria `.tag.on` (0-2-0). Medido no
      // navegador: com <span> a etiqueta sai #71717a em vez do verde.
      const alvo = $('#fr-achados');
      alvo.innerHTML = found.length
        ? found
            .map(
              (f, i) => `<div class="achado" style="animation-delay:${i * 90}ms">
                <div class="tag on"><div class="pt"></div>${t('achei')}</div>
                <span>${escapeHtml(f.name)} <span class="muted">— ${escapeHtml(
                  f.url || f.command || ''
                )}</span></span>
              </div>`
            )
            .join('') +
          `<div class="aviso ok"><div><b>${plural(
            found.length,
            'Uma IA pronta pra usar, sem custo.',
            '{n} IAs prontas pra usar, sem custo.'
          )}</b> ${t(
            'Elas rodam na sua máquina — nada sai daqui. Já dá pra conversar.'
          )}</div>
            <button id="fr-comecar" class="primary"><span data-icon="check"></span> ${t(
              'Começar agora'
            )}</button></div>`
        : `<div class="achado">
            <div class="tag off"><div class="pt"></div>${t('não')}</div>
            <span>${t('Não achei IA instalada nesta máquina')} <span class="muted">— ${t(
              'abra o Ollama ou o LM Studio e toque em Procurar agora de novo'
            )}</span></span>
          </div>`;
      paintIcons(alvo);
      await load();
      $('#fr-comecar')?.addEventListener('click', () => newChat());
    } catch (err) {
      toast(err.message, 'err');
    }
    // O botão volta ao normal de qualquer jeito: sem modelo novo, esta tela
    // continua na frente e um botão travado em "procurando..." é beco sem saída.
    btn.disabled = false;
    btn.innerHTML = original;
  };
  $('#fr-providers').onclick = () => switchView('providers');
}

// A fileira de pílulas da tela vazia. Rótulos literais do handoff. É função, e
// não lista pronta: uma lista montada na carga do módulo congelaria os rótulos
// no português, antes de o dicionário existir e sem voltar a mudar quando a
// pessoa troca de idioma.
const ATALHOS = () => [
  ['users', t('Perguntar pra várias'), 'council'],
  ['globe', t('Pesquisar na web'), 'research'],
  ['file', t('Ler um arquivo'), 'arquivo'],
  ['code', t('Programar no terminal'), 'code'],
  ['brain', t('O que você sabe de mim'), 'memory']
];

function renderEmptyState() {
  if (!chatModels().length) return renderFirstRun();
  const gem = state.gems.find((g) => g.id === state.gemId);
  // A saudação não inventa nome: o servidor ainda não guarda um.
  const quem = [gem?.name, state.model ? modelLabel(state.model) : t('nenhuma IA escolhida')]
    .filter(Boolean)
    .join(' · ');
  // Atalho pra tela que ainda não existe é beco sem saída: só entra com a view.
  const atalhos = ATALHOS().filter(([, , alvo]) => alvo !== 'code' || $('#view-code'));

  $('#messages').innerHTML = `
    <div class="vazio">
      <div class="topo">
        ${roseta(54, 'bloom')}
        <h1>${t('Pode falar.')}<span>${escapeHtml(quem)}</span></h1>
      </div>
      <div class="atalhos">
        ${atalhos
          .map(
            ([ic, rot, alvo], i) =>
              `<button class="atalho" type="button" data-atalho="${alvo}"
                 style="animation-delay:${360 + i * 60}ms">
                 <span class="ico">${icon(ic, 19)}</span> <span>${rot}</span>
               </button>`
          )
          .join('')}
      </div>
    </div>`;

  for (const btn of $$('#messages .atalho')) {
    btn.onclick = () => {
      const alvo = btn.dataset.atalho;
      if (alvo === 'arquivo') $('#file-input').click();
      else switchView(alvo);
    };
  }
  pintarAnon();
  brilho.pulsar();
}


/** Escreve a linha e some com ela enquanto não há número nenhum. */
function setStats(el, stats) {
  const alvo = el.querySelector('.stats');
  if (!alvo) return;
  const texto = statsLine(stats);
  alvo.textContent = texto;
  alvo.classList.toggle('oculta', !texto);
  // Tempo até a primeira palavra continua útil em modelo local, mas não cabe
  // na linha de três números: fica no title.
  if (stats.ttft != null) {
    alvo.title = t('primeira palavra em {tempo} s', {
      tempo: formatarNumero(stats.ttft / 1000, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      })
    });
  }
}

/**
 * A linha discreta antes da resposta. Enquanto o modelo pensa, a roseta
 * respira; quando termina, ela vira chevron e diz quanto durou.
 */
function prependReasoning(el, text) {
  const details = document.createElement('details');
  details.className = 'reasoning live';
  details.innerHTML = `<summary>${roseta(18, 'pensa')} <span class="rot">${t(
    'pensando…'
  )}</span></summary>
    <div class="think"></div>`;
  details.querySelector('.think').textContent = text;
  el.querySelector('.body').before(details);
  return details.querySelector('.think');
}

/** Fecha a linha de raciocínio: troca a roseta pelo chevron e diz o tempo. */
function endReasoning(el, segundos) {
  const details = el.querySelector('.reasoning');
  if (!details) return;
  details.classList.remove('live');
  const rotulo =
    segundos == null
      ? t('como pensou')
      : t('como pensou · {tempo} s', {
          tempo: formatarNumero(segundos, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
          })
        });
  details.querySelector('summary').innerHTML =
    `<span class="ico">${icon('chevron', 16)}</span> <span class="rot">${rotulo}</span>`;
}

async function openChat(id, focusId) {
  const data = await api(`/chats/${id}`);
  state.chatId = id;
  state.chat = data.chat;
  state.messages = data.messages;
  state.attachments = data.attachments || [];
  state.model = data.chat.model || state.model;
  state.gemId = data.chat.gem_id || '';
  state.projectId = data.chat.project_id || '';
  state.useWeb = Boolean(JSON.parse(data.chat.tools || '{}').web);
  switchView('chat');
  renderSidebar();
  renderTopbar();
  renderMessages(focusId);
  renderAttachBar();
  // Voltar pra uma conversa é um dos três momentos em que a malha nasce.
  brilho.pulsar();
  closeSidebarOnMobile();
}

/**
 * Zera a conversa da tela sem trocar de tela. Separado do `newChat` porque
 * `switchView` desliga o modo anônimo de propósito — chamá-lo de dentro do
 * `toggleAnon` desarmava o modo no mesmo gesto que o ligava.
 */
function limparConversa() {
  state.chatId = null;
  state.chat = null;
  state.messages = [];
  state.attachments = [];
  renderSidebar();
  renderTopbar();
  renderEmptyState();
  renderAttachBar();
}

function newChat() {
  state.chatId = null;
  state.chat = null;
  state.messages = [];
  state.attachments = [];
  switchView('chat');
  renderSidebar();
  renderTopbar();
  renderEmptyState();
  renderAttachBar();
  $('#input').focus();
}

async function ensureChat() {
  if (state.chatId) return state.chatId;
  const chat = await api('/chats', {
    method: 'POST',
    body: {
      gem_id: state.gemId || null,
      project_id: state.projectId || null,
      model: state.model,
      mode: state.gems.find((g) => g.id === state.gemId)?.mode || 'chat'
    }
  });
  state.chatId = chat.id;
  state.chat = chat;
  state.chats.unshift({ ...chat, message_count: 0 });
  renderSidebar();
  return chat.id;
}

/** Consome o stream de um turno e vai montando a resposta na tela. */
/**
 * Roda um turno inteiro. Devolve o que a IA respondeu para quem precisa do
 * texto depois — o modo voz lê a resposta em voz alta. `ganchos.memoria`
 * avisa assim que os fatos entram no prompt, ainda durante o "pensando".
 */
async function consumeTurn(path, body, ganchos = {}) {
  const controller = new AbortController();
  state.streaming = controller;
  // Respondendo: mostra parar, esconde enviar. Desabilitado, o botão azul
  // ficaria na tela ao lado do parar — dois botões redondos pro mesmo momento.
  $('#btn-stop').hidden = false;
  $('#btn-send').hidden = true;

  let el = null;
  let bodyEl = null;
  let thinkEl = null;
  let trilhaEl = null;
  let answer = '';
  let messageId = null;
  // Os fatos que entraram no prompt viram o rodapé da resposta, não um aviso
  // no meio da conversa: o handoff pede um aviso só por turno.
  let fatosUsados = [];
  let pensouEm = 0;

  try {
    await stream(
      path,
      body,
      (ev) => {
        switch (ev.type) {
          case 'reset':
            for (const node of $$('#messages .msg, #messages .note')) {
              if (node.dataset.id && ev.keep.includes(node.dataset.id)) continue;
              if (node.classList.contains('note')) node.remove();
              else if (!ev.keep.includes(node.dataset.id)) node.remove();
            }
            break;
          case 'user': {
            const userEl = messageEl('user', ev.message.content, { id: ev.message.id });
            wireActions(userEl, { id: ev.message.id, role: 'user', text: ev.message.content });
            break;
          }
          case 'memory-used':
            // O aviso é um só, e vem depois da resposta: uma linha antes dela
            // atrapalha a leitura e some do histórico quando a conversa reabre.
            fatosUsados = ev.items;
            ganchos.memoria?.(ev.items);
            break;
          case 'docs-used':
            addNote(
              t('usando {lista}', {
                lista: ev.items
                  .map(
                    (i) =>
                      escapeHtml(i.source) +
                      (i.whole ? '' : ` ${t('(trecho {n})', { n: i.ord + 1 })}`)
                  )
                  .join(' · ')
              }),
              '',
              'paperclip'
            );
            break;
          case 'web-used':
            addNote(
              t('web: {lista}', {
                lista: ev.hits
                  .map(
                    (h) =>
                      `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener">[${h.n}] ${escapeHtml(
                        h.title.slice(0, 60)
                      )}</a>`
                  )
                  .join(' · ')
              }),
              '',
              'globe'
            );
            break;
          case 'agent-step':
            // Um bloco só, que cresce — oito passos viravam oito avisos soltos
            // empurrando a conversa pra cima.
            if (!trilhaEl) {
              trilhaEl = addNote(
                `<b>${t('navegando')}</b><div class="trilha"></div>`,
                'agente',
                'globe'
              );
            }
            trilhaEl.querySelector('.trilha').insertAdjacentHTML(
              'beforeend',
              `<div class="passo${ev.erro ? ' ruim' : ''}">${escapeHtml(ev.descricao || ev.acao)}` +
                `${ev.motivo ? `<span class="porque">${escapeHtml(ev.motivo)}</span>` : ''}</div>`
            );
            scrollDown();
            break;
          case 'agent-page':
            break;
          case 'history-cut':
            // A conversa inteira está na tela, mas o modelo só recebeu o fim
            // dela. Sem este aviso, ele parece ter esquecido do nada.
            addNote(
              t(
                'conversa longa: só as últimas {enviadas} mensagens foram enviadas ao modelo ({fora} ficaram de fora). O que virou memória continua valendo.',
                { enviadas: ev.sent, fora: ev.dropped }
              ),
              '',
              'alert'
            );
            break;
          case 'phase':
            addNote(escapeHtml(ev.text), '', 'spark');
            break;
          case 'note':
            addNote(escapeHtml(ev.text), '', 'alert');
            break;
          case 'reasoning':
            if (!el) el = messageEl('assistant', '', { label: modelLabel(state.model) });
            if (!thinkEl) {
              thinkEl = prependReasoning(el, '');
              pensouEm = Date.now();
            }
            thinkEl.textContent += ev.text;
            // `.think` tem teto de 190px e rola por dentro.
            thinkEl.scrollTop = thinkEl.scrollHeight;
            break;
          case 'delta':
            if (!el) el = messageEl('assistant', '', { label: modelLabel(state.model) });
            if (pensouEm) {
              endReasoning(el, (Date.now() - pensouEm) / 1000);
              pensouEm = 0;
            }
            if (!answer) brilho.pulsar();
            bodyEl = el.querySelector('.body');
            answer += ev.text;
            bodyEl.innerHTML = renderMarkdown(answer);
            scrollDown();
            break;
          case 'stats':
            if (el) setStats(el, ev);
            break;
          case 'done':
            messageId = ev.message.id;
            if (el) {
              el.dataset.id = messageId;
              // Só aqui: cada 'delta' reescreve o .body inteiro com o markdown.
              // Em conversa anônima não há rodapé de memória: nada foi usado.
              if (fatosUsados.length && !$('#app').classList.contains('anon')) {
                el.querySelector('.body').insertAdjacentHTML('beforeend', memFoot(fatosUsados));
                el.querySelector('.mem-foot [data-act=abrir]').onclick = () => switchView('memory');
                scrollDown();
              }
              wireActions(el, { id: messageId, role: 'assistant', text: ev.message.content });
              wireCodeCopy(el);
            }
            break;
          case 'memory-new': {
            if ($('#app').classList.contains('anon')) break;
            const fatos = ev.items;
            const quais = fatos.map((i) => `<b>${escapeHtml(i.text)}</b>`).join(' · ');
            const nota = addNote(
              `${t('Guardei: {quais}. Todas as IAs vão saber disso.', { quais })} ` +
                `<a href="#" data-act="mudar">${t('mudar')}</a> · ` +
                `<a href="#" data-act="esquecer">${t('esquecer')}</a>`,
              'new',
              'brain'
            );
            nota.querySelector('[data-act=mudar]').onclick = (e) => {
              e.preventDefault();
              switchView('memory');
            };
            nota.querySelector('[data-act=esquecer]').onclick = async (e) => {
              e.preventDefault();
              for (const f of fatos) await api(`/memories/${f.id}`, { method: 'DELETE' });
              nota.remove();
              toast(t('esqueci'), 'ok');
            };
            break;
          }
          case 'error':
            addNote(escapeHtml(ev.message), 'err', 'alert');
            break;
          default:
            break;
        }
      },
      controller.signal
    );
  } catch (err) {
    if (err.name !== 'AbortError') addNote(escapeHtml(err.message), 'err', 'alert');
  } finally {
    state.streaming = null;
    $('#btn-stop').hidden = true;
    $('#btn-send').hidden = false;
    // O título é gerado no servidor a partir da primeira frase.
    const fresh = await api('/chats');
    state.chats = fresh;
    renderSidebar();
    renderTopbar();
  }
  return { answer, fatos: fatosUsados };
}

async function send(text, ganchos) {
  if (!text.trim()) return null;
  if (!state.model) {
    addNote(
      t('Nenhuma IA escolhida. Abra {onde} e ligue uma.', {
        onde: `<b>${t('IAs ligadas')}</b>`
      }),
      'err',
      'alert'
    );
    return null;
  }
  const anonimo = $('#app').classList.contains('anon');
  // A tela vazia sai de cena no primeiro envio; a faixa de anônimo fica.
  $('#messages').querySelector('.vazio, .first-run')?.remove();

  if (anonimo) {
    // Nada de `ensureChat`: conversa anônima não tem linha no banco. O histórico
    // mora só aqui, e vai junto porque o servidor não tem de onde lê-lo — é o
    // mesmo motivo pelo qual ele some quando a aba fecha.
    const historico = anonHistorico.slice(-ANON_JANELA);
    anonHistorico.push({ role: 'user', content: text });
    const turno = await consumeTurn(
      '/chat-anonimo',
      { content: text, model: state.model, web: state.useWeb, history: historico },
      ganchos
    );
    if (turno?.answer) anonHistorico.push({ role: 'assistant', content: turno.answer });
    return turno;
  }

  const chatId = await ensureChat();
  return consumeTurn(
    `/chats/${chatId}/stream`,
    { content: text, model: state.model, web: state.useWeb },
    ganchos
  );
}

async function regenerate(fromId) {
  if (!state.chatId) return;
  await consumeTurn(`/chats/${state.chatId}/regenerate`, {
    from: fromId,
    model: state.model,
    web: state.useWeb
  });
}

// ------------------------------------------------------------------ anexos

function renderAttachBar() {
  const bar = $('#attach-bar');
  bar.innerHTML = '';
  bar.hidden = !state.attachments.length;
  for (const att of state.attachments) {
    // A extensão faz o papel do ícone; a contagem de trechos é jargão e sai da
    // superfície, mas continua no title de quem quiser saber.
    const tipo = att.name.includes('.')
      ? att.name.split('.').pop().slice(0, 4).toLowerCase()
      : t('arq');
    const chip = document.createElement('span');
    chip.className = `chip${att.status === 'erro' ? ' err' : ''}`;
    chip.innerHTML = `
      <span class="tipo">${escapeHtml(tipo)}</span>
      <span class="nome">${escapeHtml(att.name)}</span>
      <button type="button" title="${t('tirar da conversa')}" aria-label="${t(
        'tirar {nome} da conversa',
        { nome: escapeHtml(att.name) }
      )}">${icon('close', 15)}</button>`;
    chip.title =
      att.note ||
      t('{trechos} trecho(s) · {kb} kB', {
        trechos: att.chunks ?? 0,
        kb: Math.round(att.bytes / 1000)
      });
    chip.querySelector('button').onclick = async () => {
      await api(`/attachments/${att.id}`, { method: 'DELETE' });
      state.attachments = state.attachments.filter((a) => a.id !== att.id);
      renderAttachBar();
    };
    bar.appendChild(chip);
  }
}

async function uploadFiles(files) {
  const chatId = await ensureChat();
  for (const file of files) {
    const pending = addNote(
      t('indexando {nome}...', { nome: escapeHtml(file.name) }),
      '',
      'paperclip'
    );
    try {
      const att = await api(
        `/chats/${chatId}/attachments?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: await file.arrayBuffer(), raw: true }
      );
      state.attachments.push(att);
      pending.remove();
      if (att.status === 'erro') {
        addNote(
          `${escapeHtml(file.name)}: ${escapeHtml(att.note || t('sem texto legível'))}`,
          'err',
          'alert'
        );
      } else {
        addNote(
          `${escapeHtml(file.name)} — ${t('{trechos} trecho(s), {chars} caracteres', {
            trechos: att.chunks,
            chars: att.chars
          })}`,
          'new',
          'paperclip'
        );
      }
    } catch (err) {
      pending.remove();
      addNote(`${escapeHtml(file.name)}: ${escapeHtml(err.message)}`, 'err', 'alert');
    }
  }
  renderAttachBar();
}

// --------------------------------------------------------------------- voz

/** Marcação de Markdown não deve ser lida em voz alta. */
function semMarcacao(text) {
  return text.replace(/```[\s\S]*?```/g, ' bloco de código. ').replace(/[*_#`>|]/g, '');
}

function speak(text) {
  if (!('speechSynthesis' in window)) return toast(t('este navegador não lê em voz alta'), 'err');
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(semMarcacao(text));
  utterance.lang = 'pt-BR';
  speechSynthesis.speak(utterance);
}

let recognition = null;
function toggleDictation() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return toast(t('este navegador não tem ditado'), 'err');
  if (recognition) {
    recognition.stop();
    return;
  }
  recognition = new Recognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = true;
  recognition.continuous = true;

  const input = $('#input');
  const base = input.value;
  $('#btn-mic').classList.add('on', 'toggle');

  recognition.onresult = (ev) => {
    let text = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) text += ev.results[i][0].transcript;
    input.value = (base ? base + ' ' : '') + text;
    autosize(input);
  };
  recognition.onerror = (ev) => toast(t('ditado: {erro}', { erro: ev.error }), 'err');
  recognition.onend = () => {
    recognition = null;
    $('#btn-mic').classList.remove('on', 'toggle');
  };
  recognition.start();
}

// ---------------------------------------------------------------- modo voz

// Conversa falada: a camada #voice cobre a tela e o ciclo é sempre o mesmo —
// ouvir, repetir o que entendeu, pensar, responder falando, e voltar a ouvir.
// A conversa continua sendo a mesma que está atrás: o modo voz não é um chat
// separado, é outra forma de digitar nela.
const voz = { aberto: false, rec: null, mudo: false, encerrando: false };

function vozDiz(texto, { falando = false } = {}) {
  $('#voice-txt').textContent = texto;
  $('#voice').classList.toggle('falando', falando);
}

/** Ouve uma fala. Resolve com o que foi dito, ou com '' se não veio nada. */
function vozOuvir() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  return new Promise((resolve) => {
    const rec = new Recognition();
    voz.rec = rec;
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    // Turno a turno: a pausa da pessoa é o que fecha a vez dela de falar.
    rec.continuous = false;
    let dito = '';
    vozDiz(t('ouvindo…'));
    rec.onresult = (ev) => {
      let texto = '';
      for (let i = 0; i < ev.results.length; i++) texto += ev.results[i][0].transcript;
      dito = texto.trim();
      // Enquanto não é final, aparece entre aspas: mostra que está entendendo.
      if (dito) vozDiz(`“${dito}”`);
    };
    rec.onerror = (ev) => {
      // 'no-speech' e 'aborted' são o silêncio e o fechar — não são defeito.
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        vozDiz(t('o ditado falhou: {erro}', { erro: ev.error }));
      }
    };
    rec.onend = () => {
      voz.rec = null;
      resolve(dito);
    };
    rec.start();
  });
}

/** Lê a resposta em voz alta e só volta quando terminou (ou falhou). */
function vozFalar(texto) {
  if (!('speechSynthesis' in window) || !texto.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(semMarcacao(texto));
    fala.lang = 'pt-BR';
    fala.onend = resolve;
    fala.onerror = resolve;
    speechSynthesis.speak(fala);
  });
}

async function vozCiclo() {
  while (voz.aberto) {
    if (voz.mudo) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const dito = await vozOuvir();
    if (!voz.aberto) return;
    if (!dito) continue;

    vozDiz(t('pensando…'));
    let resposta = null;
    try {
      resposta = await send(dito, {
        memoria: (itens) => {
          if (!itens.length) return;
          vozDiz(
            `${t('pensando…')}\n${plural(
              itens.length,
              'usando 1 coisa que sabe de você',
              'usando {n} coisas que sabe de você'
            )}`
          );
        }
      });
    } catch (err) {
      vozDiz(err.message || t('não deu pra falar com o servidor'));
      await new Promise((r) => setTimeout(r, 1800));
      continue;
    }
    if (!voz.aberto) return;
    const texto = resposta?.answer?.trim();
    if (!texto) continue;
    vozDiz(texto, { falando: true });
    await vozFalar(texto);
    $('#voice').classList.remove('falando');
  }
}

function abrirVoz() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return toast(t('este navegador não tem ditado'), 'err');
  if (voz.aberto) return;
  voz.aberto = true;
  voz.mudo = false;
  $('#voice').classList.remove('mudo', 'falando');
  $('#voice-mudo').setAttribute('aria-pressed', 'false');
  $('#voice-marca').innerHTML = roseta(78, 'grande');
  $('#voice-quem').textContent = `${modelLabel(state.model)} · ${t('responde falando')}`;
  $('#voice').hidden = false;
  paintIcons($('#voice'));
  vozCiclo();
}

function fecharVoz() {
  if (!voz.aberto) return;
  voz.aberto = false;
  // `abort` não dispara resultado; `stop` entregaria mais uma fala depois de
  // fechado, e aí o ciclo mandaria uma pergunta que ninguém pediu.
  voz.rec?.abort();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  $('#voice').hidden = true;
  $('#voice').classList.remove('falando', 'mudo');
}

function vozMudo() {
  voz.mudo = !voz.mudo;
  $('#voice').classList.toggle('mudo', voz.mudo);
  $('#voice-mudo').setAttribute('aria-pressed', String(voz.mudo));
  const rotuloMudo = voz.mudo ? t('voltar a ouvir') : t('silenciar');
  $('#voice-mudo').title = rotuloMudo;
  $('#voice-mudo').setAttribute('aria-label', rotuloMudo);
  if (voz.mudo) {
    voz.rec?.abort();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    vozDiz(t('microfone desligado'));
  }
}

// -------------------------------------------------------- ajustes do chat

function renderTune() {
  const tune = $('#tune');
  if (!tune.hidden) {
    tune.hidden = true;
    return;
  }
  const chat = state.chat || {};
  tune.hidden = false;
  tune.innerHTML = `
    <label>${t('Perfil')}
      <select id="t-gem">
        <option value="">${t('sem perfil')}</option>
        ${state.gems
          .map(
            (g) =>
              `<option value="${g.id}"${g.id === state.gemId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`
          )
          .join('')}
      </select>
    </label>
    <label>${t('Projeto')}
      <select id="t-project">
        <option value="">${t('sem projeto')}</option>
        ${state.projects
          .map(
            (p) =>
              `<option value="${p.id}"${p.id === state.projectId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
          )
          .join('')}
      </select>
    </label>
    <label class="full">${t('Prompt de sistema desta conversa (vence o da gem)')}
      <textarea id="t-system" rows="3" placeholder="${t(
        'deixe vazio pra usar o do perfil'
      )}">${escapeHtml(chat.system_prompt || '')}</textarea>
    </label>
    <label>${t('Temperatura')} <input id="t-temp" type="number" step="0.05" min="0" max="2" value="${chat.temperature ?? ''}" /></label>
    <label>${t('Quão variado é o vocabulário, de 0 a 1 (top_p)')} <input id="t-topp" type="number" step="0.05" min="0" max="1" value="${chat.top_p ?? ''}" /></label>
    <label>${t('Limite de tokens')} <input id="t-max" type="number" min="1" value="${chat.max_tokens ?? ''}" /></label>
    <label>${t('Modo')}
      <select id="t-mode">
        <option value="chat"${chat.mode === 'chat' ? ' selected' : ''}>${t('conversa')}</option>
        <option value="coding"${chat.mode === 'coding' ? ' selected' : ''}>${t('programar')}</option>
      </select>
    </label>
    <div class="full row">
      <button id="t-save" class="primary">${t('Aplicar')}</button>
      <span class="meta">${t('Deixe vazio pra usar o que a IA já traz de fábrica.')}</span>
    </div>`;

  tune.querySelector('#t-save').onclick = async () => {
    if (!state.chatId) return toast(t('mande uma mensagem primeiro'), 'err');
    const num = (sel) => {
      const value = tune.querySelector(sel).value;
      return value === '' ? null : Number(value);
    };
    state.gemId = tune.querySelector('#t-gem').value;
    state.projectId = tune.querySelector('#t-project').value;
    localStorage.setItem('iaunifier.gem', state.gemId);
    state.chat = await api(`/chats/${state.chatId}`, {
      method: 'PATCH',
      body: {
        gem_id: state.gemId || null,
        project_id: state.projectId || null,
        system_prompt: tune.querySelector('#t-system').value || null,
        temperature: num('#t-temp'),
        top_p: num('#t-topp'),
        max_tokens: num('#t-max'),
        mode: tune.querySelector('#t-mode').value
      }
    });
    renderTopbar();
    tune.hidden = true;
    toast(t('ajustes aplicados'), 'ok');
  };
}

// ------------------------------------------------------------------- views

/** As telas que moram dentro do <details id="nav-mais"> da gaveta. */
const DENTRO_DE_MAIS = ['memory', 'projects', 'gems', 'providers'];

function switchView(view) {
  // O anônimo vale pra conversa em que foi ligado, e só pra ela.
  if ($('#app').classList.contains('anon')) toggleAnon();
  state.view = view;
  for (const el of $$('.view')) {
    el.hidden = true;
    el.classList.remove('entra');
  }
  const alvo = $(`#view-${view}`);
  alvo.hidden = false;
  for (const btn of $$('.nav-item')) btn.classList.toggle('active', btn.dataset.view === view);
  // O "Mais" abre sozinho quando a tela ativa está dentro dele.
  if (DENTRO_DE_MAIS.includes(view)) $('#nav-mais').open = true;
  // A malha do rodapé é da conversa: fora dela some, ao voltar renasce.
  if (view === 'chat') brilho.pulsar();
  else brilho.apagar();
  // Tirar e repor força o navegador a rodar a animação de novo quando é a
  // mesma tela; sem o reflow no meio, ele funde as duas mudanças em nada.
  const entrar = () => {
    void alvo.offsetWidth;
    alvo.classList.add('entra');
  };
  const pintado = renderView();
  entrar();
  // Painel que busca dados reescreve a própria classe quando a resposta chega:
  // repor a classe ali garante a animação também nesse caminho.
  pintado?.then?.(entrar);
}

function renderView() {
  const ctx = { switchView, applyTheme, startChatWithGem, startChatInProject };
  const render = views[state.view];
  if (!render) return Promise.resolve();
  // Painel busca dados do servidor. Celular que sai do alcance do wi-fi, ou
  // servidor de casa desligado, davam falha sem dono no console e tela em
  // branco: quem tocou não ficava sabendo de nada.
  return Promise.resolve(render($(`#view-${state.view}`), ctx)).catch((err) => {
    const alvo = $(`#view-${state.view}`);
    // Reescrever a classe crua apagaria a animação de entrada antes de rodar.
    alvo.className = `view panel${alvo.classList.contains('entra') ? ' entra' : ''}`;
    alvo.innerHTML = `<div class="panel-inner">
        <p class="hint">${escapeHtml(falhaLegivel(err))}</p>
        <button id="btn-tentar-de-novo">${t('Tentar de novo')}</button>
      </div>`;
    alvo.querySelector('#btn-tentar-de-novo').onclick = () => renderView();
    toast(falhaLegivel(err), 'err');
  });
}

function startChatWithGem(gem) {
  state.gemId = gem.id;
  localStorage.setItem('iaunifier.gem', gem.id);
  if (gem.model) state.model = gem.model;
  newChat();
}

function startChatInProject(project) {
  state.projectId = project.id;
  newChat();
}

// ------------------------------------------------------- paleta de comandos

function commands() {
  const list = [
    { icon: 'plus', label: t('Nova conversa'), run: newChat, key: '⌘N' },
    { icon: 'alert', label: t('Conversa anônima'), run: toggleAnon, key: '⇧⌘N' },
    { icon: 'spark', label: t('Ajustes desta conversa'), run: renderTune, key: '⌘,' },
    { icon: 'users', label: t('Perguntar pra várias'), run: () => switchView('council') },
    { icon: 'globe', label: t('Pesquisar na web'), run: () => switchView('research') },
    { icon: 'brain', label: t('Ver memória'), run: () => switchView('memory') },
    { icon: 'folder', label: t('Projetos'), run: () => switchView('projects') },
    { icon: 'sparkle', label: t('Perfis'), run: () => switchView('gems') },
    { icon: 'plug', label: t('IAs ligadas'), run: () => switchView('providers') },
    { icon: 'settings', label: t('Ajustes'), run: () => switchView('settings') },
    { icon: 'paperclip', label: t('Anexar arquivo'), run: () => $('#file-input').click() },
    {
      icon: 'globe',
      label: state.useWeb
        ? t('Desligar o agente de navegador')
        : t('Ligar o agente de navegador'),
      run: toggleWeb
    },
    {
      icon: 'sun',
      label: t('Alternar tema claro/escuro'),
      run: () =>
        applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
    },
    { icon: 'download', label: t('Exportar conversa em Markdown'), run: () => exportChat('md') },
    { icon: 'file', label: t('Exportar conversa em JSON'), run: () => exportChat('json') }
  ];
  for (const gem of state.gems) {
    list.push({
      icon: gem.icon,
      label: t('Conversar com {nome}', { nome: gem.name }),
      run: () => startChatWithGem(gem)
    });
  }
  for (const model of chatModels()) {
    list.push({
      icon: 'cpu',
      label: t('Trocar para {modelo}', { modelo: model.label }),
      run: () => {
        state.model = model.ref;
        localStorage.setItem('iaunifier.model', model.ref);
        renderTopbar();
        toast(t('agora responde {modelo}', { modelo: model.label }));
      }
    });
  }
  return list;
}

let paletteIndex = 0;
let paletteItems = [];

function openPalette() {
  $('#palette').hidden = false;
  $('#palette-input').value = '';
  $('#palette-input').focus();
  drawPalette('');
}

function closePalette() {
  $('#palette').hidden = true;
}

function drawPalette(query) {
  const q = query.trim().toLowerCase();
  paletteItems = commands().filter((c) => !q || c.label.toLowerCase().includes(q));
  paletteIndex = 0;
  const list = $('#palette-list');
  list.innerHTML = paletteItems
    .map(
      (c, i) =>
        `<div class="palette-item${i === 0 ? ' sel' : ''}" data-i="${i}">${icon(c.icon, 15)}
           <span>${escapeHtml(c.label)}</span>
           ${c.key ? `<span class="hintk muted">${c.key}</span>` : ''}</div>`
    )
    .join('');
  for (const el of list.querySelectorAll('.palette-item')) {
    el.onclick = () => {
      closePalette();
      paletteItems[Number(el.dataset.i)].run();
    };
  }
}

function movePalette(delta) {
  const items = $$('#palette-list .palette-item');
  if (!items.length) return;
  items[paletteIndex]?.classList.remove('sel');
  paletteIndex = (paletteIndex + delta + items.length) % items.length;
  items[paletteIndex].classList.add('sel');
  items[paletteIndex].scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ ações

function toggleWeb() {
  state.useWeb = !state.useWeb;
  pintarWeb();
  if (state.chatId) {
    api(`/chats/${state.chatId}`, { method: 'PATCH', body: { tools: { web: state.useWeb } } });
  }
  toast(
    state.useWeb
      ? t('agente de navegador ligado: o modelo abre o navegador e navega sozinho')
      : t('agente de navegador desligado')
  );
}

async function exportChat(format) {
  if (!state.chatId) return toast(t('nenhuma conversa aberta'), 'err');
  if (format === 'json') {
    const data = await api(`/chats/${state.chatId}/export?format=json`);
    download(`${data.chat.title}.json`, JSON.stringify(data, null, 2), 'application/json');
  } else {
    const res = await fetch(`/api/chats/${state.chatId}/export?format=md`, {
      headers: { 'x-iaunifier-token': localStorage.getItem('iaunifier.token') || '' }
    });
    download(`${state.chat?.title || 'conversa'}.md`, await res.text(), 'text/markdown');
  }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[^\w.\- ]+/g, '');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Enviar cinza com o campo vazio, destaque quando tem o que enviar. */
function pintarEnviar() {
  $('#btn-send').classList.toggle('vazio', !$('#input').value.trim());
}

function autosize(el) {
  const lista = $('#messages');
  const estavaNoFim = lista
    ? lista.scrollHeight - lista.scrollTop - lista.clientHeight < 8
    : false;
  el.style.height = 'auto';
  // O teto é o mesmo do CSS (#input { max-height: 190px }): passar dele cortava
  // o texto sem deixar rolagem à vista.
  el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  if (estavaNoFim) scrollDown();
  pintarEnviar();
}

const noCelular = () => window.innerWidth <= 760;

/**
 * No celular a gaveta desliza sobre a tela; no computador ela recolhe e o
 * conteúdo ocupa a largura toda. Fechar era um botão morto no computador.
 */
function setSidebar(aberta) {
  if (!noCelular()) {
    $('#app').classList.toggle('recolhido', !aberta);
    return;
  }
  $('#sidebar').classList.toggle('open', aberta);
  $('#scrim').classList.toggle('on', aberta);
}

function closeSidebarOnMobile() {
  if (noCelular()) setSidebar(false);
}

// ---------------------------------------------------------------- eventos

$('#composer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('#input');
  const text = input.value;
  input.value = '';
  input.style.height = 'auto';
  // O submit limpa o campo sem passar por autosize: sem isto o botão fica azul
  // com o campo já vazio.
  pintarEnviar();
  // Devolver o foco mantém o teclado do celular aberto: sem isto ele desce a
  // cada mensagem e a conversa vira um sobe-e-desce.
  if (dedo.matches) input.focus();
  send(text);
});

// Enter só envia onde existe Shift pra quebrar linha. No teclado do celular a
// tecla de retorno é a única que há: enviar nela deixa o usuário sem nenhum
// jeito de escrever um parágrafo.
const dedo = matchMedia('(pointer: coarse)');
$('#input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && !dedo.matches) {
    ev.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#input').addEventListener('input', (ev) => autosize(ev.target));

// Colar imagem ou arquivo direto no campo de texto.
$('#input').addEventListener('paste', (ev) => {
  const files = [...(ev.clipboardData?.files || [])];
  if (files.length) {
    ev.preventDefault();
    uploadFiles(files);
  }
});

// Arrastar arquivo pra dentro da conversa.
const composer = $('#composer');
for (const type of ['dragenter', 'dragover']) {
  composer.addEventListener(type, (ev) => {
    ev.preventDefault();
    composer.classList.add('drag');
  });
}
for (const type of ['dragleave', 'drop']) {
  composer.addEventListener(type, (ev) => {
    ev.preventDefault();
    composer.classList.remove('drag');
    if (type === 'drop' && ev.dataTransfer?.files?.length) uploadFiles([...ev.dataTransfer.files]);
  });
}

$('#btn-attach').onclick = () => $('#file-input').click();
$('#file-input').onchange = (ev) => {
  uploadFiles([...ev.target.files]);
  ev.target.value = '';
};
$('#btn-mic').onclick = toggleDictation;
$('#btn-stop').onclick = () => state.streaming?.abort();

const novaConversa = () => {
  newChat();
  closeSidebarOnMobile();
};
$('#btn-new-chat').onclick = novaConversa;
$('#btn-new-chat-top').onclick = novaConversa;
$('#btn-web').onclick = toggleWeb;
$('#btn-anon').onclick = toggleAnon;
$('#btn-voice').onclick = abrirVoz;
$('#voice-close').onclick = fecharVoz;
$('#voice-fim').onclick = fecharVoz;
$('#voice-mudo').onclick = vozMudo;
addEventListener('resize', () => {
  $('#btn-new-chat-top').hidden = noCelular();
});
$('#btn-tune').onclick = renderTune;
$('#btn-export').onclick = () => exportChat('md');
$('#btn-theme').onclick = () =>
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
$('#btn-palette').onclick = openPalette;

// Só quem tem data-view: o <summary class="nav-item"> do "Mais" abre o
// <details> sozinho, e switchView(undefined) procuraria #view-undefined.
for (const btn of $$('.nav-item[data-view]')) {
  btn.onclick = () => {
    switchView(btn.dataset.view);
    closeSidebarOnMobile();
  };
}

$('#sel-model').onchange = (ev) => {
  state.model = ev.target.value;
  localStorage.setItem('iaunifier.model', state.model);
  if (state.chatId) api(`/chats/${state.chatId}`, { method: 'PATCH', body: { model: state.model } });
};
$('#sel-gem').onchange = (ev) => {
  state.gemId = ev.target.value;
  localStorage.setItem('iaunifier.gem', state.gemId);
  if (state.chatId) {
    api(`/chats/${state.chatId}`, { method: 'PATCH', body: { gem_id: state.gemId || null } });
  } else {
    renderEmptyState();
  }
};
$('#sel-project').onchange = (ev) => {
  state.projectId = ev.target.value;
  if (state.chatId) {
    api(`/chats/${state.chatId}`, { method: 'PATCH', body: { project_id: state.projectId || null } });
  }
};

let searchTimer = 0;
$('#side-search').oninput = (ev) => {
  clearTimeout(searchTimer);
  const value = ev.target.value;
  searchTimer = setTimeout(() => deepSearch(value), 220);
};

// Teclado aberto no celular: o iOS não encolhe o layout nem o dvh, só o
// visualViewport sabe quanto de tela sobrou. Sem isto o campo de escrever fica
// atrás do teclado, e a última mensagem também.
const telaVisivel = window.visualViewport;
if (telaVisivel) {
  const ajustarAltura = () => {
    const sobrou = telaVisivel.height;
    // Diferença pequena é a barra de endereço subindo e descendo, não teclado.
    const tecladoAberto = window.innerHeight - sobrou > 120;
    if (tecladoAberto) {
      document.documentElement.style.setProperty('--altura-util', `${sobrou}px`);
      scrollDown();
    } else {
      document.documentElement.style.removeProperty('--altura-util');
    }
  };
  telaVisivel.addEventListener('resize', ajustarAltura);
  telaVisivel.addEventListener('scroll', ajustarAltura);
}

$('#btn-open-side').onclick = () => setSidebar(true);
$('#btn-close-side').onclick = () => setSidebar(false);
// Tocar fora é o primeiro gesto que qualquer um tenta pra fechar uma gaveta.
$('#scrim').onclick = () => setSidebar(false);

$('#palette-input').oninput = (ev) => drawPalette(ev.target.value);
$('#palette').onclick = (ev) => {
  if (ev.target.id === 'palette') closePalette();
};

document.addEventListener('keydown', (ev) => {
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    $('#palette').hidden ? openPalette() : closePalette();
    return;
  }
  // As teclas anunciadas na lista de atalhos precisam existir: ⇧⌘N é a
  // conversa anônima, ⌘N a conversa nova e ⌘, os ajustes desta conversa.
  if (mod && ev.key.toLowerCase() === 'n') {
    ev.preventDefault();
    if (ev.shiftKey) toggleAnon();
    else newChat();
    return;
  }
  if (mod && ev.key === ',') {
    ev.preventDefault();
    renderTune();
    return;
  }
  if (mod && ev.key === 'Enter' && document.activeElement === $('#input')) {
    ev.preventDefault();
    $('#composer').requestSubmit();
    return;
  }
  if (!$('#palette').hidden) {
    if (ev.key === 'Escape') closePalette();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      movePalette(1);
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      movePalette(-1);
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const item = paletteItems[paletteIndex];
      closePalette();
      item?.run();
    }
    return;
  }
  // Esc fecha o modo voz antes de cortar a resposta: com a camada aberta é
  // ela que a pessoa está vendo, e é dela que quer sair.
  if (ev.key === 'Escape' && voz.aberto) return fecharVoz();
  if (ev.key === 'Escape' && state.streaming) state.streaming.abort();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

$('#brand-marca').innerHTML = roseta(26, 'fixa');
paintIcons();
// Primeiro dos três momentos do brilho: a chegada.
brilho.pulsar();
load()
  .then(() => {
    if (!state.messages.length) renderEmptyState();
  })
  .catch((err) => addNote(escapeHtml(falhaLegivel(err)), 'err', 'alert'));
