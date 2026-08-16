// Interface do IAUnifier. Sem build: ES modules servidos direto.

import {
  $, $$, api, stream, state, refreshState, chatModels, modelLabel, fillSelect,
  escapeHtml, badge, toast, paintIcons, modelOptions
} from './core.js';
import { icon } from './icons.js';
import { renderMarkdown, wireCodeCopy } from './md.js';
import { views } from './views.js';

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

// -------------------------------------------------------------------- boot

async function load() {
  await refreshState();
  renderSidebar();
  renderTopbar();
  renderView();
  $('#side-status').textContent = `${chatModels().length} modelo(s) · ${state.providers.length} provedor(es)`;
}

// ---------------------------------------------------------------- sidebar

/** O globo é interruptor: o estado precisa aparecer, não só tingir. */
function pintarWeb() {
  const btn = $('#btn-web');
  btn.classList.toggle('on', state.useWeb);
  btn.setAttribute('aria-pressed', String(Boolean(state.useWeb)));
  const rotulo = state.useWeb
    ? 'busca na web ligada nesta conversa'
    : 'busca na web desligada nesta conversa';
  btn.title = rotulo;
  btn.setAttribute('aria-label', rotulo);
}

function chatRow(chat) {
  const item = document.createElement('div');
  item.className = `chat-item${chat.id === state.chatId ? ' active' : ''}`;
  const project = state.projects.find((p) => p.id === chat.project_id);
  item.innerHTML = `
    ${project ? badge(project.icon, project.color, 13) : `<span class="ico">${icon('chat', 15)}</span>`}
    <span class="label">${escapeHtml(chat.title)}</span>
    <span class="row-actions">
      <button class="icon" data-act="rename" title="renomear" aria-label="renomear conversa">${icon('edit', 14)}</button>
      <button class="icon" data-act="pin" title="${chat.pinned ? 'desfixar' : 'fixar'}" aria-label="${chat.pinned ? 'desfixar' : 'fixar'} conversa">${icon('pin', 14)}</button>
      <button class="icon" data-act="archive" title="${chat.archived ? 'desarquivar' : 'arquivar'}" aria-label="${chat.archived ? 'desarquivar' : 'arquivar'} conversa">${icon('archive', 14)}</button>
      <button class="icon" data-act="del" title="apagar" aria-label="apagar conversa">${icon('trash', 14)}</button>
    </span>`;

  item.onclick = () => openChat(chat.id);
  item.querySelector('[data-act=rename]').onclick = (ev) => {
    ev.stopPropagation();
    startRename(item, chat);
  };
  item.querySelector('[data-act=pin]').onclick = async (ev) => {
    ev.stopPropagation();
    await api(`/chats/${chat.id}`, { method: 'PATCH', body: { pinned: !chat.pinned } });
    await load();
  };
  item.querySelector('[data-act=archive]').onclick = async (ev) => {
    ev.stopPropagation();
    await api(`/chats/${chat.id}`, { method: 'PATCH', body: { archived: chat.archived ? 0 : 1 } });
    if (!chat.archived && state.chatId === chat.id) newChat();
    await load();
  };
  item.querySelector('[data-act=del]').onclick = async (ev) => {
    ev.stopPropagation();
    if (!confirm(`Apagar "${chat.title}"?`)) return;
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
    list.insertAdjacentHTML('beforeend', '<div class="list-label">Fixadas</div>');
    for (const chat of pinned) list.appendChild(chatRow(chat));
  }
  if (rest.length) {
    if (pinned.length) list.insertAdjacentHTML('beforeend', '<div class="list-label">Conversas</div>');
    for (const chat of rest) list.appendChild(chatRow(chat));
  }
  if (!chats.length) {
    list.insertAdjacentHTML(
      'beforeend',
      `<div class="list-label">${showingArchived ? 'nada arquivado' : 'nada por aqui'}</div>`
    );
  }

  const toggle = document.createElement('button');
  toggle.className = 'link-btn';
  toggle.innerHTML = `${icon('archive', 13)} ${showingArchived ? 'voltar às conversas' : 'ver arquivadas'}`;
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
    list.insertAdjacentHTML('beforeend', '<div class="list-label">Nas mensagens</div>');
    for (const hit of chats) {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.innerHTML = `<span class="ico">${icon('chat', 15)}</span>
        <span class="label" title="${escapeHtml(hit.excerpt)}">${escapeHtml(hit.title)} — ${escapeHtml(
          hit.excerpt
        )}</span>`;
      item.onclick = () => openChat(hit.chat_id, hit.id);
      list.appendChild(item);
    }
  }
  if (memories.length) {
    list.insertAdjacentHTML('beforeend', '<div class="list-label">Na memória</div>');
    for (const m of memories) {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.innerHTML = `<span class="ico">${icon('brain', 15)}</span>
        <span class="label">${escapeHtml(m.text)}</span>`;
      item.onclick = () => switchView('memory');
      list.appendChild(item);
    }
  }
  if (!chats.length && !memories.length) {
    list.insertAdjacentHTML('beforeend', '<div class="list-label">nada encontrado</div>');
  }
}

// ----------------------------------------------------------------- topbar

function renderTopbar() {
  fillSelect(
    $('#sel-model'),
    chatModels().map((m) => ({ value: m.ref, label: m.label })),
    state.model,
    chatModels().length ? null : 'nenhum modelo — abra Provedores'
  );
  fillSelect(
    $('#sel-gem'),
    state.gems.map((g) => ({ value: g.id, label: g.name })),
    state.gemId,
    'sem gem'
  );
  fillSelect(
    $('#sel-project'),
    state.projects.map((p) => ({ value: p.id, label: p.name })),
    state.projectId,
    'sem projeto'
  );
  const chat = state.chats.find((c) => c.id === state.chatId);
  const title = $('#chat-title');
  title.textContent = chat ? chat.title : '';
  title.title = chat ? 'clique duas vezes pra renomear' : '';
  title.ondblclick = chat ? () => renameFromTopbar(chat) : null;
  pintarWeb();
}

// -------------------------------------------------------------------- chat

function messageEl(role, text, meta = {}) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.dataset.id = meta.id || '';
  const who = role === 'user' ? 'você' : meta.label || 'ia';
  el.innerHTML = `
    <div class="who">${icon(role === 'user' ? 'chat' : 'bot', 13)} ${escapeHtml(who)}</div>
    <div class="body"></div>
    <div class="stats"></div>
    <div class="actions"></div>`;

  const body = el.querySelector('.body');
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
    btn.innerHTML = icon(name, 14);
    btn.onclick = handler;
    actions.appendChild(btn);
    return btn;
  };

  add('copy', 'copiar', async () => {
    await navigator.clipboard.writeText(text);
    toast('copiado', 'ok');
  });

  if (role === 'assistant') {
    add('refresh', 'refazer com o modelo atual', () => regenerate(id));
    add('speaker', 'ler em voz alta', () => speak(text));
  }
  if (role === 'user') {
    add('edit', 'editar e reenviar', () => {
      $('#input').value = text;
      $('#input').focus();
      autosize($('#input'));
    });
  }
  add('trash', 'apagar', async () => {
    await api(`/messages/${id}`, { method: 'DELETE' });
    el.remove();
  });
}

function addNote(text, cls = '', iconName = 'brain') {
  const el = document.createElement('div');
  el.className = `note ${cls}`;
  el.innerHTML = `<span class="ico">${icon(iconName, 14)}</span><span>${text}</span>`;
  $('#messages').appendChild(el);
  scrollDown();
  return el;
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
    if (meta.reasoning) prependReasoning(el, meta.reasoning);
    if (meta.stats) el.querySelector('.stats').textContent = statsLine(meta.stats);
    wireActions(el, { id: m.id, role: m.role, text: m.content });
    wireCodeCopy(el);
    if (focusId === m.id) setTimeout(() => el.scrollIntoView({ block: 'center' }), 50);
  }
  if (!state.messages.length) renderEmptyState();
}

/**
 * Primeira abertura: sem provedor não há modelo, e sem modelo nada nesta tela
 * funciona. Em vez do vazio de sempre, os três passos que tiram o app do zero.
 */
function renderFirstRun() {
  // Provedor cadastrado mas sem modelo utilizável é outro problema: aí não
  // falta descobrir nada, falta ligar ou atualizar o que já está lá.
  const desligados = state.providers.filter((p) => !p.enabled).length;
  const explicacao = state.providers.length
    ? `Você tem ${state.providers.length} provedor(es) cadastrado(s), mas nenhum modelo disponível${
        desligados ? ` — ${desligados} está(ão) desligado(s)` : ''
      }.`
    : 'Falta ligar uma IA. São três passos, e o primeiro costuma resolver sozinho.';

  $('#messages').innerHTML = `
    <div class="first-run">
      <div class="badge-row">${badge('sparkle', 'indigo', 26)}</div>
      <h2>${state.providers.length ? 'Nenhum modelo disponível' : 'Bem-vindo ao IAUnifier'}</h2>
      <p>${escapeHtml(explicacao)}</p>
      <ol class="steps">
        <li>
          <strong>Procurar o que já existe na máquina</strong>
          <span>Ollama, LM Studio, LocalAI, llama.cpp e as CLIs do Claude, Codex e Gemini — se estiverem instalados, entram sozinhos.</span>
          <button id="fr-discover" class="primary"><span data-icon="search"></span> Procurar agora</button>
        </li>
        <li>
          <strong>Ou usar uma IA de API</strong>
          <span>OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter. Você cola a chave uma vez e ela fica no servidor, nunca no navegador.</span>
          <button id="fr-providers"><span data-icon="plug"></span> Abrir Provedores</button>
        </li>
        <li>
          <strong>Depois é só conversar</strong>
          <span>O que você contar pra uma IA, as outras lembram: a memória é uma só, compartilhada entre todas.</span>
        </li>
      </ol>
    </div>`;
  paintIcons($('#messages'));
  $('#fr-discover').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'procurando...';
    try {
      const { found } = await api('/discover', { method: 'POST' });
      toast(
        found.length
          ? `encontrado: ${found.map((f) => f.name).join(', ')}`
          : 'nada novo encontrado nesta máquina — cadastre uma IA de API',
        found.length ? 'ok' : ''
      );
      await load();
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

function renderEmptyState() {
  if (!chatModels().length) return renderFirstRun();
  const gem = state.gems.find((g) => g.id === state.gemId);
  $('#messages').innerHTML = `
    <div class="msg" style="text-align:center;color:var(--muted);margin-top:12vh">
      <div style="display:flex;justify-content:center;margin-bottom:10px">
        ${badge(gem?.icon || 'sparkle', gem?.color || 'indigo', 22)}
      </div>
      <div style="font-size:16px;color:var(--text)">${escapeHtml(gem?.name || 'IAUnifier')}</div>
      <div style="font-size:13px;margin-top:4px">
        ${state.model ? escapeHtml(modelLabel(state.model)) : 'nenhum modelo escolhido'}
      </div>
      <div style="font-size:12.5px;margin-top:14px">
        Anexe arquivo, ligue a busca na web, ou chame o conselho pra perguntar a vários modelos de uma vez.
      </div>
    </div>`;
}

function statsLine(stats) {
  const parts = [];
  if (stats.ttft != null) parts.push(`primeiro token em ${(stats.ttft / 1000).toFixed(2)}s`);
  if (stats.tps) parts.push(`${stats.tps} tok/s`);
  if (stats.tokens) parts.push(`${stats.tokens} tokens${stats.estimated ? ' (estimado)' : ''}`);
  if (stats.ms) parts.push(`${(stats.ms / 1000).toFixed(1)}s no total`);
  return parts.join(' · ');
}

function prependReasoning(el, text) {
  const details = document.createElement('details');
  details.className = 'reasoning';
  details.innerHTML = `<summary>raciocínio do modelo</summary><div class="think"></div>`;
  details.querySelector('.think').textContent = text;
  el.querySelector('.body').before(details);
  return details.querySelector('.think');
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
  closeSidebarOnMobile();
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
async function consumeTurn(path, body) {
  const controller = new AbortController();
  state.streaming = controller;
  $('#btn-stop').hidden = false;
  $('#btn-send').disabled = true;

  let el = null;
  let bodyEl = null;
  let thinkEl = null;
  let answer = '';
  let messageId = null;

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
            addNote(
              `lembrou de ${ev.items.length}: ${ev.items.map((i) => escapeHtml(i.text)).join(' · ')}`,
              '',
              'brain'
            );
            break;
          case 'docs-used':
            addNote(
              `usando ${ev.items
                .map((i) => escapeHtml(i.source) + (i.whole ? '' : ` (trecho ${i.ord + 1})`))
                .join(' · ')}`,
              '',
              'paperclip'
            );
            break;
          case 'web-used':
            addNote(
              'web: ' +
                ev.hits
                  .map(
                    (h) =>
                      `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener">[${h.n}] ${escapeHtml(
                        h.title.slice(0, 60)
                      )}</a>`
                  )
                  .join(' · '),
              '',
              'globe'
            );
            break;
          case 'history-cut':
            // A conversa inteira está na tela, mas o modelo só recebeu o fim
            // dela. Sem este aviso, ele parece ter esquecido do nada.
            addNote(
              `conversa longa: só as últimas ${ev.sent} mensagens foram enviadas ao modelo ` +
                `(${ev.dropped} ficaram de fora). O que virou memória continua valendo.`,
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
            if (!thinkEl) thinkEl = prependReasoning(el, '');
            thinkEl.textContent += ev.text;
            break;
          case 'delta':
            if (!el) el = messageEl('assistant', '', { label: modelLabel(state.model) });
            bodyEl = el.querySelector('.body');
            answer += ev.text;
            bodyEl.innerHTML = renderMarkdown(answer);
            scrollDown();
            break;
          case 'stats':
            if (el) el.querySelector('.stats').textContent = statsLine(ev);
            break;
          case 'done':
            messageId = ev.message.id;
            if (el) {
              el.dataset.id = messageId;
              wireActions(el, { id: messageId, role: 'assistant', text: ev.message.content });
              wireCodeCopy(el);
            }
            break;
          case 'memory-new':
            addNote(
              `aprendeu: ${ev.items.map((i) => escapeHtml(i.text)).join(' · ')}`,
              'new',
              'brain'
            );
            break;
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
    $('#btn-send').disabled = false;
    // O título é gerado no servidor a partir da primeira frase.
    const fresh = await api('/chats');
    state.chats = fresh;
    renderSidebar();
    renderTopbar();
  }
}

async function send(text) {
  if (!text.trim()) return;
  if (!state.model) {
    addNote('nenhum modelo escolhido — abra Provedores e cadastre um', 'err', 'alert');
    return;
  }
  const chatId = await ensureChat();
  if (state.messages.length === 0 && $('#messages').querySelector('.msg[style]')) {
    $('#messages').innerHTML = '';
  }
  await consumeTurn(`/chats/${chatId}/stream`, {
    content: text,
    model: state.model,
    web: state.useWeb
  });
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
    const chip = document.createElement('span');
    chip.className = `chip${att.status === 'erro' ? ' err' : ''}`;
    chip.innerHTML = `${icon('file', 13)}
      <span class="nome">${escapeHtml(att.name)}</span>
      <span class="muted">${att.chunks ?? 0}t</span>
      <button title="remover" aria-label="remover ${escapeHtml(att.name)}">${icon('close', 14)}</button>`;
    chip.title = att.note || `${Math.round(att.bytes / 1024)} KB`;
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
    const pending = addNote(`indexando ${escapeHtml(file.name)}...`, '', 'paperclip');
    try {
      const att = await api(
        `/chats/${chatId}/attachments?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: await file.arrayBuffer(), raw: true }
      );
      state.attachments.push(att);
      pending.remove();
      if (att.status === 'erro') {
        addNote(`${escapeHtml(file.name)}: ${escapeHtml(att.note || 'sem texto legível')}`, 'err', 'alert');
      } else {
        addNote(
          `${escapeHtml(file.name)} — ${att.chunks} trecho(s), ${att.chars} caracteres`,
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

function speak(text) {
  if (!('speechSynthesis' in window)) return toast('este navegador não lê em voz alta', 'err');
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    // Marcação de Markdown não deve ser lida em voz alta.
    text.replace(/```[\s\S]*?```/g, ' bloco de código. ').replace(/[*_#`>|]/g, '')
  );
  utterance.lang = 'pt-BR';
  speechSynthesis.speak(utterance);
}

let recognition = null;
function toggleDictation() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return toast('este navegador não tem ditado', 'err');
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
  recognition.onerror = (ev) => toast(`ditado: ${ev.error}`, 'err');
  recognition.onend = () => {
    recognition = null;
    $('#btn-mic').classList.remove('on', 'toggle');
  };
  recognition.start();
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
    <label>Gem
      <select id="t-gem">
        <option value="">sem gem</option>
        ${state.gems
          .map(
            (g) =>
              `<option value="${g.id}"${g.id === state.gemId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`
          )
          .join('')}
      </select>
    </label>
    <label>Projeto
      <select id="t-project">
        <option value="">sem projeto</option>
        ${state.projects
          .map(
            (p) =>
              `<option value="${p.id}"${p.id === state.projectId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
          )
          .join('')}
      </select>
    </label>
    <label class="full">Prompt de sistema desta conversa (vence o da gem)
      <textarea id="t-system" rows="3" placeholder="deixe vazio pra usar o da gem">${escapeHtml(
        chat.system_prompt || ''
      )}</textarea>
    </label>
    <label>Temperatura <input id="t-temp" type="number" step="0.05" min="0" max="2" value="${chat.temperature ?? ''}" /></label>
    <label>top_p <input id="t-topp" type="number" step="0.05" min="0" max="1" value="${chat.top_p ?? ''}" /></label>
    <label>Limite de tokens <input id="t-max" type="number" min="1" value="${chat.max_tokens ?? ''}" /></label>
    <label>Modo
      <select id="t-mode">
        <option value="chat"${chat.mode === 'chat' ? ' selected' : ''}>conversa</option>
        <option value="coding"${chat.mode === 'coding' ? ' selected' : ''}>coding</option>
      </select>
    </label>
    <div class="full row">
      <button id="t-save" class="primary">Aplicar</button>
      <span class="meta">vazio = padrão do provedor</span>
    </div>`;

  tune.querySelector('#t-save').onclick = async () => {
    if (!state.chatId) return toast('mande uma mensagem primeiro', 'err');
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
    toast('ajustes aplicados', 'ok');
  };
}

// ------------------------------------------------------------------- views

function switchView(view) {
  state.view = view;
  for (const el of $$('.view')) el.hidden = true;
  $(`#view-${view}`).hidden = false;
  for (const btn of $$('.nav-item')) btn.classList.toggle('active', btn.dataset.view === view);
  renderView();
}

function renderView() {
  const ctx = { switchView, applyTheme, startChatWithGem, startChatInProject };
  const render = views[state.view];
  if (!render) return;
  // Painel busca dados do servidor. Celular que sai do alcance do wi-fi, ou
  // servidor de casa desligado, davam falha sem dono no console e tela em
  // branco: quem tocou não ficava sabendo de nada.
  Promise.resolve(render($(`#view-${state.view}`), ctx)).catch((err) => {
    const alvo = $(`#view-${state.view}`);
    alvo.className = 'view panel';
    alvo.innerHTML = `<div class="panel-inner">
        <p class="hint">${escapeHtml(err.message || 'não deu pra falar com o servidor')}</p>
        <button id="btn-tentar-de-novo">Tentar de novo</button>
      </div>`;
    alvo.querySelector('#btn-tentar-de-novo').onclick = () => renderView();
    toast(err.message || 'servidor fora do ar', 'err');
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
    { icon: 'plus', label: 'Nova conversa', run: newChat, key: 'Ctrl+Shift+N' },
    { icon: 'users', label: 'Conselho de IAs', run: () => switchView('council') },
    { icon: 'globe', label: 'Pesquisa profunda', run: () => switchView('research') },
    { icon: 'brain', label: 'Memória compartilhada', run: () => switchView('memory') },
    { icon: 'folder', label: 'Projetos', run: () => switchView('projects') },
    { icon: 'sparkle', label: 'Gems', run: () => switchView('gems') },
    { icon: 'plug', label: 'Provedores', run: () => switchView('providers') },
    { icon: 'settings', label: 'Configuração', run: () => switchView('settings') },
    { icon: 'paperclip', label: 'Anexar arquivo', run: () => $('#file-input').click() },
    {
      icon: 'globe',
      label: state.useWeb ? 'Desligar busca na web' : 'Ligar busca na web',
      run: toggleWeb
    },
    {
      icon: 'sun',
      label: 'Alternar tema claro/escuro',
      run: () =>
        applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
    },
    { icon: 'download', label: 'Exportar conversa em Markdown', run: () => exportChat('md') },
    { icon: 'file', label: 'Exportar conversa em JSON', run: () => exportChat('json') }
  ];
  for (const gem of state.gems) {
    list.push({ icon: gem.icon, label: `Conversar com ${gem.name}`, run: () => startChatWithGem(gem) });
  }
  for (const model of chatModels()) {
    list.push({
      icon: 'cpu',
      label: `Trocar para ${model.label}`,
      run: () => {
        state.model = model.ref;
        localStorage.setItem('iaunifier.model', model.ref);
        renderTopbar();
        toast(`modelo: ${model.label}`);
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
  toast(state.useWeb ? 'busca na web ligada nesta conversa' : 'busca na web desligada');
}

async function exportChat(format) {
  if (!state.chatId) return toast('nenhuma conversa aberta', 'err');
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

function autosize(el) {
  const lista = $('#messages');
  const estavaNoFim = lista
    ? lista.scrollHeight - lista.scrollTop - lista.clientHeight < 8
    : false;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  if (estavaNoFim) scrollDown();
}

const noCelular = () => window.innerWidth <= 760;

function setSidebar(aberta) {
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
$('#btn-new-chat').onclick = () => {
  newChat();
  closeSidebarOnMobile();
};
$('#btn-web').onclick = toggleWeb;
$('#btn-tune').onclick = renderTune;
$('#btn-export').onclick = () => exportChat('md');
$('#btn-theme').onclick = () =>
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
$('#btn-palette').onclick = openPalette;

for (const btn of $$('.nav-item')) {
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
  if (mod && ev.shiftKey && ev.key.toLowerCase() === 'n') {
    ev.preventDefault();
    newChat();
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
  if (ev.key === 'Escape' && state.streaming) state.streaming.abort();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

paintIcons();
load()
  .then(() => {
    if (!state.messages.length) renderEmptyState();
  })
  .catch((err) => addNote(`não carregou: ${escapeHtml(err.message)}`, 'err', 'alert'));
