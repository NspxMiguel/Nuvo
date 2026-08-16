// Ícones. Traço de 24x24, desenhados aqui mesmo — nenhuma fonte externa e
// nenhum emoji, que muda de desenho a cada sistema operacional.

const PATHS = {
  chat: 'M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  sparkle: 'M12 3l2.2 5.3L20 10l-5.8 1.7L12 17l-2.2-5.3L4 10l5.8-1.7Z M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z',
  // "memória compartilhada" desenha melhor como nós ligados do que como cérebro.
  brain:
    'M12 6.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M4.5 22a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M19.5 22a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M12 11.5v3 M12 14.5 5.5 17.5 M12 14.5l6.5 3',
  plug: 'M9 2.5v5 M15 2.5v5 M6.5 7.5h11v3.5a5.5 5.5 0 0 1-11 0Z M12 16.5v5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1.2Z',
  plus: 'M12 5v14 M5 12h14',
  close: 'M18 6 6 18 M6 6l12 12',
  send: 'M4 12l16-8-6 16-2.5-6.5Z M11.5 13.5 20 4',
  stop: 'M7 7h10v10H7Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
  paperclip: 'M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l8-8',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3.5 9h17 M3.5 15h17 M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z',
  refresh: 'M20 11A8 8 0 0 0 6 6.3L3 9 M4 13a8 8 0 0 0 14 4.7l3-2.7 M3 4v5h5 M21 20v-5h-5',
  trash: 'M4 7h16 M10 4h4 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  pin: 'M12 17v5 M7 10.5V4h10v6.5l3 4.5H4Z',
  copy: 'M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  download: 'M12 3v12 M7 11l5 5 5-5 M4 20h16',
  edit: 'M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16Z M13.5 6.5 17.5 10.5',
  check: 'M4 12.5 9.5 18 20 6',
  chevron: 'M6 9l6 6 6-6',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M12 1v3 M12 20v3 M4.2 4.2l2 2 M17.8 17.8l2 2 M1 12h3 M20 12h3 M4.2 19.8l2-2 M17.8 6.2l2-2',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  users: 'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2 21v-1.5A4.5 4.5 0 0 1 6.5 15h3A4.5 4.5 0 0 1 14 19.5V21 M16 4.3a3.5 3.5 0 0 1 0 6.6 M18 15.2a4.5 4.5 0 0 1 4 4.3V21',
  mic: 'M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15Z M5 11a7 7 0 0 0 14 0 M12 18v3 M8.5 21h7',
  speaker: 'M4 9h3l5-4v14l-5-4H4Z M16 9.5a3.5 3.5 0 0 1 0 5 M18.5 7a7 7 0 0 1 0 10',
  key: 'M15.5 4a5.5 5.5 0 1 0-4.4 8.8L4 20v0h3v-2h2v-2h2l2.2-2.2A5.5 5.5 0 0 0 15.5 4Z M17 8h.01',
  cpu: 'M7 7h10v10H7Z M4 10h3 M4 14h3 M17 10h3 M17 14h3 M10 4v3 M14 4v3 M10 17v3 M14 17v3',
  file: 'M6 3h7l5 5v13H6Z M13 3v5h5',
  alert: 'M12 8v5 M12 17h.01 M10.3 3.9 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z',
  play: 'M7 4.5 19 12 7 19.5Z',
  command: 'M9 9h6v6H9Z M9 9V6a3 3 0 1 0-3 3Z M15 9h3a3 3 0 1 0-3-3Z M9 15H6a3 3 0 1 0 3 3Z M15 15v3a3 3 0 1 0 3-3Z',
  bot: 'M7 9h10a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-5A2.5 2.5 0 0 1 7 9Z M12 5.5V9 M12 3.6h.01 M9.5 13.5h.01 M14.5 13.5h.01 M2 13v2.5 M22 13v2.5',
  code: 'M8.5 8 4 12.5 8.5 17 M15.5 8 20 12.5 15.5 17 M13.5 5l-3 15',
  unlock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z M8 11V7a4 4 0 0 1 7.5-2',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z M8 7h7 M8 11h7',
  layers: 'M12 3 2.5 8 12 13l9.5-5Z M2.5 13 12 18l9.5-5 M2.5 17.5 12 22.5l9.5-5',
  spark: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8',
  filter: 'M3 5h18l-7 8v6l-4 2v-8Z',
  archive: 'M3 5h18v4H3Z M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9 M10 13h4',
  arrowUp: 'M12 20V5 M6 11l6-6 6 6',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'
};

export const ICON_NAMES = Object.keys(PATHS);

/** HTML de um ícone. `size` em pixels; a cor vem do `currentColor`. */
export function icon(name, size = 18) {
  const d = PATHS[name] || PATHS.sparkle;
  const shapes = d
    .split(' M')
    .map((part, i) => `<path d="${i === 0 ? part : 'M' + part}" />`)
    .join('');
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${shapes}</svg>`;
}

/** Ícone como elemento, pra quando o destino não aceita HTML solto. */
export function iconEl(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = icon(name, size);
  return span;
}

// Paleta usada por gems e projetos. O nome vira uma variável CSS.
export const COLORS = ['indigo', 'teal', 'amber', 'rose', 'violet', 'sky', 'lime', 'slate'];
