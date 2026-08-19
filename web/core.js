// Estado, acesso à API e peças de interface usadas por todas as telas.

import { icon, COLORS } from './icons.js';

// ------------------------------------------------------------------- token

const params = new URLSearchParams(location.search);
if (params.get('token')) {
  localStorage.setItem('iaunifier.token', params.get('token'));
  history.replaceState({}, '', location.pathname);
}
export const TOKEN = localStorage.getItem('iaunifier.token') || '';

// O manifest é o que descreve o app instalado, e o `start_url` dele precisa
// levar o token — senão o atalho na tela inicial abre num pedido de senha.
// Ele vai buscado com o token na URL por dois motivos: o navegador pede o
// manifest sem os nossos cabeçalhos, e assim o servidor pode exigir o token
// pra devolvê-lo — um manifest com token dentro não pode ficar aberto na rede.
if (TOKEN) {
  const link = document.querySelector('link[rel="manifest"]');
  if (link) link.href = `/manifest.webmanifest?token=${encodeURIComponent(TOKEN)}`;
}

export async function api(path, { method = 'GET', body, raw } = {}) {
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
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * POST que devolve SSE. `onEvent` recebe cada evento; a promessa resolve no
 * fim do stream. Vale pra chat, pesquisa, conselho e download de modelo —
 * EventSource não serve porque não faz POST.
 */
export async function stream(path, body, onEvent, signal) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-iaunifier-token': TOKEN },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
      let event;
      try {
        event = JSON.parse(raw.slice(6));
      } catch {
        continue;
      }
      if (event.type === 'end') return;
      onEvent(event);
    }
  }
}

// ------------------------------------------------------------------ estado

export const state = {
  providers: [],
  gems: [],
  projects: [],
  chats: [],
  settings: null,
  chatId: null,
  chat: null,
  messages: [],
  attachments: [],
  model: localStorage.getItem('iaunifier.model') || '',
  gemId: localStorage.getItem('iaunifier.gem') || '',
  projectId: '',
  view: 'chat',
  streaming: null,
  useWeb: false
};

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export async function refreshState() {
  const data = await api('/state');
  Object.assign(state, data);
  if (!state.model && chatModels().length) state.model = chatModels()[0].ref;
  return state;
}

export function chatModels() {
  return state.providers
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models
        .filter((m) => m.kind === 'chat')
        .map((m) => ({ ref: m.ref, label: `${p.name} · ${m.label}`, provider: p.name }))
    );
}

export function embeddingModels() {
  return state.providers.flatMap((p) =>
    p.models
      .filter((m) => m.kind === 'embedding')
      .map((m) => ({ ref: m.ref, label: `${p.name} · ${m.label}` }))
  );
}

/** O ref é `providerId:modelId` — na tela mostramos o nome legível. */
export function modelLabel(ref) {
  if (!ref) return 'ia';
  return chatModels().find((m) => m.ref === ref)?.label || ref.split(':').slice(1).join(':') || ref;
}

// ------------------------------------------------------------------- peças

export function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** De onde veio um fato da memória, em português e já escapado pra HTML. */
export function origemDoFato(m) {
  // `source_ref` de fato aprendido é "<provedor> · <modelo> · chat <id>"; o que
  // interessa na tela é o nome da conversa, não o id nem o modelo.
  const id = /chat ([\w-]+)$/.exec(m.source_ref || '')?.[1];
  const chat = id && state.chats.find((c) => c.id === id);
  if (chat) return `de “${escapeHtml(chat.title)}”`;
  if (m.source === 'manual') return 'você contou';
  if (m.source === 'import') return 'veio de outra IA';
  if (m.source_ref) return `de ${escapeHtml(m.source_ref)}`;
  return 'aprendido numa conversa';
}

/** "vale pra tudo" ou "só no projeto X", este com a cor do projeto. */
export function escopoDoFato(m) {
  const proj = m.project_id ? state.projects.find((p) => p.id === m.project_id) : null;
  return proj
    ? `<span class="escopo proj" style="--tint: var(--${proj.color || 'indigo'})">só no projeto ${escapeHtml(
        proj.name
      )}</span>`
    : '<span class="escopo">vale pra tudo</span>';
}

/** Preenche os ícones declarados no HTML como `<span data-icon="nome">`. */
export function paintIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.dataset.painted) continue;
    el.dataset.painted = '1';
    el.classList.add('ico');
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18);
  }
}

export function badge(name, color, size = 18) {
  return `<span class="badge${size < 18 ? ' sm' : ''}" style="--tint: var(--${color || 'indigo'})">${icon(
    name,
    size
  )}</span>`;
}

export function fillSelect(el, options, value, placeholder) {
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

export function modelOptions(selected) {
  return chatModels()
    .map(
      (m) =>
        `<option value="${escapeHtml(m.ref)}"${m.ref === selected ? ' selected' : ''}>${escapeHtml(
          m.label
        )}</option>`
    )
    .join('');
}

let toastTimer = 0;
export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  clearTimeout(toastTimer);
  setTimeout(() => el.remove(), 4200);
}

// Nome de cor que aparece pro usuário. Na variável CSS o nome segue em inglês.
const CORES_PT = {
  indigo: 'azul', teal: 'verde-água', amber: 'âmbar', rose: 'rosa',
  violet: 'violeta', sky: 'azul-claro', lime: 'verde-limão', slate: 'cinza'
};

/** Seletor de ícone e cor, usado por perfis e projetos. */
export function iconPicker(container, { icon: current = 'sparkle', color = 'indigo' } = {}) {
  const names = [
    'sparkle', 'bot', 'code', 'brain', 'book', 'search', 'globe', 'folder',
    'layers', 'spark', 'users', 'key', 'cpu', 'file', 'unlock', 'chat'
  ];
  container.innerHTML = `
    <div class="icon-picker">${names
      .map(
        (n) =>
          `<button type="button" data-name="${n}" class="${n === current ? 'sel' : ''}"
             aria-label="ícone ${n}" aria-pressed="${n === current}">${icon(n, 22)}</button>`
      )
      .join('')}</div>
    <div class="color-picker">${COLORS.map(
      (c) =>
        `<button type="button" class="swatch ${c === color ? 'sel' : ''}" data-color="${c}"
           style="background: var(--${c})" title="${CORES_PT[c] || c}" aria-label="cor ${CORES_PT[c] || c}"
           aria-pressed="${c === color}"></button>`
    ).join('')}</div>`;

  const chosen = { icon: current, color };
  const marcar = (grupo, btn) => {
    for (const b of container.querySelectorAll(grupo)) {
      b.classList.remove('sel');
      b.setAttribute('aria-pressed', 'false');
    }
    btn.classList.add('sel');
    btn.setAttribute('aria-pressed', 'true');
  };
  for (const btn of container.querySelectorAll('.icon-picker button')) {
    btn.onclick = () => {
      chosen.icon = btn.dataset.name;
      marcar('.icon-picker button', btn);
    };
  }
  for (const btn of container.querySelectorAll('.swatch')) {
    btn.onclick = () => {
      chosen.color = btn.dataset.color;
      marcar('.swatch', btn);
    };
  }
  return chosen;
}
