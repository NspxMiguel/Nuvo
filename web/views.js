// Painéis: provedores, gems, projetos, memória, config, conselho e pesquisa.

import {
  $, api, stream, state, refreshState, chatModels, embeddingModels, modelOptions,
  escapeHtml, badge, toast, iconPicker, paintIcons, TOKEN
} from './core.js';
import { icon } from './icons.js';
import { renderMarkdown, wireCodeCopy } from './md.js';

/** Cada painel se redesenha inteiro; o estado real está no servidor. */
export const views = {};

function panel(el, title, iconName, hint, inner) {
  el.className = 'view panel';
  el.innerHTML = `<div class="panel-inner">
      <h2>${icon(iconName, 19)} ${escapeHtml(title)}</h2>
      <p class="hint">${hint}</p>
      ${inner}
    </div>`;
  return el.querySelector('.panel-inner');
}

// ------------------------------------------------------------- provedores

views.providers = async function renderProviders(el, { switchView }) {
  const presets = await api('/presets');
  const inner = panel(
    el,
    'Provedores',
    'plug',
    'IA local, de API e de linha de comando — tudo no mesmo seletor de modelo.',
    `<div class="row" style="margin-bottom:12px">
       <button id="btn-discover"><span data-icon="search"></span> Procurar IA local nesta máquina</button>
       <button id="btn-health"><span data-icon="activity"></span> Testar todos</button>
       <span id="health-status" class="meta"></span>
     </div>
     <div id="providers-cards"></div>
     <div class="card">
       <h3>${icon('plus', 16)} Adicionar provedor</h3>
       <label class="field">Preset
         <select id="new-preset">
           <option value="">— personalizado —</option>
           ${presets.map((p) => `<option value="${p.key}">${escapeHtml(p.name)}</option>`).join('')}
         </select>
       </label>
       <div class="grid">
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
       </div>
       <label class="field">Endereço base <input id="new-url" placeholder="http://127.0.0.1:1234/v1" /></label>
       <div class="grid">
         <label class="field">Nome da chave <input id="new-secret" placeholder="OPENAI_API_KEY" /></label>
         <label class="field">Chave (fica só no servidor) <input id="new-value" type="password" /></label>
       </div>
       <label class="field">Config do CLI (JSON)
         <textarea id="new-config" rows="2" placeholder='{"command":"claude","args":["-p"],"stdin":true,"models":["default"]}'></textarea>
       </label>
       <button id="btn-add-provider" class="primary"><span data-icon="plus"></span> Adicionar</button>
     </div>`
  );

  const cards = inner.querySelector('#providers-cards');
  for (const p of state.providers) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${badge('plug', p.enabled ? 'indigo' : 'slate', 16)} ${escapeHtml(p.name)}
        <span class="tag">${p.kind}</span>
        ${p.auto ? '<span class="tag">encontrado sozinho</span>' : ''}
        ${p.secret_name ? `<span class="tag ${p.has_secret ? 'on' : 'off'}">${p.has_secret ? 'com chave' : 'sem chave'}</span>` : ''}
        ${p.enabled ? '' : '<span class="tag off">desligado</span>'}
      </h3>
      <div class="meta">${escapeHtml(p.base_url || p.config.command || '')} · ${p.models.length} modelo(s)</div>
      <div class="health" id="health-${p.id}"></div>
      ${p.manageable ? '<div id="ollama-' + p.id + '"></div>' : ''}
      <div class="row">
        <button data-act="refresh"><span data-icon="refresh"></span> Atualizar modelos</button>
        <button data-act="key"><span data-icon="key"></span> Trocar chave</button>
        <button data-act="toggle">${p.enabled ? 'Desligar' : 'Ligar'}</button>
        ${p.manageable ? '<button data-act="manage"><span data-icon="download"></span> Modelos</button>' : ''}
        <button data-act="del" class="danger"><span data-icon="trash"></span> Remover</button>
      </div>`;

    const reload = async () => {
      await refreshState();
      switchView('providers');
    };

    card.querySelector('[data-act=refresh]').onclick = async () => {
      try {
        await api(`/providers/${p.id}/refresh`, { method: 'POST' });
        toast(`${p.name}: catálogo atualizado`, 'ok');
        await reload();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    card.querySelector('[data-act=key]').onclick = async () => {
      const name = p.secret_name || prompt('Nome da variável da chave:', 'API_KEY');
      if (!name) return;
      const value = prompt(`Valor de ${name}:`);
      if (value === null) return;
      await api(`/providers/${p.id}`, {
        method: 'PATCH',
        body: { secretName: name, secretValue: value }
      });
      toast('chave guardada no servidor', 'ok');
      await reload();
    };
    card.querySelector('[data-act=toggle]').onclick = async () => {
      await api(`/providers/${p.id}`, { method: 'PATCH', body: { enabled: !p.enabled } });
      await reload();
    };
    card.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`Remover ${p.name}?`)) return;
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
    btn.textContent = 'procurando...';
    try {
      const { found } = await api('/discover', { method: 'POST' });
      toast(found.length ? `encontrado: ${found.map((f) => f.name).join(', ')}` : 'nada novo encontrado');
      await refreshState();
      switchView('providers');
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  };

  // Saúde: fala com cada provedor de verdade e escreve o resultado no cartão
  // dele. É a resposta pra "por que não vem resposta?" sem ter que adivinhar.
  inner.querySelector('#btn-health').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const status = inner.querySelector('#health-status');
    btn.disabled = true;
    status.textContent = 'testando...';
    try {
      const results = await api('/health');
      for (const r of results) {
        const alvo = inner.querySelector(`#health-${r.id}`);
        if (!alvo) continue;
        const rotulo =
          r.status === 'ok'
            ? `respondeu em ${r.ms} ms · ${r.models} modelo(s)`
            : r.status === 'off'
              ? r.message
              : r.message;
        alvo.className = `health ${r.status}`;
        alvo.innerHTML = `${icon(r.status === 'ok' ? 'check' : 'alert', 14)} ${escapeHtml(rotulo)}`;
      }
      const ruins = results.filter((r) => r.status === 'erro').length;
      status.textContent = ruins ? `${ruins} com problema` : 'todos responderam';
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
        return toast('config do CLI não é JSON válido', 'err');
      }
    }
    try {
      const out = await api('/providers', {
        method: 'POST',
        body: {
          name: inner.querySelector('#new-name').value || 'Provedor',
          kind: inner.querySelector('#new-kind').value,
          baseUrl: inner.querySelector('#new-url').value || null,
          secretName: inner.querySelector('#new-secret').value || null,
          secretValue: inner.querySelector('#new-value').value || null,
          config
        }
      });
      await refreshState();
      switchView('providers');
      if (out.error) toast(`provedor criado, mas não listou modelos: ${out.error}`, 'err');
      else toast('provedor adicionado', 'ok');
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
    <div class="card" style="margin-top:10px;background:var(--panel-2)">
      <h3>${icon('download', 15)} Modelos do Ollama</h3>
      <div class="row">
        <input id="pull-name" placeholder="ex.: llama3.2, qwen2.5:7b, nomic-embed-text" style="flex:1;min-width:200px" />
        <button id="pull-go" class="primary">Baixar</button>
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
            `<div class="mem-item"><div class="txt">${escapeHtml(m.label)}<div class="src">${m.kind}</div></div>
             <button class="icon" data-del="${escapeHtml(m.model_id)}" title="apagar">${icon('trash', 15)}</button></div>`
        )
        .join('')
    : '<div class="meta">nenhum modelo baixado ainda</div>';

  for (const btn of installed.querySelectorAll('[data-del]')) {
    btn.onclick = async () => {
      const model = btn.dataset.del;
      if (!confirm(`Apagar ${model} do disco?`)) return;
      try {
        await api(`/providers/${provider.id}/models/${encodeURIComponent(model)}`, { method: 'DELETE' });
        toast(`${model} apagado`, 'ok');
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
    status.textContent = 'começando...';
    try {
      await stream(`/providers/${provider.id}/pull`, { model }, (ev) => {
        if (ev.type === 'progress') {
          status.textContent = ev.percent != null ? `${ev.status} — ${ev.percent}%` : ev.status;
          fill.style.width = `${ev.percent || 0}%`;
        } else if (ev.type === 'error') {
          status.textContent = `falhou: ${ev.message}`;
        } else if (ev.type === 'done') {
          status.textContent = 'pronto';
          fill.style.width = '100%';
        }
      });
      toast(`${model} baixado`, 'ok');
      await reload();
    } catch (err) {
      status.textContent = `falhou: ${err.message}`;
    }
  };
}

// -------------------------------------------------------------------- gems

views.gems = function renderGems(el, { switchView, startChatWithGem }) {
  const inner = panel(
    el,
    'Gems',
    'sparkle',
    'Personalidade, modelo preferido e escopo de memória. "Sem filtro" vale de verdade em modelo local; em API hospedada o provedor aplica a política dele.',
    `<div id="gems-cards"></div>
     <div class="card">
       <h3>${icon('plus', 16)} Nova gem</h3>
       <label class="field">Nome <input id="g-name" placeholder="Revisor de contrato" /></label>
       <label class="field">Ícone e cor<div id="g-picker"></div></label>
       <label class="field">Instruções <textarea id="g-prompt" rows="4" placeholder="Como essa IA deve se comportar"></textarea></label>
       <div class="grid">
         <label class="field">Modo
           <select id="g-mode"><option value="chat">conversa</option><option value="coding">coding</option></select>
         </label>
         <label class="field">Modelo preferido
           <select id="g-model"><option value="">— o que estiver selecionado —</option>${modelOptions()}</select>
         </label>
         <label class="field">Temperatura <input id="g-temp" type="number" step="0.1" min="0" max="2" /></label>
       </div>
       <label class="check"><input type="checkbox" id="g-unfiltered" /> sem filtro</label>
       <button id="btn-add-gem" class="primary"><span data-icon="plus"></span> Criar</button>
     </div>`
  );

  const cards = inner.querySelector('#gems-cards');
  for (const g of state.gems) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${badge(g.icon, g.color, 17)} ${escapeHtml(g.name)}
        <span class="tag">${g.mode}</span>
        ${g.unfiltered ? '<span class="tag off">sem filtro</span>' : ''}
        <span class="tag ${g.memory_read ? 'on' : ''}">${g.memory_read ? 'lê memória' : 'não lê'}</span>
        <span class="tag ${g.memory_write ? 'on' : ''}">${g.memory_write ? 'grava memória' : 'não grava'}</span>
      </h3>
      <div class="meta">${escapeHtml((g.system_prompt || '').slice(0, 240))}</div>
      <div class="row">
        <button data-act="use"><span data-icon="chat"></span> Conversar</button>
        <button data-act="edit"><span data-icon="edit"></span> Editar</button>
        <button data-act="mem"><span data-icon="brain"></span> Alternar memória</button>
        <button data-act="del" class="danger"><span data-icon="trash"></span></button>
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
      if (!confirm(`Remover ${g.name}?`)) return;
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
        name: inner.querySelector('#g-name').value || 'Nova gem',
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
    toast('gem criada', 'ok');
  };

  paintIcons(el);
};

function editGem(card, gem, switchView) {
  const form = document.createElement('div');
  form.style.marginTop = '10px';
  form.innerHTML = `
    <label class="field">Nome <input class="e-name" value="${escapeHtml(gem.name)}" /></label>
    <label class="field">Ícone e cor<div class="e-picker"></div></label>
    <label class="field">Instruções <textarea class="e-prompt" rows="5">${escapeHtml(gem.system_prompt || '')}</textarea></label>
    <div class="grid">
      <label class="field">Modo
        <select class="e-mode">
          <option value="chat"${gem.mode === 'chat' ? ' selected' : ''}>conversa</option>
          <option value="coding"${gem.mode === 'coding' ? ' selected' : ''}>coding</option>
        </select>
      </label>
      <label class="field">Modelo preferido
        <select class="e-model"><option value="">— nenhum —</option>${modelOptions(gem.model)}</select>
      </label>
      <label class="field">Temperatura
        <input class="e-temp" type="number" step="0.1" min="0" max="2" value="${gem.temperature ?? ''}" />
      </label>
    </div>
    <label class="check"><input type="checkbox" class="e-unf" ${gem.unfiltered ? 'checked' : ''} /> sem filtro</label>
    <div class="row"><button class="primary e-save">Salvar</button><button class="e-cancel ghost">Cancelar</button></div>`;
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
    toast('gem salva', 'ok');
  };
}

// ---------------------------------------------------------------- projetos

views.projects = function renderProjects(el, { switchView, startChatInProject }) {
  const inner = panel(
    el,
    'Projetos',
    'folder',
    'Agrupa conversas, tem instrução própria, memória de escopo próprio e anexos que valem em toda conversa do projeto. O diretório é usado pelas IAs de CLI no modo coding.',
    `<div id="proj-cards"></div>
     <div class="card">
       <h3>${icon('plus', 16)} Novo projeto</h3>
       <label class="field">Nome <input id="p-name" /></label>
       <label class="field">Ícone e cor<div id="p-picker"></div></label>
       <label class="field">Instruções <textarea id="p-inst" rows="3"></textarea></label>
       <label class="field">Diretório <input id="p-dir" placeholder="/Users/você/Projetos/algo" /></label>
       <button id="btn-add-proj" class="primary"><span data-icon="plus"></span> Criar</button>
     </div>`
  );

  const cards = inner.querySelector('#proj-cards');
  for (const p of state.projects) {
    const chats = state.chats.filter((c) => c.project_id === p.id).length;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${badge(p.icon, p.color, 17)} ${escapeHtml(p.name)}</h3>
      <div class="meta">${chats} conversa(s) · ${escapeHtml(p.workdir || 'sem diretório')}</div>
      <div class="meta">${escapeHtml((p.instructions || '').slice(0, 220))}</div>
      <div id="files-${p.id}"></div>
      <div class="row">
        <button data-act="use"><span data-icon="chat"></span> Conversar</button>
        <button data-act="files"><span data-icon="paperclip"></span> Arquivos</button>
        <button data-act="del" class="danger"><span data-icon="trash"></span></button>
      </div>`;

    card.querySelector('[data-act=use]').onclick = () => startChatInProject(p);
    card.querySelector('[data-act=files]').onclick = () =>
      renderProjectFiles(card.querySelector(`#files-${p.id}`), p);
    card.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`Remover ${p.name}?`)) return;
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
        name: inner.querySelector('#p-name').value || 'Novo projeto',
        icon: picker.icon,
        color: picker.color,
        instructions: inner.querySelector('#p-inst').value,
        workdir: inner.querySelector('#p-dir').value || null
      }
    });
    await refreshState();
    switchView('projects');
    toast('projeto criado', 'ok');
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
    <div class="card" style="margin-top:10px;background:var(--panel-2)">
      <div class="meta">Arquivo do projeto entra em toda conversa dele.</div>
      <div class="row"><input type="file" class="p-file" multiple /></div>
      <div class="p-list" style="margin-top:8px"></div>
    </div>`;

  const list = host.querySelector('.p-list');
  const draw = (rows) => {
    list.innerHTML = rows.length
      ? rows
          .map(
            (f) =>
              `<div class="mem-item"><div class="txt">${escapeHtml(f.name)}
                 <div class="src">${f.chunks} trecho(s) · ${Math.round(f.bytes / 1024)} KB${
                   f.note ? ` · ${escapeHtml(f.note)}` : ''
                 }</div></div>
               <button class="icon" data-del="${f.id}">${icon('trash', 15)}</button></div>`
          )
          .join('')
      : '<div class="meta">nenhum arquivo</div>';
    for (const btn of list.querySelectorAll('[data-del]')) {
      btn.onclick = async () => {
        await api(`/attachments/${btn.dataset.del}`, { method: 'DELETE' });
        draw(await api(`/attachments?project=${project.id}`));
      };
    }
  };
  draw(files);

  host.querySelector('.p-file').onchange = async (ev) => {
    for (const file of ev.target.files) {
      try {
        await api(`/attachments?project=${project.id}&name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: await file.arrayBuffer(),
          raw: true
        });
        toast(`${file.name} indexado`, 'ok');
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'err');
      }
    }
    draw(await api(`/attachments?project=${project.id}`));
  };
}

// ---------------------------------------------------------------- memória

views.memory = async function renderMemory(el, { switchView }) {
  const memories = await api('/memories');
  const inner = panel(
    el,
    'Memória compartilhada',
    'brain',
    'Um banco só, lido e escrito por qualquer modelo. O que você contou pro Claude, o GPT lembra.',
    `<div class="card">
       <label class="field">Novo fato <input id="m-text" placeholder="Ex.: prefere respostas curtas e sem enrolação" /></label>
       <div class="row">
         <button id="btn-add-mem" class="primary"><span data-icon="plus"></span> Guardar</button>
         <label class="check"><input type="checkbox" id="m-pin" /> fixar</label>
       </div>
     </div>
     <div class="card">
       <h3>${icon('download', 15)} Importar de outra IA</h3>
       <div class="meta">Export do ChatGPT ou do Claude (conversations.json), ou texto solto.</div>
       <div class="row"><input type="file" id="m-file" accept=".json,.md,.txt" /></div>
       <div id="import-status" class="meta"></div>
     </div>
     <div class="card">
       <h3>${memories.length} fato(s)</h3>
       <div id="mem-list"></div>
     </div>`
  );

  const list = inner.querySelector('#mem-list');
  for (const m of memories) {
    const item = document.createElement('div');
    item.className = 'mem-item';
    item.innerHTML = `
      <div class="txt">${escapeHtml(m.text)}
        <div class="src">${m.source}${m.source_ref ? ' · ' + escapeHtml(m.source_ref) : ''} · usado ${m.use_count}x</div>
      </div>`;
    const pin = document.createElement('button');
    pin.className = `icon${m.pinned ? ' toggle on' : ''}`;
    pin.innerHTML = icon('pin', 15);
    pin.title = m.pinned ? 'desfixar' : 'fixar';
    pin.onclick = async () => {
      await api(`/memories/${m.id}`, { method: 'PATCH', body: { pinned: !m.pinned } });
      switchView('memory');
    };
    const del = document.createElement('button');
    del.className = 'icon';
    del.innerHTML = icon('trash', 15);
    del.onclick = async () => {
      await api(`/memories/${m.id}`, { method: 'DELETE' });
      switchView('memory');
    };
    item.append(pin, del);
    list.appendChild(item);
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
    status.textContent = 'lendo e extraindo... export grande demora.';
    try {
      const text = await file.text();
      const out = await api(`/memories/import?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: text,
        raw: true
      });
      toast(`${out.facts.length} fato(s) novo(s) de ${out.conversations} conversa(s)`, 'ok');
      switchView('memory');
    } catch (err) {
      status.textContent = `falhou: ${err.message}`;
    }
  };

  paintIcons(el);
};

// ----------------------------------------------------------------- config

views.settings = async function renderSettings(el, { switchView, applyTheme }) {
  const settings = await api('/settings');
  const inner = panel(
    el,
    'Configuração',
    'settings',
    'Tudo fica em ~/.iaunifier. As chaves nunca saem do servidor.',
    `<div class="card">
       <h3>${icon('brain', 15)} Memória</h3>
       <label class="check"><input type="checkbox" id="s-enabled" ${settings.memory.enabled ? 'checked' : ''} /> memória ligada</label>
       <label class="check"><input type="checkbox" id="s-auto" ${settings.memory.autoExtract ? 'checked' : ''} /> aprender sozinho depois de cada resposta</label>
       <div class="grid">
         <label class="field">Fatos injetados por vez
           <input id="s-max" type="number" min="1" max="50" value="${settings.memory.maxInjected}" />
         </label>
         <label class="field">Nota mínima pra entrar
           <input id="s-min" type="number" step="0.01" min="0" max="1" value="${settings.memory.minScore}" />
         </label>
       </div>
       <label class="field">Modelo que extrai os fatos
         <select id="s-extractor">
           <option value="">— heurística local, sem chamar modelo —</option>
           ${chatModels()
             .map(
               (m) =>
                 `<option value="${escapeHtml(m.ref)}"${
                   settings.memory.extractorModel === m.ref ? ' selected' : ''
                 }>${escapeHtml(m.label)}</option>`
             )
             .join('')}
         </select>
       </label>
       <label class="field">Modelo de embedding (busca semântica e RAG)
         <select id="s-embed">
           <option value="">— sem embedding, só busca por palavra —</option>
           ${embeddingModels()
             .map(
               (m) =>
                 `<option value="${escapeHtml(m.ref)}"${
                   settings.memory.embeddingModel === m.ref ? ' selected' : ''
                 }>${escapeHtml(m.label)}</option>`
             )
             .join('')}
         </select>
       </label>
       <button id="btn-save-settings" class="primary"><span data-icon="check"></span> Salvar</button>
     </div>
     <div class="card">
       <h3>${icon('sun', 15)} Aparência</h3>
       <div class="row">
         <button data-theme="dark">${icon('moon', 15)} Escuro</button>
         <button data-theme="light">${icon('sun', 15)} Claro</button>
       </div>
     </div>
     <div class="card">
       <h3>${icon('key', 15)} Acesso</h3>
       <div class="meta">Token exigido: ${settings.requireToken ? 'sim' : 'não'} · escutando em ${settings.host}:${settings.port}</div>
       <div class="meta">Chaves guardadas: ${settings.secrets.join(', ') || 'nenhuma'}</div>
       <div class="meta">Busca semântica: ${settings.embeddingAvailable ? 'ligada' : 'desligada (só busca por palavra)'}</div>
     </div>
     <div class="card">
       <h3>${icon('save', 15)} Backup</h3>
       <div class="meta">Um zip com o banco inteiro — conversas, memória, gems, projetos — mais a configuração e os arquivos anexados.</div>
       <div class="row" style="margin-top:8px">
         <button id="btn-backup"><span data-icon="download"></span> Baixar cópia agora</button>
         <button id="btn-restore"><span data-icon="upload"></span> Restaurar de um arquivo</button>
         <input id="restore-file" type="file" accept=".zip" hidden />
       </div>
       <div id="backup-list" class="meta" style="margin-top:8px">carregando cópias automáticas…</div>
     </div>
     <div class="card">
       <h3>${icon('command', 15)} Atalhos</h3>
       <div class="meta">Ctrl/Cmd + K — paleta de comandos</div>
       <div class="meta">Ctrl/Cmd + Enter — enviar mesmo com quebra de linha</div>
       <div class="meta">Ctrl/Cmd + Shift + N — nova conversa</div>
       <div class="meta">Esc — fechar paleta ou parar a resposta</div>
     </div>`
  );

  inner.querySelector('#btn-save-settings').onclick = async () => {
    await api('/settings', {
      method: 'PATCH',
      body: {
        memory: {
          enabled: inner.querySelector('#s-enabled').checked,
          autoExtract: inner.querySelector('#s-auto').checked,
          maxInjected: Number(inner.querySelector('#s-max').value) || 12,
          minScore: Number(inner.querySelector('#s-min').value) || 0.12,
          extractorModel: inner.querySelector('#s-extractor').value || null,
          embeddingModel: inner.querySelector('#s-embed').value || null
        }
      }
    });
    toast('configuração salva', 'ok');
    switchView('settings');
  };

  for (const btn of inner.querySelectorAll('[data-theme]')) {
    btn.onclick = () => applyTheme(btn.dataset.theme);
  }

  // --- backup ---------------------------------------------------------------

  inner.querySelector('#btn-backup').onclick = () => {
    // Download é o navegador que faz: a rota já manda o content-disposition.
    const link = document.createElement('a');
    link.href = `/api/backup?token=${encodeURIComponent(TOKEN)}`;
    link.click();
    toast('a cópia está sendo gerada e vai baixar em instantes');
  };

  const fileInput = inner.querySelector('#restore-file');
  inner.querySelector('#btn-restore').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!confirm(`Restaurar de "${file.name}"?\n\nO que está aqui agora é substituído. O banco atual fica guardado como cópia antes de trocar.`)) {
      fileInput.value = '';
      return;
    }
    try {
      const done = await api('/restore', { method: 'POST', raw: true, body: await file.arrayBuffer() });
      toast(done.message, 'ok');
      alert(`Restaurado: banco${done.config ? ', configuração' : ''}, ${done.uploads} anexo(s).\n\nReinicie o servidor pra carregar os dados.`);
    } catch (err) {
      toast(err.message, 'err');
    }
    fileInput.value = '';
  };

  api('/backups')
    .then((lista) => {
      const alvo = inner.querySelector('#backup-list');
      if (!lista.length) {
        alvo.textContent = 'A cópia automática é feita uma vez por dia, quando o servidor sobe.';
        return;
      }
      const tamanho = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`);
      alvo.innerHTML = `Cópias automáticas (as sete últimas):<br>${lista
        .map((b) => `${escapeHtml(b.at.replace('T', ' ').slice(0, 16))} — ${tamanho(b.bytes)}`)
        .join('<br>')}`;
    })
    .catch(() => {
      inner.querySelector('#backup-list').textContent = 'não consegui listar as cópias automáticas';
    });

  paintIcons(el);
};

// --------------------------------------------------------------- conselho

views.council = function renderCouncil(el) {
  const models = chatModels();
  const saved = JSON.parse(localStorage.getItem('iaunifier.council') || '[]');

  const inner = panel(
    el,
    'Conselho de IAs',
    'users',
    'O mesmo prompt em vários modelos ao mesmo tempo. Compare lado a lado, peça uma síntese, ou deixe que eles se avaliem sem saber de quem é cada resposta.',
    models.length < 2
      ? '<div class="card">Você precisa de pelo menos dois modelos. Cadastre outro provedor.</div>'
      : `<div class="card">
           <label class="field">Pergunta
             <textarea id="c-prompt" rows="3" placeholder="O que você quer perguntar pra todos eles"></textarea>
           </label>
           <label class="field">Modelos do conselho
             <div id="c-models" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"></div>
           </label>
           <div class="grid">
             <label class="field">Modo
               <select id="c-mode">
                 <option value="council">conselho — respostas + síntese</option>
                 <option value="compare">comparar — só as respostas</option>
                 <option value="vote">votação cega — eles se avaliam</option>
               </select>
             </label>
             <label class="field">Quem sintetiza
               <select id="c-judge"><option value="">— o primeiro escolhido —</option>${modelOptions()}</select>
             </label>
           </div>
           <div class="row">
             <button id="c-go" class="primary"><span data-icon="play"></span> Convocar</button>
             <button id="c-stop" class="danger" hidden><span data-icon="stop"></span> Parar</button>
             <span id="c-status" class="meta"></span>
           </div>
         </div>
         <div id="c-out"></div>`
  );

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

  const out = inner.querySelector('#c-out');
  const status = inner.querySelector('#c-status');
  const stopBtn = inner.querySelector('#c-stop');
  let controller = null;

  inner.querySelector('#c-go').onclick = async () => {
    const chosen = [...picker.querySelectorAll('input:checked')].map((i) => i.value);
    if (chosen.length < 2) return toast('escolha pelo menos dois modelos', 'err');
    localStorage.setItem('iaunifier.council', JSON.stringify(chosen));

    const promptText = inner.querySelector('#c-prompt').value.trim();
    if (!promptText) return toast('escreva a pergunta', 'err');

    out.innerHTML = '<div class="council-grid" id="c-grid"></div>';
    const grid = out.querySelector('#c-grid');
    const cols = new Map();
    controller = new AbortController();
    stopBtn.hidden = false;
    status.textContent = 'perguntando pra todos...';

    try {
      await stream(
        '/council',
        {
          prompt: promptText,
          models: chosen,
          mode: inner.querySelector('#c-mode').value,
          judge: inner.querySelector('#c-judge').value || null
        },
        (ev) => {
          if (ev.type === 'start') {
            for (const m of ev.models) {
              const col = document.createElement('div');
              col.className = 'council-col';
              col.innerHTML = `<h4>${icon('bot', 14)} ${escapeHtml(m.label)}</h4><div class="body meta">pensando...</div>`;
              grid.appendChild(col);
              cols.set(m.ref, col);
            }
          } else if (ev.type === 'answer') {
            const col = cols.get(ev.ref);
            if (!col) return;
            col.querySelector('.body').innerHTML = ev.error
              ? `<span style="color:var(--danger)">${escapeHtml(ev.error)}</span>`
              : renderMarkdown(ev.text);
            col.querySelector('h4').insertAdjacentHTML(
              'beforeend',
              `<span class="tag" style="margin-left:auto">${(ev.ms / 1000).toFixed(1)}s</span>`
            );
            wireCodeCopy(col);
          } else if (ev.type === 'phase') {
            status.textContent = ev.text;
          } else if (ev.type === 'synthesis') {
            out.insertAdjacentHTML(
              'afterbegin',
              `<div class="card" style="border-color:var(--ok)">
                 <h3>${icon('check', 15)} Resposta do conselho
                   <span class="tag">${escapeHtml(ev.label)}</span></h3>
                 <div class="body">${renderMarkdown(ev.text)}</div>
               </div>`
            );
            wireCodeCopy(out);
            status.textContent = 'pronto';
          } else if (ev.type === 'votes') {
            const table = ev.ranked
              .map(
                (r) =>
                  `<tr><td>${escapeHtml(r.label)}</td><td class="score">${
                    r.average == null ? '—' : r.average.toFixed(2)
                  }</td><td class="meta">${r.votes
                    .map((v) => `${escapeHtml(v.from)}: ${v.nota}`)
                    .join(' · ')}</td></tr>`
              )
              .join('');
            out.insertAdjacentHTML(
              'afterbegin',
              `<div class="card"><h3>${icon('users', 15)} Notas</h3>
                 <div class="table-wrap"><table><thead><tr><th>Modelo</th><th>Média</th><th>Votos</th></tr></thead>
                 <tbody>${table}</tbody></table></div></div>`
            );
            for (const [ref, col] of cols) {
              if (ev.ranked[0]?.ref === ref) col.classList.add('win');
            }
            status.textContent = 'pronto';
          } else if (ev.type === 'error') {
            toast(ev.message, 'err');
            status.textContent = ev.message;
          } else if (ev.type === 'done') {
            status.textContent = 'pronto';
          }
        },
        controller.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'err');
    } finally {
      stopBtn.hidden = true;
      controller = null;
    }
  };

  stopBtn.onclick = () => controller?.abort();
  paintIcons(el);
};

// --------------------------------------------------------------- pesquisa

views.research = function renderResearch(el) {
  const inner = panel(
    el,
    'Pesquisa profunda',
    'globe',
    'Várias buscas, leitura das páginas e um relatório com as fontes numeradas. Não usa chave de API: a busca sai pelo DuckDuckGo.',
    `<div class="card">
       <label class="field">Pergunta
         <textarea id="r-question" rows="2" placeholder="O que você quer descobrir"></textarea>
       </label>
       <div class="grid">
         <label class="field">Modelo
           <select id="r-model">${modelOptions(state.model)}</select>
         </label>
         <label class="field">Consultas <input id="r-breadth" type="number" min="1" max="8" value="4" /></label>
         <label class="field">Páginas por consulta <input id="r-depth" type="number" min="1" max="5" value="3" /></label>
       </div>
       <div class="row">
         <button id="r-go" class="primary"><span data-icon="search"></span> Pesquisar</button>
         <button id="r-stop" class="danger" hidden><span data-icon="stop"></span> Parar</button>
         <span id="r-status" class="meta"></span>
       </div>
     </div>
     <div id="r-log"></div>
     <div id="r-report"></div>`
  );

  const log = inner.querySelector('#r-log');
  const report = inner.querySelector('#r-report');
  const status = inner.querySelector('#r-status');
  const stopBtn = inner.querySelector('#r-stop');
  let controller = null;

  const line = (html, cls = '') => {
    log.insertAdjacentHTML('beforeend', `<div class="result ${cls}">${html}</div>`);
    log.scrollTop = log.scrollHeight;
  };

  inner.querySelector('#r-go').onclick = async () => {
    const question = inner.querySelector('#r-question').value.trim();
    if (!question) return toast('escreva a pergunta', 'err');

    log.innerHTML = '';
    report.innerHTML = '';
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
          } else if (ev.type === 'plan') {
            line(
              `<div class="title">${icon('search', 13)} Consultas planejadas</div>` +
                ev.queries.map((q) => `<div class="meta">• ${escapeHtml(q)}</div>`).join('')
            );
          } else if (ev.type === 'hits') {
            line(`<div class="meta">${ev.hits.length} resultado(s) distintos</div>`);
          } else if (ev.type === 'read') {
            line(
              `<div class="title">${escapeHtml(ev.title)}</div>
               <div class="url">${escapeHtml(ev.url)}</div>
               <div class="meta">${ev.error ? 'não abriu: ' + escapeHtml(ev.error) : ev.chars + ' caracteres'}</div>`
            );
          } else if (ev.type === 'note') {
            line(`<div class="meta">${escapeHtml(ev.text)}</div>`);
          } else if (ev.type === 'report') {
            report.innerHTML = `<div class="card">
                <h3>${icon('book', 15)} Relatório <span class="tag">${(ev.ms / 1000).toFixed(1)}s</span></h3>
                <div class="msg"><div class="body">${renderMarkdown(ev.text)}</div></div>
                <div class="row">
                  <button id="r-copy"><span data-icon="copy"></span> Copiar</button>
                </div>
              </div>`;
            wireCodeCopy(report);
            paintIcons(report);
            report.querySelector('#r-copy').onclick = () => {
              navigator.clipboard.writeText(ev.text);
              toast('relatório copiado', 'ok');
            };
            status.textContent = 'pronto';
          } else if (ev.type === 'error') {
            toast(ev.message, 'err');
            status.textContent = ev.message;
          }
        },
        controller.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'err');
    } finally {
      stopBtn.hidden = true;
      controller = null;
    }
  };

  stopBtn.onclick = () => controller?.abort();
  paintIcons(el);
};
