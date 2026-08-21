// Painéis: IAs ligadas, perfis, projetos, memória, ajustes, conselho e pesquisa.

import {
  $, api, stream, state, refreshState, chatModels, embeddingModels, modelOptions, modelLabel,
  escapeHtml, badge, toast, iconPicker, paintIcons, TOKEN, origemDoFato, escopoDoFato
} from './core.js';
import { icon } from './icons.js';
import { avisar, confirmar, perguntar } from './dialogo.js';
import { renderMarkdown, wireCodeCopy } from './md.js';
import { roseta } from './glow.js';
import {
  t, plural, formatarNumero, formatarData, NOMES as IDIOMAS, idioma, trocarIdioma
} from './i18n.js';
import {
  lerRequisitos, cartaoRequisitos, ligarRequisitos, perguntarNavegador
} from './requisitos.js';
import { lerCatalogo, secaoCatalogo, ligarCatalogo } from './catalogo.js';
import { viewLoja } from './view-loja.js';

/** Cada painel se redesenha inteiro; o estado real está no servidor. */
export const views = {};

function panel(el, title, iconName, hint, inner) {
  // `entra` vem do switchView; reescrever className cru apagava a animação.
  el.className = `view panel${el.classList.contains('entra') ? ' entra' : ''}`;
  el.innerHTML = `<div class="panel-inner">
      <h2><span class="ico">${icon(iconName, 19)}</span> ${escapeHtml(title)}</h2>
      <p class="hint">${hint}</p>
      ${inner}
    </div>`;
  return el.querySelector('.panel-inner');
}

// ----------------------------------------------------------- IAs ligadas

const gbTxt = (n) => `${formatarNumero(n || 0, { maximumFractionDigits: 1 })} GB`;
const pctTxt = (v, total) => `${Math.max(0, Math.min(100, (v / (total || 1)) * 100)).toFixed(1)}%`;

/**
 * O GET /machine devolve a memória da máquina em bytes e o tamanho de cada
 * modelo em GB. Não existe máquina com mil GB de RAM, então número acima disso
 * é byte e vira GB aqui — assim a tela serve pras duas formas do campo.
 */
const emGb = (n) => {
  const v = Number(n || 0);
  return v >= 1024 ? v / 1024 ** 3 : v;
};

const CABE_ROT = { folga: 'cabe com folga', aperto: 'cabe apertado', nao: 'não cabe aqui' };

/** Como cada tipo de provedor se chama na superfície — "provedor" e "kind" não aparecem. */
const KIND_ROT = {
  ollama: 'roda nesta máquina',
  cli: 'programa do terminal',
  openai: 'paga por uso',
  anthropic: 'paga por uso',
  google: 'paga por uso'
};

/** Endereço de casa é motor local, mesmo falando a API da OpenAI. */
const ehLocal = (p) =>
  /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/.test(p.base_url || '');
const kindRot = (p) => t(ehLocal(p) ? 'roda nesta máquina' : KIND_ROT[p.kind] || 'paga por uso');

/** O cartão da máquina: quanto de memória tem, o que é o chip e o que cabe nela. */
function cartaoMaquina(m) {
  if (!m) return '';
  const total = emGb(m.ram_total);
  const livre = emGb(m.ram_livre);
  const vram = emGb(m.gpu_vram);
  const baixados = (m.modelos || []).filter((x) => x.instalado).reduce((s, x) => s + (x.gb || 0), 0);
  const sistema = Math.max(0, total - livre - baixados);
  const teto =
    (m.modelos || []).filter((x) => x.cabe === 'folga').reduce((s, x) => Math.max(s, x.gb || 0), 0) ||
    Math.max(0, livre - 2);
  const placa = vram
    ? t('com placa de vídeo de <b>{vram}</b>', { vram: gbTxt(vram) })
    : t('sem placa de vídeo dedicada');
  return `<div class="maquina">
      ${t('Seu servidor tem <b>{ram} de memória</b> e um <b>{chip}</b>, {placa}.', {
        ram: gbTxt(total),
        chip: escapeHtml(m.chip || t('processador desconhecido')),
        placa
      })}
      ${t('Cabe modelo de até uns <b>{teto}</b> com folga pro resto da máquina respirar.', {
        teto: gbTxt(teto)
      })}
      <div class="barra-mem">
        <i style="width:${pctTxt(baixados, total)};background:var(--accent)"></i>
        <i style="width:${pctTxt(sistema, total)};background:var(--slate)"></i>
      </div>
      <div class="legenda">
        <span><i style="background:var(--accent)"></i> ${t('modelos baixados')} · ${gbTxt(baixados)}</span>
        <span><i style="background:var(--slate)"></i> ${t('resto do sistema')} · ${gbTxt(sistema)}</span>
        <span><i style="background:var(--panel-3)"></i> ${t('livre')} · ${gbTxt(livre)}</span>
      </div>
    </div>`;
}

/** Uma linha de modelo recomendado: pra que serve, contra quem, e se cabe aqui. */
function linhaModelo(m) {
  const cabe = CABE_ROT[m.cabe] ? m.cabe : 'aperto';
  return `<div class="modelo${m.instalado ? ' instalado' : ''}" data-modelo="${escapeHtml(m.id)}">
      <div class="linha1">
        <span class="nome">${escapeHtml(m.nome_legivel || m.id)}</span>
        <span class="id">${escapeHtml(m.id)} · ${gbTxt(m.gb)}</span>
      </div>
      <div class="pra-que">${escapeHtml(m.pra_que ? t(m.pra_que) : '')}</div>
      <div class="compara">${escapeHtml(m.compara ? t(m.compara) : '')}</div>
      <div class="cabe ${cabe}">${icon(cabe === 'nao' ? 'alert' : 'check', 16)} ${t(CABE_ROT[cabe])}</div>
      <div class="acoes">${
        m.instalado
          ? `<button class="ghost" type="button" data-usar="${escapeHtml(m.id)}">${icon('play', 17)} ${t('Usar agora')}</button>
             <button class="danger" type="button" data-apagar="${escapeHtml(m.id)}">${icon('trash', 17)} ${t('Apagar')}</button>`
          : cabe === 'nao'
            ? `<button disabled type="button">${icon('download', 17)} ${t('Baixar')}</button>
               <button class="ghost" type="button" data-porque="${escapeHtml(m.id)}">${t('Por que não cabe')}</button>`
            : `<button class="primary" type="button" data-baixar="${escapeHtml(m.id)}">${icon('download', 17)} ${t('Baixar {tam}', { tam: gbTxt(m.gb) })}</button>`
      }</div>
      <div class="progress" hidden><span style="width:0%"></span></div>
    </div>`;
}

/**
 * Baixar, apagar e usar modelo da lista de recomendados. As rotas são as
 * mesmas do gerenciador do Ollama; sem uma IA que rode aqui, a lista avisa
 * em vez de ficar de enfeite.
 */
function ligarRecomendados(inner, maquina, switchView) {
  const lista = inner.querySelector('#lista-modelos');
  if (!lista || !maquina) return;
  const local =
    state.providers.find((p) => p.manageable && p.enabled) || state.providers.find((p) => p.manageable);
  // Sem IA local, o clique não vira erro seco: ele aponta pro cartão que
  // resolve, que está na mesma tela, logo acima.
  const semLocal = () => {
    const cartao = inner.querySelector('#cartao-falta');
    if (!cartao) return toast(t('nenhuma IA que roda aqui está ligada'), 'err');
    cartao.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cartao.classList.add('chama');
    setTimeout(() => cartao.classList.remove('chama'), 1400);
    toast(t('primeiro o programa que roda IA aqui — o botão está logo acima'), 'err');
  };

  for (const linha of lista.querySelectorAll('.modelo')) {
    const m = (maquina.modelos || []).find((x) => x.id === linha.dataset.modelo);
    if (!m) continue;
    const nome = m.nome_legivel || m.id;

    const usar = linha.querySelector('[data-usar]');
    if (usar) {
      usar.onclick = () => {
        if (!local) return semLocal();
        const ref = `${local.id}:${m.id}`;
        state.model = ref;
        localStorage.setItem('nuvo.model', ref);
        toast(t('{nome} escolhida', { nome }), 'ok');
        switchView('chat');
      };
    }

    const apagar = linha.querySelector('[data-apagar]');
    if (apagar) {
      apagar.onclick = async () => {
        if (!local) return semLocal();
        if (
          !(await confirmar({
            titulo: t('Apagar'),
            texto: t('Apagar {nome} do disco?', { nome }),
            acao: t('Apagar'),
            perigo: true
          }))
        ) {
          return;
        }
        try {
          await api(`/providers/${local.id}/models/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
          toast(t('{nome} apagada', { nome }), 'ok');
          await refreshState();
          switchView('providers');
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    }

    const baixar = linha.querySelector('[data-baixar]');
    if (baixar) {
      baixar.onclick = async () => {
        if (!local) return semLocal();
        const barra = linha.querySelector('.progress');
        const fill = barra.querySelector('span');
        barra.hidden = false;
        baixar.disabled = true;
        try {
          await stream(`/providers/${local.id}/pull`, { model: m.id }, (ev) => {
            if (ev.type === 'progress') fill.style.width = `${ev.percent || 0}%`;
            else if (ev.type === 'error') toast(ev.message, 'err');
          });
          fill.style.width = '100%';
          toast(t('{nome} baixado', { nome }), 'ok');
          await refreshState();
          switchView('providers');
        } catch (err) {
          toast(err.message, 'err');
          baixar.disabled = false;
        }
      };
    }

    const porque = linha.querySelector('[data-porque]');
    if (porque) {
      porque.onclick = () => {
        const aberto = linha.querySelector('.aviso');
        if (aberto) return aberto.remove();
        linha.querySelector('.acoes').insertAdjacentHTML(
          'afterend',
          `<div class="aviso err"><div><b>${t('Não cabe nesta máquina.')}</b> ${escapeHtml(
            m.compara
              ? t(m.compara)
              : t('Ela pede {tam} só pra ela, e sobraria pouco pro resto.', { tam: gbTxt(m.gb) })
          )}</div></div>`
        );
      };
    }
  }
}

views.providers = async function renderProviders(el, { switchView }) {
  const [presets, maquina, requisitos, catalogo] = await Promise.all([
    api('/presets'),
    // GET /machine ainda não existe no servidor: sem ele a tela continua de pé,
    // só sem o cartão da máquina e sem a lista de recomendados.
    api('/machine').catch(() => null),
    lerRequisitos(),
    lerCatalogo()
  ]);

  const inner = panel(
    el,
    t('IAs ligadas'),
    'plug',
    t('Três jeitos de ligar uma IA: a que roda aqui, a que é paga por uso e a que é um programa do terminal.'),
    `${cartaoRequisitos(requisitos)}
     ${cartaoMaquina(maquina)}
     ${
       maquina && maquina.modelos && maquina.modelos.length
         ? `<h3 class="sec">${t('Roda aqui, de graça — recomendados pra esta máquina')}</h3>
            <div id="lista-modelos">${maquina.modelos.map(linhaModelo).join('')}</div>`
         : ''
     }
     ${secaoCatalogo(catalogo)}
     <h3 class="sec">${t('Todas as IAs ligadas')}</h3>
     <div class="row" style="margin-bottom:12px">
       <button id="btn-discover" type="button"><span data-icon="search"></span> ${t('Procurar IA nesta máquina')}</button>
       <button id="btn-health" type="button"><span data-icon="activity"></span> ${t('Testar todas')}</button>
       <span id="health-status" class="meta"></span>
     </div>
     <div id="providers-cards"></div>
     <h3 class="sec">${t('Adicionar uma IA')}</h3>
     <div class="card">
       <label class="field">${t('Começar de um pronto')}
         <select id="new-preset">
           <option value="">${t('— do zero —')}</option>
           ${presets.map((p) => `<option value="${escapeHtml(p.key)}">${escapeHtml(p.name)}</option>`).join('')}
         </select>
       </label>
       <div class="grid">
         <label class="field">${t('Nome')} <input id="new-name" placeholder="${t('Minha IA')}" /></label>
         <label class="field">${t('Como ela é ligada')}
           <select id="new-kind">
             <option value="openai">${t('compatível com a API da OpenAI (paga por uso ou local)')}</option>
             <option value="anthropic">${t('paga por uso')} · Anthropic</option>
             <option value="google">${t('paga por uso')} · Google</option>
             <option value="ollama">${t('roda nesta máquina')} · Ollama</option>
             <option value="cli">${t('programa do terminal')}</option>
           </select>
         </label>
       </div>
       <label class="field">${t('Endereço')} <input id="new-url" placeholder="http://127.0.0.1:1234/v1" /></label>
       <div class="grid">
         <label class="field">${t('Nome da chave')} <input id="new-secret" placeholder="OPENAI_API_KEY" /></label>
         <label class="field">${t('Chave (fica só no servidor)')} <input id="new-value" type="password" /></label>
       </div>
       <label class="field">${t('Ajuste do programa do terminal (JSON)')}
         <textarea id="new-config" rows="2" placeholder='{"command":"claude","args":["-p"],"stdin":true,"models":["default"]}'></textarea>
       </label>
       <div class="row">
         <button id="btn-add-provider" class="primary" type="button"><span data-icon="plus"></span> ${t('Adicionar')}</button>
       </div>
     </div>`
  );

  // Instalar ou ligar o que falta redesenha a tela inteira: o cartão da máquina,
  // a lista de recomendados e os botões de baixar mudam todos de uma vez.
  ligarRequisitos(inner, requisitos, async () => {
    await refreshState();
    switchView('providers');
  });

  ligarRecomendados(inner, maquina, switchView);

  ligarCatalogo(inner, catalogo, () => switchView('providers'));

  const cards = inner.querySelector('#providers-cards');
  for (const p of state.providers) {
    const card = document.createElement('div');
    card.className = 'card prov';
    card.innerHTML = `
      <div class="kind">${t(KIND_ROT[p.kind] || 'paga por uso')}${
        p.auto ? ` · ${t('encontrada sozinha')}` : ''
      }</div>
      <h3>${escapeHtml(p.name)}
        ${
          p.enabled
            ? `<span class="tag on"><span class="pt"></span>${t('ligada')}</span>`
            : `<span class="tag warn"><span class="pt"></span>${t('desligada por você')}</span>`
        }
        ${
          p.secret_name
            ? `<span class="tag ${p.has_secret ? 'on' : 'off'}"><span class="pt"></span>${
                p.has_secret ? t('com chave') : t('sem chave')
              }</span>`
            : ''
        }
      </h3>
      <div class="meta">${escapeHtml(p.base_url || p.config.command || '')}${
        p.gasto_mes != null
          ? ` · <span class="custo">${t('US$ {valor} este mês', {
              valor: formatarNumero(p.gasto_mes, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })
            })}</span>`
          : ''
      }</div>
      <div class="health" id="health-${p.id}"></div>
      ${p.manageable ? '<div id="ollama-' + p.id + '"></div>' : ''}
      <div class="models">${
        p.models.length
          ? p.models.map((m) => `<span class="model-pill">${escapeHtml(m.label)}</span>`).join('')
          : `<span class="model-pill">${t('nenhum modelo ainda')}</span>`
      }</div>
      <div class="row">
        <button data-act="refresh" type="button"><span data-icon="refresh"></span> ${t('Atualizar modelos')}</button>
        ${
          // IA de terminal entra pelo login do próprio programa: não há chave
          // guardada aqui pra trocar. O botão abria dois pedidos de nome e valor
          // de uma variável que nunca seria lida.
          p.kind === 'cli'
            ? ''
            : `<button data-act="key" type="button"><span data-icon="key"></span> ${t('Trocar chave')}</button>`
        }
        <button data-act="toggle" type="button">${p.enabled ? t('Desligar') : t('Ligar')}</button>
        ${p.manageable ? `<button data-act="manage" type="button"><span data-icon="download"></span> ${t('Modelos')}</button>` : ''}
        <button data-act="del" class="danger" type="button"><span data-icon="trash"></span> ${t('Remover')}</button>
      </div>`;

    const reload = async () => {
      await refreshState();
      switchView('providers');
    };

    card.querySelector('[data-act=refresh]').onclick = async () => {
      try {
        await api(`/providers/${p.id}/refresh`, { method: 'POST' });
        toast(t('{nome}: lista de modelos atualizada', { nome: p.name }), 'ok');
        await reload();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    const botaoChave = card.querySelector('[data-act=key]');
    if (botaoChave) botaoChave.onclick = async () => {
      const name =
        p.secret_name ||
        (await perguntar({
          titulo: t('Trocar chave'),
          rotulo: t('Nome da variável da chave:'),
          valor: 'API_KEY'
        }));
      if (!name) return;
      const value = await perguntar({
        titulo: t('Trocar chave'),
        rotulo: t('Valor de {nome}:', { nome: name })
      });
      if (value === null) return;
      await api(`/providers/${p.id}`, {
        method: 'PATCH',
        body: { secretName: name, secretValue: value }
      });
      toast(t('chave guardada no servidor'), 'ok');
      await reload();
    };
    card.querySelector('[data-act=toggle]').onclick = async () => {
      await api(`/providers/${p.id}`, { method: 'PATCH', body: { enabled: !p.enabled } });
      await reload();
    };
    card.querySelector('[data-act=del]').onclick = async () => {
      if (
        !(await confirmar({
          titulo: t('Remover'),
          texto: t('Remover {nome}?', { nome: p.name }),
          acao: t('Remover'),
          perigo: true
        }))
      ) {
        return;
      }
      await api(`/providers/${p.id}`, { method: 'DELETE' });
      await reload();
    };
    if (p.manageable) {
      card.querySelector('[data-act=manage]').onclick = () =>
        renderOllamaManager(card.querySelector(`#ollama-${p.id}`), p, reload);
    }

    cards.appendChild(card);
  }

  inner.querySelector('#btn-discover').onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = t('procurando…');
    try {
      const { found } = await api('/discover', { method: 'POST' });
      toast(
        found.length
          ? t('encontrado: {lista}', { lista: found.map((f) => f.name).join(', ') })
          : t('nada novo encontrado')
      );
      await refreshState();
      switchView('providers');
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  };

  // Saúde: fala com cada IA de verdade e escreve o resultado no cartão dela.
  // É a resposta pra "por que não vem resposta?" sem ter que adivinhar.
  inner.querySelector('#btn-health').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const status = inner.querySelector('#health-status');
    btn.disabled = true;
    status.textContent = t('testando…');
    try {
      const results = await api('/health');
      for (const r of results) {
        const alvo = inner.querySelector(`#health-${r.id}`);
        if (!alvo) continue;
        if (r.status === 'erro') {
          // explainProviderError já devolve "causa + o que fazer (mensagem crua)".
          const corte = r.message.indexOf('. ');
          const causa = corte > 0 ? r.message.slice(0, corte + 1) : r.message;
          const resto = corte > 0 ? r.message.slice(corte + 2) : '';
          alvo.className = 'aviso err';
          alvo.innerHTML = `<div><b>${escapeHtml(causa)}</b> ${escapeHtml(resto)}</div>
            <button class="primary" type="button" data-act="key"><span data-icon="key"></span> ${t('Trocar chave')}</button>`;
          paintIcons(alvo);
          alvo.querySelector('[data-act=key]').onclick = () =>
            alvo.closest('.prov').querySelector('.row [data-act=key]').click();
          continue;
        }
        const rotulo =
          r.status === 'ok'
            ? plural(r.models, 'respondeu em {ms} ms · 1 modelo', 'respondeu em {ms} ms · {n} modelos', {
                ms: r.ms
              })
            : r.message;
        alvo.className = `health ${r.status}`;
        alvo.innerHTML = `${icon('check', 14)} ${escapeHtml(rotulo)}`;
      }
      const ruins = results.filter((r) => r.status === 'erro').length;
      status.textContent = ruins ? t('{n} com problema', { n: ruins }) : t('todas responderam');
    } catch (err) {
      status.textContent = '';
      toast(err.message, 'err');
    }
    btn.disabled = false;
  };

  inner.querySelector('#new-preset').onchange = (ev) => {
    const preset = presets.find((p) => p.key === ev.target.value);
    if (!preset) return;
    inner.querySelector('#new-name').value = preset.name;
    inner.querySelector('#new-kind').value = preset.kind;
    inner.querySelector('#new-url').value = preset.baseUrl || '';
    inner.querySelector('#new-secret').value = preset.secretName || '';
    inner.querySelector('#new-config').value = preset.config ? JSON.stringify(preset.config) : '';
  };

  inner.querySelector('#btn-add-provider').onclick = async () => {
    const configText = inner.querySelector('#new-config').value.trim();
    let config = {};
    if (configText) {
      try {
        config = JSON.parse(configText);
      } catch {
        return toast(t('o ajuste do programa do terminal não é JSON válido'), 'err');
      }
    }
    try {
      const out = await api('/providers', {
        method: 'POST',
        body: {
          name: inner.querySelector('#new-name').value || t('Nova IA'),
          kind: inner.querySelector('#new-kind').value,
          baseUrl: inner.querySelector('#new-url').value || null,
          secretName: inner.querySelector('#new-secret').value || null,
          secretValue: inner.querySelector('#new-value').value || null,
          config
        }
      });
      await refreshState();
      switchView('providers');
      if (out.error) toast(t('IA adicionada, mas não listou modelos: {erro}', { erro: out.error }), 'err');
      else toast(t('IA adicionada'), 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  paintIcons(el);
};

/** Baixar e apagar modelo sem sair do app — o que o LM Studio faz na aba de modelos. */
function renderOllamaManager(host, provider, reload) {
  if (host.dataset.open === '1') {
    host.innerHTML = '';
    host.dataset.open = '0';
    return;
  }
  host.dataset.open = '1';
  host.innerHTML = `
    <div class="grupo-rot">${t('Modelos que rodam aqui')}</div>
    <div class="grupo" style="padding:14px 18px">
      <div class="row" style="margin:0">
        <input id="pull-name" placeholder="${t('ex.: llama3.2, qwen2.5:7b, nomic-embed-text')}" style="flex:1;min-width:200px" />
        <button id="pull-go" class="primary" type="button">${t('Baixar')}</button>
      </div>
      <div id="pull-status" class="meta" style="margin-top:8px"></div>
      <div class="progress" hidden><span style="width:0"></span></div>
      <div id="installed" style="margin-top:12px"></div>
    </div>`;

  const installed = host.querySelector('#installed');
  installed.innerHTML = provider.models.length
    ? provider.models
        .map(
          (m) =>
            `<div class="mem-item"><div class="txt">${escapeHtml(m.label)}<div class="src">${escapeHtml(
              m.kind
            )}</div></div>
             <button class="icon danger" type="button" data-del="${escapeHtml(m.model_id)}" title="${t('apagar')}"
               aria-label="${t('apagar {nome}', { nome: escapeHtml(m.label) })}">${icon('trash', 16)}</button></div>`
        )
        .join('')
    : `<div class="meta">${t('nenhum modelo baixado ainda')}</div>`;

  for (const btn of installed.querySelectorAll('[data-del]')) {
    btn.onclick = async () => {
      const model = btn.dataset.del;
      if (
        !(await confirmar({
          titulo: t('Apagar'),
          texto: t('Apagar {nome} do disco?', { nome: model }),
          acao: t('Apagar'),
          perigo: true
        }))
      ) {
        return;
      }
      try {
        await api(`/providers/${provider.id}/models/${encodeURIComponent(model)}`, { method: 'DELETE' });
        toast(t('{nome} apagado', { nome: model }), 'ok');
        await reload();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }

  const status = host.querySelector('#pull-status');
  const bar = host.querySelector('.progress');
  const fill = bar.querySelector('span');

  host.querySelector('#pull-go').onclick = async () => {
    const model = host.querySelector('#pull-name').value.trim();
    if (!model) return;
    bar.hidden = false;
    status.textContent = t('começando…');
    try {
      await stream(`/providers/${provider.id}/pull`, { model }, (ev) => {
        if (ev.type === 'progress') {
          status.textContent = ev.percent != null ? `${ev.status} — ${ev.percent}%` : ev.status;
          fill.style.width = `${ev.percent || 0}%`;
          // A pastilha apagada mostra, de fora da gaveta, que este cartão está baixando.
          const pills = host.closest('.prov') && host.closest('.prov').querySelector('.models');
          if (pills) {
            let pill = pills.querySelector('.model-pill.baixando');
            if (!pill) {
              pill = document.createElement('span');
              pill.className = 'model-pill baixando';
              pills.appendChild(pill);
            }
            pill.textContent =
              ev.percent != null
                ? t('{nome} · baixando {pct}%', { nome: model, pct: ev.percent })
                : `${model} · ${ev.status}`;
          }
        } else if (ev.type === 'error') {
          status.textContent = t('falhou: {erro}', { erro: ev.message });
        } else if (ev.type === 'done') {
          status.textContent = t('pronto');
          fill.style.width = '100%';
          const pill = host.closest('.prov') && host.closest('.prov').querySelector('.model-pill.baixando');
          if (pill) pill.remove();
        }
      });
      toast(t('{nome} baixado', { nome: model }), 'ok');
      await reload();
    } catch (err) {
      status.textContent = t('falhou: {erro}', { erro: err.message });
    }
  };
}

// ------------------------------------------------------------------ perfis

views.gems = function renderGems(el, { switchView, startChatWithGem }) {
  const inner = panel(
    el,
    t('Perfis'),
    'sparkle',
    t('Um jeito salvo de responder: a instrução, qual IA responde e o quanto ela pode inventar. Todos leem a mesma memória. "Sem filtro" vale de verdade em IA que roda aqui; em IA paga por uso quem manda é a política de quem hospeda.'),
    `<div id="gems-cards"></div>
     <div class="card">
       <h3>${t('Novo perfil')}</h3>
       <label class="field">${t('Nome')} <input id="g-name" placeholder="${t('Revisor de contrato')}" /></label>
       <label class="field">${t('Ícone e cor')}<div id="g-picker"></div></label>
       <label class="field">${t('Como essa IA deve se comportar')}
         <textarea id="g-prompt" rows="4" placeholder="${t('Leia como advogado do inquilino. Aponte cláusula por cláusula o que é abusivo.')}"></textarea>
       </label>
       <div class="grid">
         <label class="field">${t('Pra que serve')}
           <select id="g-mode"><option value="chat">${t('conversa')}</option><option value="coding">${t('programar')}</option></select>
         </label>
         <label class="field">${t('Qual IA responde')}
           <select id="g-model"><option value="">${t('— a que estiver escolhida na conversa —')}</option>${modelOptions()}</select>
         </label>
         <label class="field">${t('Quão criativa (0 é nada, 2 é muito)')}
           <input id="g-temp" type="number" step="0.1" min="0" max="2" placeholder="${formatarNumero(0.7, { minimumFractionDigits: 1 })}" />
         </label>
       </div>
       <label class="check"><input type="checkbox" id="g-unfiltered" /> ${t('sem filtro')}</label>
       <div class="row"><button id="btn-add-gem" class="primary" type="button"><span data-icon="plus"></span> ${t('Criar perfil')}</button></div>
     </div>`
  );

  const cards = inner.querySelector('#gems-cards');
  for (const g of state.gems) {
    const criativa = t(
      g.temperature == null
        ? 'como estiver na conversa'
        : g.temperature <= 0.3
          ? 'nada criativa'
          : g.temperature <= 0.8
            ? 'pouco criativa'
            : 'bem criativa'
    );

    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--tint', `var(--${g.color || 'indigo'})`);
    card.innerHTML = `
      <h3>${badge(g.icon, g.color, 17)} ${escapeHtml(g.name)}
        <span class="tag"><span class="pt" style="background: var(--tint)"></span>${
          g.mode === 'coding' ? t('programar') : t('conversa')
        }</span>
        ${g.unfiltered ? `<span class="tag off"><span class="pt"></span>${t('sem filtro')}</span>` : ''}
        <span class="tag ${g.memory_read ? 'on' : 'off'}"><span class="pt"></span>${
          g.memory_read ? t('lê a memória') : t('não lê a memória')
        }</span>
        <span class="tag ${g.memory_write ? 'on' : 'off'}"><span class="pt"></span>${
          g.memory_write ? t('guarda o que aprende') : t('não guarda nada')
        }</span>
      </h3>
      <div class="meta">${escapeHtml((g.system_prompt || '').slice(0, 240))}</div>
      <div class="models row">
        <span class="model-pill">${escapeHtml(g.model ? modelLabel(g.model) : t('qualquer IA'))}</span>
        <span class="model-pill">${criativa}</span>
      </div>
      <div class="row">
        <button data-act="use" class="primary" type="button"><span data-icon="play"></span> ${t('Usar')}</button>
        <button data-act="edit" class="ghost" type="button"><span data-icon="edit"></span> ${t('Mudar')}</button>
        <button data-act="mem" class="ghost" type="button"><span data-icon="brain"></span> ${
          g.memory_read ? t('Parar de usar a memória') : t('Usar a memória')
        }</button>
        <button data-act="del" class="icon danger" type="button" title="${t('apagar')}"
          aria-label="${t('apagar o perfil {nome}', { nome: escapeHtml(g.name) })}"><span data-icon="trash"></span></button>
      </div>`;

    card.querySelector('[data-act=use]').onclick = () => startChatWithGem(g);
    card.querySelector('[data-act=edit]').onclick = () => editGem(card, g, switchView);
    card.querySelector('[data-act=mem]').onclick = async () => {
      await api(`/gems/${g.id}`, {
        method: 'PATCH',
        body: { memory_read: !g.memory_read, memory_write: !g.memory_write }
      });
      await refreshState();
      switchView('gems');
    };
    card.querySelector('[data-act=del]').onclick = async () => {
      if (
        !(await confirmar({
          titulo: t('Apagar'),
          texto: t('Apagar o perfil {nome}?', { nome: g.name }),
          acao: t('Apagar'),
          perigo: true
        }))
      ) {
        return;
      }
      await api(`/gems/${g.id}`, { method: 'DELETE' });
      await refreshState();
      switchView('gems');
    };
    cards.appendChild(card);
  }

  const picker = iconPicker(inner.querySelector('#g-picker'));

  inner.querySelector('#btn-add-gem').onclick = async () => {
    await api('/gems', {
      method: 'POST',
      body: {
        name: inner.querySelector('#g-name').value || t('Novo perfil'),
        icon: picker.icon,
        color: picker.color,
        system_prompt: inner.querySelector('#g-prompt').value,
        mode: inner.querySelector('#g-mode').value,
        model: inner.querySelector('#g-model').value || null,
        temperature: inner.querySelector('#g-temp').value
          ? Number(inner.querySelector('#g-temp').value)
          : null,
        unfiltered: inner.querySelector('#g-unfiltered').checked
      }
    });
    await refreshState();
    switchView('gems');
    toast(t('perfil criado'), 'ok');
  };

  paintIcons(el);
};

function editGem(card, gem, switchView) {
  const form = document.createElement('div');
  form.style.marginTop = '10px';
  form.innerHTML = `
    <label class="field">${t('Nome')} <input class="e-name" value="${escapeHtml(gem.name)}" /></label>
    <label class="field">${t('Ícone e cor')}<div class="e-picker"></div></label>
    <label class="field">${t('Como essa IA deve se comportar')}
      <textarea class="e-prompt" rows="5">${escapeHtml(gem.system_prompt || '')}</textarea>
    </label>
    <div class="grid">
      <label class="field">${t('Pra que serve')}
        <select class="e-mode">
          <option value="chat"${gem.mode === 'chat' ? ' selected' : ''}>${t('conversa')}</option>
          <option value="coding"${gem.mode === 'coding' ? ' selected' : ''}>${t('programar')}</option>
        </select>
      </label>
      <label class="field">${t('Qual IA responde')}
        <select class="e-model"><option value="">${t('— a que estiver escolhida na conversa —')}</option>${modelOptions(gem.model)}</select>
      </label>
      <label class="field">${t('Quão criativa (0 é nada, 2 é muito)')}
        <input class="e-temp" type="number" step="0.1" min="0" max="2" value="${gem.temperature ?? ''}" />
      </label>
    </div>
    <label class="check"><input type="checkbox" class="e-unf" ${gem.unfiltered ? 'checked' : ''} /> ${t('sem filtro')}</label>
    <div class="row">
      <button type="button" class="primary e-save">${t('Salvar mudanças')}</button>
      <button type="button" class="e-cancel ghost">${t('Cancelar')}</button>
    </div>`;
  card.appendChild(form);
  const picker = iconPicker(form.querySelector('.e-picker'), gem);

  form.querySelector('.e-cancel').onclick = () => form.remove();
  form.querySelector('.e-save').onclick = async () => {
    await api(`/gems/${gem.id}`, {
      method: 'PATCH',
      body: {
        name: form.querySelector('.e-name').value,
        icon: picker.icon,
        color: picker.color,
        system_prompt: form.querySelector('.e-prompt').value,
        mode: form.querySelector('.e-mode').value,
        model: form.querySelector('.e-model').value || null,
        temperature: form.querySelector('.e-temp').value
          ? Number(form.querySelector('.e-temp').value)
          : null,
        unfiltered: form.querySelector('.e-unf').checked
      }
    });
    await refreshState();
    switchView('gems');
    toast(t('perfil salvo'), 'ok');
  };
}

// ---------------------------------------------------------------- projetos

views.projects = function renderProjects(el, { switchView, startChatInProject }) {
  const inner = panel(
    el,
    t('Projetos'),
    'folder',
    t('Pasta de trabalho com arquivos, instrução e memória próprios. O que é aprendido dentro fica dentro.'),
    `<div id="proj-cards"></div>
     <div class="card">
       <h3>${t('Novo projeto')}</h3>
       <label class="field">${t('Nome')} <input id="p-name" placeholder="${t('Casa')}" /></label>
       <label class="field">${t('Ícone e cor')}<div id="p-picker"></div></label>
       <label class="field">${t('Instrução que vale em toda conversa daqui')}
         <textarea id="p-inst" rows="3" placeholder="${t('Português claro, sem jargão. Quando citar norma, cite o artigo.')}"></textarea>
       </label>
       <label class="field">${t('Pasta de trabalho')}
         <input id="p-dir" placeholder="${t('/Users/você/Projetos/algo')}" />
       </label>
       <div class="row"><button id="btn-add-proj" class="primary" type="button"><span data-icon="plus"></span> ${t('Criar projeto')}</button></div>
     </div>`
  );

  const cards = inner.querySelector('#proj-cards');
  for (const p of state.projects) {
    const chats = state.chats.filter((c) => c.project_id === p.id).length;
    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--tint', `var(--${p.color || 'slate'})`);
    card.innerHTML = `
      <h3>${badge(p.icon, p.color, 17)} ${escapeHtml(p.name)}
        <span class="tag"><span class="pt" style="background: var(--tint)"></span>${plural(
          chats,
          '1 conversa',
          '{n} conversas'
        )}</span>
      </h3>
      <div class="meta">${escapeHtml(p.workdir || t('sem pasta de trabalho'))}</div>
      <div class="meta">${escapeHtml((p.instructions || '').slice(0, 220))}</div>
      <div id="files-${p.id}"></div>
      <div class="row">
        <button data-act="use" class="primary" type="button"><span data-icon="chat"></span> ${t('Conversar aqui')}</button>
        <button data-act="files" class="ghost" type="button"><span data-icon="file"></span> ${t('Arquivos')}</button>
        <button data-act="del" class="icon danger" type="button" title="${t('apagar')}"
          aria-label="${t('apagar o projeto {nome}', { nome: escapeHtml(p.name) })}"><span data-icon="trash"></span></button>
      </div>`;

    card.querySelector('[data-act=use]').onclick = () => startChatInProject(p);
    card.querySelector('[data-act=files]').onclick = () =>
      renderProjectFiles(card.querySelector(`#files-${p.id}`), p);
    card.querySelector('[data-act=del]').onclick = async () => {
      if (
        !(await confirmar({
          titulo: t('Apagar'),
          texto: t('Apagar o projeto {nome}?', { nome: p.name }),
          acao: t('Apagar'),
          perigo: true
        }))
      ) {
        return;
      }
      await api(`/projects/${p.id}`, { method: 'DELETE' });
      await refreshState();
      switchView('projects');
    };
    cards.appendChild(card);
  }

  const picker = iconPicker(inner.querySelector('#p-picker'), { icon: 'folder', color: 'slate' });

  inner.querySelector('#btn-add-proj').onclick = async () => {
    await api('/projects', {
      method: 'POST',
      body: {
        name: inner.querySelector('#p-name').value || t('Novo projeto'),
        icon: picker.icon,
        color: picker.color,
        instructions: inner.querySelector('#p-inst').value,
        workdir: inner.querySelector('#p-dir').value || null
      }
    });
    await refreshState();
    switchView('projects');
    toast(t('projeto criado'), 'ok');
  };

  paintIcons(el);
};

async function renderProjectFiles(host, project) {
  if (host.dataset.open === '1') {
    host.innerHTML = '';
    host.dataset.open = '0';
    return;
  }
  host.dataset.open = '1';
  const files = await api(`/attachments?project=${project.id}`);
  host.innerHTML = `
    <div class="grupo-rot">${t('Arquivos do projeto')}</div>
    <div class="grupo p-list"></div>
    <div class="row">
      <button type="button" class="ghost p-add"><span data-icon="plus"></span> ${t('Adicionar arquivo')}</button>
      <span class="meta">${t('Arquivo daqui entra em toda conversa do projeto.')}</span>
    </div>
    <input type="file" class="p-file" multiple hidden />`;

  const list = host.querySelector('.p-list');
  const draw = (rows) => {
    list.innerHTML = rows.length
      ? rows
          .map(
            (f) => `<div class="linha">
                <span class="ico">${icon('file', 18)}</span>
                <span class="rot">${escapeHtml(f.name)}
                  <small>${plural(f.chunks, '1 trecho', '{n} trechos')} · ${Math.round(f.bytes / 1000)} kB${
                    f.note ? ` · ${escapeHtml(f.note)}` : ''
                  }</small>
                </span>
                <button type="button" class="icon danger" data-del="${f.id}" title="${t('tirar do projeto')}"
                  aria-label="${t('tirar {nome} do projeto', { nome: escapeHtml(f.name) })}">${icon('trash', 16)}</button>
              </div>`
          )
          .join('')
      : `<div class="linha"><span class="rot">${t('Nenhum arquivo ainda.')}
           <small>${t('O que você puser aqui vale em toda conversa do projeto.')}</small></span></div>`;
    for (const btn of list.querySelectorAll('[data-del]')) {
      btn.onclick = async () => {
        await api(`/attachments/${btn.dataset.del}`, { method: 'DELETE' });
        draw(await api(`/attachments?project=${project.id}`));
      };
    }
  };
  draw(files);

  const escolher = host.querySelector('.p-file');
  host.querySelector('.p-add').onclick = () => escolher.click();
  escolher.onchange = async (ev) => {
    for (const file of ev.target.files) {
      try {
        await api(`/attachments?project=${project.id}&name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: await file.arrayBuffer(),
          raw: true
        });
        toast(t('{nome} indexado', { nome: file.name }), 'ok');
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'err');
      }
    }
    escolher.value = '';
    draw(await api(`/attachments?project=${project.id}`));
  };
  paintIcons(host);
}

// ---------------------------------------------------------------- memória

views.memory = async function renderMemory(el, { switchView }) {
  // `maxInjected` é o número que a tela chama de "usadas por resposta".
  const [memories, settings] = await Promise.all([api('/memories'), api('/settings')]);
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);
  const hoje = memories.filter((m) => new Date(m.created_at) >= inicioDoDia).length;

  const inner = panel(
    el,
    t('Memória'),
    'brain',
    t('Uma memória só, lida por todas as IAs. O que você contou pra uma, as outras sabem.'),
    `<div class="reg-topo">
       <div><span class="num">${memories.length}</span><span class="rot">${t('coisas guardadas')}</span></div>
       <div><span class="num">${settings.memory.maxInjected}</span><span class="rot">${t('no máximo por resposta')}</span></div>
       <div><span class="num">${hoje}</span><span class="rot">${t('aprendidas hoje')}</span></div>
     </div>
     <div class="card">
       <h3>${t('Contar uma coisa nova')}</h3>
       <label class="field">${t('O que você quer que todas as IAs saibam')}
         <input id="m-text" placeholder="${t('Ex.: prefiro resposta curta, sem introdução')}" />
       </label>
       <label class="check"><input type="checkbox" id="m-pin" /> ${t('entra em toda resposta')}</label>
       <div class="row">
         <button id="btn-add-mem" class="primary" type="button"><span data-icon="plus"></span> ${t('Guardar')}</button>
         <button id="btn-import" class="ghost" type="button"><span data-icon="upload"></span> ${t('Importar conversas')}</button>
       </div>
       <div class="meta">${t('Traz conversas do ChatGPT, do Claude ou do Gemini (conversations.json), ou texto solto.')}</div>
       <div id="import-status" class="meta"></div>
       <input type="file" id="m-file" accept=".json,.md,.txt" hidden />
     </div>
     <h3 class="sec">${t('O que está guardado')}</h3>
     <div id="mem-list"></div>`
  );

  inner.querySelector('#btn-import').onclick = () => inner.querySelector('#m-file').click();

  const list = inner.querySelector('#mem-list');
  const MOSTRA = 12;

  const linhaDoFato = (m) => {
    const item = document.createElement('div');
    item.className = 'mem-item';
    item.innerHTML = `
      <div class="txt">${escapeHtml(m.text)}
        <div class="src">
          ${escopoDoFato(m)}
          <span>${origemDoFato(m)}</span>
          <span>·</span>
          <span>${plural(m.use_count, 'usada 1 vez', 'usada {n} vezes')}</span>
        </div>
      </div>`;

    const fixar = document.createElement('button');
    fixar.type = 'button';
    fixar.className = `icon${m.pinned ? ' toggle on' : ''}`;
    fixar.innerHTML = icon('pin', 16);
    fixar.title = m.pinned ? t('não entrar em toda resposta') : t('entrar em toda resposta');
    fixar.setAttribute('aria-label', fixar.title);
    fixar.onclick = async () => {
      await api(`/memories/${m.id}`, { method: 'PATCH', body: { pinned: !m.pinned } });
      switchView('memory');
    };

    const mudar = document.createElement('button');
    mudar.type = 'button';
    mudar.className = 'icon';
    mudar.innerHTML = icon('edit', 16);
    mudar.title = t('mudar');
    mudar.setAttribute('aria-label', t('mudar o que está guardado'));
    mudar.onclick = async () => {
      const novo = await perguntar({
        titulo: t('Mudar'),
        rotulo: t('Mudar o que está guardado:'),
        valor: m.text,
        multilinha: true
      });
      if (novo == null || !novo.trim() || novo.trim() === m.text) return;
      await api(`/memories/${m.id}`, { method: 'PATCH', body: { text: novo.trim() } });
      switchView('memory');
    };

    const esquecer = document.createElement('button');
    esquecer.type = 'button';
    esquecer.className = 'icon danger';
    esquecer.innerHTML = icon('trash', 16);
    esquecer.title = t('esquecer');
    esquecer.setAttribute('aria-label', t('esquecer este fato'));
    esquecer.onclick = async () => {
      if (
        !(await confirmar({
          titulo: t('Apagar'),
          texto: t('Esquecer isto?\n\n"{texto}"', { texto: m.text }),
          acao: t('Apagar'),
          perigo: true
        }))
      ) {
        return;
      }
      await api(`/memories/${m.id}`, { method: 'DELETE' });
      switchView('memory');
    };

    item.append(fixar, mudar, esquecer);
    return item;
  };

  for (const m of memories.slice(0, MOSTRA)) list.appendChild(linhaDoFato(m));

  if (memories.length > MOSTRA) {
    const mais = document.createElement('button');
    mais.type = 'button';
    mais.className = 'link-btn';
    mais.innerHTML = `${icon('chevron', 16)} ${t('ver as outras {n}', { n: memories.length - MOSTRA })}`;
    mais.onclick = () => {
      for (const m of memories.slice(MOSTRA)) list.insertBefore(linhaDoFato(m), mais);
      mais.remove();
    };
    list.appendChild(mais);
  }

  inner.querySelector('#btn-add-mem').onclick = async () => {
    const text = inner.querySelector('#m-text').value.trim();
    if (!text) return;
    await api('/memories', {
      method: 'POST',
      body: { text, pinned: inner.querySelector('#m-pin').checked }
    });
    switchView('memory');
  };

  inner.querySelector('#m-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const status = inner.querySelector('#import-status');
    status.textContent = t('lendo e separando o que vale guardar… arquivo grande demora.');
    try {
      const text = await file.text();
      const out = await api(`/memories/import?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: text,
        raw: true
      });
      // O corte tem que aparecer: "200 conversas lidas" num export de mil
      // parece o arquivo inteiro.
      const corte = out.skipped
        ? plural(
            out.skipped,
            ' — 1 conversa além do limite ficou de fora',
            ' — {n} conversas além do limite ficaram de fora'
          )
        : '';
      toast(
        t('{fatos} de {conversas}{corte}', {
          fatos: plural(out.facts.length, '1 coisa nova', '{n} coisas novas'),
          conversas: plural(out.conversations, '1 conversa', '{n} conversas'),
          corte
        }),
        'ok'
      );
      switchView('memory');
    } catch (err) {
      status.textContent = t('falhou: {erro}', { erro: err.message });
    }
  };

  paintIcons(el);
};

// ----------------------------------------------------------------- ajustes

// No celular a lista agrupada; no computador a janela de duas colunas. Os dois
// saem do mesmo #view-settings e é o CSS que decide qual aparece. Só o lado do
// computador (.cfg-corpo) carrega ids — o do celular usa data-* e chama a API
// direto, senão os mesmos ids existiriam duas vezes no DOM.
let cfgSecao = 'geral';

// Cada rótulo é uma função com o `t()` dentro, e não um texto solto na tabela.
// A varredura do test/idiomas-cobertura.test.mjs só enxerga a frase escrita
// dentro do t() no código: com o texto cru aqui e um t(rot) na hora de desenhar,
// "Personalizar" ficou fora dos dois dicionários e aparecia em português no
// meio da tela em inglês, sem nenhum teste reclamar.
const CFG_TRILHA = [
  [() => t('Ajustes'), [
    ['geral', 'settings', () => t('Geral')],
    ['memoria', 'brain', () => t('Memória')],
    ['ias', 'plug', () => t('IAs ligadas')],
    ['acesso', 'key', () => t('Acesso')],
    ['dados', 'folder', () => t('Seus dados')]
  ]],
  [() => t('Personalizar'), [
    ['perfis', 'sparkle', () => t('Perfis')],
    ['menu', 'layers', () => t('Botões do menu')],
    ['terminal', 'code', () => t('Programas do terminal')],
    ['agente', 'globe', () => t('Modo agente')],
    ['atalhos', 'command', () => t('Atalhos de teclado')]
  ]]
];

const cfgLin = (rot, sub, ctl, larga) => `<div class="cfg-lin${larga ? ' larga' : ''}">
    <div class="rot">${rot}${sub ? `<small>${sub}</small>` : ''}</div>
    <div class="ctl">${ctl}</div>
  </div>`;

/** Interruptor do desenho novo. O <input> some da tela mas continua no DOM com
 *  o mesmo id de sempre — é dele que os handlers de hoje leem `.checked`. */
const cfgChave = (id, on) =>
  `<input type="checkbox" id="${id}"${on ? ' checked' : ''} hidden />
   <span class="chave${on ? ' on' : ''}" data-chave="${id}" role="switch" aria-checked="${!!on}" tabindex="0"></span>`;

/** As telas da gaveta, com o nome e o ícone que aparecem no menu. */
const TELAS_DA_GAVETA = [
  ['chat', 'chat', () => t('Conversas')],
  ['council', 'users', () => t('Perguntar pra várias')],
  ['research', 'globe', () => t('Pesquisar na web')],
  ['code', 'code', () => t('Programar')],
  ['estudos', 'book', () => t('Estudos')],
  ['memory', 'brain', () => t('Memória')],
  ['projects', 'folder', () => t('Projetos')],
  ['gems', 'sparkle', () => t('Perfis')],
  ['providers', 'plug', () => t('IAs ligadas')],
  ['loja', 'layers', () => t('Loja')]
];

const MENU_PADRAO_DA_TELA = {
  ordem: TELAS_DA_GAVETA.map(([id]) => id),
  escondidos: [],
  noMais: ['memory', 'projects', 'gems', 'providers', 'loja']
};

const CFG_SECOES = {
  menu: (settings) => {
    const cfg = settings.menu || MENU_PADRAO_DA_TELA;
    const nomes = new Map(TELAS_DA_GAVETA.map(([id, ico, rot]) => [id, { ico, rot }]));
    return `<h3>${t('Botões do menu')}</h3>
      <p class="hint">${t(
        'Escolha o que aparece na gaveta, em que ordem, e o que fica guardado dentro do "Mais".'
      )}</p>
      <div id="menu-lista" class="grupo">${cfg.ordem
        .filter((id) => nomes.has(id))
        .map((id, i) => {
          const { ico, rot } = nomes.get(id);
          const escondido = cfg.escondidos.includes(id);
          const noMais = cfg.noMais.includes(id);
          // Conversas não some: esconder tudo deixaria a gaveta vazia e sem
          // caminho de volta pra cá.
          const fixo = id === 'chat';
          return `<div class="linha menu-linha" data-id="${id}">
            <span class="ico">${icon(ico, 18)}</span>
            <span class="grow">${escapeHtml(rot())}</span>
            <label class="check" title="${t('aparece na gaveta')}">
              <input type="checkbox" data-campo="ver" ${escondido ? '' : 'checked'}
                ${fixo ? 'disabled' : ''} aria-label="${t('mostrar {nome}', { nome: rot() })}" />
              <span>${t('aparece')}</span>
            </label>
            <label class="check" title="${t('fica dentro do Mais')}">
              <input type="checkbox" data-campo="mais" ${noMais ? 'checked' : ''}
                aria-label="${t('guardar {nome} dentro do Mais', { nome: rot() })}" />
              <span>${t('no Mais')}</span>
            </label>
            <button type="button" class="icon" data-mover="-1" ${i === 0 ? 'disabled' : ''}
              title="${t('subir')}" aria-label="${t('subir {nome}', { nome: rot() })}">${icon('chevron', 16)}</button>
            <button type="button" class="icon vira" data-mover="1"
              ${i === cfg.ordem.length - 1 ? 'disabled' : ''}
              title="${t('descer')}" aria-label="${t('descer {nome}', { nome: rot() })}">${icon('chevron', 16)}</button>
          </div>`;
        })
        .join('')}</div>
      <div class="row">
        <button id="menu-padrao" class="ghost" type="button">${t('Voltar ao padrão')}</button>
      </div>`;
  },

  geral: () => `<h3>${t('Geral')}</h3>
    ${cfgLin(t('Idioma'), t('Vale pra tela e pras mensagens do servidor. Sem escolher, ele segue o lugar onde você está.'),
      `<select id="s-idioma">${Object.entries(IDIOMAS)
        .map(([codigo, nome]) => `<option value="${escapeHtml(codigo)}"${codigo === idioma() ? ' selected' : ''}>${escapeHtml(nome)}</option>`)
        .join('')}</select>`)}
    ${cfgLin(t('Qual IA responde por padrão'), t('Vale pra conversa nova; dá pra trocar dentro de cada uma.'),
      `<select id="s-modelo-padrao">${modelOptions(state.model)}</select>`)}
    ${cfgLin(t('Perfil que abre junto'), t('O jeito salvo de responder que já vem escolhido.'),
      `<select id="s-perfil-padrao"><option value="">${t('— nenhum —')}</option>${state.gems
        .map((g) => `<option value="${escapeHtml(g.id)}"${g.id === state.gemId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`)
        .join('')}</select>`)}`,

  memoria: (s, pendente) => `<h3>${t('Memória')}</h3>
    ${cfgLin(t('Lembrar do que eu conto'), t('Uma memória só, lida por todas as IAs.'), cfgChave('s-enabled', s.memory.enabled))}
    ${cfgLin(t('Aprender sozinho depois de cada resposta'), t('Sem isso, só guarda o que você mandar guardar.'), cfgChave('s-auto', s.memory.autoExtract))}
    ${cfgLin(t('Quantas coisas entram por resposta'), t('Mais que 20 costuma atrapalhar em vez de ajudar.'),
      `<input id="s-max" type="number" min="1" max="50" value="${s.memory.maxInjected}" style="max-width:120px;text-align:center" />`)}
    ${cfgLin(t('Nota mínima pra entrar'), t('Abaixo disso a lembrança é fraca demais e fica de fora.'),
      `<input id="s-min" type="number" step="0.01" min="0" max="1" value="${s.memory.minScore}" style="max-width:120px;text-align:center" />`)}
    ${cfgLin(t('Quem separa o que vale guardar'), '',
      `<select id="s-extractor">
         <option value="">${t('— sem chamar IA, só a regra local —')}</option>
         ${chatModels().map((m) => `<option value="${escapeHtml(m.ref)}"${s.memory.extractorModel === m.ref ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
       </select>`)}
    ${cfgLin(t('O jeito de indexar'), t('É o que faz a busca entender sentido, não só palavra igual.'),
      `<select id="s-embed">
         <option value="">${t('— sem indexar, só busca por palavra —')}</option>
         ${embeddingModels().map((m) => `<option value="${escapeHtml(m.ref)}"${s.memory.embeddingModel === m.ref ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
       </select>`)}
    ${pendente.total
      ? `<div class="aviso" id="reindex-box">
           <div><b>${plural(
             pendente.total,
             '1 coisa foi indexada pelo jeito antigo',
             '{n} coisas foram indexadas pelo jeito antigo'
           )}</b>
             ${t('({memorias} da memória, {chunks} de documentos). Até refazer, elas só aparecem na busca por palavra.', {
               memorias: pendente.memories,
               chunks: pendente.chunks
             })}</div>
           <button id="btn-reindex" class="primary" type="button">${icon('refresh', 17)} ${t('Refazer agora')}</button>
         </div>`
      : ''}
    ${cfgLin(t('Guardar o que eu mudei aqui'), '', `<button id="btn-save-settings" class="primary" type="button">${t('Salvar')}</button>`)}`,

  ias: () => `<h3>${t('IAs ligadas')}</h3>
    ${state.providers
      .map((p) =>
        cfgLin(
          escapeHtml(p.name),
          escapeHtml(
            `${t(KIND_ROT[p.kind] || 'paga por uso')} · ${plural(p.models.length, '1 modelo', '{n} modelos')}`
          ),
          `${p.enabled
            ? `<span class="tag on"><span class="pt"></span>${t('ligada')}</span>`
            : `<span class="tag warn"><span class="pt"></span>${t('desligada')}</span>`}
           <button class="ghost" type="button" data-ir="providers">${t('Abrir')}</button>`
        )
      )
      .join('')}
    ${cfgLin(t('Procurar IA nesta máquina'), t('Olha as portas conhecidas, o PATH e as chaves guardadas no sistema.'),
      `<button class="primary" type="button" data-ir="providers">${t('Abrir IAs ligadas')}</button>`)}`,

  acesso: (s) => `<h3>${t('Acesso')}</h3>
    ${cfgLin(t('Pedir senha pra abrir'), t('Sem isso, qualquer aparelho da sua rede abre este app.'), cfgChave('s-token', s.requireToken))}
    ${s.requireToken
      ? ''
      : `<div class="aviso err"><div><b>${t('Este app está aberto pra rede inteira.')}</b>
           ${t('Qualquer aparelho no seu Wi‑Fi entra, lê suas conversas e gasta suas chaves de API. Ligue a senha aí em cima.')}</div></div>`}
    ${cfgLin(t('Onde ele está escutando'), '', `<span class="val">${escapeHtml(s.host)}:${s.port}</span>`)}
    ${cfgLin(t('Chaves guardadas no servidor'), t('Elas nunca chegam ao navegador.'),
      `<span class="val">${s.secrets.length ? escapeHtml(s.secrets.join(' · ')) : t('nenhuma')}</span>`)}
    ${cfgLin(t('Busca por sentido'), '', `<span class="val">${s.embeddingAvailable ? t('ligada') : t('desligada — só por palavra')}</span>`)}`,

  dados: () => `<h3>${t('Seus dados')}</h3>
    ${cfgLin(t('Baixar cópia agora'), t('Um zip com conversas, memória, perfis, projetos, ajustes e anexos.'),
      `<button id="btn-backup" class="ghost" type="button"><span data-icon="download"></span> ${t('Baixar')}</button>`)}
    ${cfgLin(t('Restaurar de um arquivo'), t('Substitui o que está aqui. O banco de agora fica guardado antes da troca.'),
      `<button id="btn-restore" class="ghost" type="button"><span data-icon="upload"></span> ${t('Escolher arquivo')}</button><input id="restore-file" type="file" accept=".zip" hidden />`)}
    ${cfgLin(t('Cópias automáticas'), t('Uma por dia, quando o servidor sobe. Guarda as sete últimas.'),
      `<span class="val" id="backup-list">${t('carregando…')}</span>`, true)}`,

  // O modo agente abre um navegador de verdade e clica sozinho. Quem escolhe
  // qual navegador é a pessoa, na primeira vez que liga — aqui ela troca depois,
  // sem precisar desligar e ligar de novo pra ver a pergunta.
  agente: (s) => {
    const nav = s.navegador || {};
    const nome = nav.binario ? nav.binario.split(/[\\/]/).pop() : '';
    const economicos = new Set(
      state.providers
        .filter(
          (p) =>
            p.enabled &&
            (p.kind === 'ollama' || ehLocal(p) || /groq|deepseek/i.test(`${p.name || ''} ${p.base_url || ''}`))
        )
        .flatMap((p) => p.models.filter((m) => m.kind === 'chat').map((m) => m.ref))
    );
    const modelos = chatModels().sort(
      (a, b) => Number(!economicos.has(a.ref)) - Number(!economicos.has(b.ref))
    );
    const opcoesDeModelo = (selecionado) =>
      modelos
        .map(
          (m) =>
            `<option value="${escapeHtml(m.ref)}"${m.ref === selecionado ? ' selected' : ''}>${
              economicos.has(m.ref) ? `${t('econômica')} · ` : ''
            }${escapeHtml(m.label)}</option>`
        )
        .join('');
    return `<h3>${t('Modo agente')}</h3>
    ${cfgLin(
      t('IA que dá os passos'),
      t('Cada passo manda a página inteira. No automático, ele prefere uma IA local, Groq ou DeepSeek.'),
      `<select id="s-nav-modelo">
         <option value="">${t('Automático — economiza quando pode')}</option>
         ${opcoesDeModelo(nav.modeloNavegar)}
       </select>`
    )}
    ${economicos.size
      ? ''
      : `<div class="aviso"><div><b>${t('Nenhuma IA econômica está ligada.')}</b>
           ${t('Os passos usam a IA da conversa por enquanto. Ligue Ollama, Groq ou DeepSeek para economizar.')}</div></div>`}
    ${cfgLin(
      t('IA que escreve a resposta'),
      t('Só ela recebe o resultado da navegação e escreve a resposta final que você lê.'),
      `<select id="s-nav-resposta">
         <option value="">${t('A IA escolhida na conversa')}</option>
         ${opcoesDeModelo(nav.modeloResponder)}
       </select>`
    )}
    ${cfgLin(
      t('Qual navegador ele dirige'),
      t('Sempre numa janela separada: ele não usa suas abas nem seus logins.'),
      `<select id="s-nav-fonte">
         <option value="instalado"${nav.fonte === 'instalado' ? ' selected' : ''}>${t('O que já está nesta máquina')}</option>
         <option value="proprio"${nav.fonte === 'proprio' ? ' selected' : ''}>${t('O que o app baixou')}${nome ? ` · ${escapeHtml(nome)}` : ''}</option>
       </select>`
    )}
    ${cfgLin(
      t('Mostrar a janela enquanto ele navega'),
      t('Serve pra acompanhar o que ele faz, e pra entrar num site na mão uma vez — dali em diante ele continua logado.'),
      cfgChave('s-nav-janela', nav.janela)
    )}
    ${cfgLin(
      t('Quantos passos ele pode dar por pergunta'),
      t('Cada passo é uma ida à IA. Oito resolve quase tudo sem virar uma conversa inteira.'),
      `<input id="s-nav-passos" type="number" min="1" max="30" value="${Number(nav.passos) || 8}" style="max-width:120px;text-align:center" />`
    )}
    ${cfgLin(t('Guardar o que eu mudei aqui'), '', `<button id="btn-save-agente" class="primary" type="button">${t('Salvar')}</button>`)}`;
  },

  perfis: () => `<h3>${t('Perfis')}</h3>
    ${state.gems
      .map((g) =>
        cfgLin(escapeHtml(g.name), escapeHtml(g.model ? modelLabel(g.model) : t('usa a IA escolhida na conversa')),
          `<button class="ghost" type="button" data-ir="gems">${t('Mudar')}</button>`)
      )
      .join('')}
    ${cfgLin(t('Novo perfil'), '', `<button class="primary" type="button" data-ir="gems">${t('Criar')}</button>`)}`,

  terminal: () => {
    const clis = state.providers.filter((p) => p.kind === 'cli');
    return `<h3>${t('Programas do terminal')}</h3>
    ${clis.length
      ? clis
          .map((p) =>
            cfgLin(
              escapeHtml(p.name),
              escapeHtml(p.config.command || t('sem caminho apontado')),
              `${p.enabled
                ? `<span class="tag on"><span class="pt"></span>${t('ligado')}</span>`
                : `<span class="tag warn"><span class="pt"></span>${t('desligado por você')}</span>`}
               <button class="ghost" type="button" data-ir="providers">${t('Abrir')}</button>`
            )
          )
          .join('')
      : cfgLin(t('Nenhum programa ligado'), t('Claude Code, Codex, Gemini e opencode entram sozinhos se estiverem instalados.'),
          `<button class="primary" type="button" data-ir="providers">${t('Procurar agora')}</button>`)}`;
  },

  atalhos: () => `<h3>${t('Atalhos de teclado')}</h3>
    ${[
      [t('Lista de comandos'), '⌘K'],
      // A tabela precisa bater com o listener de web/app.js: ⌘N é conversa
      // nova e ⇧⌘N é a anônima. Trocados, quem seguisse esta tela abriria uma
      // conversa anônima achando que abriu uma normal.
      [t('Nova conversa'), '⌘N'],
      [t('Conversa anônima'), '⇧⌘N'],
      [t('Ajustes desta conversa'), '⌘,'],
      [t('Enviar mesmo com quebra de linha'), '⌘↵'],
      [t('Sair do modo voz, fechar a lista ou parar a resposta'), 'Esc']
    ]
      .map(([r, k]) => cfgLin(r, '', `<span class="val" style="font-family:var(--font-mono)">${k}</span>`))
      .join('')}`
};

function cfgMobile(s, pendente) {
  const lin = (ic, rot, extra = '', attr = '') => `<button class="linha" type="button"${attr}>
      <span class="ico" data-icon="${ic}" data-size="20"></span>
      <span class="rot">${rot}</span>${extra}
      <span class="seta" data-icon="chevron" data-size="17"></span>
    </button>`;
  // `.linha .val` é `flex: 0 0 auto`: sem deixar encolher, um valor comprido
  // (o nome da IA) espreme o rótulo em quatro linhas e passa por cima dele.
  const val = (v) =>
    `<span class="val" style="flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span>`;
  // `txt`, não `t`: um parâmetro chamado `t` esconderia a função de tradução
  // importada no topo, e a próxima frase escrita aqui dentro quebraria.
  const curto = (txt, n = 26) =>
    String(txt).length > n ? `${String(txt).slice(0, n - 1)}…` : String(txt);
  const trava = (ic, rot, id, on) => `<button class="linha" type="button" data-trava="${id}">
      <span class="ico" data-icon="${ic}" data-size="20"></span>
      <span class="rot">${rot}</span>
      <span class="chave${on ? ' on' : ''}" role="switch" aria-checked="${!!on}"></span>
    </button>`;

  return `<div class="cfg-mob panel-inner">
    <h2>${t('Ajustes')}</h2>

    <div class="grupo-rot" style="padding-top:12px">${t('Aparência')}</div>
    <div class="grupo">
      ${lin('moon', t('Tema'), val(document.documentElement.dataset.theme === 'light' ? t('claro') : t('escuro')), ' data-mob="tema"')}
      ${lin('globe', t('Idioma'), val(escapeHtml(IDIOMAS[idioma()] || idioma())), ' data-mob="idioma"')}
    </div>

    <div class="grupo-rot">${t('Memória')}</div>
    <div class="grupo">
      ${lin('brain', t('Ver e editar memória'), '', ' data-ir="memory"')}
      ${trava('check', t('Lembrar do que eu conto'), 's-enabled', s.memory.enabled)}
      ${trava('sparkle', t('Aprender sozinho'), 's-auto', s.memory.autoExtract)}
      ${pendente.total ? lin('refresh', t('Refazer o índice'), val(pendente.total), ' data-mob="reindex"') : ''}
    </div>

    <div class="grupo-rot">${t('IAs')}</div>
    <div class="grupo">
      ${lin('plug', t('IAs ligadas'), val(state.providers.filter((p) => p.enabled).length), ' data-ir="providers"')}
      ${lin(
        'bot',
        // O nome da IA é "provedor · modelo" e não cabe na coluna da direita a
        // 375px: vai como sublinha do rótulo, que é o que `.linha .rot small` desenha.
        `${t('Qual responde por padrão')}<small>${escapeHtml(curto(modelLabel(state.model), 40))}</small>`,
        '',
        ' data-ir="providers"'
      )}
      ${lin('sparkle', t('Perfis'), val(state.gems.length), ' data-ir="gems"')}
      ${lin('folder', t('Projetos'), val(state.projects.length), ' data-ir="projects"')}
      ${lin(
        'globe',
        `${t('Modo agente')}<small>${
          s.navegador?.fonte === 'proprio'
            ? t('usa o navegador que o app baixou')
            : s.navegador?.fonte === 'instalado'
              ? t('usa o navegador desta máquina')
              : t('ainda não escolhido')
        }</small>`,
        '',
        ' data-mob="agente"'
      )}
    </div>

    <div class="grupo-rot">${t('Acesso')}</div>
    <div class="grupo">
      ${trava('key', t('Pedir senha pra abrir'), 's-token', s.requireToken)}
      ${lin('command', `${t('Onde ele está escutando')}<small>${escapeHtml(s.host)}:${s.port}</small>`)}
    </div>

    <div class="grupo-rot">${t('Seus dados')}</div>
    <div class="grupo">
      ${lin('download', t('Baixar cópia agora'), '', ' data-mob="backup"')}
      ${lin('upload', t('Restaurar de um arquivo'), '', ' data-mob="restore"')}
    </div>

    <div class="grupo" style="margin-top:14px">
      <button class="linha perigo" type="button" data-mob="apagar-conversas">
        <span class="ico" data-icon="trash" data-size="20"></span>
        <span class="rot">${t('Apagar todas as conversas')}</span>
      </button>
    </div>

    <div class="versao">Nuvo · ${t('roda em {host}:{porta}', { host: escapeHtml(s.host), porta: s.port })}</div>
  </div>`;
}

/** Baixar a cópia: o download é o navegador que faz, a rota já manda o nome. */
function baixarCopia() {
  const link = document.createElement('a');
  link.href = `/api/backup?token=${encodeURIComponent(TOKEN)}`;
  link.click();
  toast(t('a cópia está sendo gerada e vai baixar em instantes'));
}

async function aplicarRestauracao(file) {
  if (!file) return;
  if (
    !(await confirmar({
      titulo: t('Restaurar de um arquivo'),
      texto: t('Restaurar de "{nome}"?\n\nO que está aqui agora é substituído. O banco atual fica guardado como cópia antes de trocar.', {
        nome: file.name
      }),
      acao: t('Restaurar'),
      perigo: true
    }))
  ) {
    return;
  }
  try {
    const done = await api('/restore', { method: 'POST', raw: true, body: await file.arrayBuffer() });
    toast(done.message, 'ok');
    const lido = done.config
      ? plural(done.uploads, 'Cópia lida: banco, ajustes e 1 anexo.', 'Cópia lida: banco, ajustes e {n} anexos.')
      : plural(done.uploads, 'Cópia lida: banco e 1 anexo.', 'Cópia lida: banco e {n} anexos.');
    await avisar({
      titulo: t('Restaurar de um arquivo'),
      texto: `${lido}\n\n${t('O banco entra no lugar na próxima vez que o servidor subir — trocar agora não valeria, porque este processo ainda está com o banco antigo aberto. Reinicie para concluir.')}`
    });
  } catch (err) {
    toast(err.message, 'err');
  }
}

/** No celular não existe #restore-file (os ids moram só no lado do computador). */
function escolherArquivoDeCopia() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.zip';
  inp.onchange = () => aplicarRestauracao(inp.files[0]);
  inp.click();
}

/** Em lotes: o servidor tem teto por chamada pra não travar num pedido só. */
async function rodarReindex(aoAndar) {
  let feitos = 0;
  for (;;) {
    const r = await api('/reindex', { method: 'POST' });
    feitos += r.updated;
    if (aoAndar) aoAndar(feitos);
    if (r.done) return { feitos, done: true };
    if (!r.updated) return { feitos, done: false, reason: r.reason };
  }
}

views.settings = async function renderSettings(el, { switchView, applyTheme, aplicarMenu }) {
  const [settings, pendente] = await Promise.all([api('/settings'), api('/reindex')]);
  const secao = CFG_SECOES[cfgSecao] ? cfgSecao : 'geral';
  const tema = document.documentElement.dataset.theme;

  el.className = `view panel${el.classList.contains('entra') ? ' entra' : ''}`;
  el.innerHTML = `
    <div class="cfg">
      <nav class="cfg-rail">
        <div class="busca">${icon('search', 18)}<input type="search" placeholder="${t('Procurar nos ajustes')}" /></div>
        ${CFG_TRILHA.map(
          ([rot, itens]) =>
            `<div class="cfg-rot">${rot()}</div>` +
            itens
              .map(
                ([k, ic, nome]) =>
                  `<button class="cfg-item${k === secao ? ' sel' : ''}" type="button" data-secao="${k}"><span class="ico">${icon(ic, 19)}</span> ${nome()}</button>`
              )
              .join('')
        ).join('')}
      </nav>
      <div class="cfg-corpo">
        ${CFG_SECOES[secao](settings, pendente)}
        <div class="cfg-pe">
          <button data-theme="dark" type="button" class="${tema === 'dark' ? 'sel' : ''}" title="${t('escuro')}" aria-label="${t('tema escuro')}">${icon('moon', 19)}</button>
          <button data-theme="light" type="button" class="${tema === 'light' ? 'sel' : ''}" title="${t('claro')}" aria-label="${t('tema claro')}">${icon('sun', 19)}</button>
        </div>
      </div>
    </div>
    ${cfgMobile(settings, pendente)}`;

  const q = (sel) => el.querySelector(sel);

  // Trocar o idioma redesenha a tela inteira (o ouvinte de `aoTrocarIdioma`
  // mora no app.js), então não há nada pra fazer depois de chamar.
  // --- botões do menu -------------------------------------------------------
  const listaDoMenu = q('#menu-lista');
  if (listaDoMenu) {
    const cfg = {
      ordem: [...(settings.menu?.ordem || MENU_PADRAO_DA_TELA.ordem)],
      escondidos: [...(settings.menu?.escondidos || [])],
      noMais: [...(settings.menu?.noMais || MENU_PADRAO_DA_TELA.noMais)]
    };
    const guardar = async () => {
      const fora = await api('/settings', { method: 'PATCH', body: { menu: cfg } });
      state.settings = fora;
      aplicarMenu?.();
      switchView('settings');
    };
    const marcar = (lista, id, ligado) => {
      const dentro = lista.includes(id);
      if (ligado && !dentro) lista.push(id);
      if (!ligado && dentro) lista.splice(lista.indexOf(id), 1);
    };

    for (const linha of listaDoMenu.querySelectorAll('.menu-linha')) {
      const id = linha.dataset.id;
      linha.querySelector('[data-campo=ver]').onchange = (ev) => {
        marcar(cfg.escondidos, id, !ev.target.checked);
        guardar();
      };
      linha.querySelector('[data-campo=mais]').onchange = (ev) => {
        marcar(cfg.noMais, id, ev.target.checked);
        guardar();
      };
      for (const botao of linha.querySelectorAll('[data-mover]')) {
        botao.onclick = () => {
          const de = cfg.ordem.indexOf(id);
          const para = de + Number(botao.dataset.mover);
          if (de < 0 || para < 0 || para >= cfg.ordem.length) return;
          cfg.ordem.splice(para, 0, cfg.ordem.splice(de, 1)[0]);
          guardar();
        };
      }
    }
    q('#menu-padrao').onclick = async () => {
      const fora = await api('/settings', { method: 'PATCH', body: { menu: MENU_PADRAO_DA_TELA } });
      state.settings = fora;
      aplicarMenu?.();
      switchView('settings');
      toast(t('menu de volta ao padrão'), 'ok');
    };
  }

  const selIdioma = q('#s-idioma');
  if (selIdioma) selIdioma.onchange = () => trocarIdioma(selIdioma.value);

  // A trilha procura na lista de seções pelo nome — sem sair da tela.
  //
  // O título do grupo some junto com os itens dele, e a busca que não acha nada
  // diz isso: sem as duas coisas, procurar por uma palavra que não existe
  // deixava só "Ajustes" e "Personalizar" soltos, sem uma linha explicando.
  const busca = el.querySelector('.cfg-rail .busca input');
  if (busca) {
    const trilha = el.querySelector('.cfg-rail');
    const vazio = document.createElement('div');
    vazio.className = 'cfg-rot';
    vazio.hidden = true;
    trilha.appendChild(vazio);
    busca.oninput = () => {
      const alvo = busca.value.trim().toLowerCase();
      let achou = 0;
      for (const b of el.querySelectorAll('.cfg-item')) {
        b.hidden = !!alvo && !b.textContent.toLowerCase().includes(alvo);
        if (!b.hidden) achou += 1;
      }
      for (const rot of el.querySelectorAll('.cfg-rail .cfg-rot')) {
        if (rot === vazio) continue;
        let visivel = false;
        for (let n = rot.nextElementSibling; n && !n.classList.contains('cfg-rot'); n = n.nextElementSibling) {
          if (n.classList.contains('cfg-item') && !n.hidden) visivel = true;
        }
        rot.hidden = !!alvo && !visivel;
      }
      vazio.hidden = !alvo || achou > 0;
      vazio.textContent = t('nada encontrado');
    };
  }

  for (const b of el.querySelectorAll('[data-secao]')) {
    b.onclick = () => {
      cfgSecao = b.dataset.secao;
      switchView('settings');
    };
  }

  // o <span class="chave"> é a cara do <input type="checkbox"> que está do lado
  for (const k of el.querySelectorAll('[data-chave]')) {
    const alvo = q(`#${k.dataset.chave}`);
    if (!alvo) continue;
    const virar = () => {
      alvo.checked = !alvo.checked;
      k.classList.toggle('on', alvo.checked);
      k.setAttribute('aria-checked', String(alvo.checked));
      alvo.dispatchEvent(new Event('change', { bubbles: true }));
    };
    k.onclick = virar;
    k.onkeydown = (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') {
        ev.preventDefault();
        virar();
      }
    };
  }

  for (const btn of el.querySelectorAll('[data-theme]')) btn.onclick = () => applyTheme(btn.dataset.theme);
  for (const btn of el.querySelectorAll('[data-ir]')) btn.onclick = () => switchView(btn.dataset.ir);

  // --- geral ----------------------------------------------------------------

  const modeloPadrao = q('#s-modelo-padrao');
  if (modeloPadrao) {
    modeloPadrao.onchange = () => {
      state.model = modeloPadrao.value;
      localStorage.setItem('nuvo.model', state.model);
      const sel = document.querySelector('#sel-model');
      if (sel) sel.value = state.model;
      toast(t('IA padrão trocada'), 'ok');
    };
  }
  const perfilPadrao = q('#s-perfil-padrao');
  if (perfilPadrao) {
    perfilPadrao.onchange = () => {
      state.gemId = perfilPadrao.value;
      localStorage.setItem('nuvo.gem', state.gemId);
      const sel = document.querySelector('#sel-gem');
      if (sel) sel.value = state.gemId;
      toast(t('perfil padrão trocado'), 'ok');
    };
  }

  // --- memória --------------------------------------------------------------

  const botaoReindex = q('#btn-reindex');
  if (botaoReindex) {
    botaoReindex.onclick = async () => {
      const caixa = q('#reindex-box');
      botaoReindex.disabled = true;
      botaoReindex.textContent = t('refazendo…');
      const r = await rodarReindex((feitos) => {
        botaoReindex.textContent = feitos ? t('refazendo… {n}', { n: feitos }) : t('refazendo…');
      });
      if (r.done) {
        caixa.textContent = r.feitos
          ? plural(r.feitos, '1 coisa refeita', '{n} coisas refeitas')
          : t('nada a refazer');
        return;
      }
      caixa.textContent = r.reason || t('não deu pra refazer agora');
      botaoReindex.disabled = false;
      botaoReindex.textContent = t('Tentar de novo');
      caixa.appendChild(botaoReindex);
    };
  }

  const salvar = q('#btn-save-settings');
  if (salvar) {
    salvar.onclick = async () => {
      await api('/settings', {
        method: 'PATCH',
        body: {
          memory: {
            enabled: q('#s-enabled').checked,
            autoExtract: q('#s-auto').checked,
            maxInjected: Number(q('#s-max').value) || 12,
            minScore: Number(q('#s-min').value) || 0.12,
            extractorModel: q('#s-extractor').value || null,
            embeddingModel: q('#s-embed').value || null
          }
        }
      });
      toast(t('ajustes salvos'), 'ok');
      switchView('settings');
    };
  }

  // --- modo agente ----------------------------------------------------------

  const salvarAgente = q('#btn-save-agente');
  if (salvarAgente) {
    salvarAgente.onclick = async () => {
      const fonte = q('#s-nav-fonte').value;
      await api('/settings', {
        method: 'PATCH',
        body: {
          navegador: {
            fonte,
            janela: q('#s-nav-janela').checked,
            passos: Math.min(30, Math.max(1, Number(q('#s-nav-passos').value) || 8)),
            modeloNavegar: q('#s-nav-modelo').value || null,
            modeloResponder: q('#s-nav-resposta').value || null
          }
        }
      });
      // Escolher "o que o app baixou" sem ele no disco deixaria o agente sem
      // navegador nenhum: o download acontece aqui, com a barra na frente.
      if (fonte === 'proprio' && !settings.navegador?.binario) {
        const alvo = q('#s-nav-fonte').closest('.cfg-lin');
        alvo.insertAdjacentHTML(
          'afterend',
          `<div class="cfg-lin larga" id="baixa-nav"><div class="rot">${t('Baixando o navegador do app')}<small class="passo-txt"></small></div>
             <div class="ctl" style="flex:1"><div class="progress"><span style="width:0%"></span></div></div></div>`
        );
        const caixa = q('#baixa-nav');
        try {
          await stream('/requisitos/navegador/baixar', {}, (ev) => {
            if (ev.type === 'phase') caixa.querySelector('.passo-txt').textContent = t(ev.text);
            else if (ev.pct != null) caixa.querySelector('.progress span').style.width = `${ev.pct}%`;
            else if (ev.type === 'error') toast(ev.error || t('não deu certo'), 'err');
          });
          toast(t('navegador pronto'), 'ok');
        } catch (err) {
          toast(err.message, 'err');
        }
      }
      toast(t('ajustes salvos'), 'ok');
      switchView('settings');
    };
  }

  // --- acesso ---------------------------------------------------------------

  // Desligar a senha é decisão de rede, não de gosto: pede confirmação e diz o
  // que muda. Religar não pergunta nada — voltar a trancar não faz estrago.
  const trocarSenha = async (marcado, desfazer) => {
    if (
      !marcado &&
      !(await confirmar({
        titulo: t('Desligar'),
        texto: t('Desligar a senha?\n\nQualquer aparelho na sua rede vai poder abrir este app, ler suas conversas e usar suas chaves de API.'),
        acao: t('Desligar'),
        perigo: true
      }))
    ) {
      desfazer();
      return;
    }
    try {
      const out = await api('/settings', { method: 'PATCH', body: { requireToken: marcado } });
      // Religando, o servidor devolve a chave junto: sem guardá-la, o próximo
      // pedido desta aba levaria 401 e o botão teria trancado o próprio dono.
      if (out.accessToken) {
        localStorage.setItem('nuvo.token', out.accessToken);
        toast(t('senha religada — este aparelho já está com a chave; os outros precisam dela'));
        return location.reload();
      }
      toast(marcado ? t('senha religada') : t('senha desligada — cuidado'), marcado ? 'ok' : 'err');
      switchView('settings');
    } catch (err) {
      desfazer();
      toast(err.message, 'err');
    }
  };

  const campoSenha = q('#s-token');
  if (campoSenha) {
    campoSenha.onchange = async (ev) => {
      const marcado = ev.target.checked;
      await trocarSenha(marcado, () => {
        ev.target.checked = !marcado;
        const chave = el.querySelector('[data-chave="s-token"]');
        if (chave) {
          chave.classList.toggle('on', ev.target.checked);
          chave.setAttribute('aria-checked', String(ev.target.checked));
        }
      });
    };
  }

  // --- seus dados -----------------------------------------------------------

  const btnBackup = q('#btn-backup');
  if (btnBackup) btnBackup.onclick = baixarCopia;

  const fileInput = q('#restore-file');
  const btnRestore = q('#btn-restore');
  if (btnRestore && fileInput) {
    btnRestore.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      await aplicarRestauracao(fileInput.files[0]);
      fileInput.value = '';
    };
  }

  if (q('#backup-list')) {
    api('/backups')
      .then((lista) => {
        const alvo = q('#backup-list');
        if (!alvo) return;
        if (!lista.length) {
          alvo.textContent = t('nenhuma ainda');
          return;
        }
        const tamanho = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`);
        // A data sai no formato do idioma escolhido. Antes era o ISO cru
        // fatiado, que num app em inglês ou espanhol aparecia como 2026-08-20.
        const quando = (at) => {
          const dia = formatarData(at, { day: '2-digit', month: 'short', year: 'numeric' });
          const hora = String(at).slice(11, 16);
          return dia ? `${dia} ${hora}` : String(at).replace('T', ' ').slice(0, 16);
        };
        alvo.innerHTML = lista
          .map((b) => `${escapeHtml(quando(b.at))} — ${tamanho(b.bytes)}`)
          .join('<br />');
      })
      .catch(() => {
        const alvo = q('#backup-list');
        if (alvo) alvo.textContent = t('não consegui listar as cópias automáticas');
      });
  }

  // --- lista de celular: sem id nenhum, fala com a API direto ---------------

  for (const b of el.querySelectorAll('[data-trava]')) {
    const chave = b.querySelector('.chave');
    b.onclick = async () => {
      const ligado = !chave.classList.contains('on');
      const pintar = (v) => {
        chave.classList.toggle('on', v);
        chave.setAttribute('aria-checked', String(v));
      };
      pintar(ligado);
      if (b.dataset.trava === 's-token') {
        return trocarSenha(ligado, () => pintar(!ligado));
      }
      const campo = b.dataset.trava === 's-enabled' ? 'enabled' : 'autoExtract';
      try {
        await api('/settings', { method: 'PATCH', body: { memory: { [campo]: ligado } } });
        toast(t('ajuste salvo'), 'ok');
      } catch (err) {
        pintar(!ligado);
        toast(err.message, 'err');
      }
    };
  }

  for (const b of el.querySelectorAll('[data-mob]')) {
    const acao = b.dataset.mob;
    b.onclick = async () => {
      if (acao === 'tema') {
        return applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      }
      // Gira entre os idiomas, como a linha do tema gira entre claro e escuro:
      // são três, e uma tela inteira de escolha pra três itens é grande demais.
      if (acao === 'idioma') {
        const codigos = Object.keys(IDIOMAS);
        return trocarIdioma(codigos[(codigos.indexOf(idioma()) + 1) % codigos.length]);
      }
      // A mesma pergunta da primeira vez: no celular ela é a tela inteira, e
      // troca a escolha sem precisar da trilha de ajustes, que é do desktop.
      if (acao === 'agente') {
        const fonte = await perguntarNavegador();
        if (fonte) switchView('settings');
        return;
      }
      if (acao === 'backup') return baixarCopia();
      if (acao === 'restore') return escolherArquivoDeCopia();
      if (acao === 'reindex') {
        b.disabled = true;
        const r = await rodarReindex();
        toast(
          r.done
            ? r.feitos
              ? plural(r.feitos, '1 coisa refeita', '{n} coisas refeitas')
              : t('nada a refazer')
            : r.reason || t('não deu pra refazer agora'),
          r.done ? 'ok' : 'err'
        );
        return switchView('settings');
      }
      if (acao === 'apagar-conversas') {
        // Não existe apagar em lote no servidor: é laço no cliente, uma a uma.
        const total = state.chats.length;
        if (!total) return toast(t('não há conversa pra apagar'));
        if (
          !(await confirmar({
            titulo: t('Apagar todas as conversas'),
            texto: `${plural(total, 'Apagar 1 conversa?', 'Apagar {n} conversas?')}\n\n${t('Isso não volta.')}`,
            acao: t('Apagar'),
            perigo: true
          }))
        ) {
          return;
        }
        b.disabled = true;
        for (const c of [...state.chats]) {
          try {
            await api(`/chats/${c.id}`, { method: 'DELETE' });
          } catch {
            /* uma que falha não pode parar as outras */
          }
        }
        await refreshState();
        toast(t('conversas apagadas'), 'ok');
        return switchView('settings');
      }
    };
  }

  paintIcons(el);
};

// --------------------------------------------------------------- conselho

views.council = function renderCouncil(el, { switchView }) {
  const models = chatModels();
  const saved = JSON.parse(localStorage.getItem('nuvo.council') || '[]');

  const inner = panel(
    el,
    t('Perguntar pra várias'),
    'users',
    t('A mesma pergunta em várias IAs ao mesmo tempo. Todas leem a mesma memória.'),
    models.length < 2
      ? `<div class="card">
           <p>${t('Você precisa de pelo menos duas IAs ligadas pra perguntar pra várias.')}</p>
           <div class="row"><button id="c-ligar" class="primary" type="button">${t('Ver IAs ligadas')}</button></div>
         </div>`
      : `<div class="card">
           <label class="field">${t('Pergunta')}
             <textarea id="c-prompt" rows="3" placeholder="${t('O que você quer perguntar pra todas elas')}"></textarea>
           </label>
           <label class="field">${t('Quais IAs respondem')}
             <div id="c-models" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"></div>
           </label>
           <label class="field" id="c-judge-campo">${t('Quem costura a resposta final')}
             <select id="c-judge"><option value="">${t('— a primeira escolhida —')}</option>${modelOptions()}</select>
           </label>
           <select id="c-mode" hidden>
             <option value="council">${t('Uma resposta só')}</option>
             <option value="compare">${t('Lado a lado')}</option>
             <option value="vote">${t('Elas votam')}</option>
           </select>
           <label class="field">${t('Como você quer ver')}
             <div class="segmentado" id="c-modos">
               <button type="button" data-modo="council" class="sel">${t('Uma resposta só')}</button>
               <button type="button" data-modo="compare">${t('Lado a lado')}</button>
               <button type="button" data-modo="vote">${t('Elas votam')}</button>
             </div>
           </label>
           <div class="row">
             <button id="c-go" class="primary" type="button">${t('Perguntar pra todas')}</button>
             <button id="c-stop" class="danger" type="button" hidden>${icon('stop', 18)} ${t('Parar')}</button>
           </div>
         </div>
         <div class="council-head">
           <div class="pergunta" id="c-pergunta" hidden></div>
           <div class="council-meta">
             <div class="trilho" id="c-trilho"></div>
             <span class="col-state" id="c-status"></span>
             <span class="grow"></span>
             <button id="c-replay" class="icon" type="button" title="${t('perguntar de novo')}" aria-label="${t('perguntar de novo')}" hidden>${icon('refresh', 18)}</button>
           </div>
         </div>
         <div id="c-out"></div>`
  );

  // O botão que resolve só existe no ramo sem IAs suficientes.
  const ligar = inner.querySelector('#c-ligar');
  if (ligar) ligar.onclick = () => switchView('providers');
  if (models.length < 2) return paintIcons(el);

  const picker = inner.querySelector('#c-models');
  picker.innerHTML = models
    .map(
      (m) =>
        `<label class="check"><input type="checkbox" value="${escapeHtml(m.ref)}"${
          saved.includes(m.ref) ? ' checked' : ''
        } /> ${escapeHtml(m.label)}</label>`
    )
    .join('');

  // O segmentado é a cara do <select id="c-mode">, que continua sendo quem manda
  // o modo pro servidor. Ele vive no formulário, junto da pergunta: embaixo do
  // resultado ele parecia aba de resultado, e clicar não mudava resposta
  // nenhuma — o modo vale pra pergunta seguinte, não pra que já foi feita.
  const modos = inner.querySelector('#c-modos');
  const modeSel = inner.querySelector('#c-mode');
  const judgeField = inner.querySelector('#c-judge-campo');
  for (const b of modos.querySelectorAll('button[data-modo]')) {
    b.onclick = () => {
      modeSel.value = b.dataset.modo;
      for (const o of modos.querySelectorAll('button')) o.classList.toggle('sel', o === b);
      judgeField.hidden = b.dataset.modo !== 'council';
    };
  }

  const out = inner.querySelector('#c-out');
  const status = inner.querySelector('#c-status');
  const stopBtn = inner.querySelector('#c-stop');
  let controller = null;

  inner.querySelector('#c-go').onclick = async () => {
    const chosen = [...picker.querySelectorAll('input:checked')].map((i) => i.value);
    if (chosen.length < 2) return toast(t('escolha pelo menos duas IAs'), 'err');
    localStorage.setItem('nuvo.council', JSON.stringify(chosen));

    const promptText = inner.querySelector('#c-prompt').value.trim();
    if (!promptText) return toast(t('escreva a pergunta'), 'err');

    const total = chosen.length;
    const pergunta = inner.querySelector('#c-pergunta');
    pergunta.textContent = `“${promptText}”`;
    pergunta.hidden = false;
    const trilho = inner.querySelector('#c-trilho');
    trilho.innerHTML = chosen.map(() => '<i class="run"></i>').join('');
    inner.querySelector('#c-replay').hidden = false;

    out.innerHTML = '<div class="council-grid" id="c-grid"></div>';
    const grid = out.querySelector('#c-grid');
    const cols = new Map();
    const marcas = new Map();
    const t0 = Date.now();
    let prontas = 0;
    let ok = 0;
    let falhas = 0;
    const relogio = setInterval(() => {
      const dt = (Date.now() - t0) / 1000;
      status.textContent = t('{prontas} de {total} prontas · {seg} s', {
        prontas,
        total,
        seg: dt.toFixed(0)
      });
      for (const col of cols.values()) {
        if (!col.classList.contains('run')) continue;
        col.querySelector('header .col-state').textContent = `${formatarNumero(dt, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1
        })} s`;
      }
    }, 100);
    controller = new AbortController();
    stopBtn.hidden = false;
    status.textContent = t('{prontas} de {total} prontas · {seg} s', { prontas: 0, total, seg: 0 });

    // Ao costurar, as colunas recolhem numa tira de pastilhas e a resposta
    // final assume a página. A grade é escondida, não removida: quem clicar na
    // pastilha volta pra resposta separada.
    function recolher(vencedorRef) {
      const existente = out.querySelector('.tira');
      if (existente) return existente;
      grid.hidden = true;
      const tira = document.createElement('div');
      tira.className = 'tira';
      for (const [ref, col] of cols) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = col.classList.contains('fail') ? 'fail' : ref === vencedorRef ? 'primary' : '';
        b.innerHTML = `<span class="pt"></span> ${escapeHtml(col.querySelector('h4').textContent)}`;
        b.onclick = () => {
          grid.hidden = false;
          col.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        };
        tira.appendChild(b);
      }
      out.append(tira, grid);
      return tira;
    }

    try {
      await stream(
        '/council',
        {
          prompt: promptText,
          models: chosen,
          mode: modeSel.value,
          judge: inner.querySelector('#c-judge').value || null
        },
        (ev) => {
          if (ev.type === 'start') {
            ev.models.forEach((m, k) => {
              const col = document.createElement('article');
              col.className = 'council-col run';
              col.id = `c-col-${k}`;
              col.style.animationDelay = `${k * 60}ms`;
              col.innerHTML = `<header>
                  <h4 title="${escapeHtml(m.label)}">${escapeHtml(m.label)}</h4>
                  <span class="col-state">${formatarNumero(0, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1
                  })} s</span>
                </header>
                <div class="body"></div>
                <footer>
                  <button class="icon" type="button" data-copiar title="${t('copiar')}" aria-label="${t('copiar a resposta')}">${icon('copy', 18)}</button>
                  <span class="grow"></span>
                  <span class="col-state"></span>
                </footer>`;
              grid.appendChild(col);
              cols.set(m.ref, col);
              marcas.set(m.ref, trilho.children[k]);
            });
          } else if (ev.type === 'answer') {
            const col = cols.get(ev.ref);
            if (!col) return;
            const marca = marcas.get(ev.ref);
            const estado = col.querySelector('header .col-state');
            prontas++;
            if (ev.error) {
              falhas++;
              col.className = 'council-col fail';
              if (marca) marca.className = 'fail';
              estado.textContent = t('falhou');
              col.querySelector('.body').innerHTML = `<div class="aviso err" style="margin:0">
                  <div><b>${t('essa IA não respondeu')}</b><br />${escapeHtml(ev.error)}<br />${t('Veja se ela está ligada e com chave em IAs ligadas.')}</div>
                  <button class="primary" type="button" data-resolver>${t('Resolver')}</button>
                </div>`;
              col.querySelector('[data-resolver]').onclick = () => switchView('providers');
              return;
            }
            ok++;
            col.className = 'council-col done';
            if (marca) marca.className = 'done';
            estado.textContent = `${formatarNumero(ev.ms / 1000, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1
            })} s`;
            col.querySelector('.body').innerHTML = renderMarkdown(ev.text);
            col.querySelector('footer .col-state').textContent = plural(
              ev.text.trim().split(/\s+/).length,
              '1 palavra',
              '{n} palavras'
            );
            col.querySelector('[data-copiar]').onclick = () =>
              navigator.clipboard.writeText(ev.text).then(() => toast(t('resposta copiada')));
            wireCodeCopy(col);
          } else if (ev.type === 'phase') {
            const seg = ((Date.now() - t0) / 1000).toFixed(0);
            const fase =
              modeSel.value === 'vote'
                ? t('elas estão se avaliando…')
                : t('costurando a resposta final…');
            status.textContent = t('{total} de {total} · {seg} s · {fase}', { total, seg, fase });
          } else if (ev.type === 'synthesis') {
            const tira = recolher();
            tira.insertAdjacentHTML(
              'beforebegin',
              `<div class="final">
                 <div class="quem">${roseta(20, 'fixa')}<span class="rot">${t(
                   'as {n} respostas viraram uma · costurada pelo {quem}',
                   { n: ok, quem: escapeHtml(ev.label) }
                 )}</span></div>
                 <div class="txt">${renderMarkdown(ev.text)}</div>
               </div>
               <p class="hint" style="margin:0 0 12px">${t('as respostas separadas continuam aqui:')}</p>`
            );
            wireCodeCopy(out);
          } else if (ev.type === 'votes') {
            const vencedor = ev.ranked[0]?.average != null ? ev.ranked[0].ref : null;
            const tira = recolher(vencedor);
            const falharam = [...cols.values()]
              .filter((c) => c.classList.contains('fail'))
              .map((c) => c.querySelector('h4').textContent);
            const linhas = ev.ranked
              .map((r) => {
                const venceu = r.ref === vencedor;
                const curtas = r.votes.length
                  ? t('notas recebidas: {notas}', { notas: r.votes.map((v) => v.nota).join(', ') })
                  : t('não recebeu nota');
                const longas = r.votes.length
                  ? r.votes.map((v) => `${v.from}: ${v.nota}`).join(' · ')
                  : t('não recebeu nota');
                // Os dois `style` consertam o ramo de computador da folha
                // (styles.css 1478-1480): lá a linha vira `1.2fr 2fr auto` e a
                // barra cai na trilha `auto`, que mede 0 porque uma barra não
                // tem largura própria; e `.votos` volta a `grid-column: auto`,
                // então o `text-align: right` alinhava dentro da primeira
                // coluna em vez da linha inteira. No celular os dois valores
                // são os mesmos que a folha já aplica.
                return `<tr class="${venceu ? 'win' : ''}">
                  <td>${venceu ? `<span class="crown">${icon('check', 16)}</span> ` : ''}${escapeHtml(r.label)}${venceu ? ` · ${t('venceu')}` : ''}</td>
                  <td class="nota">${
                    r.average == null
                      ? '—'
                      : formatarNumero(r.average, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1
                        })
                  }</td>
                  <td style="min-width:120px"><div class="barra"><span style="width:${r.average == null ? 0 : (r.average / 10) * 100}%"></span></div></td>
                  <td class="votos" style="grid-column:1/-1" data-curtas="${escapeHtml(curtas)}" data-longas="${escapeHtml(longas)}">${escapeHtml(curtas)}</td>
                </tr>`;
              })
              .join('');
            tira.insertAdjacentHTML(
              'beforebegin',
              `<div class="placar">
                 <table><tbody>${linhas}</tbody></table>
                 ${
                   ev.anuladas
                     ? `<div class="placar-nota">${icon('alert', 16)} <span>${plural(
                         ev.anuladas,
                         '1 voto anulado: a nota veio fora da escala de 0 a 10.',
                         '{n} votos anulados: a nota veio fora da escala de 0 a 10.'
                       )}</span></div>`
                     : ''
                 }
                 <div class="placar-nota">${icon('users', 16)} <span>${t('cada IA avaliou as outras sem saber de quem era cada resposta.')}${
                   falharam.length === 1
                     ? ` ${t('A {quem} falhou e não votou.', { quem: escapeHtml(falharam[0]) })}`
                     : falharam.length
                       ? ` ${t('{quem} falharam e não votaram.', { quem: escapeHtml(falharam.join(', ')) })}`
                       : ''
                 }</span></div>
               </div>`
            );
          } else if (ev.type === 'winner') {
            const col = cols.get(ev.ref);
            if (col) col.className = 'council-col win';
            const placar = out.querySelector('.placar');
            if (placar && !out.querySelector('#c-seguir')) {
              placar.insertAdjacentHTML(
                'afterend',
                `<div class="row" style="margin:18px 0">
                   <button class="ghost" type="button" id="c-quem-votou">${t('Quem votou o quê')}</button>
                   <button class="ghost" type="button" id="c-seguir">${t('Continuar com o vencedor')}</button>
                 </div>`
              );
              let aberto = false;
              out.querySelector('#c-quem-votou').onclick = () => {
                aberto = !aberto;
                for (const td of out.querySelectorAll('.placar .votos')) {
                  td.textContent = aberto ? td.dataset.longas : td.dataset.curtas;
                }
              };
              out.querySelector('#c-seguir').onclick = () => {
                state.model = ev.ref;
                localStorage.setItem('nuvo.model', ev.ref);
                switchView('chat');
              };
            }
          } else if (ev.type === 'error') {
            toast(ev.message, 'err');
            out.insertAdjacentHTML(
              'beforeend',
              `<div class="aviso err"><div><b>${t('não deu certo')}</b><br />${escapeHtml(ev.message)}</div></div>`
            );
          } else if (ev.type === 'done') {
            clearInterval(relogio);
            const seg = ((Date.now() - t0) / 1000).toFixed(0);
            status.textContent = t('{total} de {total} · {seg} s{falhou}', {
              total,
              seg,
              falhou: falhas ? ` · ${plural(falhas, '1 falhou', '{n} falharam')}` : ''
            });
          }
        },
        controller.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'err');
    } finally {
      clearInterval(relogio);
      stopBtn.hidden = true;
      controller = null;
    }
  };

  inner.querySelector('#c-replay').onclick = () => inner.querySelector('#c-go').click();
  stopBtn.onclick = () => controller?.abort();
  paintIcons(el);
};

// ---------------------------------------- peças do registro de pesquisa

/** Número que sobe em vez de trocar de valor (handoff: 400–900 ms, 1-(1-x)³). */
function subirNumero(el, ate, ms = 600) {
  if (!el) return;
  const de = Number(String(el.textContent).replace(/\D/g, '')) || 0;
  if (de === ate) return;
  const t0 = performance.now();
  const passo = (agora) => {
    // `avanco`, não `t`: `t` é a função de tradução importada no topo.
    const avanco = Math.min(1, (agora - t0) / ms);
    el.textContent = Math.round(de + (ate - de) * (1 - Math.pow(1 - avanco, 3)));
    if (avanco < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/** mm:ss desde o começo da pesquisa, que é o que vai no `.step-k`. */
function relogioMMSS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Só o domínio: é o que a sublinha do passo mostra. */
function dominio(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return String(url);
  }
}

/**
 * O modelo fecha o relatório com uma lista "Fontes" em markdown (é o que o
 * REPORT_PROMPT do server/research.mjs pede). A lista de verdade é montada a
 * partir de `sources`, com id pra âncora das citações; a do texto sai fora pra
 * não aparecer duas vezes.
 */
function semSecaoFontes(md) {
  const linhas = String(md || '').split('\n');
  const corte = linhas.findIndex((l) => /^\s*(?:#{1,6}\s*|\*{2})?fontes\b\s*:?\s*\*{0,2}\s*$/i.test(l));
  return (corte < 0 ? linhas : linhas.slice(0, corte)).join('\n').trimEnd();
}

/** O CSS novo só desenha `.relatorio h3`: o menor nível do texto vira h3. */
function nivelarTitulos(html) {
  const niveis = [...html.matchAll(/<h([1-6])>/g)].map((m) => Number(m[1]));
  if (!niveis.length) return html;
  const delta = 3 - Math.min(...niveis);
  if (!delta) return html;
  return html.replace(
    /<(\/?)h([1-6])>/g,
    (_, barra, n) => `<${barra}h${Math.min(6, Math.max(1, Number(n) + delta))}>`
  );
}

/** `[3]` no corpo do relatório vira `<sup><a href="#f3">3</a></sup>`. */
function marcarCitacoes(root) {
  if (!root) return;
  const anda = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (no) =>
      no.parentElement?.closest('a, code, pre, sup')
        ? NodeFilter.FILTER_REJECT
        : /\[\d{1,3}(?:\s*,\s*\d{1,3})*\]/.test(no.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
  });
  const alvos = [];
  while (anda.nextNode()) alvos.push(anda.currentNode);
  for (const no of alvos) {
    const pedaco = document.createDocumentFragment();
    let fim = 0;
    for (const m of no.nodeValue.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
      pedaco.append(no.nodeValue.slice(fim, m.index));
      for (const n of m[1].split(',')) {
        const sup = document.createElement('sup');
        const a = document.createElement('a');
        a.href = `#f${n.trim()}`;
        a.textContent = n.trim();
        sup.append(a);
        pedaco.append(sup);
      }
      fim = m.index + m[0].length;
    }
    pedaco.append(no.nodeValue.slice(fim));
    no.replaceWith(pedaco);
  }
}

// --------------------------------------------------------------- pesquisa

views.research = function renderResearch(el, { switchView }) {
  const inner = panel(
    el,
    t('Pesquisar na web'),
    'globe',
    t('A IA vai à web, lê as páginas e escreve um relatório com as fontes.'),
    `<div class="card plain">
       <label class="field">${t('O que você quer descobrir')}
         <textarea id="r-question" rows="2" placeholder="${t('Ex.: vale trocar um disco com setores realocados agora?')}"></textarea>
       </label>
       <div class="grid">
         <label class="field">${t('Qual IA responde')}
           <select id="r-model">${modelOptions(state.model)}</select>
         </label>
         <label class="field">${t('Quantas buscas')} <input id="r-breadth" type="number" min="1" max="8" value="4" /></label>
         <label class="field">${t('Páginas por busca')} <input id="r-depth" type="number" min="1" max="5" value="3" /></label>
       </div>
       <div class="row">
         <button id="r-go" class="primary" type="button"><span data-icon="search" data-size="18"></span> ${t('Pesquisar')}</button>
         <button id="r-stop" class="danger" type="button" hidden><span data-icon="stop" data-size="18"></span> ${t('Parar')}</button>
         <span id="r-status" class="meta" aria-live="polite"></span>
       </div>
       <div class="meta">${t('Não usa chave de API: a busca sai pelo DuckDuckGo.')}</div>
     </div>
     <div id="r-log"></div>
     <div id="r-report"></div>`
  );

  const log = inner.querySelector('#r-log');
  const report = inner.querySelector('#r-report');
  const status = inner.querySelector('#r-status');
  const stopBtn = inner.querySelector('#r-stop');
  let controller = null;
  let t0 = 0;
  let cronometro = 0;
  let buscas = 0;
  let lidas = 0;
  let guardadas = 0;
  let descartadas = 0;

  // Um passo do registro: o que estava correndo fica verde, o novo pulsa.
  const passo = (titulo, sub) => {
    const reg = inner.querySelector('#r-reg');
    if (!reg) return;
    for (const s of reg.querySelectorAll('.step.now')) s.className = 'step done';
    reg.insertAdjacentHTML(
      'beforeend',
      `<div class="step now"><span class="step-k">${relogioMMSS(Date.now() - t0)}</span>
         <span class="txt"><b>${escapeHtml(titulo)}</b><span class="sub">${escapeHtml(sub)}</span></span></div>`
    );
  };

  // Fim de corrida (relatório, erro ou parada): ninguém fica pulsando.
  const fecharPassos = () => {
    for (const s of log.querySelectorAll('.step.now')) s.className = 'step done';
    log.querySelector('#r-seg')?.classList.remove('live');
  };

  inner.querySelector('#r-go').onclick = async () => {
    const question = inner.querySelector('#r-question').value.trim();
    if (!question) return toast(t('escreva a pergunta'), 'err');

    report.innerHTML = '';
    buscas = lidas = guardadas = descartadas = 0;
    t0 = Date.now();
    log.innerHTML = `<div class="reg-topo">
        <div><span class="num live" id="r-seg">0</span><span class="rot">${t('segundos')}</span></div>
        <div><span class="num" id="r-buscas">0</span><span class="rot">${t('buscas')}</span></div>
        <div><span class="num" id="r-lidas">0</span><span class="rot">${t('páginas lidas')}</span></div>
        <div><span class="num" id="r-guardadas">0</span><span class="rot">${t('fontes guardadas')}</span></div>
      </div>
      <div class="reg" id="r-reg"></div>`;
    clearInterval(cronometro);
    cronometro = setInterval(() => {
      const seg = inner.querySelector('#r-seg');
      if (seg) seg.textContent = Math.floor((Date.now() - t0) / 1000);
    }, 250);
    controller = new AbortController();
    stopBtn.hidden = false;

    try {
      await stream(
        '/research',
        {
          question,
          model: inner.querySelector('#r-model').value,
          breadth: Number(inner.querySelector('#r-breadth').value),
          depth: Number(inner.querySelector('#r-depth').value)
        },
        (ev) => {
          if (ev.type === 'phase') {
            status.textContent = ev.text;
            if (ev.phase === 'busca') {
              buscas++;
              passo(t('Buscando'), ev.text.replace(/^buscando:\s*/i, ''));
              subirNumero(inner.querySelector('#r-buscas'), buscas);
            } else if (ev.phase === 'relatório') {
              passo(t('Escrevendo o relatório'), plural(guardadas, 'com 1 fonte', 'com {n} fontes'));
            }
            // 'plano' e 'leitura' não viram passo: quem conta a história são os
            // eventos `plan` e `read`, que já trazem o detalhe.
          } else if (ev.type === 'plan') {
            passo(t('Entendi a pergunta'), t('separei em {n} buscas', { n: ev.queries.length }));
          } else if (ev.type === 'read') {
            const onde = dominio(ev.url);
            if (ev.error) {
              descartadas++;
              passo(t('Descartei 1 página'), t('{onde} — não abriu: {erro}', { onde, erro: ev.error }));
            } else if (ev.chars <= 200) {
              // Mesmo corte que o servidor usa pra decidir o que vira fonte.
              descartadas++;
              passo(t('Descartei 1 página'), t('{onde} — veio quase vazia', { onde }));
            } else {
              guardadas++;
              passo(t('Lendo'), `${onde} — ${ev.title || t('sem título')}`);
              subirNumero(inner.querySelector('#r-guardadas'), guardadas);
            }
            lidas++;
            subirNumero(inner.querySelector('#r-lidas'), lidas);
          } else if (ev.type === 'note') {
            passo(t('Aviso'), ev.text);
          } else if (ev.type === 'report') {
            clearInterval(cronometro);
            fecharPassos();
            const seg = Math.floor((Date.now() - t0) / 1000);
            const reg = inner.querySelector('#r-reg');
            const passos = reg ? reg.querySelectorAll('.step').length : 0;
            const conta =
              `${plural(passos, '1 passo', '{n} passos')} · ${seg} s · ` +
              `${plural(guardadas, '1 fonte guardada', '{n} fontes guardadas')}, ` +
              `${plural(descartadas, '1 descartada', '{n} descartadas')}`;
            reg?.remove();
            log.innerHTML = `<details class="reg-fechado">
                <summary>${icon('chevron', 16)} ${t('o passo a passo')} · ${conta}</summary>
              </details>`;
            if (reg) log.querySelector('details').append(reg);

            report.innerHTML = `<div class="relatorio">
                ${nivelarTitulos(renderMarkdown(semSecaoFontes(ev.text)))}
                <ol class="fontes">${(ev.sources || [])
                  .map(
                    (f) => `<li id="f${f.n}"><span class="n">${f.n}</span>
                      <span><a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                        f.title || dominio(f.url)
                      )}</a><br /><span class="url">${escapeHtml(
                        String(f.url).replace(/^https?:\/\//, '')
                      )}</span></span></li>`
                  )
                  .join('')}</ol>
                <div class="row">
                  <button id="r-copy" class="ghost" type="button"><span data-icon="copy" data-size="17"></span> ${t('Copiar')}</button>
                  <button id="r-continuar" class="ghost" type="button"><span data-icon="chat" data-size="17"></span> ${t('Continuar conversando')}</button>
                  <button id="r-guardar" class="ghost" type="button"><span data-icon="brain" data-size="17"></span> ${t('Guardar na memória')}</button>
                </div>
              </div>`;
            marcarCitacoes(report.querySelector('.relatorio'));
            wireCodeCopy(report);
            paintIcons(report);
            report.querySelector('#r-copy').onclick = () => {
              navigator.clipboard.writeText(ev.text);
              toast(t('relatório copiado'), 'ok');
            };
            report.querySelector('#r-continuar').onclick = () => {
              switchView('chat');
              const campo = document.querySelector('#input');
              if (!campo) return;
              campo.value = `${t('Sobre a pesquisa "{pergunta}":', { pergunta: question })}\n\n`;
              campo.dispatchEvent(new Event('input'));
              campo.focus();
            };
            report.querySelector('#r-guardar').onclick = async () => {
              const resumo = String(ev.text).replace(/\s+/g, ' ').trim().slice(0, 400);
              await api('/memories', {
                method: 'POST',
                body: {
                  text: t('Pesquisa "{pergunta}": {resumo}', { pergunta: question, resumo }),
                  pinned: false
                }
              });
              toast(t('guardado na memória'), 'ok');
            };
            status.textContent = t('pronto');
          } else if (ev.type === 'error') {
            clearInterval(cronometro);
            fecharPassos();
            report.innerHTML = `<div class="aviso err">
                <div><b>${t('Não deu pra escrever o relatório.')}</b> ${escapeHtml(ev.message)}</div>
                <button id="r-de-novo" class="ghost" type="button">${t('Tentar de novo')}</button>
              </div>`;
            report.querySelector('#r-de-novo').onclick = () => inner.querySelector('#r-go').click();
            status.textContent = ev.message;
          }
        },
        controller.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'err');
    } finally {
      clearInterval(cronometro);
      fecharPassos();
      stopBtn.hidden = true;
      controller = null;
    }
  };

  stopBtn.onclick = () => controller?.abort();
  paintIcons(el);
};

// ------------------------------------------------------------------- loja

views.loja = viewLoja;
