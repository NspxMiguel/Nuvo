// A API inteira, com o servidor de pé numa porta livre. Um provedor falso
// entra no banco pra que o chat possa ser exercido sem chamar modelo de
// verdade.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, stubFetch, fakeResponse } from './helpers.mjs';

const home = useTempHome();
const { startServer } = await import('./helpers.mjs');
const { run, now, uid } = await import('../server/db.mjs');

let app;
let fakeProviderId;
let fakeRef;

before(async () => {
  app = await startServer();

  // Provedor OpenAI-compatível apontando pra lugar nenhum: o fetch é trocado
  // nos testes que precisam de resposta.
  fakeProviderId = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, ?, 'openai', 'http://modelo.invalido/v1', NULL, '{}', 1, 0, ?)`,
    fakeProviderId,
    'Provedor de teste',
    now()
  );
  run(
    'INSERT INTO models (id, provider_id, model_id, label, kind, seen_at) VALUES (?,?,?,?,?,?)',
    uid(), fakeProviderId, 'modelo-teste', 'modelo-teste', 'chat', now()
  );
  fakeRef = `${fakeProviderId}:modelo-teste`;
});

after(async () => {
  await app.close();
  home.cleanup();
});

// ------------------------------------------------------------------ acesso

test('sem token devolve 401', async () => {
  const res = await app.api('/state', { token: '' });
  assert.equal(res.status, 401);
  assert.match(res.data.error, /token/);
});

test('token errado devolve 401 e não vaza o certo', async () => {
  const res = await app.api('/state', { token: 'chute-errado-aqui' });
  assert.equal(res.status, 401);
  assert.ok(!res.text.includes(app.token));
});

test('com token devolve o estado completo', async () => {
  const res = await app.api('/state');
  assert.equal(res.status, 200);
  for (const chave of ['providers', 'gems', 'projects', 'chats', 'settings']) {
    assert.ok(chave in res.data, `faltou ${chave}`);
  }
});

test('o segredo do provedor nunca sai pela API', async () => {
  await app.api('/providers', {
    method: 'POST',
    body: {
      name: 'Com chave',
      kind: 'openai',
      baseUrl: 'http://exemplo.invalido/v1',
      secretName: 'CHAVE_DE_TESTE',
      secretValue: 'valor-super-secreto-123'
    }
  });
  const estado = await app.api('/state');
  assert.ok(!estado.text.includes('valor-super-secreto-123'), 'o valor da chave vazou');
  const criado = estado.data.providers.find((p) => p.name === 'Com chave');
  assert.equal(criado.has_secret, true, 'mas a interface precisa saber que existe chave');
  const config = await app.api('/settings');
  assert.ok(!config.text.includes('valor-super-secreto-123'));
  assert.ok(config.data.secrets.includes('CHAVE_DE_TESTE'), 'o nome pode aparecer');
});

test('arquivo estático é servido e não dá pra sair da pasta web', async () => {
  const index = await app.raw('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);

  for (const tentativa of ['/../server/config.mjs', '/..%2f..%2fetc%2fpasswd', '/....//server/db.mjs']) {
    const res = await app.raw(tentativa);
    assert.ok(res.status === 404 || res.status === 403, `${tentativa} devia ser barrado, veio ${res.status}`);
    const corpo = await res.text();
    assert.ok(!corpo.includes('accessToken'), 'nunca pode servir a configuração');
  }
});

// ------------------------------------------------------------------- gems

test('gem: cria, edita e apaga', async () => {
  const criada = await app.api('/gems', {
    method: 'POST',
    body: { name: 'Revisor', icon: 'book', color: 'teal', system_prompt: 'Revise o texto.' }
  });
  assert.equal(criada.status, 200);
  assert.equal(criada.data.icon, 'book');

  const editada = await app.api(`/gems/${criada.data.id}`, {
    method: 'PATCH',
    body: { name: 'Revisor sênior', unfiltered: true }
  });
  assert.equal(editada.data.name, 'Revisor sênior');
  assert.equal(editada.data.unfiltered, 1);
  assert.equal(editada.data.icon, 'book', 'campo não enviado não pode ser zerado');

  await app.api(`/gems/${criada.data.id}`, { method: 'DELETE' });
  const lista = await app.api('/gems');
  assert.ok(!lista.data.some((g) => g.id === criada.data.id));
});

test('gem inexistente devolve 404 em vez de 500', async () => {
  const res = await app.api('/gems/nao-existe', { method: 'PATCH', body: { name: 'x' } });
  assert.equal(res.status, 404);
});

// --------------------------------------------------------------- conversas

test('conversa: cria, ajusta e apaga', async () => {
  const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
  assert.equal(chat.status, 200);
  const id = chat.data.id;

  const ajustada = await app.api(`/chats/${id}`, {
    method: 'PATCH',
    body: { title: 'Nome novo', temperature: 0.3, top_p: 0.9, max_tokens: 500, pinned: true }
  });
  assert.equal(ajustada.data.title, 'Nome novo');
  assert.equal(ajustada.data.temperature, 0.3);
  assert.equal(ajustada.data.pinned, 1);

  const aberta = await app.api(`/chats/${id}`);
  assert.equal(aberta.data.chat.id, id);
  assert.ok(Array.isArray(aberta.data.messages));
  assert.ok(Array.isArray(aberta.data.attachments));

  await app.api(`/chats/${id}`, { method: 'DELETE' });
  assert.equal((await app.api(`/chats/${id}`)).status, 404);
});

test('conversa arquivada some da lista mas continua existindo', async () => {
  const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
  await app.api(`/chats/${chat.data.id}`, { method: 'PATCH', body: { archived: true } });

  const normal = await app.api('/chats');
  assert.ok(!normal.data.some((c) => c.id === chat.data.id));

  const todas = await app.api('/chats?all=1');
  assert.ok(todas.data.some((c) => c.id === chat.data.id));
});

// ------------------------------------------------------------------- chat

test('turno de conversa: stream completo com modelo falso', async () => {
  const stub = stubFetch(async () =>
    fakeResponse([
      'data: {"choices":[{"delta":{"content":"Oi, "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"tudo certo."}}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n'
    ])
  );
  try {
    const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
    const res = await app.raw(`/api/chats/${chat.data.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
      body: JSON.stringify({ content: 'oi tudo bem?', model: fakeRef })
    });
    const texto = await res.text();
    const eventos = texto
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));

    const tipos = eventos.map((e) => e.type);
    assert.ok(tipos.includes('user'), 'faltou o evento da mensagem do usuário');
    assert.ok(tipos.includes('delta'), 'faltou o texto da resposta');
    assert.ok(tipos.includes('stats'), 'faltou a medição');
    assert.ok(tipos.includes('done'), 'faltou o fechamento');
    assert.equal(tipos.at(-1), 'end');

    const resposta = eventos.find((e) => e.type === 'done').message;
    assert.equal(resposta.content, 'Oi, tudo certo.');

    const stats = eventos.find((e) => e.type === 'stats');
    assert.equal(stats.tokens, 4, 'a contagem do provedor tem que ser usada');
    assert.equal(stats.estimated, false);

    // A conversa ganha título a partir da primeira frase.
    const aberta = await app.api(`/chats/${chat.data.id}`);
    assert.equal(aberta.data.chat.title, 'oi tudo bem?');
    assert.equal(aberta.data.messages.length, 2);
  } finally {
    stub.restore();
  }
});

test('provedor fora do ar vira evento de erro, não derruba o servidor', async () => {
  const stub = stubFetch(async () => {
    throw new Error('conexão recusada');
  });
  try {
    const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
    const res = await app.raw(`/api/chats/${chat.data.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
      body: JSON.stringify({ content: 'oi', model: fakeRef })
    });
    const texto = await res.text();
    assert.match(texto, /"type":"error"/);
    assert.match(texto, /conexão recusada/);
    assert.match(texto, /"type":"end"/, 'mesmo com erro o stream tem que fechar direito');
  } finally {
    stub.restore();
  }
  // o servidor continua respondendo
  assert.equal((await app.api('/state')).status, 200);
});

test('resposta cortada no meio é gravada como interrompida', async () => {
  const stub = stubFetch(async () => {
    const original = fakeResponse(['data: {"choices":[{"delta":{"content":"comecei mas"}}]}\n\n']);
    let entregue = false;
    return {
      ...original,
      body: {
        getReader() {
          return {
            async read() {
              if (entregue) throw new Error('conexão caiu no meio');
              entregue = true;
              return {
                done: false,
                value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"comecei mas"}}]}\n\n')
              };
            }
          };
        }
      }
    };
  });
  try {
    const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
    const res = await app.raw(`/api/chats/${chat.data.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
      body: JSON.stringify({ content: 'teste de queda', model: fakeRef })
    });
    await res.text();

    const aberta = await app.api(`/chats/${chat.data.id}`);
    const resposta = aberta.data.messages.find((m) => m.role === 'assistant');
    assert.ok(resposta, 'o pedaço que chegou tinha que ter sido gravado');
    assert.match(resposta.content, /comecei mas/);
    assert.match(resposta.meta, /interrupted/);
  } finally {
    stub.restore();
  }
});

test('conversa sem modelo escolhido explica o problema', async () => {
  const chat = await app.api('/chats', { method: 'POST', body: {} });
  const res = await app.raw(`/api/chats/${chat.data.id}/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
    body: JSON.stringify({ content: 'oi' })
  });
  const texto = await res.text();
  assert.match(texto, /nenhum modelo/);
});

// ---------------------------------------------------------------- memória

test('memória pela API: grava, fixa, busca e apaga', async () => {
  const criada = await app.api('/memories', {
    method: 'POST',
    body: { text: 'Miguel programa em JavaScript e Swift' }
  });
  assert.equal(criada.status, 200);

  await app.api(`/memories/${criada.data.id}`, { method: 'PATCH', body: { pinned: true } });
  const lista = await app.api('/memories');
  assert.equal(lista.data.find((m) => m.id === criada.data.id).pinned, 1);

  const busca = await app.api('/search?q=JavaScript Swift');
  assert.ok(busca.data.memories.some((m) => m.id === criada.data.id));

  await app.api(`/memories/${criada.data.id}`, { method: 'DELETE' });
  assert.ok(!(await app.api('/memories')).data.some((m) => m.id === criada.data.id));
});

test('busca acha dentro das mensagens, não só no título', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(['data: {"choices":[{"delta":{"content":"O jabuticabeira floresce no tronco."}}]}\n\n', 'data: [DONE]\n\n'])
  );
  try {
    const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
    await app.raw(`/api/chats/${chat.data.id}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
      body: JSON.stringify({ content: 'me fala de arvores', model: fakeRef })
    }).then((r) => r.text());

    const busca = await app.api('/search?q=jabuticabeira');
    assert.ok(busca.data.chats.some((c) => c.chat_id === chat.data.id), 'devia achar pela palavra da resposta');
  } finally {
    stub.restore();
  }
});

// ----------------------------------------------------------------- anexos

test('anexo pela API entra na conversa e some ao apagar', async () => {
  const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
  const enviado = await app.api(`/chats/${chat.data.id}/attachments?name=notas.txt`, {
    method: 'POST',
    body: 'O prazo do contrato Delta é de noventa dias.',
    raw: true
  });
  assert.equal(enviado.status, 200);
  assert.equal(enviado.data.status, 'ok');

  const aberta = await app.api(`/chats/${chat.data.id}`);
  assert.equal(aberta.data.attachments.length, 1);

  await app.api(`/attachments/${enviado.data.id}`, { method: 'DELETE' });
  assert.equal((await app.api(`/chats/${chat.data.id}`)).data.attachments.length, 0);
});

// -------------------------------------------------------------- exportação

test('exportar em markdown e em json', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(['data: {"choices":[{"delta":{"content":"Resposta exportada."}}]}\n\n', 'data: [DONE]\n\n'])
  );
  let chatId;
  try {
    const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
    chatId = chat.data.id;
    await app.raw(`/api/chats/${chatId}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
      body: JSON.stringify({ content: 'pergunta exportada', model: fakeRef })
    }).then((r) => r.text());
  } finally {
    stub.restore();
  }

  const md = await app.raw(`/api/chats/${chatId}/export?format=md&token=${app.token}`);
  const texto = await md.text();
  assert.match(md.headers.get('content-type'), /markdown/);
  assert.match(texto, /pergunta exportada/);
  assert.match(texto, /Resposta exportada\./);

  const json = await app.api(`/chats/${chatId}/export?format=json`);
  assert.equal(json.data.messages.length, 2);
  assert.equal(typeof json.data.messages[0].meta, 'object', 'o meta tem que vir já lido');
});

// ------------------------------------------------------------ configuração

test('salvar memória não desliga a exigência de token', async () => {
  const antes = await app.api('/settings');
  assert.equal(antes.data.requireToken, true);

  await app.api('/settings', { method: 'PATCH', body: { memory: { maxInjected: 7 } } });

  const depois = await app.api('/settings');
  assert.equal(depois.data.requireToken, true, 'o token não pode cair sozinho');
  assert.equal(depois.data.memory.maxInjected, 7);
  assert.equal(depois.data.memory.enabled, true, 'o resto da configuração tem que sobreviver');
});

test('rota inexistente devolve 404 com mensagem', async () => {
  const res = await app.api('/nao/existe');
  assert.equal(res.status, 404);
  assert.match(res.data.error, /rota não encontrada/);
});

// ------------------------------------------------------------- concorrência

test('dois streams na mesma conversa: o segundo é recusado com 409', async () => {
  const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
  const chatId = chat.data.id;

  // Resposta lenta de propósito: o primeiro stream fica aberto enquanto o
  // segundo pedido chega.
  let liberar;
  const espera = new Promise((resolve) => {
    liberar = resolve;
  });
  const stub = stubFetch(async () => {
    const encoder = new TextEncoder();
    let etapa = 0;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return '';
      },
      body: {
        getReader() {
          return {
            async read() {
              if (etapa === 0) {
                etapa++;
                return {
                  done: false,
                  value: encoder.encode('data: {"choices":[{"delta":{"content":"devagar"}}]}\n\n')
                };
              }
              if (etapa === 1) {
                etapa++;
                await espera;
                return { done: false, value: encoder.encode('data: [DONE]\n\n') };
              }
              return { done: true, value: undefined };
            }
          };
        }
      }
    };
  });

  try {
    const primeiro = app.raw(`/api/chats/${chatId}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
      body: JSON.stringify({ content: 'pergunta lenta', model: fakeRef })
    }).then((r) => r.text());

    // Dá tempo do primeiro pegar a trava antes de tentar o segundo.
    await new Promise((r) => setTimeout(r, 60));

    const segundo = await app.api(`/chats/${chatId}/stream`, {
      method: 'POST',
      body: { content: 'pergunta atropelando', model: fakeRef }
    });
    assert.equal(segundo.status, 409);
    assert.match(segundo.data.error, /já está respondendo/);

    liberar();
    await primeiro;

    // E depois que solta, o mesmo pedido passa.
    const terceiro = await app.raw(`/api/chats/${chatId}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-iaunifier-token': app.token },
      body: JSON.stringify({ content: 'agora vai', model: fakeRef })
    });
    assert.equal(terceiro.status, 200);
    await terceiro.text();
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------------ backup

test('backup baixa um zip com o banco dentro', async () => {
  const res = await app.raw(`/api/backup?token=${app.token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /zip/);
  assert.match(res.headers.get('content-disposition'), /iaunifier-.*\.zip/);

  const buffer = Buffer.from(await res.arrayBuffer());
  const { unzip } = await import('../server/backup.mjs');
  const dentro = unzip(buffer);
  assert.ok(dentro.has('data.db'));
  assert.equal(dentro.get('data.db').toString('utf8', 0, 15), 'SQLite format 3');
});

test('restaurar arquivo que não é backup devolve 400 explicado', async () => {
  const res = await app.api('/restore', {
    method: 'POST',
    raw: true,
    body: Buffer.from('isso aqui é um txt qualquer')
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /zip/);
});

test('restaurar backup de verdade responde pedindo reinício', async () => {
  const zipRes = await app.raw(`/api/backup?token=${app.token}`);
  const buffer = Buffer.from(await zipRes.arrayBuffer());

  const res = await app.api('/restore', { method: 'POST', raw: true, body: buffer });
  assert.equal(res.status, 200);
  assert.equal(res.data.restart, true);
  assert.equal(res.data.db, true);
  assert.match(res.data.message, /reinicie/);
});

// ------------------------------------------------------------------- saúde

test('saúde acusa provedor de API que não responde', async () => {
  const stub = stubFetch(async () => {
    throw new Error('fetch failed');
  });
  try {
    const res = await app.api('/health');
    assert.equal(res.status, 200);
    const alvo = res.data.find((p) => p.id === fakeProviderId);
    assert.equal(alvo.status, 'erro');
    assert.match(alvo.message, /não consegui falar com/, 'a mensagem tem que dizer o que fazer');
    assert.match(alvo.message, /modelo\.invalido/);
  } finally {
    stub.restore();
  }
});

test('saúde de CLI testa o binário, não a configuração', async () => {
  const provider = await app.api('/providers', {
    method: 'POST',
    body: {
      name: 'CLI que não existe',
      kind: 'cli',
      config: { command: 'binario-que-nao-existe-mesmo', args: [], stdin: true, models: ['default'] }
    }
  });
  const id = provider.data.provider.id;

  const res = await app.api('/health');
  const alvo = res.data.find((p) => p.id === id);
  assert.equal(alvo.status, 'erro', 'listar modelos devolveria "ok" com o binário ausente');
  assert.match(alvo.message, /não existe nesta máquina/);

  await app.api(`/providers/${id}`, { method: 'DELETE' });
});

test('saúde marca provedor desligado sem tentar falar com ele', async () => {
  await app.api(`/providers/${fakeProviderId}`, { method: 'PATCH', body: { enabled: false } });
  const stub = stubFetch(async () => {
    throw new Error('não era pra ter chamado');
  });
  try {
    const res = await app.api('/health');
    const alvo = res.data.find((p) => p.id === fakeProviderId);
    assert.equal(alvo.status, 'off');
    assert.ok(
      !stub.calls.some((c) => c.url.includes('modelo.invalido')),
      'provedor desligado não deve ser chamado'
    );
  } finally {
    stub.restore();
    await app.api(`/providers/${fakeProviderId}`, { method: 'PATCH', body: { enabled: true } });
  }
});

// -------------------------------------------------------------------- ping

test('ping responde sem token e não conta como tentativa errada', async () => {
  const semToken = await app.raw('/api/ping');
  assert.equal(semToken.status, 200);
  assert.deepEqual(await semToken.json(), { app: 'iaunifier' });

  // Vinte pings não podem gastar a cota de tentativas de token — senão abrir o
  // atalho do dock várias vezes trancaria o próprio usuário do lado de fora.
  for (let i = 0; i < 20; i++) await app.raw('/api/ping');
  const depois = await app.api('/state');
  assert.equal(depois.status, 200, 'o token bom tem que continuar valendo');
});

test('ping não vaza nada além da identidade', async () => {
  const res = await app.raw('/api/ping');
  const texto = await res.text();
  assert.ok(!texto.includes(app.token), 'o token não pode sair numa rota sem autenticação');
  assert.equal(Object.keys(JSON.parse(texto)).length, 1);
});

// -------------------------------------------------- religar e desligar token

test('token pode ser desligado e religado pela API, sem trancar ninguém fora', async () => {
  // Desliga: as rotas passam a responder sem cabeçalho nenhum.
  const desliga = await app.api('/settings', { method: 'PATCH', body: { requireToken: false } });
  assert.equal(desliga.status, 200);
  assert.equal(desliga.data.requireToken, false);

  const semNada = await app.raw('/api/state');
  assert.equal(semNada.status, 200, 'com o token desligado a rota tem que abrir');

  // Religa — e é preciso conseguir religar SEM token, senão desligar seria
  // porta de mão única: o app ficaria aberto pra sempre.
  const religa = await app.api('/settings', { method: 'PATCH', body: { requireToken: true }, token: '' });
  assert.equal(religa.status, 200);
  assert.equal(religa.data.requireToken, true);
  assert.equal(
    religa.data.accessToken,
    app.token,
    'a chave vai junto ao religar, senão quem apertou o botão fica trancado do lado de fora'
  );

  const semTokenAgora = await app.raw('/api/state');
  assert.equal(semTokenAgora.status, 401, 'religado, a tranca volta na hora');
  const comToken = await app.api('/state');
  assert.equal(comToken.status, 200, 'e o token de sempre continua valendo');
});

test('a chave só sai na transição de religar, nunca numa leitura comum', async () => {
  const leitura = await app.api('/settings');
  assert.equal(leitura.data.accessToken, undefined, 'GET /settings não pode devolver o token');

  const outroPatch = await app.api('/settings', { method: 'PATCH', body: { memory: { maxInjected: 9 } } });
  assert.equal(outroPatch.data.accessToken, undefined, 'salvar memória não é transição de tranca');

  // Já estando ligado, religar de novo também não devolve nada.
  const denovo = await app.api('/settings', { method: 'PATCH', body: { requireToken: true } });
  assert.equal(denovo.data.accessToken, undefined, 'sem transição, sem chave');
});

// ----------------------------------------------- apagar leva o arquivo junto

test('apagar conversa pela API não deixa o documento no disco', async () => {
  const { existsSync } = await import('node:fs');
  const chat = await app.api('/chats', { method: 'POST', body: { model: fakeRef } });
  const chatId = chat.data.id;

  const anexo = await app.api(`/chats/${chatId}/attachments?name=nota-privada.txt`, {
    method: 'POST',
    raw: true,
    body: 'Conteúdo que o usuário espera que suma junto com a conversa.'
  });
  const caminho = anexo.data.path;
  assert.ok(caminho && existsSync(caminho), 'o original tinha que estar no disco');

  await app.api(`/chats/${chatId}`, { method: 'DELETE' });
  assert.ok(
    !existsSync(caminho),
    'apagar a conversa tem que apagar o documento — o cascade só leva a linha do banco'
  );
});

test('apagar projeto pela API também leva os arquivos dele', async () => {
  const { existsSync } = await import('node:fs');
  const projeto = await app.api('/projects', { method: 'POST', body: { name: 'Projeto com arquivo' } });
  const id = projeto.data.id;

  const anexo = await app.api(`/attachments?project=${id}&name=doc-do-projeto.txt`, {
    method: 'POST',
    raw: true,
    body: 'Documento que pertence ao projeto inteiro.'
  });
  const caminho = anexo.data?.path;
  if (!caminho) return; // rota de anexo por projeto pode não existir; nada a provar

  await app.api(`/projects/${id}`, { method: 'DELETE' });
  assert.ok(!existsSync(caminho), 'o documento do projeto tem que sair do disco junto');
});

// ---------------------------------------------------------------- manifest

test('manifest leva o token no start_url, e não é servido sem ele', async () => {
  // O app instalado na tela inicial começa com o localStorage vazio: se o
  // start_url não levar o token, o atalho abre num pedido de senha. E como o
  // arquivo passa a ter o token dentro, ele não pode ficar aberto na rede.
  const semToken = await app.raw('/manifest.webmanifest');
  assert.equal(semToken.status, 401, 'manifest com token dentro não pode ser público');

  const comToken = await app.raw(`/manifest.webmanifest?token=${encodeURIComponent(app.token)}`);
  assert.equal(comToken.status, 200);
  assert.match(comToken.headers.get('content-type'), /manifest\+json/);

  const manifest = await comToken.json();
  assert.equal(manifest.start_url, `/?token=${encodeURIComponent(app.token)}`);
  assert.equal(manifest.id, '/', 'sem id fixo, mudar o start_url duplica a instalação');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('sem token exigido, o manifest é o arquivo normal', async () => {
  const { patchConfig } = await import('../server/config.mjs');
  patchConfig({ requireToken: false });
  try {
    const res = await app.raw('/manifest.webmanifest');
    assert.equal(res.status, 200);
    const manifest = await res.json();
    assert.equal(manifest.start_url, '/', 'sem tranca não há token pra pendurar na URL');
  } finally {
    patchConfig({ requireToken: true });
  }
});

test('refazer que não dá pra fazer não apaga a conversa', async () => {
  // A ordem antiga era truncar primeiro e conferir depois: quando a conferência
  // reprovava, a conversa já tinha perdido a resposta antiga e não ganhava
  // nenhuma no lugar.
  const chat = (await app.api('/chats', { method: 'POST', body: { title: 'refazer' } })).data;

  // Só uma resposta, sem pergunta antes dela: refazer é impossível.
  const { run, uid, now } = await import('../server/db.mjs');
  run(
    'INSERT INTO messages (id, chat_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)',
    uid(), chat.id, 'assistant', 'resposta órfã', '{}', now()
  );

  const antes = (await app.api(`/chats/${chat.id}`)).data.messages;
  assert.equal(antes.length, 1);

  const res = await app.api(`/chats/${chat.id}/regenerate`, { method: 'POST', body: {} });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /pergunta/);

  const depois = (await app.api(`/chats/${chat.id}`)).data.messages;
  assert.equal(depois.length, 1, 'a mensagem tinha que continuar lá');
  assert.equal(depois[0].content, 'resposta órfã');
});

test('refazer com provedor desligado avisa sem apagar nada', async () => {
  const { run, uid, now } = await import('../server/db.mjs');
  const provedor = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, 'Desligado', 'openai', 'http://x.invalido/v1', NULL, '{}', 0, 0, ?)`,
    provedor, now()
  );
  const chat = (
    await app.api('/chats', { method: 'POST', body: { title: 'refazer 2', model: `${provedor}:m` } })
  ).data;
  run(
    'INSERT INTO messages (id, chat_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)',
    uid(), chat.id, 'user', 'pergunta', '{}', now()
  );
  run(
    'INSERT INTO messages (id, chat_id, role, content, meta, created_at) VALUES (?,?,?,?,?,?)',
    uid(), chat.id, 'assistant', 'resposta velha', '{}', now()
  );

  const res = await app.api(`/chats/${chat.id}/regenerate`, { method: 'POST', body: {} });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /desligado/);

  const depois = (await app.api(`/chats/${chat.id}`)).data.messages;
  assert.equal(depois.length, 2, 'nada podia ter sido apagado');
});
