// Protótipo de desenho. Sem rede: dados fixos, e os momentos ao vivo
// (streaming, conselho, pesquisa, download) simulados por timer.
// O app de verdade continua em app.js/views.js — aqui se prova o CSS e o movimento.

import { icon } from './icons.js';
import { ligarBrilho, roseta } from './glow.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const timers = [];
const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
const every = (fn, ms) => { const id = setInterval(fn, ms); timers.push(id); return id; };
const limpar = () => { while (timers.length) { const t = timers.pop(); clearTimeout(t); clearInterval(t); } };

function pintarIcones(root = document) {
  for (const el of $$('[data-icon]', root)) {
    if (el.dataset.pronto) continue;
    el.dataset.pronto = '1';
    el.classList.add('ico');
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 19);
  }
}

// número que sobe em vez de trocar
function subir(el, ate, ms = 700) {
  const de = Number(el.textContent.replace(/\D/g, '')) || 0;
  const t0 = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - t0) / ms);
    el.textContent = Math.round(de + (ate - de) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

const brilho = ligarBrilho($('#glow'));

// ------------------------------------------------------------------- dados

const MODELOS = [
  ['Claude Sonnet 4', 'claude-sonnet-4'],
  ['GPT-4o', 'gpt-4o'],
  ['Gemini 2.0 Flash', 'gemini-2.0-flash'],
  ['Llama 3.1 8B (aqui)', 'llama3.1:8b'],
  ['Qwen Coder 14B (aqui)', 'qwen2.5-coder:14b'],
  ['Claude Code (terminal)', 'claude-code']
];

const CONVERSAS = [
  ['Fixadas', ['Regras da casa (Home Assistant)', 'Leituras de 2026']],
  ['Hoje', ['Trocar o disco do servidor', 'Revisão do contrato de aluguel', 'Erro no backup da madrugada']],
  ['Ontem', ['Rota de bicicleta pro trabalho', 'Resumo do epub do Sennett', 'Qual modelo cabe no servidor']]
];

const FATOS = [
  ['Prefere respostas curtas, sem introdução nem resumo no fim.', 'conversa “Revisão do contrato”', 'vale pra tudo', null],
  ['O servidor de casa é um Debian 12 com 32 GB de memória e dois discos em espelho.', 'conversa “Trocar o disco”', 'vale pra tudo', null],
  ['Escreve em português do Brasil e evita anglicismo.', 'importação do ChatGPT, março', 'vale pra tudo', null],
  ['Usa uv, não pip. Não quer sugestão de virtualenv.', 'conversa “Erro no backup”', 'só no projeto IAUnifier', 'teal'],
  ['O contrato de aluguel vence em outubro de 2026.', 'anexo contrato-2025.pdf', 'só no projeto Casa', 'amber']
];

function encherTopbar() {
  $('#sel-model').innerHTML = MODELOS.map(([n]) => `<option>${n}</option>`).join('');
  $('#sel-gem').innerHTML = '<option>— nenhum —</option><option>Revisor de contrato</option><option>Parceiro de código</option>';
  $('#sel-project').innerHTML = '<option>— sem projeto —</option><option>Casa</option><option>IAUnifier</option>';
}

function encherLista() {
  $('#chat-list').innerHTML = CONVERSAS.map(
    ([rot, itens], g) => `<div class="list-label">${rot}</div>` + itens.map(
      (nome, i) => `<div class="chat-item${g === 1 && i === 0 ? ' active' : ''}">
        <span class="label">${nome}</span>
        <span class="row-actions">
          <button class="icon" title="renomear" data-icon="edit" data-size="17"></button>
          <button class="icon" title="apagar" data-icon="trash" data-size="17"></button>
        </span>
      </div>`
    ).join('')
  ).join('');
  pintarIcones($('#chat-list'));
}

// -------------------------------------------------------------------- chat

const RESPOSTA = `Troque só o disco com defeito. Aumentar o espaço no mesmo dia dobra o risco, e o espelho fica sem proteção justamente enquanto reconstrói.

A ordem que eu seguiria:

1. **Confirme qual disco é.** \`smartctl -a /dev/sdb\` e olhe o contador de setores realocados. O que cresce é o que sai.
2. **Tire do arranjo antes de desligar**: \`mdadm --manage /dev/md0 --fail /dev/sdb1 --remove /dev/sdb1\`.
3. **Troque e adicione o novo**, com a mesma tabela de partição do disco que ficou.
4. **Acompanhe a reconstrução** em \`/proc/mdstat\`. Com 4 TB e a máquina em uso, conte umas 8 horas.

Enquanto reconstrói você está sem redundância. Como o backup da madrugada de 17/08 não terminou, rode ele antes de começar.`;

const RACIOCINIO = `Ele falou "espelho", e numa conversa anterior contou que o servidor é Debian com dois discos espelhados: então é mdadm RAID1, não ZFS. Isso muda os comandos.

A ordem segura é falhar e remover pelo mdadm antes de desligar; senão o arranjo tenta montar com um disco sujo no boot.

Vale lembrar do backup: durante a reconstrução não há redundância, e ele guardou que o backup desta semana falhou. É informação útil, não enrolação.

Nada de sugerir pip ou virtualenv por causa do outro fato guardado — aqui não se aplica, é shell.`;

function bloco(md) {
  return md.split('\n\n').map((p) => {
    const t = p
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    if (/^\d\./.test(t)) return `<ol>${t.split('\n').map((l) => `<li>${l.replace(/^\d\.\s*/, '')}</li>`).join('')}</ol>`;
    return `<p>${t}</p>`;
  }).join('');
}

function memFoot() {
  return `<details class="mem-foot">
    <summary>${icon('brain', 17)} <span>usei <b>3 coisas</b> que já sei sobre você</span></summary>
    <div class="fatos">
      <div class="fato"><span>O servidor é Debian 12, 32 GB, dois discos em espelho.</span><span class="de">de “Trocar o disco”</span></div>
      <div class="fato"><span>Prefere resposta curta, sem introdução.</span><span class="de">de “Revisão do contrato”</span></div>
      <div class="fato"><span>O backup da madrugada de 17/08 falhou.</span><span class="de">aprendido ontem</span></div>
    </div>
    <div class="row"><button class="ghost">${icon('edit', 17)} Abrir memória</button><button class="ghost">Não usar aqui</button></div>
  </details>`;
}

function renderChat({ streaming = true } = {}) {
  const msgs = $('#messages');
  $('#chat-title').textContent = 'Trocar o disco do servidor';
  $('#attach-bar').hidden = false;
  $('#attach-bar').innerHTML = `
    <span class="chip"><span class="tipo">pdf</span><span class="nome">smart-sdb.pdf</span><button data-icon="close" data-size="15"></button></span>
    <span class="chip"><span class="tipo">txt</span><span class="nome">mdstat.txt</span><button data-icon="close" data-size="15"></button></span>`;

  msgs.innerHTML = `
    <div class="msg user"><div class="body">um dos discos do espelho começou a dar erro de setor. troco só ele ou aproveito e aumento o espaço?</div></div>
    <div class="msg assistant" id="m-resp">
      <details class="reasoning"><summary>${roseta(18, 'pensa')} <span class="rot">pensando…</span></summary><div class="think"></div></details>
      <div class="body"></div>
      <div class="stats"></div>
      <div class="actions">
        <button class="icon" data-icon="copy" data-size="18" title="copiar"></button>
        <button class="icon" data-icon="refresh" data-size="18" title="refazer com outra IA"></button>
        <button class="icon" data-icon="speaker" data-size="18" title="ouvir"></button>
      </div>
    </div>`;
  pintarIcones(msgs);

  const resp = $('#m-resp');
  const think = $('.think', resp);
  const body = $('.body', resp);
  const stats = $('.stats', resp);
  const raciocinio = $('.reasoning', resp);

  if (!streaming) {
    think.textContent = RACIOCINIO;
    body.innerHTML = bloco(RESPOSTA) + memFoot();
    $('.rot', raciocinio).textContent = 'como pensou · 2,1 s';
    stats.textContent = '12,4 s · 1.284 palavras-token · 104 por segundo';
    pintarIcones(resp);
    return;
  }

  brilho.pulsar();
  raciocinio.classList.add('live');
  $('#btn-send').hidden = true;
  $('#btn-stop').hidden = false;

  let i = 0;
  const pensa = every(() => {
    i += 16;
    think.textContent = RACIOCINIO.slice(0, i);
    think.scrollTop = think.scrollHeight;
    if (i >= RACIOCINIO.length) {
      clearInterval(pensa);
      raciocinio.classList.remove('live');
      $('.rot', raciocinio).textContent = 'como pensou · 2,1 s';
      $('.roseta', raciocinio).replaceWith(Object.assign(document.createElement('span'), { innerHTML: icon('chevron', 16) }));
      escrever();
    }
  }, 40);

  function escrever() {
    let j = 0;
    const t0 = Date.now();
    const escreve = every(() => {
      j += 10;
      body.innerHTML = bloco(RESPOSTA.slice(0, j));
      if (j >= RESPOSTA.length) {
        clearInterval(escreve);
        const s = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',');
        stats.textContent = `${s} s · 1.284 palavras-token · 104 por segundo`;
        const anon = $('#app').classList.contains('anon');
        if (!anon) body.insertAdjacentHTML('beforeend', memFoot());
        pintarIcones(resp);
        $('#btn-send').hidden = false;
        $('#btn-stop').hidden = true;
        if (anon) return;
        later(() => {
          msgs.insertAdjacentHTML('beforeend', `<div class="note new"><span class="ico">${icon('brain', 18)}</span>
            <span>Guardei: <b>o espelho tem 4 TB e o backup de 17/08 não terminou</b>. Todas as IAs vão saber disso.
            <a href="#">mudar</a> · <a href="#">esquecer</a></span></div>`);
          msgs.scrollTop = msgs.scrollHeight;
        }, 800);
      }
      msgs.scrollTop = msgs.scrollHeight;
    }, 16);
  }
}

// ------------------------------------------------------------- tela vazia

const ATALHOS = [
  ['users', 'Perguntar pra várias'],
  ['globe', 'Pesquisar na web'],
  ['file', 'Ler um arquivo'],
  ['code', 'Programar no terminal'],
  ['brain', 'O que você sabe de mim']
];

function renderVazio() {
  $('#attach-bar').hidden = true;
  $('#chat-title').textContent = '';
  $('#messages').innerHTML = `<div class="vazio">
    <div class="topo">${roseta(54, 'bloom')}<h1>Pode falar, Miguel.</h1></div>
    <div class="atalhos">${ATALHOS.map(([ic, t], i) => `<button class="atalho" style="animation-delay:${360 + i * 60}ms">
      <span class="ico">${icon(ic, 19)}</span> <span>${t}</span></button>`).join('')}</div>
  </div>`;
  pintarIcones($('#messages'));
  brilho.pulsar();
}

// ---------------------------------------------------------------- conselho

const COLUNAS = [
  { m: 'Claude Sonnet 4', ms: 3200, txt: 'Troque só o disco. Aumentar o volume no mesmo movimento dobra o risco: o arranjo fica sem redundância durante a reconstrução e você não quer duas variáveis novas ao mesmo tempo. Primeiro devolva o espelho ao estado saudável; depois, com backup verificado, cresça.' },
  { m: 'GPT-4o', ms: 9500, txt: 'Recomendo separar em duas manutenções. Primeira: substituir o disco defeituoso, removendo do arranjo antes de desligar. Segunda, uma semana depois: crescer o arranjo, já com os dois discos novos e a saúde limpa em ambos.' },
  { m: 'Gemini 2.0 Flash', ms: 5200, txt: 'Se os dois discos são do mesmo lote e a máquina tem quatro anos, a chance do segundo falhar durante a reconstrução não é pequena. Vale trocar os dois, um depois do outro, e aí o espaço maior vem de graça no fim.' },
  { m: 'Llama 3.1 8B', ms: 41000, txt: 'Faça backup completo antes. Depois marque o disco como falho, remova, substitua e deixe reconstruir. O aumento de espaço pode vir depois, desde que o sistema de arquivos aceite crescer a quente.' },
  { m: 'Claude Code', ms: 6000, erro: 'o programa não respondeu', dica: 'O terminal encontra o “claude”, mas o app roda como serviço e não. Aponte o caminho completo em IAs ligadas.' }
];

function renderCouncil(modo = 'conselho') {
  const view = $('#view-council');
  view.className = 'view panel';
  const ROTULO = { conselho: 'Uma resposta só', comparar: 'Lado a lado', 'votação': 'Elas votam' };
  view.innerHTML = `<div class="panel-inner">
    <h2>Perguntar pra várias</h2>
    <p class="hint">A mesma pergunta em cinco IAs ao mesmo tempo. Todas leem a mesma memória.</p>
    <div class="council-head">
      <div class="pergunta">“Troco só o disco com erro ou aproveito e aumento o espaço do espelho?”</div>
      <div class="council-meta">
        <div class="trilho" id="c-trilho"></div>
        <span class="col-state" id="c-status"></span>
        <span class="grow"></span>
        <button id="c-replay" class="icon" title="perguntar de novo">${icon('refresh', 18)}</button>
      </div>
      <div class="segmentado" id="c-modos">
        ${Object.keys(ROTULO).map((m) => `<button data-modo="${m}" class="${m === modo ? 'sel' : ''}">${ROTULO[m]}</button>`).join('')}
      </div>
    </div>
    <div id="c-out"></div>
  </div>`;
  pintarIcones(view);

  $$('#c-modos button[data-modo]').forEach((b) => (b.onclick = () => { limpar(); renderCouncil(b.dataset.modo); }));
  $('#c-replay').onclick = () => { limpar(); renderCouncil(modo); };

  const out = $('#c-out');
  const trilho = $('#c-trilho');
  trilho.innerHTML = COLUNAS.map(() => '<i class="run"></i>').join('');
  out.innerHTML = `<div class="council-grid" id="c-grid">${COLUNAS.map((c, k) => `
    <article class="council-col run" id="col-${k}" style="animation-delay:${k * 60}ms">
      <header><h4>${c.m}</h4><span class="col-state">0,0 s</span></header>
      <div class="body"></div>
      <footer><button class="icon" data-icon="copy" data-size="18" title="copiar"></button>
        <span class="grow"></span><span class="col-state"></span></footer>
    </article>`).join('')}</div>`;
  pintarIcones(out);

  const t0 = Date.now();
  const status = $('#c-status');
  let prontas = 0;

  const relogio = every(() => {
    const dt = (Date.now() - t0) / 1000;
    status.textContent = `${prontas} de ${COLUNAS.length} prontas · ${dt.toFixed(0)} s`;
    COLUNAS.forEach((c, k) => {
      const col = $(`#col-${k}`);
      if (col && col.classList.contains('run')) $('.col-state', col).textContent = `${dt.toFixed(1).replace('.', ',')} s`;
    });
  }, 100);

  COLUNAS.forEach((c, k) => {
    const col = $(`#col-${k}`);
    const body = $('.body', col);
    const mark = trilho.children[k];
    if (c.erro) {
      later(() => {
        col.className = 'council-col fail';
        mark.className = 'fail';
        $('.col-state', col).textContent = 'falhou';
        body.innerHTML = `<div class="aviso err" style="margin:0"><div><b>${c.erro}</b><br />${c.dica}</div>
          <button class="primary">Resolver</button></div>`;
        prontas++;
        checar();
      }, c.ms);
      return;
    }
    const passo = Math.max(12, c.ms / c.txt.length);
    let i = 0;
    const it = every(() => {
      i += 2;
      body.textContent = c.txt.slice(0, i);
      body.scrollTop = body.scrollHeight;
      if (i >= c.txt.length) {
        clearInterval(it);
        col.className = 'council-col done';
        mark.className = 'done';
        $('.col-state', col).textContent = `${((Date.now() - t0) / 1000).toFixed(1).replace('.', ',')} s`;
        $('footer .col-state', col).textContent = '412 palavras-token';
        prontas++;
        checar();
      }
    }, passo);
  });

  function checar() {
    if (prontas < COLUNAS.length) return;
    clearInterval(relogio);
    status.textContent = `${prontas} de ${COLUNAS.length} · 41 s · 1 falhou`;
    if (modo === 'comparar') return;
    later(() => (modo === 'votação' ? costurarPlacar(out) : costurarFinal(out)), 900);
  }
}

function recolher(out) {
  const grid = $('#c-grid', out);
  const tira = document.createElement('div');
  tira.className = 'tira';
  tira.innerHTML = COLUNAS.map((c, k) => `<button class="${c.erro ? 'fail' : ''}" data-abrir="${k}"><span class="pt"></span> ${c.m}</button>`).join('');
  if (grid) grid.remove();
  out.prepend(tira);
  return tira;
}

function costurarFinal(out) {
  const tira = recolher(out);
  tira.insertAdjacentHTML('beforebegin', `<div class="final">
    <div class="quem">${roseta(20, 'fixa')}<span class="rot">as cinco respostas viraram uma · costurada pelo Claude Sonnet 4</span></div>
    <div class="txt">
      <p><b>Troque só o disco agora.</b> As quatro IAs que responderam concordam em separar as duas coisas. A divergência é sobre o segundo disco.</p>
      <p>O Gemini levantou um ponto que os outros não tocaram: se os discos são do mesmo lote e da mesma idade, a reconstrução é quando o segundo tende a falhar. Se for o caso, troque os dois em sequência — o espaço maior sai disso sem uma segunda manutenção.</p>
      <p>Ninguém discordou de uma coisa: confira o backup antes de mexer. O de 17/08 falhou.</p>
    </div>
  </div>
  <p class="hint" style="margin:0 0 12px">as respostas separadas continuam aqui:</p>`);
  pintarIcones(out);
}

function costurarPlacar(out) {
  const tira = recolher(out);
  const notas = [
    ['Claude Sonnet 4', 8.7, '9, 9, 8', true],
    ['Gemini 2.0 Flash', 8.3, '9, 8, 8', false],
    ['GPT-4o', 7.5, '8, 7, 8', false],
    ['Llama 3.1 8B', 6.0, '6, 7, 5', false]
  ];
  tira.insertAdjacentHTML('beforebegin', `<div class="placar">
    <table><tbody>${notas.map(([m, n, v, w]) => `<tr class="${w ? 'win' : ''}">
      <td>${w ? `<span class="crown">${icon('check', 16)}</span> ` : ''}${m}${w ? ' · venceu' : ''}</td>
      <td class="nota">${String(n).replace('.', ',')}</td>
      <td><div class="barra"><span style="width:${(n / 10) * 100}%"></span></div></td>
      <td class="votos">notas recebidas: ${v}</td>
    </tr>`).join('')}</tbody></table>
    <div class="placar-nota">${icon('alert', 16)} <span>1 voto anulado: a Llama deu nota 12, fora da escala de 0 a 10.</span></div>
    <div class="placar-nota">${icon('users', 16)} <span>cada IA avaliou as outras sem saber de quem era cada resposta. O Claude Code falhou e não votou.</span></div>
  </div>
  <div class="row" style="margin:18px 0"><button class="ghost">quem votou o quê</button><button class="ghost">continuar com o vencedor</button></div>`);
  pintarIcones(out);
}

// ---------------------------------------------------------------- pesquisa

const PASSOS = [
  ['00:02', 'Entendi a pergunta', 'separei em 4 buscas'],
  ['00:04', 'Buscando', 'quando trocar disco com setor realocado em espelho'],
  ['00:09', 'Buscando', 'aumentar espaço de raid1 com discos maiores debian'],
  ['00:13', 'Lendo', 'raid.wiki.kernel.org — RAID setup'],
  ['00:18', 'Lendo', 'wiki.debian.org/RAID'],
  ['00:23', 'Lendo', 'unix.stackexchange.com — resposta aceita'],
  ['00:29', 'Buscando', 'quando o segundo disco falha durante reconstrução'],
  ['00:34', 'Descartei 2 páginas', 'fórum repetindo o que já tinha, sem fonte'],
  ['00:38', 'Escrevendo o relatório', 'com 7 fontes']
];

function renderResearch() {
  const view = $('#view-research');
  view.className = 'view panel';
  view.innerHTML = `<div class="panel-inner">
    <h2>Pesquisa</h2>
    <p class="hint">Ela vai à web, lê as páginas e escreve um relatório com as fontes.</p>
    <div class="card plain">
      <label class="field">O que você quer descobrir<textarea rows="2">Vale trocar um disco com setores realocados agora, e dá pra aumentar o espaço no mesmo movimento?</textarea></label>
      <div class="row" style="margin:0"><button class="primary" id="r-go">${icon('search', 18)} Pesquisar</button>
        <button class="ghost" id="r-mais">mais opções</button></div>
    </div>
    <div id="r-live"></div>
    <div id="r-report"></div>
  </div>`;
  pintarIcones(view);
  $('#r-go').onclick = () => { limpar(); rodarPesquisa(); };
  $('#r-mais').onclick = () => abrirAjustes('pesquisa');
  rodarPesquisa();
}

function rodarPesquisa() {
  const live = $('#r-live');
  const report = $('#r-report');
  report.innerHTML = '';
  live.innerHTML = `<div class="reg-topo">
      <div><span class="num live" id="r-t">0</span><span class="rot">segundos</span></div>
      <div><span class="num" id="r-b">0</span><span class="rot">buscas</span></div>
      <div><span class="num" id="r-p">0</span><span class="rot">páginas lidas</span></div>
      <div><span class="num" id="r-f">0</span><span class="rot">fontes guardadas</span></div>
    </div>
    <div class="reg" id="r-reg"></div>`;
  const reg = $('#r-reg');
  const t0 = Date.now();
  const rel = every(() => ($('#r-t').textContent = Math.floor((Date.now() - t0) / 1000)), 250);

  let b = 0, p = 0, f = 0;
  PASSOS.forEach(([k, titulo, sub], i) => {
    later(() => {
      $$('.step.now', reg).forEach((s) => (s.className = 'step done'));
      reg.insertAdjacentHTML('beforeend', `<div class="step now"><span class="step-k">${k}</span>
        <span class="txt"><b>${titulo}</b><span class="sub">${sub}</span></span></div>`);
      if (titulo === 'Buscando') subir($('#r-b'), ++b, 400);
      if (titulo === 'Lendo') { subir($('#r-p'), ++p, 400); subir($('#r-f'), (f += 2), 600); }
      if (i === PASSOS.length - 1) {
        clearInterval(rel);
        later(() => terminarPesquisa(live, report, Math.floor((Date.now() - t0) / 1000)), 2600);
      }
    }, 700 + i * 900);
  });
}

const FONTES = [
  ['RAID setup — Linux RAID Wiki', 'raid.wiki.kernel.org/index.php/RAID_setup'],
  ['RAID — Debian Wiki', 'wiki.debian.org/RAID'],
  ['Quando trocar um disco com setores realocados', 'unix.stackexchange.com/questions/1129'],
  ['smartmontools — o que cada atributo quer dizer', 'smartmontools.org/wiki/FAQ'],
  ['mdadm — manual', 'man7.org/linux/man-pages/man8/mdadm.8.html'],
  ['Backblaze Drive Stats 2025', 'backblaze.com/blog/drive-stats-2025'],
  ['Crescer um espelho com discos maiores', 'wiki.archlinux.org/title/RAID#Grow']
];

function terminarPesquisa(live, report, seg) {
  live.innerHTML = `<details class="reg-fechado"><summary>${icon('chevron', 16)} o passo a passo · ${PASSOS.length} passos · ${seg} s · 7 fontes guardadas, 2 descartadas</summary></details>`;
  pintarIcones(live);
  report.innerHTML = `<div class="relatorio">
    <h3>Trocar antes, crescer depois</h3>
    <p>Um contador de setores realocados que <em>cresce</em> é motivo de troca, mesmo com o disco ainda respondendo: a tendência importa mais que o número<sup><a href="#f4">4</a></sup>. Em espelho, o caminho seguro é tirar o disco do arranjo antes de desligar a máquina<sup><a href="#f1">1</a></sup><sup><a href="#f5">5</a></sup>.</p>
    <p>Aumentar o espaço no mesmo movimento é possível, mas só depois que os dois discos forem maiores — o que significa duas trocas<sup><a href="#f7">7</a></sup>. Fazer tudo junto deixa o espelho sem proteção por mais tempo, e é durante a reconstrução que a segunda falha costuma aparecer em discos do mesmo lote<sup><a href="#f6">6</a></sup>.</p>
    <p>Recomendação: troca do disco com defeito agora; espaço maior numa segunda manutenção, com backup conferido.</p>
    <ol class="fontes">${FONTES.map(([t, u], i) => `<li id="f${i + 1}"><span class="n">${i + 1}</span>
      <span><a href="https://${u}" target="_blank" rel="noreferrer">${t}</a><br /><span class="url">${u}</span></span></li>`).join('')}</ol>
    <div class="row"><button class="ghost">${icon('copy', 17)} Copiar</button><button class="ghost">${icon('chat', 17)} Continuar conversando</button>
      <button class="ghost">${icon('brain', 17)} Guardar na memória</button></div>
  </div>`;
  pintarIcones(report);
  torrada('ok', 'Relatório pronto', `${seg} s · 7 fontes.`);
}

// ------------------------------------------------- IAs ligadas (LM Studio)

const RECOMENDADOS = [
  {
    nome: 'Qwen Coder 14B', id: 'qwen2.5-coder:14b', gb: 9.1, cabe: 'folga', instalado: true,
    praQue: 'A melhor daqui pra código: entende projeto inteiro e devolve diff.',
    compara: 'Escreve código melhor que a Llama 8B e roda quase na mesma velocidade.'
  },
  {
    nome: 'Llama 3.1 8B', id: 'llama3.1:8b', gb: 4.7, cabe: 'folga', instalado: true,
    praQue: 'A mais rápida. Boa pra conversa do dia a dia e resumo.',
    compara: 'Menos precisa que a Qwen 14B, mas responde em metade do tempo.'
  },
  {
    nome: 'Mistral Small 24B', id: 'mistral-small:24b', gb: 14.2, cabe: 'aperto',
    praQue: 'A melhor daqui pra escrever em português: texto solto, sem sotaque de tradução.',
    compara: 'Escreve melhor que as duas de cima, mas deixa só uns 3 GB livres pro resto da máquina.'
  },
  {
    nome: 'Gemma 3 27B', id: 'gemma3:27b', gb: 17.4, cabe: 'nao',
    praQue: 'Raciocínio longo, contas e texto técnico.',
    compara: 'Precisa de 32 GB de memória; nesta máquina ela travaria no meio da resposta.'
  }
];

function linhaModelo(m) {
  const rot = { folga: 'cabe com folga', aperto: 'cabe apertado', nao: 'não cabe aqui' }[m.cabe];
  return `<div class="modelo${m.instalado ? ' instalado' : ''}">
    <div class="linha1"><span class="nome">${m.nome}</span><span class="id">${m.id} · ${String(m.gb).replace('.', ',')} GB</span></div>
    <div class="pra-que">${m.praQue}</div>
    <div class="compara">${m.compara}</div>
    <div class="cabe ${m.cabe}">${icon(m.cabe === 'nao' ? 'alert' : 'check', 16)} ${rot}</div>
    <div class="acoes">${m.instalado
      ? `<button class="ghost">${icon('play', 17)} Usar agora</button><button class="danger">${icon('trash', 17)} Apagar</button>`
      : m.cabe === 'nao'
        ? `<button disabled>${icon('download', 17)} Baixar</button><button class="ghost">Por que não cabe</button>`
        : `<button class="primary" data-baixar="${m.id}">${icon('download', 17)} Baixar ${String(m.gb).replace('.', ',')} GB</button>`}</div>
    <div class="progress" hidden><span style="width:0%"></span></div>
  </div>`;
}

function renderProviders() {
  const view = $('#view-providers');
  view.className = 'view panel';
  view.innerHTML = `<div class="panel-inner">
    <h2>IAs ligadas</h2>
    <p class="hint">Três jeitos de ligar uma IA: a que roda aqui, a que é paga por uso e a que é um programa do terminal.</p>

    <div class="maquina">
      Seu servidor tem <b>32 GB de memória</b> e um <b>Ryzen 5 5600</b>, sem placa de vídeo dedicada.
      Cabe modelo de até uns <b>15 GB</b> com folga pro resto da máquina respirar.
      <div class="barra-mem">
        <i style="width:43%;background:var(--accent)"></i>
        <i style="width:14%;background:var(--slate)"></i>
      </div>
      <div class="legenda">
        <span><i style="background:var(--accent)"></i> modelos baixados · 13,8 GB</span>
        <span><i style="background:var(--slate)"></i> resto do sistema · 4,4 GB</span>
        <span><i style="background:var(--panel-3)"></i> livre · 13,8 GB</span>
      </div>
    </div>

    <h3 class="sec">Roda aqui, de graça — recomendados pra esta máquina</h3>
    <div id="lista-modelos">${RECOMENDADOS.map(linhaModelo).join('')}</div>
    <div class="row"><button class="ghost">${icon('search', 17)} Ver todos os 128 modelos</button></div>

    <h3 class="sec">Pagas por uso</h3>
    <div class="card">
      <h3>Anthropic <span class="tag on"><span class="pt"></span>funcionando</span></h3>
      <div class="meta">Claude Sonnet 4, Haiku 4 e Opus 4 · gasto deste mês: US$ 4,12</div>
      <div class="row"><button class="ghost">${icon('key', 17)} Trocar chave</button><button class="ghost">Testar</button></div>
    </div>
    <div class="card">
      <h3>OpenAI <span class="tag off"><span class="pt"></span>sem crédito</span></h3>
      <div class="aviso err"><div><b>A conta ficou sem crédito às 20:41.</b> Parei de mandar pedidos pra cá; as conversas em aberto seguiram no Claude.<br />
        Coloque crédito no painel da OpenAI e toque em testar. A chave continua valendo.</div>
        <button class="primary">${icon('external', 17)} Abrir painel</button></div>
      <div class="row" style="margin-top:4px"><button class="ghost">Testar de novo</button><button class="ghost">Desligar por enquanto</button></div>
    </div>

    <h3 class="sec">Programas do terminal</h3>
    <div class="card">
      <h3>Claude Code <span class="tag off"><span class="pt"></span>não achei</span></h3>
      <div class="aviso err"><div><b>O programa existe no seu terminal, mas não para o app.</b>
        Eles rodam com caminhos diferentes. Aponte o caminho completo — aqui provavelmente <code>/usr/local/bin/claude</code>.</div>
        <button class="primary">Apontar caminho</button></div>
    </div>
    <div class="card">
      <h3>Codex <span class="tag warn"><span class="pt"></span>desligado por você</span></h3>
      <div class="meta">/usr/local/bin/codex · último uso em 2 de agosto</div>
      <div class="row"><button class="ghost">Ligar</button><button class="danger">${icon('trash', 17)} Remover</button></div>
    </div>
  </div>`;
  pintarIcones(view);

  $$('[data-baixar]', view).forEach((b) => (b.onclick = () => baixar(b)));
}

function baixar(botao) {
  const linha = botao.closest('.modelo');
  const barra = $('.progress', linha);
  const fill = $('span', barra);
  barra.hidden = false;
  botao.disabled = true;
  botao.innerHTML = 'baixando…';
  let p = 0;
  const it = every(() => {
    p = Math.min(100, p + 3 + Math.random() * 4);
    fill.style.width = p + '%';
    if (p >= 100) {
      clearInterval(it);
      linha.classList.add('instalado');
      barra.hidden = true;
      botao.replaceWith(Object.assign(document.createElement('button'), { className: 'ghost', innerHTML: `${icon('play', 17)} Usar agora` }));
      torrada('ok', 'Modelo pronto', 'Já aparece na lista de quem pode responder.');
    }
  }, 260);
}

// ------------------------------------------------------------------ memória

function renderMemory() {
  const view = $('#view-memory');
  view.className = 'view panel';
  view.innerHTML = `<div class="panel-inner">
    <h2>Memória</h2>
    <p class="hint">Uma memória só, lida por todas as IAs. O que você contou pra uma, as outras sabem.</p>
    <div class="reg-topo">
      <div><span class="num" id="mm-1">0</span><span class="rot">coisas guardadas</span></div>
      <div><span class="num" id="mm-2">0</span><span class="rot">usadas por resposta</span></div>
      <div><span class="num" id="mm-3">0</span><span class="rot">aprendidas hoje</span></div>
    </div>
    <div class="row" style="margin:0 0 10px"><button class="primary">${icon('plus', 18)} Contar uma coisa nova</button>
      <button class="ghost">${icon('upload', 17)} Importar conversas</button></div>
    <h3 class="sec">Aprendidas recentemente</h3>
    <div>
      ${FATOS.map(([t, de, escopo, tint]) => `<div class="mem-item">
        <div class="txt">${t}
          <div class="src"><span class="escopo${tint ? ' proj' : ''}" ${tint ? `style="--tint:var(--${tint})"` : ''}>${escopo}</span>
            <span>de <a href="#">${de}</a></span><span>·</span><span>usada 14 vezes</span></div>
        </div>
        <button class="icon" data-icon="edit" data-size="18" title="mudar"></button>
        <button class="icon danger" data-icon="trash" data-size="18" title="esquecer"></button>
      </div>`).join('')}
      <button class="link-btn">${icon('chevron', 16)} ver as outras 243</button>
    </div>
  </div>`;
  pintarIcones(view);
  later(() => { subir($('#mm-1'), 248, 900); subir($('#mm-2'), 12, 700); subir($('#mm-3'), 6, 600); }, 120);
}

// ------------------------------------------------------- projetos e vozes

function renderProjects() {
  const view = $('#view-projects');
  view.className = 'view panel';
  const projetos = [
    ['Casa', 'amber', 3, 18, 'Português claro, sem jargão. Quando citar norma, cite o artigo.'],
    ['IAUnifier', 'teal', 12, 41, 'Node 22, sem empacotador. Não sugerir React nem pip.'],
    ['Leituras', 'violet', 7, 9, 'Resumo em tópicos, sempre com a página citada.']
  ];
  view.innerHTML = `<div class="panel-inner">
    <h2>Projetos</h2>
    <p class="hint">Pasta de trabalho com arquivos, instrução e memória próprios. O que é aprendido dentro fica dentro.</p>
    ${projetos.map(([n, c, arq, mem, inst]) => `<article class="card" style="--tint:var(--${c})">
      <h3>${n} <span class="tag"><span class="pt" style="background:var(--${c})"></span>${mem} coisas só daqui</span></h3>
      <div class="meta">${arq} arquivos · última conversa há 2 dias</div>
      <div class="meta" style="margin-top:6px;color:var(--text-2)">${inst}</div>
      <div class="row"><button class="primary">${icon('chat', 17)} Conversar aqui</button>
        <button class="ghost">${icon('file', 17)} Arquivos</button></div>
    </article>`).join('')}
    <div class="row"><button class="ghost">${icon('plus', 18)} Novo projeto</button></div>
  </div>`;
  pintarIcones(view);
}

function renderGems() {
  const view = $('#view-gems');
  view.className = 'view panel';
  const perfis = [
    ['Revisor de contrato', 'rose', 'Claude Sonnet 4', 'quase nada criativa', 'Leia como advogado do inquilino. Aponte cláusula por cláusula o que é abusivo.'],
    ['Parceiro de código', 'teal', 'Qwen Coder 14B', 'pouco criativa', 'Responda com diff. Nada de explicação antes do código.'],
    ['Tradutor seco', 'sky', 'Llama 3.1 8B', 'nada criativa', 'Traduza sem adaptar. Mantenha o tom do original.'],
    ['Advogado do diabo', 'amber', 'GPT-4o', 'bem criativa', 'Discorde da minha premissa antes de responder.']
  ];
  view.innerHTML = `<div class="panel-inner">
    <h2>Perfis</h2>
    <p class="hint">Um jeito salvo de responder: a instrução, a IA e o quanto ela pode inventar. Todos leem a mesma memória.</p>
    ${perfis.map(([n, c, m, temp, inst]) => `<article class="card" style="--tint:var(--${c})">
      <h3>${n}</h3>
      <div class="meta" style="color:var(--text-2)">${inst}</div>
      <div class="models"><span class="model-pill">${m}</span><span class="model-pill">${temp}</span></div>
      <div class="row"><button class="primary">${icon('play', 17)} Usar</button><button class="ghost">${icon('edit', 17)} Mudar</button></div>
    </article>`).join('')}
    <div class="row"><button class="ghost">${icon('plus', 18)} Novo perfil</button></div>
  </div>`;
  pintarIcones(view);
}

// -------------------------------------------------------------------- ajustes

// ------------------------------------------------------------------ ajustes
// No celular: lista agrupada. No computador: janela com trilha à esquerda —
// os dois saem do mesmo #view-settings, e o CSS decide qual aparece.

const CFG_TRILHA = [
  ['Ajustes', [
    ['geral', 'settings', 'Geral'],
    ['memoria', 'brain', 'Memória'],
    ['ias', 'plug', 'IAs ligadas'],
    ['acesso', 'key', 'Acesso'],
    ['dados', 'folder', 'Seus dados']
  ]],
  ['Personalizar', [
    ['perfis', 'sparkle', 'Perfis'],
    ['terminal', 'code', 'Programas do terminal'],
    ['atalhos', 'command', 'Atalhos de teclado']
  ]]
];

const lin = (rot, sub, ctl, larga) => `<div class="cfg-lin${larga ? ' larga' : ''}">
  <div class="rot">${rot}${sub ? `<small>${sub}</small>` : ''}</div>
  <div class="ctl">${ctl}</div></div>`;
const chave = (on) => `<span class="chave${on ? ' on' : ''}" data-chave></span>`;
const opcoes = (arr, sel) => arr.map((o) => `<option${o === sel ? ' selected' : ''}>${o}</option>`).join('');

const CFG_PAINEL = {
  geral: () => `<h3>Geral</h3>
    ${lin('Como a IA deve te chamar', 'Entra no começo de toda conversa.', '<input type="text" value="Miguel" />')}
    ${lin('Qual IA responde por padrão', '', `<select>${opcoes(MODELOS.map(([n]) => n), 'Claude Sonnet 4')}</select>`)}
    ${lin('Quão criativa por padrão', '', `<select>${opcoes(['nada criativa', 'pouco criativa', 'bem criativa'], 'pouco criativa')}</select>`)}
    ${lin('Instrução que vale em todas as conversas', 'Todas as IAs leem isso, junto com a memória.', '<textarea>Responda curto, em português do Brasil, sem introdução nem resumo no fim. Se discordar, diga por quê antes de concordar.</textarea>', true)}
    <h4>Aparência</h4>
    ${lin('Tamanho da letra', '', `<select>${opcoes(['pequena', 'normal', 'grande'], 'normal')}</select>`)}
    ${lin('Animações e brilho', 'Desligue se preferir a interface parada.', chave(true))}
    ${lin('Mostrar tempo e contagem em cada resposta', '', chave(true))}`,

  memoria: () => `<h3>Memória</h3>
    ${lin('Lembrar do que eu conto', 'Uma memória só, lida por todas as IAs.', chave(true))}
    ${lin('Aprender sozinho depois de cada resposta', 'Sem isso, só guarda o que você mandar guardar.', chave(true))}
    ${lin('Coisas guardadas', '', '<span class="val">248</span><button class="ghost">Ver e editar</button>')}
    ${lin('Quantas entram por resposta', 'Mais que 20 costuma atrapalhar em vez de ajudar.', '<input type="text" value="12" style="min-width:90px;text-align:center" />')}
    ${lin('Índice da memória', 'O jeito de indexar mudou; até refazer, a busca fica pior.', '<button class="primary">Refazer agora</button>')}
    ${lin('Importar de outra IA', 'Traz conversas do ChatGPT, Claude ou Gemini.', '<button class="ghost">Escolher arquivo</button>')}`,

  ias: () => `<h3>IAs ligadas</h3>
    ${lin('Ollama · roda nesta máquina', '2 modelos baixados · 13,8 GB em disco', '<span class="tag on"><span class="pt"></span>respondendo</span><button class="ghost">Abrir</button>')}
    ${lin('Anthropic · paga por uso', 'Claude Sonnet 4, Haiku 4 e Opus 4 · US$ 4,12 este mês', '<span class="tag on"><span class="pt"></span>chave válida</span><button class="ghost">Trocar chave</button>')}
    ${lin('OpenAI · paga por uso', 'A conta ficou sem crédito às 20:41; parei de mandar pedidos.', '<span class="tag off"><span class="pt"></span>sem crédito</span><button class="ghost">Testar</button>')}
    ${lin('Google · paga por uso', '', '<button class="ghost">Adicionar chave</button>')}
    ${lin('Procurar IA nesta máquina', 'Olha portas conhecidas, PATH e chaves no sistema.', '<button class="primary">Procurar agora</button>')}`,

  acesso: () => `<h3>Acesso</h3>
    ${lin('Pedir senha fora da rede de casa', 'Dentro de 192.168.0.0/24 abre direto.', chave(true))}
    ${lin('Senha de acesso', '', '<input type="text" value="ia-7f3c-9ab1-2de4" readonly style="min-width:230px;font-family:var(--font-mono)" /><button class="ghost">Copiar</button>')}
    ${lin('Rede de casa', '', '<input type="text" value="192.168.0.0/24" />')}
    ${lin('Aparelhos que entraram', 'iPhone de Miguel · MacBook · TV da sala', '<button class="ghost">Ver todos</button>')}`,

  dados: () => `<h3>Seus dados</h3>
    ${lin('Cópia automática', 'Toda madrugada, 7 cópias guardadas · última hoje 03:12', chave(true))}
    ${lin('Baixar cópia agora', '84 MB', '<button class="ghost">Baixar</button>')}
    ${lin('Restaurar de um arquivo', 'Substitui conversas e memória pelo conteúdo da cópia.', '<button class="ghost">Escolher arquivo</button>')}
    ${lin('Espaço em disco', 'conversas 12 MB · memória 4 MB · modelos 13,8 GB', '<span class="val">13,8 GB</span>')}
    ${lin('Apagar todas as conversas', 'A memória continua. Não tem como desfazer.', '<button class="danger">Apagar</button>')}`,

  perfis: () => `<h3>Perfis</h3>
    ${lin('Revisor de contrato', 'Claude Sonnet 4 · quase nada criativa', '<button class="ghost">Editar</button>')}
    ${lin('Parceiro de código', 'Qwen Coder 14B · pouco criativa', '<button class="ghost">Editar</button>')}
    ${lin('Tradutor seco', 'Llama 3.1 8B · nada criativa', '<button class="ghost">Editar</button>')}
    ${lin('Advogado do diabo', 'GPT-4o · bem criativa', '<button class="ghost">Editar</button>')}
    ${lin('Novo perfil', '', '<button class="primary">Criar</button>')}`,

  terminal: () => `<h3>Programas do terminal</h3>
    ${lin('Claude Code', '/usr/local/bin/claude — o app roda como serviço e não acha esse caminho.', '<span class="tag off"><span class="pt"></span>não achei</span><button class="primary">Apontar</button>')}
    ${lin('Codex', '/usr/local/bin/codex · último uso em 2 de agosto', '<button class="ghost">Ligar</button>')}
    ${lin('opencode', 'roda com o modelo daqui, sem custo por uso', '<button class="ghost">Ligar</button>')}
    ${lin('Pasta padrão', '', '<input type="text" value="~/projetos" />')}`,

  atalhos: () => `<h3>Atalhos de teclado</h3>
    ${[['Nova conversa', '⌘N'], ['Conversa anônima', '⇧⌘N'], ['Lista de atalhos', '⌘K'], ['Perguntar pra várias', '⇧⌘A'], ['Pesquisar na web', '⌘P'], ['Modo voz', '⌘⇧V'], ['Recolher a barra', '⌘\\'], ['Ver memória', '⌘M'], ['Trocar de IA', '⌘↑']]
      .map(([r, k]) => lin(r, '', `<span class="val" style="font-family:var(--font-mono)">${k}</span>`)).join('')}`
};

function renderSettings(secao = 'geral') {
  const view = $('#view-settings');
  view.className = 'view panel';

  const linha = (ic, rot, extra = '') => `<button class="linha">
    <span class="ico">${icon(ic, 20)}</span><span class="rot">${rot}</span>${extra}<span class="seta">${icon('chevron', 17)}</span></button>`;
  const valor = (v) => `<span class="val">${v}</span>`;
  const trava = (ic, rot, on) => `<button class="linha" data-trava>
    <span class="ico">${icon(ic, 20)}</span><span class="rot">${rot}</span>${chave(on)}</button>`;

  view.innerHTML = `
  <div class="cfg">
    <nav class="cfg-rail">
      <div class="busca">${icon('search', 18)}<input type="search" placeholder="Procurar nos ajustes" /></div>
      ${CFG_TRILHA.map(([rot, itens]) => `<div class="cfg-rot">${rot}</div>` + itens.map(([k, ic, nome]) =>
        `<button class="cfg-item${k === secao ? ' sel' : ''}" data-secao="${k}"><span class="ico">${icon(ic, 19)}</span> ${nome}</button>`).join('')).join('')}
    </nav>
    <div class="cfg-corpo">
      ${CFG_PAINEL[secao]()}
      <div class="cfg-pe">
        <button data-tema="dark" class="${document.documentElement.dataset.theme === 'dark' ? 'sel' : ''}" title="escuro">${icon('moon', 19)}</button>
        <button data-tema="light" class="${document.documentElement.dataset.theme === 'light' ? 'sel' : ''}" title="claro">${icon('sun', 19)}</button>
      </div>
    </div>
  </div>

  <div class="cfg-mob panel-inner">
    <h2>Ajustes</h2>
    <div class="grupo-rot" style="padding-top:12px">Aparência</div>
    <div class="grupo">
      ${linha('moon', 'Tema', valor('escuro'))}
      ${linha('spark', 'Tamanho da letra', valor('normal'))}
      ${trava('activity', 'Animações e brilho', true)}
    </div>
    <div class="grupo-rot">Memória</div>
    <div class="grupo">
      ${linha('brain', 'Ver e editar memória', valor('248'))}
      ${trava('check', 'Lembrar do que eu conto', true)}
      ${trava('sparkle', 'Aprender sozinho', true)}
      ${linha('refresh', 'Refazer o índice')}
    </div>
    <div class="grupo-rot">IAs</div>
    <div class="grupo">
      ${linha('plug', 'IAs ligadas', valor('3'))}
      ${linha('bot', 'Qual responde por padrão', valor('Claude Sonnet 4'))}
      ${linha('code', 'Programas do terminal', valor('3'))}
      ${linha('sparkle', 'Perfis', valor('4'))}
    </div>
    <div class="grupo-rot">Abrir de fora de casa</div>
    <div class="grupo">
      ${trava('key', 'Pedir senha fora de casa', true)}
      ${linha('copy', 'Senha de acesso', valor('ia-7f3c…'))}
    </div>
    <div class="grupo-rot">Seus dados</div>
    <div class="grupo">
      ${linha('download', 'Cópia de segurança', valor('hoje 03:12'))}
      ${linha('upload', 'Restaurar de um arquivo')}
      ${linha('chat', 'Importar de outra IA')}
    </div>
    <div class="grupo" style="margin-top:14px">
      <button class="linha perigo"><span class="ico">${icon('trash', 20)}</span><span class="rot">Apagar todas as conversas</span></button>
    </div>
    <div class="versao">Nuvo 0.9.4 · roda em 192.168.0.14</div>
  </div>`;
  pintarIcones(view);

  $$('[data-secao]', view).forEach((b) => (b.onclick = () => renderSettings(b.dataset.secao)));
  $$('[data-chave]', view).forEach((k) => (k.onclick = (e) => { e.stopPropagation(); k.classList.toggle('on'); }));
  $$('[data-trava]', view).forEach((b) => (b.onclick = () => $('.chave', b).classList.toggle('on')));
  $$('[data-tema]', view).forEach((b) => (b.onclick = () => { aplicarTema(b.dataset.tema); renderSettings(secao); }));
  $$('.cfg-mob .linha', view).forEach((b) => {
    if ($('.rot', b).textContent.trim() === 'Tema') b.onclick = () => abrirAjustes('tema');
  });
}

// ------------------------------------------------------- primeira abertura

const ACHADOS = [
  ['Ollama respondendo aqui na máquina', 'ok', '2 modelos já baixados'],
  ['Llama 3.1 8B, 4,7 GB', 'ok', 'pronta pra usar agora'],
  ['O programa “claude” está instalado', 'ok', 'usa sua assinatura, sem custo por uso'],
  ['Achei uma chave da Anthropic no sistema', 'warn', 'quer que eu teste?'],
  ['LM Studio não está rodando', 'off', 'se abrir, eu acho sozinho']
];

function renderFirstRun() {
  $('#attach-bar').hidden = true;
  $('#composer').hidden = true;
  $('#chat-title').textContent = '';
  $('#messages').innerHTML = `<div class="first-run">
    <div class="badge-row">${roseta(58, 'bloom')}</div>
    <h2>Nada ligado ainda.<br />Deixa eu ver o que tem aqui.</h2>
    <p>O app roda na sua máquina. Vou procurar IA instalada nela — nada sai daqui.</p>
    <ol class="steps">
      <li style="animation-delay:420ms"><strong>Procurar o que já existe</strong><span>Ollama, LM Studio, programas de terminal e chaves guardadas no sistema.</span>
        <div id="fr-achados"></div>
        <button class="primary" id="fr-discover">${icon('search', 18)} Procurar agora</button></li>
      <li style="animation-delay:520ms"><strong>Escolher a primeira IA</strong><span>Eu recomendo pelo tamanho da sua máquina, e digo pra que cada uma é boa.</span></li>
      <li style="animation-delay:620ms"><strong>Trazer o que você já conversou</strong><span>Importar do ChatGPT, Claude ou Gemini enche a memória de partida. Opcional.</span></li>
    </ol>
  </div>`;
  pintarIcones($('#messages'));
  brilho.pulsar();

  $('#fr-discover').onclick = (ev) => {
    const alvo = $('#fr-achados');
    alvo.innerHTML = '';
    const b = ev.currentTarget;
    b.disabled = true;
    b.innerHTML = `${roseta(18, 'pensa')} procurando…`;
    ACHADOS.forEach(([t, cls, sub], i) => later(() => {
      alvo.insertAdjacentHTML('beforeend', `<div class="achado"><span class="tag ${cls}"><span class="pt"></span>${
        cls === 'ok' ? 'achei' : cls === 'warn' ? 'talvez' : 'não'
      }</span><span>${t} <span class="muted">— ${sub}</span></span></div>`);
      if (i === ACHADOS.length - 1) {
        alvo.insertAdjacentHTML('beforeend', `<div class="aviso ok"><div><b>Duas IAs prontas pra usar, sem custo.</b>
          A Llama 3.1 8B é a mais rápida e cabe com folga nos seus 32 GB. Começo com ela?</div>
          <button class="primary">${icon('check', 17)} Começar com a Llama</button></div>`);
        pintarIcones(alvo);
        b.disabled = false;
        b.innerHTML = `${icon('refresh', 17)} Procurar de novo`;
        pintarIcones(b);
      }
    }, 400 + i * 620));
  };
}

// ----------------------------------------------------------------- torradas

function torrada(tipo, titulo, texto) {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.innerHTML = `<b>${titulo}</b><br /><span class="muted">${texto}</span>`;
  $('#toasts').append(t);
  later(() => t.remove(), 5200);
}

// ---------------------------------------------- ajustes (segunda camada)

function abrirAjustes(qual = 'conversa') {
  const t = $('#tune');
  t.innerHTML = qual === 'tema'
    ? `<div class="segmentado" id="t-tema" style="align-self:stretch">
         ${[['dark', 'Escuro'], ['light', 'Claro'], ['auto', 'Como o sistema']].map(([v, r]) =>
           `<button data-tema="${v}" class="${document.documentElement.dataset.theme === v ? 'sel' : ''}" style="flex:1">${r}</button>`).join('')}
       </div>
       <button class="primary" data-fechar>Pronto</button>`
    : qual === 'pesquisa'
    ? `<label>Quantas buscas<input type="number" value="4" /></label>
       <label>Páginas por busca<input type="number" value="3" /></label>
       <label class="full">Qual IA escreve o relatório<select>${MODELOS.map(([n]) => `<option>${n}</option>`).join('')}</select></label>
       <button class="primary" data-fechar>Pronto</button>`
    : `<label>Qual IA responde<select>${MODELOS.map(([n]) => `<option>${n}</option>`).join('')}</select></label>
       <label>Perfil<select><option>— nenhum —</option><option>Revisor de contrato</option></select></label>
       <label>Projeto<select><option>— sem projeto —</option><option>Casa</option><option>IAUnifier</option></select></label>
       <label>Quão criativa<select><option>nada criativa</option><option selected>pouco criativa</option><option>bem criativa</option></select></label>
       <label class="full">Instrução só desta conversa<textarea rows="2" placeholder="deixe vazio pra usar a da voz"></textarea></label>
       <label class="check full"><input type="checkbox" checked /> mostrar tempo e contagem em cada resposta</label>
       <button class="primary" data-fechar>Pronto</button>`;
  t.hidden = false;
  pintarIcones(t);
  $$('[data-fechar]', t).forEach((b) => (b.onclick = () => (t.hidden = true)));
  $$('[data-tema]', t).forEach((b) => (b.onclick = () => {
    aplicarTema(b.dataset.tema === 'light' ? 'light' : 'dark');
    $$('[data-tema]', t).forEach((o) => o.classList.toggle('sel', o === b));
    later(() => { t.hidden = true; renderSettings(); }, 260);
  }));
}

// -------------------------------------------------------------------- shell

function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#000000' : '#ffffff';
  brilho.assentar();
}

const CODIGO = [
  {
    nome: 'Claude Code', onde: '~/projetos/iaunifier', estado: 'trabalhando',
    saida: '<span class="cmd">$ claude "arruma o teste que quebrou no council"</span>\n\nli 3 arquivos · server/council.mjs, test/council.test.mjs, server/chat.mjs\n\n<span class="mais">+  if (voto > 10 || voto < 0) return anular(voto);</span>\n<span class="menos">-  if (voto > 10) return anular(voto);</span>\n\nrodando os testes… 284 passando, 1 falhando → 285 passando'
  },
  {
    nome: 'Codex', onde: '~/projetos/casa', estado: 'parado',
    saida: '<span class="cmd">$ codex</span>\n\núltima sessão em 2 de agosto · 12 arquivos tocados'
  },
  {
    nome: 'opencode', onde: '~/projetos/site', estado: 'parado',
    saida: '<span class="cmd">$ opencode --model qwen2.5-coder:14b</span>\n\nroda com o modelo daqui, sem custo por uso · última sessão ontem'
  }
];

function renderCode() {
  const view = $('#view-code');
  view.className = 'view panel';
  view.innerHTML = `<div class="panel-inner">
    <h2>Programar no terminal</h2>
    <p class="hint">Claude Code, Codex e opencode trabalhando dentro de uma pasta sua. Eles leem a mesma memória das conversas.</p>
    ${CODIGO.map((s) => `<article class="sessao">
      <div class="cab">
        <span class="nome">${s.nome}</span>
        <span class="onde">${s.onde}</span>
        <span class="grow"></span>
        <span class="tag ${s.estado === 'trabalhando' ? 'on' : ''}"><span class="pt"></span>${s.estado}</span>
      </div>
      <div class="saida">${s.saida}</div>
      <div class="row">${s.estado === 'trabalhando'
        ? `<button class="ghost">${icon('stop', 17)} Parar</button><button class="ghost">${icon('external', 17)} Ver o diff</button>`
        : `<button class="primary">${icon('play', 17)} Retomar</button>`}</div>
    </article>`).join('')}
    <div class="row"><button class="ghost">${icon('plus', 18)} Nova sessão numa pasta</button></div>
  </div>`;
  pintarIcones(view);
}

// telas que moram dentro de "Mais": abrem o grupo ao entrar
const DENTRO_DE_MAIS = ['memory', 'projects', 'gems', 'providers'];

const RENDER = {
  chat: () => renderChat({ streaming: true }),
  code: renderCode,
  council: () => renderCouncil('conselho'),
  research: renderResearch,
  projects: renderProjects,
  gems: renderGems,
  memory: renderMemory,
  providers: renderProviders,
  settings: renderSettings
};

function switchView(nome, opts = {}) {
  limpar();
  if ($('#app').classList.contains('anon') && !opts.mantemAnon) alternarAnon();
  $('#tune').hidden = true;
  $$('.view').forEach((v) => {
    v.hidden = v.id !== `view-${nome}`;
    v.classList.remove('entra');
  });
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === nome));
  $('#composer').hidden = nome !== 'chat';

  if (DENTRO_DE_MAIS.includes(nome)) $('#nav-mais').open = true;
  if (nome === 'chat' && opts.vazio) renderVazio();
  else if (nome === 'chat' && opts.primeira) renderFirstRun();
  else {
    if (nome !== 'chat') brilho.apagar();
    RENDER[nome]?.();
  }
  if (nome === 'chat') $('#composer').hidden = opts.primeira === true;
  const alvo = $(`#view-${nome}`);
  void alvo.offsetWidth;   // reinicia a animação de entrada
  alvo.classList.add('entra');
  if (window.matchMedia('(max-width: 760px)').matches) fecharGaveta();
}

const noPc = () => window.matchMedia('(min-width: 761px)').matches;
function abrirGaveta() {
  if (noPc()) return $('#app').classList.remove('recolhido');
  $('#sidebar').classList.add('open');
  $('#scrim').classList.add('on');
}
function fecharGaveta() {
  if (noPc()) return $('#app').classList.add('recolhido');
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('on');
}

$('#brand-marca').innerHTML = roseta(26, 'fixa');
encherTopbar();
encherLista();
pintarIcones();
aplicarTema('dark');
switchView('chat', { vazio: true });

$$('.nav-item[data-view]').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
$('#btn-open-side').onclick = abrirGaveta;
$('#btn-close-side').onclick = fecharGaveta;
$('#scrim').onclick = fecharGaveta;
$('#btn-web').onclick = (e) => {
  const b = e.currentTarget;
  b.setAttribute('aria-pressed', String(b.classList.toggle('on')));
};

$('#btn-new-chat').onclick = () => switchView('chat', { vazio: true });
$('#btn-new-chat-top').onclick = () => switchView('chat', { vazio: true });
$('#composer').onsubmit = (e) => { e.preventDefault(); renderChat({ streaming: true }); };
// a pílula cresce com o texto, e o enviar acende quando tem o que enviar
$('#input').oninput = (e) => {
  const el = e.currentTarget;
  el.style.height = 'auto';
  el.style.height = Math.min(190, el.scrollHeight) + 'px';
  $('#btn-send').classList.toggle('vazio', !el.value.trim());
};
function abrirPaleta() {
  $('#palette-list').innerHTML = [
    ['Nova conversa', 'edit', '⌘N'], ['Conversa anônima', 'alert', '⇧⌘N'],
    ['Ajustes desta conversa', 'spark', '⌘,'], ['Perguntar pra várias', 'users', '⇧⌘A'],
    ['Pesquisar na web', 'globe', '⌘P'], ['Ver memória', 'brain', '⌘M']
  ].map(([t, ic, k], i) => `<div class="palette-item${i === 0 ? ' sel' : ''}">${icon(ic, 19)} ${t}<span class="hintk">${k}</span></div>`).join('');
  $('#palette').hidden = false;
  $('#palette-input').focus();
}
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirPaleta(); }
  if (e.key === 'Escape') { $('#palette').hidden = true; $('#tune').hidden = true; }
});
$('#palette').onclick = (e) => {
  if (e.target.id === 'palette' || e.target.closest('.palette-item')) $('#palette').hidden = true;
};

const FALAS = [
  ['ouvindo…', 1400, ''],
  ['“troco só o disco do espelho ou aumento o espaço?”', 2200, 'ouviu'],
  ['pensando…', 1500, 'pensa'],
  ['Troca só o disco agora. O espelho fica sem proteção enquanto reconstrói, e o backup de ontem não terminou.', 5200, 'falando'],
  ['ouvindo…', 0, '']
];

function abrirVoz() {
  const v = $('#voice');
  v.hidden = false;
  v.className = 'voice';
  $('#voice-marca').innerHTML = roseta(78, 'grande');
  pintarIcones(v);
  let i = 0;
  const proximo = () => {
    const [txt, ms, cls] = FALAS[i];
    $('#voice-txt').textContent = txt;
    v.className = 'voice' + (cls === 'falando' ? ' falando' : '');
    $('#voice-quem').textContent = cls === 'falando'
      ? 'Claude Sonnet 4 · falando'
      : cls === 'pensa' ? 'Claude Sonnet 4 · usando 2 coisas que sabe de você' : 'Claude Sonnet 4 · responde falando';
    if (cls === 'pensa') $('#voice-marca').innerHTML = roseta(78, 'pensa');
    i = (i + 1) % FALAS.length;
    if (ms) later(proximo, ms);
  };
  proximo();
}

function fecharVoz() {
  limpar();
  $('#voice').hidden = true;
}

$('#btn-voice').onclick = abrirVoz;
$('#voice-close').onclick = fecharVoz;
$('#voice-fim').onclick = fecharVoz;
$('#voice-mudo').onclick = (e) => {
  const off = e.currentTarget.classList.toggle('off');
  $('#voice').classList.toggle('mudo', off);
};

function alternarAnon() {
  const on = $('#app').classList.toggle('anon');
  $('#btn-anon').classList.toggle('on', on);
  $('#btn-anon').setAttribute('aria-pressed', String(on));
  $('#input').placeholder = on ? 'Conversa anônima — nada fica guardado' : 'Fale com qualquer IA';
  const antiga = $('.anon-faixa');
  if (antiga) antiga.remove();
  if (on) {
    $('#messages').insertAdjacentHTML('afterbegin', `<div class="anon-faixa">
      <span class="ico">${icon('alert', 17)}</span>
      <span><b>Conversa anônima.</b> Não entra no histórico, não aprende nada sobre você e não usa a memória.
      Some quando você fechar ou trocar de conversa.</span></div>`);
    pintarIcones($('#messages'));
    torrada('', 'Conversa anônima ligada', 'Nada daqui é guardado.');
  } else {
    torrada('', 'Voltou ao normal', 'Esta conversa entra no histórico.');
  }
}

$('#btn-anon').onclick = alternarAnon;

// ponte com o documento de desenho
addEventListener('message', (ev) => {
  const d = ev.data || {};
  try { ev.source && ev.source.postMessage({ iauPronto: 1 }, '*'); } catch (e) {}
  if (d.tema) aplicarTema(d.tema);
  const modo = d.modo || (['comparar', 'conselho', 'votação'].includes(d.cenario) ? d.cenario : null);
  if (d.view === 'council' && modo) switchView('council', { modo });
  else if (d.view) switchView(d.view, { primeira: d.cenario === 'primeira', vazio: ['vazio', 'gaveta', 'paleta'].includes(d.cenario) });
  else if (d.cenario === 'primeira') switchView('chat', { primeira: true });
  else if (modo) renderCouncil(modo);
  if (d.gaveta || d.cenario === 'gaveta') later(abrirGaveta, 260);
  if (d.paleta || d.cenario === 'paleta') later(abrirPaleta, 300);
  if (d.cenario === 'anon') later(alternarAnon, 300);
  if (d.brilho) brilho.pulsar();
  if (d.ajustes) abrirAjustes();
  if (d.cenario === 'voz') later(abrirVoz, 320);
});
