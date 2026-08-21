// Rotas da API. Tudo JSON, menos os streams (chat, pesquisa, conselho e
// download de modelo), que são SSE.

import { all, one, run, uid, now, parseJSON } from './db.mjs';
import { loadConfig, patchConfig, setSecret, listSecretNames } from './config.mjs';
import { escolherIdioma, IDIOMAS } from './idioma.mjs';
import { estadoDoOllama, ligarOllama, instalarOllama, receitaManual } from './instalar.mjs';
import { catalogoEmCache, medirModelo } from './catalogo-hf.mjs';
import { CATEGORIAS, lojaEmCache, nota } from './loja.mjs';
import { plataformaDaMaquina, versaoDisponivel, baixarChromium, chromiumBaixado } from './chromium.mjs';
import { acharNavegador } from './navegador.mjs';
import {
  PRESETS,
  adapterFor,
  contextFor,
  createProvider,
  getProvider,
  listProviders,
  refreshModels,
  refOf,
  parseRef
} from './providers/index.mjs';
import { discover } from './discovery.mjs';
import { readMachine, recommendModels, classificarCabe } from './machine.mjs';
import {
  runTurn,
  createChat,
  getChat,
  listMessages,
  deleteMessage,
  truncateFrom
} from './chat.mjs';
import {
  addMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  embeddingAvailable,
  reindexPending,
  reindexEmbeddings
} from './memory.mjs';
import { importConversations } from './importers.mjs';
import {
  addAttachment,
  listAttachments,
  publicAttachment,
  deleteAttachment,
  deleteAttachmentsOf
} from './documents.mjs';
import {
  PAPEIS,
  listarProfessores,
  criarProfessor,
  verProfessor,
  atualizarProfessor,
  apagarProfessor,
  guardarFoto,
  lerFoto,
  criarPasta,
  atualizarPasta,
  apagarPasta,
  reordenarPastas,
  listarSaidas,
  acharSaida,
  apagarSaida
} from './estudos.mjs';
import { montarRetrato, limparRetrato } from './retrato.mjs';
import { gerarFormato, TIPOS as TIPOS_DE_SAIDA } from './estudos-formatos.mjs';
import {
  semearCartoes,
  fila as filaDeCartoes,
  contagem as contagemDeCartoes,
  responder as responderCartao,
  previsao as previsaoDoCartao,
  apagarCartao,
  suspenderCartao
} from './cartoes.mjs';
import { runResearch } from './research.mjs';
import { runCouncil } from './council.mjs';
import { ftsQuery } from './vectors.mjs';
import { search as webSearch, readPage } from './web.mjs';
import { createBackup, restoreBackup, listBackups, backupName } from './backup.mjs';
import { explainProviderError } from './errors.mjs';
import { ARGS_ESTRUTURADO, nomeDoComando } from './eventos-cli.mjs';
import {
  arvoreDoProjeto, gravarAnexoNoProjeto, lerArquivoDoProjeto, mudancasDoProjeto
} from './projeto-arquivos.mjs';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { corpoDoErro, erroTraduzivel } from './erro-traduzivel.mjs';

// ------------------------------------------------------------------ helpers

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readBuffer(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('arquivo grande demais (limite de 64 MB)');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req, limit) {
  return (await readBuffer(req, limit)).toString('utf8');
}

async function readJSON(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

// Um comentário SSE a cada 15 s. Modelo local pensando, pesquisa lendo página:
// há minutos sem nenhum byte, e celular em Wi‑Fi derruba conexão parada.
const PING_MS = 15_000;

/** Abre um stream SSE e devolve o par (enviar, encerrar). */
function openStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  const controller = new AbortController();
  // Quem avisa que o navegador foi embora é a RESPOSTA, não o pedido.
  //
  // Num POST, o pedido "fecha" assim que o corpo termina de ser lido — o que
  // acontece em toda chamada saudável, porque o corpo é lido logo antes daqui.
  // Cancelar por `req` significava cancelar todo turno de conversa antes de o
  // modelo escrever a primeira letra, para todos os provedores.
  res.on('close', () => controller.abort());
  // A aba pode ter sido fechada entre o pedido e este ponto — rede caída no
  // celular, por exemplo. Aí o 'close' já passou e não vem de novo.
  if (res.destroyed || res.writableEnded) controller.abort();

  let last = Date.now();
  const ping = setInterval(() => {
    if (Date.now() - last >= PING_MS && !res.writableEnded) res.write(': ping\n\n');
  }, PING_MS);
  ping.unref?.();

  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
  };
  res.on('close', finish);

  return {
    signal: controller.signal,
    send(event) {
      last = Date.now();
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      finish();
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      res.end();
    }
  };
}

// Um turno por conversa. Dois streams no mesmo chat leriam o mesmo histórico e
// gravariam duas respostas para a mesma pergunta — a segunda aba do navegador,
// o toque duplo no botão de enviar, o "regenerar" enquanto ainda escreve.
const busyChats = new Set();

function chatBusy(chatId) {
  return busyChats.has(chatId);
}

async function withChatLock(chatId, fn) {
  busyChats.add(chatId);
  try {
    return await fn();
  } finally {
    busyChats.delete(chatId);
  }
}

/** Bombeia um gerador assíncrono pra dentro do SSE, com erro virando evento. */
async function pump(stream, iterator) {
  try {
    for await (const event of iterator) stream.send(event);
  } catch (err) {
    if (err.name !== 'AbortError') stream.send({ type: 'error', ...corpoDoErro(err, undefined, 'message') });
  }
  stream.end();
}

function providerView(p) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    base_url: p.base_url,
    secret_name: p.secret_name,
    has_secret: p.secret_name ? listSecretNames().includes(p.secret_name) : null,
    config: parseJSON(p.config),
    enabled: !!p.enabled,
    auto: !!p.auto,
    manageable: p.kind === 'ollama', // dá pra baixar e apagar modelo por aqui
    // Se este comando sabe contar o que está fazendo, passo a passo. A tela
    // Programar mostra o painel de trabalho só pra quem sabe: o `gemini` é
    // descoberto e cadastrado como CLI igual aos outros, mas não fala JSONL —
    // sem esta informação ele aparecia no grupo "Mexem nos arquivos" e deixava
    // o painel vazio pra sempre, sem uma palavra dizendo por quê.
    passoAPasso:
      p.kind === 'cli'
        ? Boolean(ARGS_ESTRUTURADO[nomeDoComando(parseJSON(p.config)?.command)])
        : false,
    models: all(
      'SELECT model_id, label, kind FROM models WHERE provider_id = ? ORDER BY model_id',
      p.id
    ).map((m) => ({ ...m, ref: refOf(p.id, m.model_id) }))
  };
}

function settingsView(req) {
  const cfg = loadConfig();
  return {
    port: cfg.port,
    host: cfg.host,
    requireToken: cfg.requireToken,
    memory: cfg.memory,
    secrets: listSecretNames(),
    embeddingAvailable: embeddingAvailable(),
    idioma: cfg.idioma || null,
    idiomas: IDIOMAS,
    // A tela precisa saber se a escolha de navegador já foi feita: é ela quem
    // pergunta, na primeira vez que alguém liga o modo agente.
    navegador: cfg.navegador,
    // O palpite sai do `Accept-Language` do próprio pedido: é o idioma que a
    // pessoa configurou no navegador, e chega de graça em toda requisição. A
    // tela usa isso só quando ela ainda não escolheu nada na mão.
    idiomaSugerido: escolherIdioma({
      escolhido: cfg.idioma,
      aceito: req?.headers?.['accept-language']
    })
  };
}

const CHAT_COLUMNS = `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count,
  (SELECT COUNT(*) FROM attachments WHERE chat_id = c.id) AS attachment_count FROM chats c`;

function listChats({ includeArchived = false } = {}) {
  return all(
    `${CHAT_COLUMNS} ${includeArchived ? '' : 'WHERE c.archived = 0'}
     ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 300`
  );
}

// As três rotas de /codigo têm o mesmo começo: achar a pasta do projeto. Fora
// desta lista, /codigo/qualquer-coisa continua caindo no 404 do fim do
// despachante, e não num 400 falando de projeto.
const ROTAS_DE_CODIGO = new Set(['arvore', 'arquivo', 'mudancas']);

/**
 * Acha a pasta de trabalho do projeto pedido em `?projeto=`.
 *
 * Devolve `{ raiz }` ou `{ erro }`, e nunca lança. Os quatro jeitos de dar
 * errado — sem id, projeto apagado, campo vazio, pasta que sumiu do disco —
 * são todos coisa que a pessoa conserta na tela de Projetos, então cada um
 * vira uma frase dizendo o que fazer. O campo `workdir` é digitado à mão e
 * gravado cru (o INSERT de /projects não confere nada), então "pasta que não
 * existe" é caso comum, não exceção.
 */
function pastaDoProjeto(url) {
  const id = url.searchParams.get('projeto') || '';
  if (!id) return { erro: erroTraduzivel('não sei de qual projeto: o pedido veio sem projeto nenhum') };

  const projeto = one('SELECT * FROM projects WHERE id = ?', id);
  if (!projeto) return { erro: erroTraduzivel('esse projeto não existe mais — recarregue a página e escolha outro') };
  if (!projeto.workdir) {
    return {
      erro: erroTraduzivel(
        'esse projeto ainda não aponta pra uma pasta — abra Projetos, edite "{projeto}" e preencha a pasta de trabalho',
        { projeto: projeto.name }
      )
    };
  }

  // `resolve` aqui, antes de virar raiz de contenção: o campo aceita caminho
  // relativo, e aí a pasta mudaria junto com o diretório de trabalho do
  // processo — a mesma armadilha documentada em chromium.mjs:536.
  const raiz = resolve(projeto.workdir);
  let info = null;
  try {
    info = statSync(raiz);
  } catch {
    // pasta apagada, disco externo desmontado, sem permissão de leitura
  }
  if (!info) {
    return {
      erro: erroTraduzivel('a pasta "{pasta}" não existe mais no disco — aponte o projeto pra outra pasta', {
        pasta: projeto.workdir
      })
    };
  }
  if (!info.isDirectory()) {
    return {
      erro: erroTraduzivel('"{pasta}" é um arquivo, não uma pasta — o projeto precisa apontar pra uma pasta', {
        pasta: projeto.workdir
      })
    };
  }
  return { raiz };
}

// ------------------------------------------------------------------- rotas

export async function handleApi(req, res, url) {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;
  const seg = path.split('/').filter(Boolean);

  // --- estado geral, o que a interface carrega no boot ---------------------
  if (method === 'GET' && path === '/state') {
    return json(res, {
      providers: listProviders().map(providerView),
      gems: all('SELECT * FROM gems ORDER BY created_at'),
      projects: all('SELECT * FROM projects ORDER BY created_at'),
      chats: listChats(),
      settings: settingsView(req)
    });
  }

  // --- o que falta pra tudo funcionar, e o botao que resolve ---------------
  //
  // A tela nao pergunta "voce tem Ollama?": ela pergunta ao servidor o que
  // falta e recebe junto o rotulo do botao certo. Antes disso a interface so
  // sabia dizer "ligue o Ollama primeiro", frase que nao ajuda quem nunca
  // ouviu falar em Ollama.
  if (method === 'GET' && path === '/requisitos') {
    const [ollama] = await Promise.all([estadoDoOllama({})]);
    const instalado = acharNavegador();
    const proprio = chromiumBaixado();
    return json(res, {
      ollama: {
        ...ollama,
        // "no_ar" nao precisa de botao; "instalado_parado" precisa de um clique
        // barato; "ausente" precisa de download.
        acao: ollama.estado === 'no_ar' ? null : ollama.estado === 'instalado_parado' ? 'ligar' : 'instalar',
        manual: ollama.estado === 'ausente' ? receitaManual() : null
      },
      navegador: {
        instalado,
        proprio,
        plataforma: plataformaDaMaquina(),
        acao: instalado || proprio ? null : plataformaDaMaquina() ? 'baixar' : 'sem_jeito'
      }
    });
  }

  if (method === 'POST' && path === '/requisitos/ollama/ligar') {
    // `ligarOllama` levanta quando achou o programa e não conseguiu rodar — a
    // mensagem diz onde ele está e o que deu errado, que é o que a pessoa
    // precisa ler. Virar 500 esconderia justamente isso.
    try {
      const subiu = await ligarOllama({});
      return json(res, { ok: subiu, ...(await estadoDoOllama({})) });
    } catch (err) {
      return json(res, corpoDoErro(err, { ok: false, manual: receitaManual() }), 200);
    }
  }

  if (method === 'POST' && path === '/requisitos/ollama/instalar') {
    const { signal, send, end } = openStream(req, res);
    try {
      for await (const ev of instalarOllama({ signal })) send(ev);
      send({ type: 'pronto', ...(await estadoDoOllama({})) });
    } catch (err) {
      send({ type: 'error', ...corpoDoErro(err, { manual: receitaManual() }) });
    }
    return end();
  }

  if (method === 'POST' && path === '/requisitos/navegador/baixar') {
    const { signal, send, end } = openStream(req, res);
    try {
      let binario = null;
      for await (const ev of baixarChromium({ signal })) {
        if (ev?.binario) binario = ev.binario;
        send(ev);
      }
      binario = binario || chromiumBaixado();
      // Guardar o caminho e o que faz o modo agente parar de procurar Chrome
      // instalado e passar a usar este.
      if (binario) patchConfig({ navegador: { fonte: 'proprio', binario } });
      send({ type: 'pronto', binario });
    } catch (err) {
      send({ type: 'error', ...corpoDoErro(err) });
    }
    return end();
  }

  if (method === 'GET' && path === '/requisitos/navegador/versao') {
    try {
      return json(res, await versaoDisponivel({}));
    } catch (err) {
      return json(res, corpoDoErro(err), 502);
    }
  }

  // --- loja de MCPs e skills, puxada do GitHub ------------------------------
  if (method === 'GET' && path === '/loja') {
    const { itens, de, quando, erro } = await lojaEmCache({});
    // A nota vai calculada daqui: a fórmula é uma decisão de produto, e ter uma
    // cópia dela no navegador significaria duas fórmulas divergindo. Ordenar e
    // filtrar continua sendo do cliente, que assim troca de filtro sem rede.
    const agora = Date.now();
    return json(res, {
      itens: itens.map((i) => ({ ...i, nota: Math.round(nota(i, agora) * 1e4) / 1e4 })),
      categorias: CATEGORIAS,
      de,
      quando,
      erro
    });
  }

  // --- catalogo de modelos, puxado do Hugging Face -------------------------
  if (method === 'GET' && path === '/catalogo') {
    const { modelos, de, quando } = await catalogoEmCache({});
    return json(res, { modelos, de, quando });
  }

  // O tamanho sai medido um a um, sob demanda: medir os cem de uma vez custa
  // cem pedidos e encosta no teto anonimo do Hugging Face.
  if (method === 'GET' && seg[0] === 'catalogo' && seg[1] === 'tamanho') {
    const id = url.searchParams.get('id') || '';
    if (!id) return json(res, { error: 'falta o id do modelo' }, 400);
    const medida = await medirModelo(id, {});
    // O "cabe" sai junto do tamanho porque a regra é uma só e mora no servidor:
    // a tela que decidisse sozinha acabaria discordando da lista de
    // recomendados na mesma página.
    return json(res, {
      ...medida,
      cabe: medida.estado === 'ok' ? classificarCabe(medida.gb, readMachine()) : null
    });
  }

  // --- busca global --------------------------------------------------------
  if (method === 'GET' && path === '/search') {
    const q = ftsQuery(url.searchParams.get('q') || '');
    if (!q) return json(res, { chats: [], memories: [] });
    const chats = all(
      `SELECT m.id, m.chat_id, m.role, m.created_at,
              snippet(messages_fts, 0, '«', '»', '…', 14) AS excerpt,
              c.title
       FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       JOIN chats c ON c.id = m.chat_id
       WHERE messages_fts MATCH ?
       ORDER BY bm25(messages_fts) LIMIT 30`,
      q
    );
    const memories = all(
      `SELECT m.id, m.text, m.pinned, m.source
       FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH ? AND m.active = 1
       ORDER BY bm25(memories_fts) LIMIT 20`,
      q
    );
    return json(res, { chats, memories });
  }

  // --- reindexação da busca por significado --------------------------------
  if (method === 'GET' && path === '/reindex') return json(res, reindexPending());
  if (method === 'POST' && path === '/reindex') {
    return json(res, await reindexEmbeddings());
  }

  // --- provedores ----------------------------------------------------------
  if (method === 'GET' && path === '/presets') return json(res, PRESETS);

  // --- a maquina do usuario, e o que cabe nela --------------------------
  //
  // A tela de IAs ligadas abre com "seu Mac tem 18 GB; cabe modelo ate uns
  // 8 GB com folga". Sem isso a pessoa escolhe modelo por adivinhacao e
  // descobre que nao cabe depois de baixar seis gigabytes.
  if (method === 'GET' && path === '/machine') {
    const maquina = readMachine();
    return json(res, { ...maquina, modelos: recommendModels(maquina) });
  }

  if (method === 'POST' && path === '/discover') {
    const found = await discover();
    return json(res, { found, providers: listProviders().map(providerView) });
  }

  if (method === 'GET' && path === '/providers') {
    return json(res, listProviders().map(providerView));
  }

  // Saúde: um por um, em paralelo. É o que responde "por que a resposta não
  // vem?" antes de o usuário ter que adivinhar.
  if (method === 'GET' && path === '/health') {
    const checked = await Promise.all(
      listProviders().map(async (provider) => {
        const base = {
          id: provider.id,
          name: provider.name,
          kind: provider.kind,
          enabled: !!provider.enabled,
          models: all('SELECT COUNT(*) AS n FROM models WHERE provider_id = ?', provider.id)[0].n
        };
        if (!provider.enabled) return { ...base, status: 'off', message: 'desligada por você' };
        if (provider.secret_name && !listSecretNames().includes(provider.secret_name)) {
          return {
            ...base,
            status: 'erro',
            ...corpoDoErro(
              erroTraduzivel('falta a chave "{chave}"', { chave: provider.secret_name }),
              undefined,
              'message'
            )
          };
        }
        const started = Date.now();
        try {
          // `check` quando o adaptador tem um teste melhor que listar modelos —
          // no CLI, listar só repete a configuração e nunca falha.
          const adapter = adapterFor(provider.kind);
          const models = await (adapter.check || adapter.listModels)(contextFor(provider));
          return { ...base, status: 'ok', ms: Date.now() - started, models: models.length };
        } catch (err) {
          return {
            ...base,
            status: 'erro',
            ms: Date.now() - started,
            ...corpoDoErro(explainProviderError(err, provider), undefined, 'message')
          };
        }
      })
    );
    return json(res, checked);
  }

  if (method === 'POST' && path === '/providers') {
    const body = await readJSON(req);
    if (body.secretValue && body.secretName) setSecret(body.secretName, body.secretValue);
    const provider = createProvider({
      name: body.name,
      kind: body.kind,
      baseUrl: body.baseUrl,
      secretName: body.secretName || null,
      config: body.config || {}
    });
    let error = null;
    try {
      await refreshModels(provider.id);
    } catch (err) {
      error = err.message;
    }
    return json(res, { provider: providerView(getProvider(provider.id)), error });
  }

  if (seg[0] === 'providers' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE' && seg.length === 2) {
      run('DELETE FROM providers WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH' && seg.length === 2) {
      const body = await readJSON(req);
      if (body.secretValue !== undefined && body.secretName) {
        setSecret(body.secretName, body.secretValue);
      }
      const current = getProvider(id);
      run(
        'UPDATE providers SET name = ?, base_url = ?, secret_name = ?, config = ?, enabled = ? WHERE id = ?',
        body.name ?? current.name,
        body.baseUrl ?? current.base_url,
        body.secretName ?? current.secret_name,
        JSON.stringify(body.config ?? parseJSON(current.config)),
        body.enabled === undefined ? current.enabled : body.enabled ? 1 : 0,
        id
      );
      return json(res, providerView(getProvider(id)));
    }
    if (method === 'POST' && seg[2] === 'refresh') {
      try {
        await refreshModels(id);
        return json(res, providerView(getProvider(id)));
      } catch (err) {
        return json(res, corpoDoErro(err), 502);
      }
    }

    // Gerenciar modelo do provedor (hoje só o Ollama implementa).
    if (method === 'POST' && seg[2] === 'pull') {
      const body = await readJSON(req);
      const provider = getProvider(id);
      const adapter = adapterFor(provider.kind);
      if (!adapter.pull) return json(res, { error: 'este provedor não baixa modelo' }, 400);
      const stream = openStream(req, res);
      await pump(
        stream,
        (async function* () {
          for await (const progress of adapter.pull(contextFor(provider), {
            model: body.model,
            signal: stream.signal
          })) {
            yield { type: 'progress', ...progress };
          }
          await refreshModels(id);
          yield { type: 'done', provider: providerView(getProvider(id)) };
        })()
      );
      return;
    }
    if (method === 'DELETE' && seg[2] === 'models' && seg[3]) {
      const provider = getProvider(id);
      const adapter = adapterFor(provider.kind);
      if (!adapter.remove) return json(res, { error: 'este provedor não apaga modelo' }, 400);
      await adapter.remove(contextFor(provider), { model: decodeURIComponent(seg[3]) });
      await refreshModels(id);
      return json(res, providerView(getProvider(id)));
    }
    if (method === 'GET' && seg[2] === 'running') {
      const provider = getProvider(id);
      const adapter = adapterFor(provider.kind);
      if (!adapter.running) return json(res, []);
      try {
        return json(res, await adapter.running(contextFor(provider)));
      } catch (err) {
        return json(res, corpoDoErro(err), 502);
      }
    }
  }

  // --- gems ---------------------------------------------------------------
  if (method === 'GET' && path === '/gems') {
    return json(res, all('SELECT * FROM gems ORDER BY created_at'));
  }
  if (method === 'POST' && path === '/gems') {
    const b = await readJSON(req);
    const id = uid();
    run(
      `INSERT INTO gems (id, name, icon, color, system_prompt, model, temperature, mode, unfiltered,
                         memory_read, memory_write, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      b.name || 'Nova gem',
      b.icon || 'sparkle',
      b.color || 'indigo',
      b.system_prompt || '',
      b.model || null,
      b.temperature ?? null,
      b.mode || 'chat',
      b.unfiltered ? 1 : 0,
      b.memory_read === false ? 0 : 1,
      b.memory_write === false ? 0 : 1,
      now()
    );
    return json(res, one('SELECT * FROM gems WHERE id = ?', id));
  }
  if (seg[0] === 'gems' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      run('DELETE FROM gems WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      const cur = one('SELECT * FROM gems WHERE id = ?', id);
      if (!cur) return json(res, { error: 'gem não encontrada' }, 404);
      run(
        `UPDATE gems SET name = ?, icon = ?, color = ?, system_prompt = ?, model = ?, temperature = ?,
           mode = ?, unfiltered = ?, memory_read = ?, memory_write = ? WHERE id = ?`,
        b.name ?? cur.name,
        b.icon ?? cur.icon,
        b.color ?? cur.color,
        b.system_prompt ?? cur.system_prompt,
        b.model !== undefined ? b.model : cur.model,
        b.temperature !== undefined ? b.temperature : cur.temperature,
        b.mode ?? cur.mode,
        b.unfiltered === undefined ? cur.unfiltered : b.unfiltered ? 1 : 0,
        b.memory_read === undefined ? cur.memory_read : b.memory_read ? 1 : 0,
        b.memory_write === undefined ? cur.memory_write : b.memory_write ? 1 : 0,
        id
      );
      return json(res, one('SELECT * FROM gems WHERE id = ?', id));
    }
  }

  // --- projetos ------------------------------------------------------------
  if (method === 'GET' && path === '/projects') {
    return json(res, all('SELECT * FROM projects ORDER BY created_at'));
  }
  if (method === 'POST' && path === '/projects') {
    const b = await readJSON(req);
    const id = uid();
    run(
      'INSERT INTO projects (id, name, icon, color, instructions, workdir, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      b.name || 'Novo projeto',
      b.icon || 'folder',
      b.color || 'slate',
      b.instructions || '',
      b.workdir || null,
      now()
    );
    return json(res, one('SELECT * FROM projects WHERE id = ?', id));
  }
  if (seg[0] === 'projects' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      // Antes do DELETE: o cascade leva a linha do anexo e o arquivo no disco
      // ficaria órfão, com o documento inteiro dentro.
      deleteAttachmentsOf({ projectId: id });
      run('DELETE FROM projects WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      const cur = one('SELECT * FROM projects WHERE id = ?', id);
      if (!cur) return json(res, { error: 'projeto não encontrado' }, 404);
      run(
        'UPDATE projects SET name = ?, icon = ?, color = ?, instructions = ?, workdir = ? WHERE id = ?',
        b.name ?? cur.name,
        b.icon ?? cur.icon,
        b.color ?? cur.color,
        b.instructions ?? cur.instructions,
        b.workdir !== undefined ? b.workdir : cur.workdir,
        id
      );
      return json(res, one('SELECT * FROM projects WHERE id = ?', id));
    }
  }

  // --- estudos: professores, as caixas deles e o que foi gerado ------------
  //
  // Erro aqui vira 404/400 pelo `erroTraduzivel` que o módulo levanta, e não por
  // um `if` repetido em cada rota: quem sabe o que é "professor não encontrado" é
  // o armário, não o roteador.
  if (method === 'GET' && path === '/professores') return json(res, listarProfessores());
  if (method === 'POST' && path === '/professores') {
    return json(res, criarProfessor(await readJSON(req)));
  }
  if (seg[0] === 'professores' && seg[1] && !seg[2]) {
    if (method === 'GET') return json(res, verProfessor(seg[1]));
    if (method === 'PATCH') return json(res, atualizarProfessor(seg[1], await readJSON(req)));
    if (method === 'DELETE') return json(res, apagarProfessor(seg[1]));
  }
  if (seg[0] === 'professores' && seg[1] && seg[2] === 'retrato') {
    if (method === 'POST') {
      const b = await readJSON(req);
      const stream = openStream(req, res);
      await pump(stream, montarRetrato({ professorId: seg[1], ref: b.model, signal: stream.signal }));
      return;
    }
    // A correção feita à mão entra por cima e fica: quem regerar o retrato
    // depois recebe as correções de volta, senão a pessoa conserta o mesmo
    // achado toda vez que anexa uma prova nova.
    if (method === 'PATCH') {
      const b = await readJSON(req);
      const atual = verProfessor(seg[1]).retrato;
      if (!atual) return json(res, corpoDoErro(erroTraduzivel('ainda não existe retrato pra corrigir')), 400);
      const junto = limparRetrato({ ...atual, ...(b.retrato || {}) });
      if (!junto) return json(res, corpoDoErro(erroTraduzivel('a correção deixou o retrato sem forma')), 400);
      junto.confianca = atual.confianca;
      junto.fontes = atual.fontes;
      junto.gerado_em = atual.gerado_em;
      junto.correcoes = Array.isArray(b.correcoes) ? b.correcoes : atual.correcoes || [];
      run('UPDATE professores SET retrato = ?, updated_at = ? WHERE id = ?', JSON.stringify(junto), now(), seg[1]);
      return json(res, verProfessor(seg[1]));
    }
  }
  if (seg[0] === 'professores' && seg[1] && seg[2] === 'foto') {
    if (method === 'POST') return json(res, guardarFoto(seg[1], await readBuffer(req, 8 * 1024 * 1024)));
    if (method === 'GET') {
      const { buffer, mime } = lerFoto(seg[1]);
      // Sem cache no navegador: trocar a foto e continuar vendo a antiga é o
      // tipo de defeito que a pessoa acha que é dela.
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      return res.end(buffer);
    }
  }
  if (seg[0] === 'professores' && seg[1] && seg[2] === 'pastas') {
    if (method === 'POST' && !seg[3]) return json(res, criarPasta(seg[1], await readJSON(req)));
    if (method === 'POST' && seg[3] === 'ordem') {
      const b = await readJSON(req);
      return json(res, reordenarPastas(seg[1], Array.isArray(b.ids) ? b.ids : []));
    }
  }
  if (seg[0] === 'professores' && seg[1] && seg[2] === 'gerar' && method === 'POST') {
    const b = await readJSON(req);
    const stream = openStream(req, res);
    await pump(
      stream,
      gerarFormato({
        professorId: seg[1],
        tipo: TIPOS_DE_SAIDA.includes(b.tipo) ? b.tipo : '',
        ref: b.model,
        pastaId: b.pasta || null,
        signal: stream.signal
      })
    );
    return;
  }
  // --- cartões e a fila de revisão -----------------------------------------
  if (seg[0] === 'professores' && seg[1] && seg[2] === 'cartoes' && method === 'GET') {
    // A fila já vem com a previsão de cada nota: a tela mostra o preço nos
    // quatro botões, e sem isso ela teria que perguntar um por um.
    const cartoes = filaDeCartoes(seg[1], { limite: Number(url.searchParams.get('limite')) || 40 });
    return json(res, {
      contagem: contagemDeCartoes(seg[1]),
      cartoes: cartoes.map((c) => ({ ...c, previsao: previsaoDoCartao(c) }))
    });
  }
  if (seg[0] === 'saidas' && seg[1] && seg[2] === 'cartoes' && method === 'POST') {
    return json(res, semearCartoes(seg[1]));
  }
  if (seg[0] === 'cartoes' && seg[1]) {
    if (method === 'POST' && seg[2] === 'responder') {
      const b = await readJSON(req);
      return json(res, responderCartao(seg[1], b.nota));
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      return json(res, suspenderCartao(seg[1], b.suspenso !== false));
    }
    if (method === 'DELETE') return json(res, apagarCartao(seg[1]));
  }
  if (seg[0] === 'professores' && seg[1] && seg[2] === 'saidas' && method === 'GET') {
    return json(res, listarSaidas(seg[1], { tipo: url.searchParams.get('tipo') }));
  }
  if (seg[0] === 'pastas' && seg[1]) {
    if (method === 'PATCH') return json(res, atualizarPasta(seg[1], await readJSON(req)));
    if (method === 'DELETE') return json(res, apagarPasta(seg[1]));
  }
  if (seg[0] === 'saidas' && seg[1]) {
    if (method === 'GET') return json(res, acharSaida(seg[1]));
    if (method === 'DELETE') return json(res, apagarSaida(seg[1]));
  }

  // --- código do projeto: o painel da tela Programar -----------------------
  if (method === 'GET' && seg[0] === 'codigo' && ROTAS_DE_CODIGO.has(seg[1])) {
    const pasta = pastaDoProjeto(url);
    if (pasta.erro) return json(res, corpoDoErro(pasta.erro), 400);

    try {
      if (seg[1] === 'arvore') return json(res, await arvoreDoProjeto(pasta.raiz));
      if (seg[1] === 'mudancas') return json(res, await mudancasDoProjeto(pasta.raiz));

      const caminho = url.searchParams.get('caminho') || '';
      if (!caminho) {
        return json(res, corpoDoErro(erroTraduzivel('diga qual arquivo abrir: o pedido veio sem caminho')), 400);
      }
      return json(res, await lerArquivoDoProjeto(pasta.raiz, caminho));
    } catch (err) {
      // Caminho que escapa da pasta, arquivo binário, arquivo apagado entre a
      // árvore e o clique: é pedido errado, não defeito do servidor. Sem este
      // catch a recusa da peça de arquivos subiria até o try do index.mjs, que
      // responde 500 — e a tela diria "erro interno" pra quem só clicou no
      // arquivo errado.
      return json(res, corpoDoErro(err), 400);
    }
  }

  // Anexo da tela Programar: o arquivo é gravado na pasta do projeto e o que
  // volta é o caminho relativo. A IA de terminal não recebe conteúdo pelo
  // pedido — ela abre o arquivo por conta, e por isso ele precisa estar num
  // lugar que ela alcance.
  if (method === 'POST' && seg[0] === 'codigo' && seg[1] === 'anexo') {
    const pasta = pastaDoProjeto(url);
    if (pasta.erro) return json(res, corpoDoErro(pasta.erro), 400);
    try {
      const conteudo = await readBuffer(req);
      const nome = url.searchParams.get('name') || 'arquivo';
      return json(res, gravarAnexoNoProjeto(pasta.raiz, nome, conteudo));
    } catch (err) {
      // Arquivo grande demais, vazio, ou pasta sem permissão de escrita: é
      // pedido que não dá pra atender, não defeito do servidor.
      return json(res, corpoDoErro(err), 400);
    }
  }

  // --- conversas -----------------------------------------------------------
  if (method === 'GET' && path === '/chats') {
    return json(res, listChats({ includeArchived: url.searchParams.get('all') === '1' }));
  }
  if (method === 'POST' && path === '/chats') {
    const b = await readJSON(req);
    return json(
      res,
      createChat({
        title: b.title,
        projectId: b.project_id || null,
        gemId: b.gem_id || null,
        mode: b.mode || 'chat',
        model: b.model || null
      })
    );
  }
  if (seg[0] === 'chats' && seg[1]) {
    const id = seg[1];

    if (method === 'GET' && seg.length === 2) {
      const chat = getChat(id);
      if (!chat) return json(res, { error: 'conversa não encontrada' }, 404);
      return json(res, {
        chat,
        messages: listMessages(id),
        attachments: listAttachments({ chatId: id })
      });
    }
    if (method === 'DELETE' && seg.length === 2) {
      deleteAttachmentsOf({ chatId: id });
      run('DELETE FROM chats WHERE id = ?', id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH' && seg.length === 2) {
      const b = await readJSON(req);
      const cur = getChat(id);
      if (!cur) return json(res, { error: 'conversa não encontrada' }, 404);
      run(
        `UPDATE chats SET title = ?, model = ?, gem_id = ?, project_id = ?, mode = ?,
           system_prompt = ?, temperature = ?, top_p = ?, max_tokens = ?,
           pinned = ?, archived = ?, tools = ? WHERE id = ?`,
        b.title ?? cur.title,
        b.model !== undefined ? b.model : cur.model,
        b.gem_id !== undefined ? b.gem_id : cur.gem_id,
        b.project_id !== undefined ? b.project_id : cur.project_id,
        b.mode ?? cur.mode,
        b.system_prompt !== undefined ? b.system_prompt : cur.system_prompt,
        b.temperature !== undefined ? b.temperature : cur.temperature,
        b.top_p !== undefined ? b.top_p : cur.top_p,
        b.max_tokens !== undefined ? b.max_tokens : cur.max_tokens,
        b.pinned === undefined ? cur.pinned : b.pinned ? 1 : 0,
        b.archived === undefined ? cur.archived : b.archived ? 1 : 0,
        b.tools !== undefined ? JSON.stringify(b.tools) : cur.tools,
        id
      );
      return json(res, getChat(id));
    }

    // Exportar a conversa inteira.
    if (method === 'GET' && seg[2] === 'export') {
      const chat = getChat(id);
      if (!chat) return json(res, { error: 'conversa não encontrada' }, 404);
      const messages = listMessages(id);
      const format = url.searchParams.get('format') || 'md';
      if (format === 'json') {
        return json(res, { chat, messages: messages.map((m) => ({ ...m, meta: parseJSON(m.meta) })) });
      }
      const lines = [`# ${chat.title}`, '', `_${chat.created_at}_`, ''];
      for (const m of messages) {
        if (m.role === 'system') continue;
        const meta = parseJSON(m.meta);
        const who = m.role === 'user' ? 'Você' : meta.provider || m.model || 'Assistente';
        lines.push(`## ${who}`, '', m.content, '');
      }
      const body = lines.join('\n');
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${chat.title.replace(/[^\w\- ]+/g, '')}.md"`
      });
      return res.end(body);
    }

    // Streaming da resposta.
    if (method === 'POST' && seg[2] === 'stream') {
      const b = await readJSON(req);
      if (chatBusy(id)) {
        return json(res, { error: 'essa conversa já está respondendo — espere terminar ou pare a resposta' }, 409);
      }
      const stream = openStream(req, res);
      await withChatLock(id, () =>
        pump(
          stream,
          runTurn({
            chatId: id,
            userContent: b.content || '',
            modelRef: b.model || null,
            useWeb: b.web === undefined ? null : Boolean(b.web),
            // Quem pede é a tela Programar. O servidor não deduz pela
            // configuração da conversa: o modo estruturado liga auto-aprovação
            // de edição de arquivo, e isso tem que ser pedido explícito.
            programar: Boolean(b.programar),
            signal: stream.signal
          })
        )
      );
      return;
    }

    // Regenerar: apaga da mensagem indicada em diante e refaz o último turno.
    if (method === 'POST' && seg[2] === 'regenerate') {
      const b = await readJSON(req);
      if (chatBusy(id)) {
        return json(res, { error: 'essa conversa já está respondendo — pare a resposta antes de refazer' }, 409);
      }
      const messages = listMessages(id);
      const target = b.from
        ? messages.find((m) => m.id === b.from)
        : [...messages].reverse().find((m) => m.role === 'assistant');
      if (!target) return json(res, { error: 'não há resposta pra refazer' }, 400);

      // Tudo que dá pra conferir antes de apagar é conferido antes de apagar.
      // A ordem anterior era truncar e só então perguntar se havia pergunta e se
      // o modelo existia: quando não havia, a conversa ficava sem a resposta
      // antiga e sem a nova, e o 400 chegava tarde demais pra adiantar.
      const corte = messages.findIndex((m) => m.id === target.id);
      const remaining = messages.slice(0, corte);
      const lastUser = [...remaining].reverse().find((m) => m.role === 'user');
      if (!lastUser) return json(res, { error: 'não há pergunta antes dessa resposta' }, 400);

      const ref = b.model || getChat(id)?.model;
      if (!ref) return json(res, { error: 'nenhum modelo escolhido pra refazer' }, 400);
      try {
        const provedor = getProvider(parseRef(ref).providerId);
        if (!provedor.enabled) {
          return json(res, corpoDoErro(erroTraduzivel('a IA "{ia}" está desligada', { ia: provedor.name })), 400);
        }
      } catch (err) {
        return json(res, corpoDoErro(err), 400);
      }

      truncateFrom(id, target.id);

      const stream = openStream(req, res);
      stream.send({ type: 'reset', keep: remaining.map((m) => m.id) });
      await withChatLock(id, () =>
        pump(
          stream,
          runTurn({
            chatId: id,
            userContent: lastUser.content,
            modelRef: b.model || null,
            useWeb: b.web === undefined ? null : Boolean(b.web),
            resend: true,
            signal: stream.signal
          })
        )
      );
      return;
    }

    // Anexos da conversa. O corpo é o arquivo cru: multipart não vale a pena
    // implementar à mão só pra isso.
    if (method === 'POST' && seg[2] === 'attachments') {
      const buffer = await readBuffer(req);
      const name = url.searchParams.get('name') || 'arquivo';
      const attachment = await addAttachment({
        buffer,
        name,
        mime: req.headers['content-type'] || '',
        chatId: id
      });
      return json(res, publicAttachment(attachment));
    }
    if (method === 'GET' && seg[2] === 'attachments') {
      return json(res, listAttachments({ chatId: id }));
    }
  }

  // --- mensagens -----------------------------------------------------------
  if (seg[0] === 'messages' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      deleteMessage(id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      const cur = one('SELECT * FROM messages WHERE id = ?', id);
      if (!cur) return json(res, { error: 'mensagem não encontrada' }, 404);
      run('UPDATE messages SET content = ? WHERE id = ?', b.content ?? cur.content, id);
      return json(res, one('SELECT * FROM messages WHERE id = ?', id));
    }
  }

  // --- anexos --------------------------------------------------------------
  if (method === 'GET' && path === '/attachments') {
    return json(
      res,
      listAttachments({
        chatId: url.searchParams.get('chat'),
        projectId: url.searchParams.get('project'),
        pastaId: url.searchParams.get('pasta')
      })
    );
  }
  if (method === 'POST' && path === '/attachments') {
    const buffer = await readBuffer(req);
    const attachment = await addAttachment({
      buffer,
      name: url.searchParams.get('name') || 'arquivo',
      mime: req.headers['content-type'] || '',
      chatId: url.searchParams.get('chat') || null,
      projectId: url.searchParams.get('project') || null,
      pastaId: url.searchParams.get('pasta') || null,
      papel: PAPEIS.includes(url.searchParams.get('papel')) ? url.searchParams.get('papel') : 'material'
    });
    return json(res, publicAttachment(attachment));
  }
  if (seg[0] === 'attachments' && seg[1] && method === 'DELETE') {
    deleteAttachment(seg[1]);
    return json(res, { ok: true });
  }

  // --- pesquisa profunda ---------------------------------------------------
  if (method === 'POST' && path === '/research') {
    const b = await readJSON(req);
    const stream = openStream(req, res);
    await pump(
      stream,
      runResearch({
        question: b.question || '',
        ref: b.model,
        breadth: Number(b.breadth) || 4,
        depth: Number(b.depth) || 3,
        signal: stream.signal
      })
    );
    return;
  }

  // --- conselho de IAs -----------------------------------------------------
  // Conversa anônima: rota própria, sem id, porque não existe conversa. Nada
  // aqui grava, lê memória ou aprende — a tela promete isso e é aqui que a
  // promessa se cumpre. O histórico vem do navegador, que é onde ele some.
  if (method === 'POST' && path === '/chat-anonimo') {
    const b = await readJSON(req);
    const stream = openStream(req, res);
    await pump(
      stream,
      runTurn({
        anon: true,
        chatId: null,
        userContent: b.content || '',
        history: Array.isArray(b.history) ? b.history : [],
        modelRef: b.model || null,
        useWeb: b.web === undefined ? null : Boolean(b.web),
        signal: stream.signal
      })
    );
    return;
  }

  if (method === 'POST' && path === '/council') {
    const b = await readJSON(req);
    const stream = openStream(req, res);
    await pump(
      stream,
      runCouncil({
        prompt: b.prompt || '',
        system: b.system || null,
        // `models` é o que a interface manda; `refs` é o nome interno, aceito
        // aqui pra quem chamar a API direto não tropeçar na diferença.
        refs: b.models || b.refs || [],
        mode: b.mode || 'council',
        judge: b.judge || null,
        temperature: b.temperature ?? null,
        signal: stream.signal
      })
    );
    return;
  }

  // --- ferramenta de web avulsa (a interface usa pra testar) ---------------
  if (method === 'GET' && path === '/web/search') {
    try {
      return json(res, await webSearch(url.searchParams.get('q') || '', { limit: 8 }));
    } catch (err) {
      return json(res, corpoDoErro(err), 502);
    }
  }
  if (method === 'GET' && path === '/web/read') {
    try {
      return json(res, await readPage(url.searchParams.get('url') || ''));
    } catch (err) {
      return json(res, corpoDoErro(err), 502);
    }
  }

  // --- memória -------------------------------------------------------------
  if (method === 'GET' && path === '/memories') {
    return json(
      res,
      listMemories({
        projectId: url.searchParams.get('project') || null,
        includeInactive: url.searchParams.get('all') === '1'
      })
    );
  }
  if (method === 'POST' && path === '/memories') {
    const b = await readJSON(req);
    const row = await addMemory({
      text: b.text,
      kind: b.kind || 'fact',
      scope: b.project_id ? 'project' : 'global',
      projectId: b.project_id || null,
      source: 'manual',
      pinned: b.pinned ? 1 : 0
    });
    return json(res, row);
  }
  if (method === 'POST' && path === '/memories/import') {
    const raw = await readBody(req);
    const filename = url.searchParams.get('filename') || '';
    const projectId = url.searchParams.get('project') || null;
    const result = await importConversations(raw, { filename, projectId });
    return json(res, result);
  }
  if (seg[0] === 'memories' && seg[1]) {
    const id = seg[1];
    if (method === 'DELETE') {
      deleteMemory(id);
      return json(res, { ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJSON(req);
      return json(res, updateMemory(id, b));
    }
  }

  // --- configuração --------------------------------------------------------
  if (method === 'GET' && path === '/settings') return json(res, settingsView(req));
  if (method === 'PATCH' && path === '/settings') {
    const b = await readJSON(req);
    // Só repassa o que veio: `requireToken: undefined` desligaria o token.
    const patch = {};
    if (b.memory) patch.memory = b.memory;
    if (b.limits) patch.limits = b.limits;
    if (b.navegador) patch.navegador = b.navegador;
    // Idioma que o app não fala não vira config: guardar um valor que ninguém
    // sabe carregar faria a tela cair no padrão sem dizer por quê.
    if (b.idioma !== undefined) patch.idioma = IDIOMAS.includes(b.idioma) ? b.idioma : null;

    const antes = loadConfig().requireToken;
    if (b.requireToken !== undefined) patch.requireToken = !!b.requireToken;
    patchConfig(patch);

    // Religando a tranca, a chave vai junto nesta resposta — quem estava
    // navegando sem token seria trancado do lado de fora no pedido seguinte, e
    // o botão viraria armadilha. Só aqui, e só nesta transição: quem já
    // navegava sem token tinha acesso a tudo de qualquer jeito, então não há o
    // que proteger dele neste instante.
    if (!antes && patch.requireToken) {
      return json(res, { ...settingsView(req), accessToken: loadConfig().accessToken });
    }
    return json(res, settingsView(req));
  }
  if (method === 'POST' && path === '/secrets') {
    const b = await readJSON(req);
    setSecret(b.name, b.value);
    return json(res, { ok: true, secrets: listSecretNames() });
  }

  // --- backup --------------------------------------------------------------
  if (method === 'GET' && path === '/backup') {
    const { buffer } = createBackup();
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': buffer.length,
      'content-disposition': `attachment; filename="${backupName()}"`
    });
    return res.end(buffer);
  }
  if (method === 'GET' && path === '/backups') {
    return json(res, listBackups());
  }
  if (method === 'POST' && path === '/restore') {
    const buffer = await readBuffer(req);
    try {
      const done = restoreBackup(buffer, { keepSecrets: url.searchParams.get('keep-secrets') === '1' });
      // O banco restaurado fica esperando: trocá-lo agora não adiantaria nada,
      // porque a conexão aberta aqui devolveria as páginas antigas por cima.
      // A troca é a primeira coisa que o próximo start faz.
      return json(res, {
        ...done,
        restart: true,
        message: 'cópia lida — reinicie o servidor pra os dados entrarem no lugar'
      });
    } catch (err) {
      return json(res, corpoDoErro(err), 400);
    }
  }

  return json(res, corpoDoErro(erroTraduzivel('rota não encontrada: {metodo} {caminho}', { metodo: method, caminho: path })), 404);
}
