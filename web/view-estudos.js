// Estudos: um professor, o que ele cobra, e o material que prova isso.
//
// A tela existe pra uma coisa que nenhum leitor de PDF faz: comparar o que o
// professor ENSINA com o que ele COBRA. Por isso o material não entra num monte
// só. Cada pasta é uma avaliação (a A1 do primeiro trimestre) ou a aula, e
// dentro da pasta de uma prova cada arquivo diz o que é — a prova em si ou o
// conteúdo que ela cobrou. A diferença entre os dois é a previsão; misturar as
// caixas apaga a comparação e sobra um resumidor comum.
//
// A organização é escolhida uma vez, na criação do professor, porque escola não
// é toda igual: trimestre com A1 e A2, bimestre, semestre, ou nada disso.

import {
  api, stream, state, escapeHtml, paintIcons, toast, iconPicker, modelOptions, modelLabel
} from './core.js';
import { icon } from './icons.js';
import { t, plural, formatarNumero, formatarData } from './i18n.js';

/** Guardado aqui e não no `state`: é a navegação da tela, não dado do app. */
const aqui = {
  professorId: null,
  pastaId: null,
  aba: 'material'
};

/**
 * As três formas de organizar, e o que cada uma faz nascer.
 *
 * Os nomes das pastas saem daqui, do lado do cliente, e viajam pro servidor no
 * pedido de criação: o servidor não tem `t()`, e uma pasta semeada em português
 * apareceria assim pra quem lê o app em inglês.
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

/** O que um arquivo é dentro da pasta. É isto que separa aula de prova. */
const PAPEIS = [
  {
    id: 'prova',
    nome: () => t('A prova'),
    dica: () => t('O que ele cobrou de verdade.'),
    ico: 'file'
  },
  {
    id: 'conteudo',
    nome: () => t('O conteúdo que caiu'),
    dica: () => t('A matéria daquela prova — o recorte que ele escolheu.'),
    ico: 'book'
  },
  {
    id: 'material',
    nome: () => t('Material de aula'),
    dica: () => t('O que ele ensina fora de prova nenhuma.'),
    ico: 'layers'
  }
];

const acharOrganizacao = (id) => ORGANIZACOES.find((o) => o.id === id) || ORGANIZACOES[0];
const acharPapel = (id) => PAPEIS.find((p) => p.id === id) || PAPEIS[2];

function painel(el, titulo, ico, dica, dentro) {
  el.className = `view panel${el.classList.contains('entra') ? ' entra' : ''}`;
  el.innerHTML = `<div class="panel-inner">
      <h2><span class="ico">${icon(ico, 19)}</span> ${escapeHtml(titulo)}</h2>
      <p class="hint">${dica}</p>
      ${dentro}
    </div>`;
  return el.querySelector('.panel-inner');
}

/** A cara do professor: a foto que ele escolheu, ou a inicial do nome. */
function retratoDoProfessor(p, tamanho = 44) {
  const estilo = `width:${tamanho}px;height:${tamanho}px;--tint:var(--${p.cor || 'indigo'})`;
  if (p.foto) {
    // O endereço leva o id do professor, não o nome do arquivo, e o `?v=` muda
    // quando a foto muda — senão o navegador continua mostrando a antiga.
    return `<span class="prof-cara" style="${estilo}"><img src="/api/professores/${encodeURIComponent(
      p.id
    )}/foto?v=${encodeURIComponent(p.updated_at || '')}" alt="" /></span>`;
  }
  const inicial = (p.nome || '?').trim().charAt(0).toUpperCase();
  return `<span class="prof-cara" style="${estilo}">${escapeHtml(inicial)}</span>`;
}

// ------------------------------------------------------------------- a tela

export async function renderEstudos(el, ctx) {
  if (aqui.professorId) return telaDoProfessor(el, ctx);
  return telaDaLista(el, ctx);
}

async function telaDaLista(el, ctx) {
  const professores = await api('/professores');

  const dentro = professores.length
    ? `<div id="prof-cards" class="grid"></div>
       <div class="row"><button id="btn-novo-prof" class="primary" type="button">
         <span data-icon="plus"></span> ${t('Adicionar professor')}
       </button></div>`
    : `<div class="cd-vazio">
         <span class="ico">${icon('book', 34)}</span>
         <b>${t('Comece pelo professor')}</b>
         <span>${t(
           'Jogue aqui as provas que ele já aplicou e o conteúdo que caiu em cada uma. Com isso o Nuvo monta o retrato dele — o que ele cobra, em que formato e em que nível — e passa a estudar com você por esse recorte, em vez de pela matéria inteira.'
         )}</span>
         <div class="row"><button id="btn-novo-prof" class="primary" type="button">
           <span data-icon="plus"></span> ${t('Adicionar professor')}
         </button></div>
       </div>`;

  const inner = painel(
    el,
    t('Estudos'),
    'book',
    t('Cada professor tem um jeito de fazer prova. Aqui a gente descobre qual é o dele.'),
    `${dentro}<div id="prof-novo"></div>`
  );

  const cards = inner.querySelector('#prof-cards');
  for (const p of professores) {
    const card = document.createElement('article');
    card.className = 'card prof-card';
    card.style.setProperty('--tint', `var(--${p.cor || 'indigo'})`);
    card.innerHTML = `
      <h3>${retratoDoProfessor(p)} <span class="grow">${escapeHtml(p.nome)}</span></h3>
      <div class="meta">${escapeHtml(p.materia || t('sem matéria'))}</div>
      <div class="row prof-tags"></div>
      <div class="row">
        <button data-act="abrir" class="primary" type="button">
          <span data-icon="folder"></span> ${t('Abrir')}
        </button>
      </div>`;
    card.querySelector('[data-act=abrir]').onclick = () => {
      aqui.professorId = p.id;
      aqui.pastaId = null;
      aqui.aba = 'material';
      ctx.switchView('estudos');
    };
    cards?.appendChild(card);
  }

  inner.querySelector('#btn-novo-prof').onclick = () =>
    formularioDeProfessor(inner.querySelector('#prof-novo'), ctx);

  paintIcons(el);
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

// ------------------------------------------------------------- o professor

async function telaDoProfessor(el, ctx) {
  let prof;
  try {
    prof = await api(`/professores/${aqui.professorId}`);
  } catch {
    // Apagado noutra aba, ou o banco trocado por um backup: voltar pra lista é
    // melhor do que uma tela de erro que não tem saída.
    aqui.professorId = null;
    return telaDaLista(el, ctx);
  }

  const provas = prof.pastas.filter((p) => p.tipo === 'prova');
  const materiais = prof.pastas.filter((p) => p.tipo === 'material');
  if (!aqui.pastaId || !prof.pastas.some((p) => p.id === aqui.pastaId)) {
    aqui.pastaId = prof.pastas[0]?.id || null;
  }

  const inner = painel(
    el,
    prof.nome,
    'book',
    escapeHtml(prof.materia || t('sem matéria')),
    `<div class="row est-topo">
       <button id="est-voltar" class="ghost" type="button">
         <span data-icon="chevron" class="volta"></span> ${t('Todos os professores')}
       </button>
       <span class="grow"></span>
       <span class="tag">${plural(prof.material.provas, '1 prova', '{n} provas')}</span>
       <span class="tag">${plural(prof.material.conteudos, '1 conteúdo', '{n} conteúdos')}</span>
       <span class="tag">${plural(prof.material.materiais, '1 material', '{n} materiais')}</span>
     </div>
     <div class="segmentado est-abas" role="tablist">
       <button type="button" role="tab" data-aba="material">${t('Material')}</button>
       <button type="button" role="tab" data-aba="retrato">${t('Retrato do professor')}</button>
       <button type="button" role="tab" data-aba="estudar">${t('Estudar')}</button>
     </div>
     <div class="est-grade" data-painel="material">
       <aside class="est-pastas">
         <div class="grupo-rot">${t('Avaliações')}</div>
         <div id="est-provas" class="grupo"></div>
         <button id="est-nova-prova" class="link-btn" type="button">
           <span data-icon="plus" data-size="16"></span> ${t('Nova avaliação')}
         </button>
         <div class="grupo-rot">${t('Fora de prova')}</div>
         <div id="est-materiais" class="grupo"></div>
         <button id="est-nova-pasta" class="link-btn" type="button">
           <span data-icon="plus" data-size="16"></span> ${t('Nova pasta')}
         </button>
       </aside>
       <section id="est-corpo" class="est-corpo"></section>
     </div>
     <div id="est-retrato" data-painel="retrato" hidden></div>
     <div id="est-estudar" data-painel="estudar" hidden></div>`
  );

  for (const btn of inner.querySelectorAll('.est-abas [data-aba]')) {
    btn.classList.toggle('sel', btn.dataset.aba === aqui.aba);
    btn.setAttribute('aria-selected', String(btn.dataset.aba === aqui.aba));
    btn.onclick = () => {
      aqui.aba = btn.dataset.aba;
      ctx.switchView('estudos');
    };
  }
  for (const painel of inner.querySelectorAll('[data-painel]')) {
    painel.hidden = painel.dataset.painel !== aqui.aba;
  }

  if (aqui.aba === 'retrato') {
    telaDoRetrato(inner.querySelector('#est-retrato'), prof, ctx);
    paintIcons(el);
    return;
  }
  if (aqui.aba === 'estudar') {
    await telaDeEstudar(inner.querySelector('#est-estudar'), prof, ctx);
    paintIcons(el);
    return;
  }

  const linhaDaPasta = (pasta) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chat-item${pasta.id === aqui.pastaId ? ' active' : ''}`;
    const quantos = pasta.anexos.length;
    btn.innerHTML = `<span class="grow">${escapeHtml(pasta.nome)}</span>
      <span class="badge-n">${quantos ? formatarNumero(quantos) : ''}</span>`;
    btn.onclick = () => {
      aqui.pastaId = pasta.id;
      ctx.switchView('estudos');
    };
    return btn;
  };

  const caixaProvas = inner.querySelector('#est-provas');
  const caixaMateriais = inner.querySelector('#est-materiais');
  if (!provas.length) {
    caixaProvas.innerHTML = `<p class="meta">${t('nenhuma avaliação ainda')}</p>`;
  }
  for (const pasta of provas) caixaProvas.appendChild(linhaDaPasta(pasta));
  for (const pasta of materiais) caixaMateriais.appendChild(linhaDaPasta(pasta));

  inner.querySelector('#est-voltar').onclick = () => {
    aqui.professorId = null;
    aqui.pastaId = null;
    ctx.switchView('estudos');
  };
  inner.querySelector('#est-nova-prova').onclick = () =>
    criarPasta(prof, 'prova', ctx, caixaProvas);
  inner.querySelector('#est-nova-pasta').onclick = () =>
    criarPasta(prof, 'material', ctx, caixaMateriais);

  const pasta = prof.pastas.find((p) => p.id === aqui.pastaId);
  await corpoDaPasta(inner.querySelector('#est-corpo'), prof, pasta, ctx);

  paintIcons(el);
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

function criarPasta(prof, tipo, ctx, host) {
  pedirNome(host, {
    dica: tipo === 'prova' ? t('A1 do 1º trimestre') : t('Nome da pasta'),
    aoConfirmar: async (nome) => {
      const pasta = await api(`/professores/${prof.id}/pastas`, {
        method: 'POST',
        body: { nome, tipo }
      });
      aqui.pastaId = pasta.id;
      ctx.switchView('estudos');
    }
  });
}

/**
 * O miolo: os arquivos da pasta aberta, separados pelo papel que exercem.
 *
 * Numa pasta de prova as três caixas aparecem, e as duas primeiras são as que
 * importam. Numa pasta de aula só existe material, e mostrar as outras duas
 * vazias só convidaria a jogar prova no lugar errado.
 */
async function corpoDaPasta(host, prof, pasta, ctx) {
  if (!pasta) {
    host.innerHTML = `<div class="cd-vazio">
      <span class="ico">${icon('folder', 30)}</span>
      <b>${t('Nenhuma pasta ainda')}</b>
      <span>${t('Crie a primeira avaliação dele aqui do lado.')}</span>
    </div>`;
    return paintIcons(host);
  }

  const papeis = pasta.tipo === 'prova' ? PAPEIS : PAPEIS.filter((p) => p.id === 'material');

  host.innerHTML = `
    <div class="row est-cabeca">
      <h3 class="grow">${escapeHtml(pasta.nome)}</h3>
      <button data-act="ren" class="icon" type="button" title="${t('renomear')}"
        aria-label="${t('renomear a pasta')}"><span data-icon="edit" data-size="18"></span></button>
      <button data-act="del" class="icon danger" type="button" title="${t('apagar')}"
        aria-label="${t('apagar a pasta')}"><span data-icon="trash" data-size="18"></span></button>
    </div>
    <div class="est-caixas"></div>`;

  const caixas = host.querySelector('.est-caixas');
  for (const papel of papeis) {
    const dela = pasta.anexos.filter((a) => a.papel === papel.id);
    const caixa = document.createElement('div');
    caixa.className = 'card est-caixa';
    caixa.innerHTML = `
      <h4>${icon(papel.ico, 17)} ${escapeHtml(papel.nome())}
        <span class="tag">${dela.length ? formatarNumero(dela.length) : t('vazio')}</span>
      </h4>
      <p class="meta">${escapeHtml(papel.dica())}</p>
      <div class="est-arquivos"></div>
      <div class="row">
        <button data-add="${papel.id}" class="ghost" type="button">
          <span data-icon="plus" data-size="16"></span> ${t('Adicionar arquivo')}
        </button>
      </div>`;

    const lista = caixa.querySelector('.est-arquivos');
    for (const anexo of dela) {
      const linha = document.createElement('div');
      linha.className = `est-arquivo${anexo.status === 'ok' ? '' : ' ruim'}`;
      linha.innerHTML = `<span class="ico">${icon('file', 16)}</span>
        <span class="grow">${escapeHtml(anexo.name)}</span>
        <span class="meta">${
          anexo.status === 'ok'
            ? plural(anexo.chunks || 0, '1 trecho', '{n} trechos')
            : escapeHtml(anexo.note || t('não deu pra ler'))
        }</span>
        <button data-del="${anexo.id}" class="icon" type="button" title="${t('apagar')}"
          aria-label="${t('apagar {nome}', { nome: escapeHtml(anexo.name) })}">
          <span data-icon="trash" data-size="16"></span></button>`;
      linha.querySelector('[data-del]').onclick = async () => {
        await api(`/attachments/${anexo.id}`, { method: 'DELETE' });
        ctx.switchView('estudos');
      };
      lista.appendChild(linha);
    }
    if (!dela.length) lista.innerHTML = `<p class="meta">${t('nada aqui ainda')}</p>`;

    caixa.querySelector('[data-add]').onclick = () => escolherArquivos(pasta.id, papel.id, ctx);
    caixas.appendChild(caixa);
  }

  const cabeca = host.querySelector('.est-cabeca');
  host.querySelector('[data-act=ren]').onclick = () => {
    pedirNome(cabeca, {
      valor: pasta.nome,
      dica: t('Nome da pasta'),
      aoConfirmar: async (nome) => {
        await api(`/pastas/${pasta.id}`, { method: 'PATCH', body: { nome } });
        ctx.switchView('estudos');
      }
    });
  };

  // Apagar pede confirmação no próprio botão, em dois toques. Some sozinho se a
  // pessoa não confirmar: um botão vermelho armado pra sempre é armadilha.
  const apagar = host.querySelector('[data-act=del]');
  let armado = 0;
  apagar.onclick = async () => {
    if (!armado) {
      armado = window.setTimeout(() => {
        armado = 0;
        apagar.classList.remove('armado');
        apagar.innerHTML = icon('trash', 18);
      }, 4000);
      apagar.classList.add('armado');
      apagar.innerHTML = `${icon('trash', 16)} <span>${t('apagar mesmo?')}</span>`;
      return;
    }
    window.clearTimeout(armado);
    await api(`/pastas/${pasta.id}`, { method: 'DELETE' });
    aqui.pastaId = null;
    ctx.switchView('estudos');
  };

  paintIcons(host);
}

/** Abre o seletor de arquivos e sobe um por um, dizendo o papel de cada. */
function escolherArquivos(pastaId, papel, ctx) {
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

// -------------------------------------------------------- o retrato na tela

/** Como cada nível de Bloom se chama pra quem lê, e o que ele quer dizer. */
const ROTULO_DO_NIVEL = {
  lembrar: () => t('lembrar'),
  entender: () => t('entender'),
  aplicar: () => t('aplicar'),
  analisar: () => t('analisar'),
  avaliar: () => t('avaliar'),
  criar: () => t('criar')
};

/**
 * O quanto dá pra confiar, dito na cara.
 *
 * Com uma prova só o retrato é a descrição daquela prova. Chamar isso de padrão
 * do professor é o erro que os preditores de prova comerciais cometem, e é o que
 * transforma uma ferramenta útil numa que engana.
 */
const ROTULO_DA_CONFIANCA = {
  palpite: () => t('ainda é palpite — só uma prova'),
  indicio: () => t('indício — duas provas'),
  media: () => t('razoável — falta o material de aula'),
  boa: () => t('boa — provas e aula batendo')
};

const porcento = (fracao) => `${formatarNumero(Math.round((Number(fracao) || 0) * 100))}%`;

/** Uma barra e um número: peso se lê melhor visto do que lido. */
function linhaDePeso(rotulo, peso, citacao, extra = '') {
  return `<div class="ret-linha">
    <div class="ret-rot"><b>${escapeHtml(rotulo)}</b>${extra}</div>
    <div class="progress"><span style="width:${Math.min(Math.round((Number(peso) || 0) * 100), 100)}%"></span></div>
    <span class="ret-num">${porcento(peso)}</span>
    ${citacao ? `<p class="ret-cita">${escapeHtml(citacao)}</p>` : ''}
  </div>`;
}

function telaDoRetrato(host, prof, ctx) {
  const retrato = prof.retrato;
  const podeGerar = prof.material.provas > 0;

  if (!retrato) {
    host.innerHTML = `<div class="cd-vazio">
      <span class="ico">${icon('sparkle', 32)}</span>
      <b>${t('Ainda não há retrato dele')}</b>
      <span>${
        podeGerar
          ? t(
              'O Nuvo vai ler as provas que você anexou, uma por uma, e depois comparar com o material de aula. O que sai é o que ele cobra, em que formato e em que nível — com o trecho da prova do lado de cada achado.'
            )
          : t('Anexe pelo menos uma prova dele. Sem prova não há o que retratar.')
      }</span>
      <div id="ret-acao" class="row"></div>
      <div id="ret-andar" class="ret-andar" role="status"></div>
    </div>`;
    if (podeGerar) botaoDeGerar(host.querySelector('#ret-acao'), prof, ctx);
    return paintIcons(host);
  }

  const conf = retrato.confianca || {};
  host.innerHTML = `
    <div class="row ret-topo">
      <span class="tag ret-conf ${escapeHtml(conf.nota || '')}">
        ${escapeHtml((ROTULO_DA_CONFIANCA[conf.nota] || (() => t('sem nota de confiança')))())}
      </span>
      <span class="grow"></span>
      <span class="meta">${escapeHtml(prof.retrato_modelo ? modelLabel(prof.retrato_modelo) : '')}</span>
      <span id="ret-acao"></span>
    </div>
    <div id="ret-andar" class="ret-andar" role="status"></div>

    ${secao('file', t('Como a prova dele é'), formatoEmHtml(retrato.formato))}
    ${secao(
      'book',
      t('O que ele cobra'),
      retrato.conteudo
        .map((c) =>
          linhaDePeso(
            c.tema,
            c.peso,
            c.citacao,
            c.apareceu_em?.length
              ? `<span class="meta">${escapeHtml(c.apareceu_em.join(' · '))}</span>`
              : ''
          )
        )
        .join('')
    )}
    ${secao(
      'brain',
      t('O que ele pede de você'),
      retrato.cognitivo
        .map((c) => linhaDePeso((ROTULO_DO_NIVEL[c.nivel] || (() => c.nivel))(), c.peso))
        .join('')
    )}
    ${
      retrato.verbos.length
        ? secao(
            'edit',
            t('Como ele manda fazer'),
            `<div class="ret-verbos">${retrato.verbos
              .map(
                (v) =>
                  `<span class="tag" title="${escapeHtml(v.exemplo || '')}">${escapeHtml(
                    v.verbo
                  )} <b>${formatarNumero(v.vezes)}</b></span>`
              )
              .join('')}</div>`
          )
        : ''
    }
    ${
      retrato.pegadinhas.length
        ? secao(
            'alert',
            t('Onde ele derruba quem decorou'),
            retrato.pegadinhas
              .map(
                (p) =>
                  `<div class="ret-linha"><div class="ret-rot"><b>${escapeHtml(p.padrao)}</b></div>
                   ${p.exemplo ? `<p class="ret-cita">${escapeHtml(p.exemplo)}</p>` : ''}</div>`
              )
              .join('')
          )
        : ''
    }
    ${
      retrato.manias.length
        ? secao('spark', t('Manias dele'), `<ul class="ret-lista">${retrato.manias
            .map((m) => `<li>${escapeHtml(m)}</li>`)
            .join('')}</ul>`)
        : ''
    }
    ${
      retrato.so_na_aula.length
        ? secao(
            'filter',
            t('Ensina e nunca cobrou'),
            `<p class="meta">${t(
              'Está no material de aula e não apareceu em nenhuma prova. É o primeiro lugar onde economizar tempo.'
            )}</p>
             <ul class="ret-lista">${retrato.so_na_aula
               .map((s) => `<li>${escapeHtml(s)}</li>`)
               .join('')}</ul>`
          )
        : ''
    }
    <p class="meta ret-rodape">${t(
      'Isto é leitura de máquina sobre as provas que você deu a ela. Confira antes de estudar por aqui: o que estiver errado, apague.'
    )}</p>`;

  botaoDeGerar(host.querySelector('#ret-acao'), prof, ctx, { refazer: true });
  paintIcons(host);
}

function secao(ico, titulo, dentro) {
  if (!dentro) return '';
  return `<section class="card ret-secao">
    <h3>${icon(ico, 17)} ${escapeHtml(titulo)}</h3>
    ${dentro}
  </section>`;
}

function formatoEmHtml(formato) {
  if (!formato) return '';
  const partes = [];
  if (formato.n_questoes) {
    partes.push(`<span class="tag">${plural(formato.n_questoes, '1 questão', '{n} questões')}</span>`);
  }
  for (const tipo of formato.tipos || []) {
    partes.push(`<span class="tag">${escapeHtml(tipo.tipo)} <b>${porcento(tipo.peso)}</b></span>`);
  }
  if (!partes.length && !formato.pontuacao) return '';
  return `<div class="ret-verbos">${partes.join('')}</div>
    ${formato.pontuacao ? `<p class="meta">${escapeHtml(formato.pontuacao)}</p>` : ''}`;
}

/** O botão que manda montar, com a escolha da IA do lado. */
function botaoDeGerar(host, prof, ctx, { refazer = false } = {}) {
  if (!host) return;
  host.innerHTML = `
    <select id="ret-modelo" aria-label="${t('IA que monta o retrato')}">${modelOptions(
      state.model
    )}</select>
    <button id="ret-gerar" class="primary" type="button">
      <span data-icon="sparkle"></span> ${refazer ? t('Refazer o retrato') : t('Montar o retrato')}
    </button>`;

  const botao = host.querySelector('#ret-gerar');
  const andar = host.closest('#est-retrato')?.querySelector('#ret-andar');
  botao.onclick = async () => {
    const ref = host.querySelector('#ret-modelo').value;
    if (!ref) return toast(t('escolha uma IA pra montar o retrato'), 'err');
    botao.disabled = true;
    const passos = [];
    const contar = (linha) => {
      passos.push(linha);
      if (andar) andar.textContent = passos.slice(-1)[0];
    };
    try {
      await stream(`/professores/${prof.id}/retrato`, { model: ref }, (ev) => {
        if (ev.type === 'start') {
          contar(
            t('lendo {provas} e {materiais}', {
              provas: plural(ev.provas, '1 prova', '{n} provas'),
              materiais: plural(ev.materiais, '1 material', '{n} materiais')
            })
          );
        }
        if (ev.type === 'lendo') contar(t('lendo {nome}…', { nome: ev.nome }));
        if (ev.type === 'lida') {
          contar(t('{nome}: {questoes}', { nome: ev.nome, questoes: plural(ev.questoes, '1 questão', '{n} questões') }));
        }
        if (ev.type === 'pulada') contar(t('{nome} ficou de fora — {porque}', { nome: ev.nome, porque: ev.porque }));
        if (ev.type === 'sintetizando') contar(t('juntando tudo…'));
        if (ev.type === 'repetindo') contar(t('a resposta veio torta, pedindo de novo…'));
        if (ev.type === 'error') throw new Error(ev.message);
      });
      toast(t('retrato pronto'), 'ok');
    } catch (err) {
      toast(err.message || t('não deu pra montar o retrato'), 'err');
    } finally {
      botao.disabled = false;
      ctx.switchView('estudos');
    }
  };
  paintIcons(host);
}

// ------------------------------------------------------------------ estudar

/** O que dá pra pedir, e o que cada coisa serve. Ordem: o que mais vale prova. */
const FORMATOS = [
  {
    id: 'simulado',
    ico: 'file',
    nome: () => t('Simulado'),
    dica: () => t('Uma prova nova no jeito dele, com o gabarito e o motivo de cada questão.'),
    precisaRetrato: true
  },
  {
    id: 'guia',
    ico: 'book',
    nome: () => t('Guia de estudo'),
    dica: () => t('O que estudar, na ordem do que mais cai — e o que dá pra pular.'),
    precisaRetrato: true
  },
  {
    id: 'flashcards',
    ico: 'layers',
    nome: () => t('Cartões'),
    dica: () => t('Pergunta e resposta, pra treinar de olho fechado.'),
    precisaRetrato: false
  },
  {
    id: 'resumo',
    ico: 'edit',
    nome: () => t('Resumo'),
    dica: () => t('O material inteiro em pontos, com os termos definidos.'),
    precisaRetrato: false
  }
];

const PROBABILIDADE = {
  alta: () => t('cai bastante'),
  media: () => t('pode cair'),
  baixa: () => t('cai pouco')
};

async function telaDeEstudar(host, prof, ctx) {
  const saidas = await api(`/professores/${prof.id}/saidas`);
  const temRetrato = !!prof.retrato;

  host.innerHTML = `
    <div class="est-formatos"></div>
    <div id="est-andar" class="ret-andar" role="status"></div>
    <div class="grupo-rot">${t('O que já foi feito')}</div>
    <div id="est-saidas" class="grupo"></div>
    <div id="est-aberto"></div>`;

  const caixa = host.querySelector('.est-formatos');
  for (const formato of FORMATOS) {
    const trancado = formato.precisaRetrato && !temRetrato;
    const card = document.createElement('div');
    card.className = `card est-formato${trancado ? ' trancado' : ''}`;
    card.innerHTML = `
      <h4>${icon(formato.ico, 17)} ${escapeHtml(formato.nome())}</h4>
      <p class="meta">${escapeHtml(formato.dica())}</p>
      ${
        trancado
          ? `<p class="meta aviso warn">${t('precisa do retrato do professor antes')}</p>`
          : `<div class="row">
               <select data-modelo aria-label="${t('IA que gera')}">${modelOptions(state.model)}</select>
               <button data-gerar="${formato.id}" class="primary" type="button">
                 <span data-icon="sparkle" data-size="16"></span> ${t('Gerar')}
               </button>
             </div>`
      }`;
    const botao = card.querySelector('[data-gerar]');
    if (botao) {
      botao.onclick = () =>
        gerar(host, prof, formato.id, card.querySelector('[data-modelo]').value, ctx);
    }
    caixa.appendChild(card);
  }

  const listaSaidas = host.querySelector('#est-saidas');
  if (!saidas.length) {
    listaSaidas.innerHTML = `<p class="meta" style="padding:14px 18px">${t(
      'nada gerado ainda'
    )}</p>`;
  }
  for (const saida of saidas) {
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'linha';
    linha.innerHTML = `<span class="ico">${icon(
      FORMATOS.find((f) => f.id === saida.tipo)?.ico || 'file',
      18
    )}</span>
      <span class="grow">${escapeHtml(saida.titulo)}</span>
      <span class="meta">${escapeHtml(formatarData(saida.created_at, { day: '2-digit', month: 'short' }) || '')}</span>`;
    linha.onclick = () => abrirSaida(host.querySelector('#est-aberto'), saida, ctx);
    listaSaidas.appendChild(linha);
  }

  paintIcons(host);
}

async function gerar(host, prof, tipo, ref, ctx) {
  if (!ref) return toast(t('escolha uma IA pra gerar'), 'err');
  const andar = host.querySelector('#est-andar');
  const dizer = (frase) => {
    if (andar) andar.textContent = frase;
  };
  for (const b of host.querySelectorAll('[data-gerar]')) b.disabled = true;
  try {
    await stream(`/professores/${prof.id}/gerar`, { tipo, model: ref }, (ev) => {
      if (ev.type === 'start') {
        dizer(
          t('lendo {arquivos}…', { arquivos: plural(ev.arquivos, '1 arquivo', '{n} arquivos') })
        );
      }
      if (ev.type === 'repetindo') dizer(t('a resposta veio torta, pedindo de novo…'));
      if (ev.type === 'pronto') dizer('');
      if (ev.type === 'error') throw new Error(ev.message);
    });
    toast(t('pronto'), 'ok');
  } catch (err) {
    toast(err.message || t('não deu pra gerar'), 'err');
  } finally {
    ctx.switchView('estudos');
  }
}

function abrirSaida(host, saida, ctx) {
  if (host.dataset.aberta === saida.id) {
    host.innerHTML = '';
    host.dataset.aberta = '';
    return;
  }
  host.dataset.aberta = saida.id;
  const j = saida.json || {};
  const desenhar = {
    simulado: () => desenharSimulado(j),
    guia: () => desenharGuia(j),
    flashcards: () => desenharCartoes(j),
    resumo: () => desenharResumo(j)
  }[saida.tipo];

  host.innerHTML = `<section class="card est-saida">
      <div class="row est-cabeca">
        <h3 class="grow">${escapeHtml(saida.titulo)}</h3>
        <button data-act="fechar" class="icon" type="button" title="${t('fechar')}"
          aria-label="${t('fechar')}"><span data-icon="close" data-size="18"></span></button>
        <button data-act="apagar" class="icon danger" type="button" title="${t('apagar')}"
          aria-label="${t('apagar')}"><span data-icon="trash" data-size="18"></span></button>
      </div>
      ${desenhar ? desenhar() : ''}
      ${faltouEmHtml(j.faltou)}
    </section>`;

  host.querySelector('[data-act=fechar]').onclick = () => {
    host.innerHTML = '';
    host.dataset.aberta = '';
  };
  host.querySelector('[data-act=apagar]').onclick = async () => {
    await api(`/saidas/${saida.id}`, { method: 'DELETE' });
    ctx.switchView('estudos');
  };
  host.scrollIntoView({ block: 'nearest' });
  paintIcons(host);
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
  return `${j.instrucoes ? `<pre class="est-instrucoes">${escapeHtml(j.instrucoes)}</pre>` : ''}
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
  return `<p class="meta">${plural((j.cartoes || []).length, '1 cartão', '{n} cartões')}</p>
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
