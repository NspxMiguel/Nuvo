// Interface do IAUnifier. Sem build: ES module servido direto.

// ------------------------------------------------------------------- token

const params = new URLSearchParams(location.search);
if (params.get('token')) {
  localStorage.setItem('iaunifier.token', params.get('token'));
  history.replaceState({}, '', location.pathname);
}
const TOKEN = localStorage.getItem('iaunifier.token') || '';

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'x-iaunifier-token': TOKEN,
      ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {})
    },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    const token = prompt('Token de acesso (aparece no terminal onde o servidor subiu):');
    if (token) {
      localStorage.setItem('iaunifier.token', token);
      location.reload();
    }
    throw new Error('sem token');
  }
  const data = await res.json();
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

// ------------------------------------------------------------------- estado

const state = {
  providers: [],
  gems: [],
  projects: [],
  chats: [],
  settings: null,
  chatId: null,
  messages: [],
  model: localStorage.getItem('iaunifier.model') || '',
  gemId: localStorage.getItem('iaunifier.gem') || '',
  projectId: '',
  view: 'chat',
  streaming: null
};

const $ = (sel) => document.querySelector(sel);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** Markdown mínimo: blocos de código, código inline e negrito. */
function renderText(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

function allModels() {
  return state.providers
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models
        .filter((m) => m.kind === 'chat')
        .map((m) => ({ ref: m.ref, label: `${p.name} · ${m.label}` }))
    );
}

/** O ref é `providerId:modelId` — na tela mostramos o nome legível. */
function modelLabel(ref) {
  if (!ref) return 'ia';
  return allModels().find((m) => m.ref === ref)?.label || ref.split(':').slice(1).join(':') || ref;
}

function embeddingModels() {
  return state.providers.flatMap((p) =>
    p.models
      .filter((m) => m.kind === 'embedding')
      .map((m) => ({ ref: m.ref, label: `${p.name} · ${m.label}` }))
  );
}

// -------------------------------------------------------------------- boot

async function load() {
  const data = await api('/state');
  Object.assign(state, data);
  if (!state.model && allModels().length) state.model = allModels()[0].ref;
  renderSidebar();
  renderTopbar();
  renderView();
}

// ---------------------------------------------------------------- sidebar

function renderSidebar() {
  const list = $('#chat-list');
  list.innerHTML = '';
  for (const chat of state.chats) {
    const item = document.createElement('div');
    item.className = `chat-item${chat.id === state.chatId ? ' active' : ''}`;
    const project = state.projects.find((p) => p.id === chat.project_id);
    item.innerHTML = `<span>${project ? project.emoji + ' ' : ''}${escapeHtml(chat.title)}</span>`;
    const del = document.createElement('button');
    del.className = 'icon';
    del.textContent = '✕';
    del.onclick = async (ev) => {
      ev.stopPropagation();
      await api(`/chats/${chat.id}`, { method: 'DELETE' });
      if (state.chatId === chat.id) {
        state.chatId = null;
        state.messages = [];
      }
      await load();
    };
    item.appendChild(del);
    item.onclick = () => openChat(chat.id);
    list.appendChild(item);
  }
}

// ----------------------------------------------------------------- topbar

function fillSelect(el, options, value, placeholder) {
  el.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    el.appendChild(opt);
  }
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    el.appendChild(opt);
  }
  el.value = value || '';
}

function renderTopbar() {
  fillSelect(
    $('#sel-model'),
    allModels().map((m) => ({ value: m.ref, label: m.label })),
    state.model,
    allModels().length ? null : 'nenhum modelo — abra Provedores'
  );
  fillSelect(
    $('#sel-gem'),
    state.gems.map((g) => ({ value: g.id, label: `${g.emoji} ${g.name}` })),
    state.gemId,
    'sem gem'
  );
  fillSelect(
    $('#sel-project'),
    state.projects.map((p) => ({ value: p.id, label: `${p.emoji} ${p.name}` })),
    state.projectId,
    'sem projeto'
  );
  const chat = state.chats.find((c) => c.id === state.chatId);
  $('#chat-title').textContent = chat ? chat.title : '';
}

// -------------------------------------------------------------------- chat

function addMessageEl(role, text, meta = '') {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = `<div class="who">${role === 'user' ? 'você' : escapeHtml(meta || 'ia')}</div>
    <div class="body">${renderText(text)}</div>`;
  $('#messages').appendChild(el);
  scrollDown();
  return el.querySelector('.body');
}

function addNote(text, cls = '') {
  const el = document.createElement('div');
  el.className = `note ${cls}`;
  el.textContent = text;
  $('#messages').appendChild(el);
  scrollDown();
  return el;
}

function scrollDown() {
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
}

function renderMessages() {
  $('#messages').innerHTML = '';
  for (const m of state.messages) {
    if (m.role === 'system') continue;
    addMessageEl(m.role, m.content, modelLabel(m.model));
  }
}

async function openChat(id) {
  const data = await api(`/chats/${id}`);
  state.chatId = id;
  state.messages = data.messages;
  state.model = data.chat.model || state.model;
  state.gemId = data.chat.gem_id || '';
  state.projectId = data.chat.project_id || '';
  switchView('chat');
  renderSidebar();
  renderTopbar();
  renderMessages();
  closeSidebarOnMobile();
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
  state.chats.unshift({ ...chat, message_count: 0 });
  renderSidebar();
  return chat.id;
}

async function send(text) {
  if (!text.trim()) return;
  if (!state.model) {
    addNote('nenhum modelo escolhido — abra Provedores e cadastre um', 'err');
    return;
  }
  const chatId = await ensureChat();
  addMessageEl('user', text);

  const controller = new AbortController();
  state.streaming = controller;
  $('#btn-stop').hidden = false;
  $('#btn-send').disabled = true;

  let bodyEl = null;
  let answer = '';

  try {
    const res = await fetch(`/api/chats/${chatId}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': TOKEN },
      body: JSON.stringify({ content: text, model: state.model }),
      signal: controller.signal
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!raw.startsWith('data: ')) continue;
        const ev = JSON.parse(raw.slice(6));

        if (ev.type === 'memory-used') {
          addNote(`🧠 lembrou de ${ev.items.length}: ${ev.items.map((i) => i.text).join(' · ')}`);
        } else if (ev.type === 'delta') {
          if (!bodyEl) bodyEl = addMessageEl('assistant', '', modelLabel(state.model));
          answer += ev.text;
          bodyEl.innerHTML = renderText(answer);
          scrollDown();
        } else if (ev.type === 'memory-new') {
          addNote(`🧠 aprendeu: ${ev.items.map((i) => i.text).join(' · ')}`, 'new');
        } else if (ev.type === 'error') {
          addNote(`erro: ${ev.message}`, 'err');
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') addNote(`erro: ${err.message}`, 'err');
  } finally {
    state.streaming = null;
    $('#btn-stop').hidden = true;
    $('#btn-send').disabled = false;
    const chat = state.chats.find((c) => c.id === chatId);
    if (chat && chat.title === 'Nova conversa') {
      chat.title = text.trim().split('\n')[0].slice(0, 60);
      renderSidebar();
      renderTopbar();
    }
  }
}

// ------------------------------------------------------------------- views

function switchView(view) {
  state.view = view;
  for (const el of document.querySelectorAll('.view')) el.hidden = true;
  $(`#view-${view}`).hidden = false;
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.view === view);
  }
  renderView();
}

function renderView() {
  if (state.view === 'providers') renderProviders();
  if (state.view === 'gems') renderGems();
  if (state.view === 'projects') renderProjects();
  if (state.view === 'memory') renderMemory();
  if (state.view === 'settings') renderSettings();
}

// ---------------------------------------------------------------- provedores

async function renderProviders() {
  const el = $('#view-providers');
  el.className = 'view panel';
  const presets = await api('/presets');

  el.innerHTML = `
    <h2>Provedores</h2>
    <p class="hint">IA local, de API e de CLI — tudo aparece no mesmo seletor de modelo.</p>
    <div class="row">
      <button id="btn-discover">Procurar IA local nesta máquina</button>
    </div>
    <div id="providers-cards"></div>
    <div class="card">
      <h3>Adicionar</h3>
      <label class="field">Preset
        <select id="new-preset">
          <option value="">— personalizado —</option>
          ${presets.map((p) => `<option value="${p.key}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </label>
      <label class="field">Nome <input id="new-name" placeholder="Meu provedor" /></label>
      <label class="field">Tipo
        <select id="new-kind">
          <option value="openai">openai-compatível</option>
          <option value="anthropic">anthropic</option>
          <option value="google">google</option>
          <option value="ollama">ollama</option>
          <option value="cli">cli</option>
        </select>
      </label>
      <label class="field">Endereço base <input id="new-url" placeholder="http://127.0.0.1:1234/v1" /></label>
      <label class="field">Nome da chave <input id="new-secret" placeholder="OPENAI_API_KEY" /></label>
      <label class="field">Chave (fica só no servidor) <input id="new-value" type="password" /></label>
      <label class="field">Config do CLI (JSON)
        <textarea id="new-config" rows="3" placeholder='{"command":"claude","args":["-p"],"stdin":true,"models":["default"]}'></textarea>
      </label>
      <button id="btn-add-provider" class="primary">Adicionar</button>
    </div>`;

  const cards = el.querySelector('#providers-cards');
  for (const p of state.providers) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${escapeHtml(p.name)}
        <span class="tag">${p.kind}</span>
        ${p.auto ? '<span class="tag">auto</span>' : ''}
        ${p.secret_name ? `<span class="tag ${p.has_secret ? 'on' : 'off'}">${p.has_secret ? 'com chave' : 'sem chave'}</span>` : ''}
      </h3>
      <div class="meta">${escapeHtml(p.base_url || p.config.command || '')} · ${p.models.length} modelo(s)</div>
      <div class="row">
        <button data-act="refresh">Atualizar modelos</button>
        <button data-act="key">Trocar chave</button>
        <button data-act="del" class="danger">Remover</button>
      </div>`;
    card.querySelector('[data-act=refresh]').onclick = async () => {
      try {
        await api(`/providers/${p.id}/refresh`, { method: 'POST' });
        await load();
        switchView('providers');
      } catch (err) {
        alert(err.message);
      }
    };
    card.querySelector('[data-act=key]').onclick = async () => {
      const name = p.secret_name || prompt('Nome da variável da chave:', 'API_KEY');
      if (!name) return;
      const value = prompt(`Valor de ${name}:`);
      if (value === null) return;
      await api(`/providers/${p.id}`, { method: 'PATCH', body: { secretName: name, secretValue: value } });
      await load();
      switchView('providers');
    };
    card.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`Remover ${p.name}?`)) return;
      await api(`/providers/${p.id}`, { method: 'DELETE' });
      await load();
      switchView('providers');
    };
    cards.appendChild(card);
  }

  el.querySelector('#btn-discover').onclick = async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'procurando...';
    const { found } = await api('/discover', { method: 'POST' });
    await load();
    switchView('providers');
    alert(found.length ? `encontrado: ${found.map((f) => f.name).join(', ')}` : 'nada novo encontrado');
  };

  el.querySelector('#new-preset').onchange = (ev) => {
    const preset = presets.find((p) => p.key === ev.target.value);
    if (!preset) return;
    el.querySelector('#new-name').value = preset.name;
    el.querySelector('#new-kind').value = preset.kind;
    el.querySelector('#new-url').value = preset.baseUrl || '';
    el.querySelector('#new-secret').value = preset.secretName || '';
    el.querySelector('#new-config').value = preset.config ? JSON.stringify(preset.config) : '';
  };

  el.querySelector('#btn-add-provider').onclick = async () => {
    const configText = el.querySelector('#new-config').value.trim();
    let config = {};
    if (configText) {
      try {
        config = JSON.parse(configText);
      } catch {
        return alert('config do CLI não é JSON válido');
      }
    }
    try {
      const out = await api('/providers', {
        method: 'POST',
        body: {
          name: el.querySelector('#new-name').value || 'Provedor',
          kind: el.querySelector('#new-kind').value,
          baseUrl: el.querySelector('#new-url').value || null,
          secretName: el.querySelector('#new-secret').value || null,
          secretValue: el.querySelector('#new-value').value || null,
          config
        }
      });
      await load();
      switchView('providers');
      if (out.error) alert(`provedor criado, mas não deu pra listar modelos: ${out.error}`);
    } catch (err) {
      alert(err.message);
    }
  };
}

// ---------------------------------------------------------------------- gems

function renderGems() {
  const el = $('#view-gems');
  el.className = 'view panel';
  el.innerHTML = `
    <h2>Gems</h2>
    <p class="hint">Personalidade, modelo preferido e escopo de memória. "Sem filtro" vale de verdade em modelo local; em API hospedada, o provedor aplica a política dele.</p>
    <div id="gems-cards"></div>
    <div class="card">
      <h3>Nova gem</h3>
      <label class="field">Emoji <input id="g-emoji" value="💎" /></label>
      <label class="field">Nome <input id="g-name" /></label>
      <label class="field">Instruções <textarea id="g-prompt" rows="4"></textarea></label>
      <label class="field">Modo
        <select id="g-mode"><option value="chat">conversa</option><option value="coding">coding</option></select>
      </label>
      <label class="field">Modelo preferido
        <select id="g-model">
          <option value="">— o que estiver selecionado —</option>
          ${allModels().map((m) => `<option value="${m.ref}">${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field">Temperatura <input id="g-temp" type="number" step="0.1" min="0" max="2" /></label>
      <label class="field"><input type="checkbox" id="g-unfiltered" style="display:inline;width:auto" /> sem filtro</label>
      <button id="btn-add-gem" class="primary">Criar</button>
    </div>`;

  const cards = el.querySelector('#gems-cards');
  for (const g of state.gems) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${g.emoji} ${escapeHtml(g.name)}
        <span class="tag">${g.mode}</span>
        ${g.unfiltered ? '<span class="tag off">sem filtro</span>' : ''}
        ${g.memory_read ? '<span class="tag on">lê memória</span>' : '<span class="tag">não lê</span>'}
        ${g.memory_write ? '<span class="tag on">grava memória</span>' : '<span class="tag">não grava</span>'}
      </h3>
      <div class="meta">${escapeHtml((g.system_prompt || '').slice(0, 220))}</div>
      <div class="row">
        <button data-act="use">Usar</button>
        <button data-act="edit">Editar instruções</button>
        <button data-act="mem">Alternar memória</button>
        <button data-act="del" class="danger">Remover</button>
      </div>`;
    card.querySelector('[data-act=use]').onclick = () => {
      state.gemId = g.id;
      localStorage.setItem('iaunifier.gem', g.id);
      if (g.model) state.model = g.model;
      state.chatId = null;
      state.messages = [];
      switchView('chat');
      renderTopbar();
      renderMessages();
    };
    card.querySelector('[data-act=edit]').onclick = async () => {
      const prompt_ = prompt('Instruções da gem:', g.system_prompt || '');
      if (prompt_ === null) return;
      await api(`/gems/${g.id}`, { method: 'PATCH', body: { system_prompt: prompt_ } });
      await load();
      switchView('gems');
    };
    card.querySelector('[data-act=mem]').onclick = async () => {
      await api(`/gems/${g.id}`, {
        method: 'PATCH',
        body: { memory_read: !g.memory_read, memory_write: !g.memory_write }
      });
      await load();
      switchView('gems');
    };
    card.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`Remover ${g.name}?`)) return;
      await api(`/gems/${g.id}`, { method: 'DELETE' });
      await load();
      switchView('gems');
    };
    cards.appendChild(card);
  }

  el.querySelector('#btn-add-gem').onclick = async () => {
    await api('/gems', {
      method: 'POST',
      body: {
        name: el.querySelector('#g-name').value || 'Nova gem',
        emoji: el.querySelector('#g-emoji').value || '💎',
        system_prompt: el.querySelector('#g-prompt').value,
        mode: el.querySelector('#g-mode').value,
        model: el.querySelector('#g-model').value || null,
        temperature: el.querySelector('#g-temp').value ? Number(el.querySelector('#g-temp').value) : null,
        unfiltered: el.querySelector('#g-unfiltered').checked
      }
    });
    await load();
    switchView('gems');
  };
}

// ------------------------------------------------------------------ projetos

function renderProjects() {
  const el = $('#view-projects');
  el.className = 'view panel';
  el.innerHTML = `
    <h2>Projetos</h2>
    <p class="hint">Agrupa conversas, tem instrução própria e memória de escopo próprio. O diretório é usado pelas IAs de CLI no modo coding.</p>
    <div id="proj-cards"></div>
    <div class="card">
      <h3>Novo projeto</h3>
      <label class="field">Emoji <input id="p-emoji" value="📁" /></label>
      <label class="field">Nome <input id="p-name" /></label>
      <label class="field">Instruções <textarea id="p-inst" rows="3"></textarea></label>
      <label class="field">Diretório <input id="p-dir" placeholder="/Users/você/Projetos/algo" /></label>
      <button id="btn-add-proj" class="primary">Criar</button>
    </div>`;

  const cards = el.querySelector('#proj-cards');
  for (const p of state.projects) {
    const chats = state.chats.filter((c) => c.project_id === p.id).length;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${p.emoji} ${escapeHtml(p.name)}</h3>
      <div class="meta">${chats} conversa(s) · ${escapeHtml(p.workdir || 'sem diretório')}</div>
      <div class="meta">${escapeHtml((p.instructions || '').slice(0, 200))}</div>
      <div class="row">
        <button data-act="use">Conversar neste projeto</button>
        <button data-act="del" class="danger">Remover</button>
      </div>`;
    card.querySelector('[data-act=use]').onclick = () => {
      state.projectId = p.id;
      state.chatId = null;
      state.messages = [];
      switchView('chat');
      renderTopbar();
      renderMessages();
    };
    card.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`Remover ${p.name}?`)) return;
      await api(`/projects/${p.id}`, { method: 'DELETE' });
      await load();
      switchView('projects');
    };
    cards.appendChild(card);
  }

  el.querySelector('#btn-add-proj').onclick = async () => {
    await api('/projects', {
      method: 'POST',
      body: {
        name: el.querySelector('#p-name').value || 'Novo projeto',
        emoji: el.querySelector('#p-emoji').value || '📁',
        instructions: el.querySelector('#p-inst').value,
        workdir: el.querySelector('#p-dir').value || null
      }
    });
    await load();
    switchView('projects');
  };
}

// ------------------------------------------------------------------- memória

async function renderMemory() {
  const el = $('#view-memory');
  el.className = 'view panel';
  const memories = await api('/memories');

  el.innerHTML = `
    <h2>Memória compartilhada</h2>
    <p class="hint">Um banco só, lido e escrito por qualquer modelo. O que você contou pro Claude, o GPT lembra.</p>
    <div class="card">
      <label class="field">Novo fato <input id="m-text" placeholder="Ex.: prefere respostas curtas e sem enrolação" /></label>
      <div class="row">
        <button id="btn-add-mem" class="primary">Guardar</button>
        <label style="font-size:13px;color:var(--muted)">
          <input type="checkbox" id="m-pin" style="display:inline;width:auto" /> fixar
        </label>
      </div>
    </div>
    <div class="card">
      <h3>Importar de outra IA</h3>
      <div class="meta">Export do ChatGPT ou do Claude (conversations.json), ou texto solto.</div>
      <div class="row"><input type="file" id="m-file" accept=".json,.md,.txt" /></div>
      <div id="import-status" class="meta"></div>
    </div>
    <div class="card">
      <h3>${memories.length} fato(s)</h3>
      <div id="mem-list"></div>
    </div>`;

  const list = el.querySelector('#mem-list');
  for (const m of memories) {
    const item = document.createElement('div');
    item.className = 'mem-item';
    item.innerHTML = `
      <div class="txt">${m.pinned ? '📌 ' : ''}${escapeHtml(m.text)}
        <div class="src">${m.source}${m.source_ref ? ' · ' + escapeHtml(m.source_ref) : ''}</div>
      </div>`;
    const pin = document.createElement('button');
    pin.className = 'icon';
    pin.textContent = m.pinned ? '📌' : '📍';
    pin.title = 'fixar/desfixar';
    pin.onclick = async () => {
      await api(`/memories/${m.id}`, { method: 'PATCH', body: { pinned: !m.pinned } });
      renderMemory();
    };
    const del = document.createElement('button');
    del.className = 'icon';
    del.textContent = '✕';
    del.onclick = async () => {
      await api(`/memories/${m.id}`, { method: 'DELETE' });
      renderMemory();
    };
    item.append(pin, del);
    list.appendChild(item);
  }

  el.querySelector('#btn-add-mem').onclick = async () => {
    const text = el.querySelector('#m-text').value.trim();
    if (!text) return;
    await api('/memories', {
      method: 'POST',
      body: { text, pinned: el.querySelector('#m-pin').checked }
    });
    renderMemory();
  };

  el.querySelector('#m-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const status = el.querySelector('#import-status');
    status.textContent = 'lendo e extraindo... isso pode demorar em export grande.';
    try {
      const text = await file.text();
      const out = await api(`/memories/import?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: text,
        raw: true
      });
      status.textContent = `${out.conversations} conversa(s), ${out.messages} mensagem(ns) → ${out.facts.length} fato(s) novo(s).`;
      renderMemory();
    } catch (err) {
      status.textContent = `falhou: ${err.message}`;
    }
  };
}

// -------------------------------------------------------------------- config

async function renderSettings() {
  const el = $('#view-settings');
  el.className = 'view panel';
  const settings = await api('/settings');
  const chatModels = allModels();
  const embeds = embeddingModels();

  el.innerHTML = `
    <h2>Configuração</h2>
    <p class="hint">Tudo fica em ~/.iaunifier. As chaves nunca saem do servidor.</p>
    <div class="card">
      <h3>Memória</h3>
      <label class="field"><input type="checkbox" id="s-enabled" style="display:inline;width:auto" ${settings.memory.enabled ? 'checked' : ''} /> memória ligada</label>
      <label class="field"><input type="checkbox" id="s-auto" style="display:inline;width:auto" ${settings.memory.autoExtract ? 'checked' : ''} /> aprender sozinho depois de cada resposta</label>
      <label class="field">Fatos injetados por vez <input id="s-max" type="number" min="1" max="50" value="${settings.memory.maxInjected}" /></label>
      <label class="field">Modelo que extrai os fatos
        <select id="s-extractor">
          <option value="">— heurística local, sem chamar modelo —</option>
          ${chatModels.map((m) => `<option value="${m.ref}" ${settings.memory.extractorModel === m.ref ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field">Modelo de embedding (busca semântica)
        <select id="s-embed">
          <option value="">— sem embedding, só busca por palavra —</option>
          ${embeds.map((m) => `<option value="${m.ref}" ${settings.memory.embeddingModel === m.ref ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </label>
      <button id="btn-save-settings" class="primary">Salvar</button>
    </div>
    <div class="card">
      <h3>Acesso</h3>
      <div class="meta">Token exigido: ${settings.requireToken ? 'sim' : 'não'} · escutando em ${settings.host}:${settings.port}</div>
      <div class="meta">Chaves guardadas: ${settings.secrets.join(', ') || 'nenhuma'}</div>
    </div>`;

  el.querySelector('#btn-save-settings').onclick = async () => {
    await api('/settings', {
      method: 'PATCH',
      body: {
        memory: {
          enabled: el.querySelector('#s-enabled').checked,
          autoExtract: el.querySelector('#s-auto').checked,
          maxInjected: Number(el.querySelector('#s-max').value) || 12,
          extractorModel: el.querySelector('#s-extractor').value || null,
          embeddingModel: el.querySelector('#s-embed').value || null
        }
      }
    });
    renderSettings();
  };
}

// -------------------------------------------------------------------- eventos

$('#composer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('#input');
  const text = input.value;
  input.value = '';
  input.style.height = 'auto';
  send(text);
});

$('#input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    $('#composer').requestSubmit();
  }
});

$('#input').addEventListener('input', (ev) => {
  ev.target.style.height = 'auto';
  ev.target.style.height = `${Math.min(ev.target.scrollHeight, 200)}px`;
});

$('#btn-stop').onclick = () => state.streaming?.abort();

$('#btn-new-chat').onclick = () => {
  state.chatId = null;
  state.messages = [];
  switchView('chat');
  renderSidebar();
  renderMessages();
  closeSidebarOnMobile();
};

for (const btn of document.querySelectorAll('.nav-item')) {
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
  if (state.chatId) api(`/chats/${state.chatId}`, { method: 'PATCH', body: { gem_id: state.gemId || null } });
};

$('#sel-project').onchange = (ev) => {
  state.projectId = ev.target.value;
  if (state.chatId) {
    api(`/chats/${state.chatId}`, { method: 'PATCH', body: { project_id: state.projectId || null } });
  }
};

function closeSidebarOnMobile() {
  if (window.innerWidth <= 720) $('#sidebar').classList.remove('open');
}
$('#btn-open-side').onclick = () => $('#sidebar').classList.add('open');
$('#btn-close-side').onclick = () => $('#sidebar').classList.remove('open');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

load().catch((err) => addNote(`não carregou: ${err.message}`, 'err'));
