// Estado, acesso à API e peças de interface usadas por todas as telas.

import { icon, COLORS } from './icons.js';

// ------------------------------------------------------------------- token

const params = new URLSearchParams(location.search);
if (params.get('token')) {
  localStorage.setItem('iaunifier.token', params.get('token'));
  history.replaceState({}, '', location.pathname);
}
export const TOKEN = localStorage.getItem('iaunifier.token') || '';

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

/** Seletor de ícone e cor, usado por gems e projetos. */
export function iconPicker(container, { icon: current = 'sparkle', color = 'indigo' } = {}) {
  const names = [
    'sparkle', 'bot', 'code', 'brain', 'book', 'search', 'globe', 'folder',
    'layers', 'spark', 'users', 'key', 'cpu', 'file', 'unlock', 'chat'
  ];
  container.innerHTML = `
    <div class="icon-picker">${names
      .map(
        (n) =>
          `<button type="button" data-name="${n}" class="${n === current ? 'sel' : ''}">${icon(n, 17)}</button>`
      )
      .join('')}</div>
    <div class="color-picker">${COLORS.map(
      (c) =>
        `<button type="button" class="swatch ${c === color ? 'sel' : ''}" data-color="${c}"
           style="background: var(--${c})" title="${c}"></button>`
    ).join('')}</div>`;

  const chosen = { icon: current, color };
  for (const btn of container.querySelectorAll('.icon-picker button')) {
    btn.onclick = () => {
      chosen.icon = btn.dataset.name;
      container.querySelectorAll('.icon-picker button').forEach((b) => b.classList.remove('sel'));
      btn.classList.add('sel');
    };
  }
  for (const btn of container.querySelectorAll('.swatch')) {
    btn.onclick = () => {
      chosen.color = btn.dataset.color;
      container.querySelectorAll('.swatch').forEach((b) => b.classList.remove('sel'));
      btn.classList.add('sel');
    };
  }
  return chosen;
}
