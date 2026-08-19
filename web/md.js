// Markdown e destaque de código, escritos aqui pra não depender de CDN — a
// página é servida pelo próprio servidor da casa e precisa funcionar sem
// internet.

import { t } from './i18n.js';

export function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ------------------------------------------------------- trechos já prontos
//
// Toda passada aqui é uma expressão regular rodando por cima do resultado da
// anterior. Sem cuidado, a segunda enxerga o HTML que a primeira emitiu e
// reescreve dentro dele — foi assim que endereço com parêntese virava atributo
// solto na tag do link, e que endereço dentro de crase virava link.
//
// A saída de cada passada sai do texto e vira um marcador; no fim os marcadores
// voltam a ser HTML. O índice do marcador não usa dígito nem letra: as passadas
// seguintes procuram número, palavra e endereço, e comeriam o próprio marcador.
// Os caracteres são da área de uso privado do Unicode, que não aparece em texto.

const MARCA = '\uE000';
const DIGITOS = '\uE001\uE002\uE003\uE004\uE005\uE006\uE007\uE008\uE009\uE00A';
const SEM_MARCA = /[\uE000-\uE00A]/g;
const MARCADOR_SOLTO = /\uE000([\uE001-\uE00A]+)\uE000/g;
const MARCADOR_ESPACADO = / \uE000([\uE001-\uE00A]+)\uE000 /g;

function guardar(slots, html) {
  slots.push(html);
  return MARCA + String(slots.length - 1).replace(/\d/g, (d) => DIGITOS[Number(d)]) + MARCA;
}

/**
 * Devolve o HTML guardado. Em laço porque um trecho pode conter outro: código
 * dentro do rótulo de um link, comentário dentro de uma string.
 */
function restaurar(text, slots, re) {
  let out = text;
  for (let volta = 0; volta < 6 && out.includes(MARCA); volta++) {
    const antes = out;
    out = out.replace(re, (todo, code) => {
      const i = Number([...code].map((c) => DIGITOS.indexOf(c)).join(''));
      return slots[i] ?? todo;
    });
    if (out === antes) break;
  }
  return out;
}

// ------------------------------------------------------------------ código

const KEYWORDS =
  /\b(?:const|let|var|function|return|if|else|for|while|class|new|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|of|in|this|super|extends|yield|static|get|set|def|elif|lambda|pass|raise|with|as|None|True|False|self|print|end|do|then|fi|esac|case|local|echo|fn|pub|impl|struct|enum|match|use|mut|package|type|interface|func|go|defer|nil|public|private|protected|void|int|float|double|bool|string|select|insert|update|delete|where|values)\b/g;

/**
 * Destaque genérico: comentário, string, número e palavra-chave. Não é um
 * parser de linguagem — é o suficiente pra ler código na tela.
 */
function highlight(code) {
  const slots = [];
  const stash = (cls, text) => ` ${guardar(slots, `<span class="tok ${cls}">${text}</span>`)} `;

  const out = escapeHtml(code)
    .replace(SEM_MARCA, '')
    // Comentário de bloco e de linha, e string — primeiro, pra não deixar
    // palavra-chave dentro de string ser pintada.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => stash('com', m))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + stash('com', m.slice(p.length)))
    .replace(/(^|\s)#[^\n]*/g, (m, p) => p + stash('com', m.slice(p.length)))
    .replace(/(&quot;|&#39;|`)(?:\\.|(?!\1)[\s\S])*?\1/g, (m) => stash('str', m))
    .replace(/\b\d+(?:\.\d+)?\b/g, (m) => stash('num', m))
    .replace(KEYWORDS, (m) => stash('kw', m))
    .replace(/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, (m) => stash('fn', m));

  return restaurar(out, slots, MARCADOR_ESPACADO);
}

// ---------------------------------------------------------------- markdown

// Endereço: parêntese só vale em par. Sem isso o `)` que fecha o `](...)` do
// markdown entrava na URL, e o resto do endereço saía por fora das aspas do
// `href` que a passada anterior tinha acabado de escrever.
const LINK_MD = /\[([^\]]+)\]\((https?:\/\/(?:[^\s()<>"'`]|\([^\s()<>"'`]*\))+)\)/g;
const LINK_SOLTO = /(^|[\s(])(https?:\/\/(?:[^\s()<>"'`]|\([^\s()<>"'`]*\))+)/g;
// Ponto e vírgula ficam de fora do corte: fecham entidade HTML (&amp;).
const PONTUACAO_FINAL = /[.,:!?]+$/;

/** Negrito, itálico e riscado. Separado porque roda também no rótulo do link. */
function enfase(text) {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

function inline(text) {
  const slots = [];
  const link = (href, rotulo) =>
    guardar(slots, `<a href="${href}" target="_blank" rel="noopener noreferrer">${rotulo}</a>`);

  const out = escapeHtml(text)
    .replace(SEM_MARCA, '')
    // Código primeiro: dentro de crase não existe link nem ênfase.
    .replace(/`([^`]+)`/g, (_, code) => guardar(slots, `<code>${code}</code>`))
    // O link já sai guardado, e por isso a passada do endereço solto não tem
    // como reescrever por dentro do href que esta aqui acabou de emitir.
    .replace(LINK_MD, (_, rotulo, href) => link(href, enfase(rotulo)))
    // Endereço solto também vira link — resposta com fonte costuma colar cru.
    .replace(LINK_SOLTO, (_, antes, href) => {
      // Pontuação colada no fim é da frase, não do endereço.
      const fim = (href.match(PONTUACAO_FINAL) || [''])[0];
      const limpo = href.slice(0, href.length - fim.length);
      return antes + link(limpo, limpo) + fim;
    });

  return restaurar(enfase(out), slots, MARCADOR_SOLTO);
}

function tableRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Markdown → HTML. Cobre o que um modelo realmente usa: título, lista,
 * numeração, citação, tabela, régua, código com linguagem e texto corrido.
 */
export function renderMarkdown(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const flushParagraph = (buffer) => {
    if (!buffer.length) return;
    out.push(`<p>${inline(buffer.join('\n')).replace(/\n/g, '<br />')}</p>`);
    buffer.length = 0;
  };
  const paragraph = [];

  while (i < lines.length) {
    const line = lines[i];

    // Bloco de código.
    const fence = line.match(/^\s*```+\s*([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph(paragraph);
      const lang = fence[1] || '';
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const code = body.join('\n');
      out.push(
        `<div class="code"><div class="code-head"><span>${escapeHtml(lang || t('texto'))}</span>` +
          `<button class="code-copy" type="button" data-code="${encodeURIComponent(code)}">${t(
            'copiar'
          )}</button></div>` +
          `<pre><code>${highlight(code)}</code></pre></div>`
      );
      continue;
    }

    // Tabela: cabeçalho seguido da linha de traços.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flushParagraph(paragraph);
      const head = tableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(tableRow(lines[i++]));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head
          .map((c) => `<th>${inline(c)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraph);
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph(paragraph);
      out.push('<hr />');
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph(paragraph);
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph(paragraph);
      const ordered = Boolean(numbered);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/);
        if (!m) {
          // Continuação recuada do item anterior.
          if (items.length && /^\s{2,}\S/.test(lines[i])) {
            items[items.length - 1] += `\n${lines[i].trim()}`;
            i++;
            continue;
          }
          break;
        }
        items.push(m[2]);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(
        `<${tag}>${items
          .map((item) => `<li>${inline(item).replace(/\n/g, '<br />')}</li>`)
          .join('')}</${tag}>`
      );
      continue;
    }

    if (!line.trim()) {
      flushParagraph(paragraph);
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }

  flushParagraph(paragraph);
  return out.join('\n');
}

/** Liga o botão "copiar" dos blocos de código de um container. */
export function wireCodeCopy(root) {
  for (const btn of root.querySelectorAll('.code-copy')) {
    if (btn.dataset.wired) continue;
    btn.dataset.wired = '1';
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code));
        btn.textContent = t('copiado');
      } catch {
        btn.textContent = t('não deu');
      }
      setTimeout(() => {
        btn.textContent = t('copiar');
      }, 1400);
    };
  }
}
