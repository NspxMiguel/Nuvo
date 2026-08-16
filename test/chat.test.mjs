// O turno de conversa: onde gem, projeto, memória, anexo e provedor se
// encontram. O modelo é encenado; o que se testa é o que o servidor monta,
// grava e devolve.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, stubFetch, fakeResponse, collect } from './helpers.mjs';

const home = useTempHome();
const chat = await import('../server/chat.mjs');
const { run, all, one, uid, now } = await import('../server/db.mjs');
const { addMemory, listMemories } = await import('../server/memory.mjs');
const { addAttachment } = await import('../server/documents.mjs');

after(() => home.cleanup());

// Um provedor OpenAI-like: o corpo do pedido é o que se inspeciona nos testes.
const providerId = uid();
run(
  `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
   VALUES (?, 'Provedor de teste', 'openai', 'http://provedor.invalido/v1', NULL, '{}', 1, 0, ?)`,
  providerId, now()
);
run(
  'INSERT INTO models (id, provider_id, model_id, label, kind, seen_at) VALUES (?,?,?,?,?,?)',
  uid(), providerId, 'modelo-x', 'modelo-x', 'chat', now()
);
const REF = `${providerId}:modelo-x`;

/** Resposta em pedaços, opcionalmente com contagem de tokens. */
function respostaEm(pedacos, usage) {
  const linhas = pedacos.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
  if (usage) linhas.push(`data: ${JSON.stringify({ usage })}\n\n`);
  linhas.push('data: [DONE]\n\n');
  return fakeResponse(linhas);
}

/** Corpo JSON do enésimo pedido feito ao provedor. */
function pedido(stub, i = 0) {
  return JSON.parse(stub.calls[i].options.body);
}

// ----------------------------------------------------------- turno básico

test('turno grava pergunta e resposta, e nomeia a conversa', async () => {
  const c = chat.createChat({ title: 'Nova conversa', model: REF });
  const stub = stubFetch(async () => respostaEm(['Olá! ', 'Tudo certo.'], { prompt_tokens: 10, completion_tokens: 4 }));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'Bom dia, tudo bem?' }));

    assert.equal(eventos[0].type, 'user');
    const texto = eventos.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    assert.equal(texto, 'Olá! Tudo certo.');

    const fim = eventos.find((e) => e.type === 'done');
    assert.equal(fim.message.role, 'assistant');
    assert.equal(fim.message.content, 'Olá! Tudo certo.');
    assert.equal(fim.message.model, REF);

    const msgs = chat.listMessages(c.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user', 'a pergunta tem que vir antes da resposta');
    assert.equal(msgs[1].role, 'assistant');

    assert.equal(chat.getChat(c.id).title, 'Bom dia, tudo bem?', 'o título sai da primeira frase');
  } finally {
    stub.restore();
  }
});

test('estatística usa a contagem do provedor quando ela vem', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['resposta'], { prompt_tokens: 7, completion_tokens: 123 }));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const stats = eventos.find((e) => e.type === 'stats');
    assert.equal(stats.tokens, 123);
    assert.equal(stats.estimated, false);
    assert.ok(stats.ttft !== null, 'tempo até o primeiro token tem que ser medido');
  } finally {
    stub.restore();
  }
});

test('sem contagem do provedor, a estatística sai marcada como estimativa', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['resposta razoavelmente longa aqui']));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const stats = eventos.find((e) => e.type === 'stats');
    assert.equal(stats.estimated, true);
    assert.ok(stats.tokens > 0);
  } finally {
    stub.restore();
  }
});

test('histórico da conversa inteira vai no pedido seguinte', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'primeira' }));
    await collect(chat.runTurn({ chatId: c.id, userContent: 'segunda' }));

    const corpo = pedido(stub, 1);
    const papeis = corpo.messages.filter((m) => m.role !== 'system').map((m) => `${m.role}:${m.content}`);
    assert.deepEqual(papeis, ['user:primeira', 'assistant:ok', 'user:segunda']);
  } finally {
    stub.restore();
  }
});

test('modelo trocado no meio da conversa fica gravado no chat', async () => {
  const c = chat.createChat({ title: 'x', model: null });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'oi', modelRef: REF }));
    assert.equal(chat.getChat(c.id).model, REF);
  } finally {
    stub.restore();
  }
});

test('conversa sem modelo nenhum reclama antes de gastar chamada', async () => {
  const c = chat.createChat({ title: 'x', model: null });
  await assert.rejects(collect(chat.runTurn({ chatId: c.id, userContent: 'oi' })), /nenhum modelo/);
});

test('conversa que não existe reclama', async () => {
  await assert.rejects(collect(chat.runTurn({ chatId: 'nao-existe', userContent: 'oi' })), /não encontrada/);
});

// -------------------------------------------------------- prompt de sistema

test('gem, projeto e modo entram no prompt de sistema', async () => {
  run(
    `INSERT INTO gems (id, name, icon, color, system_prompt, model, temperature, mode, unfiltered, memory_read, memory_write, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    'gem-teste', 'Especialista', 'bot', 'indigo', 'Você é um especialista em pontes.',
    null, null, 'chat', 0, 1, 1, now()
  );
  run(
    'INSERT INTO projects (id, name, icon, color, instructions, workdir, created_at) VALUES (?,?,?,?,?,?,?)',
    'proj-teste', 'Ponte Nova', 'folder', 'slate', 'Sempre use metros, nunca pés.', null, now()
  );
  const c = chat.createChat({ title: 'x', model: REF, gemId: 'gem-teste', projectId: 'proj-teste', mode: 'coding' });

  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'qual o vão livre?' }));
    const sistema = pedido(stub).messages.find((m) => m.role === 'system').content;
    assert.match(sistema, /especialista em pontes/);
    assert.match(sistema, /Ponte Nova/);
    assert.match(sistema, /nunca pés/);
    assert.match(sistema, /Modo coding/);
  } finally {
    stub.restore();
  }
});

test('prompt da conversa ganha do prompt da gem', async () => {
  const c = chat.createChat({ title: 'x', model: REF, gemId: 'gem-teste' });
  run('UPDATE chats SET system_prompt = ? WHERE id = ?', 'Responda só em uma linha.', c.id);
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const sistema = pedido(stub).messages.find((m) => m.role === 'system').content;
    assert.match(sistema, /só em uma linha/);
    assert.ok(!/especialista em pontes/.test(sistema), 'o ajuste da conversa substitui o da gem');
  } finally {
    stub.restore();
  }
});

test('gem sem filtro acrescenta o preâmbulo e avisa o provedor', async () => {
  run(
    `INSERT INTO gems (id, name, icon, color, system_prompt, model, temperature, mode, unfiltered, memory_read, memory_write, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    'gem-livre', 'Sem filtro', 'unlock', 'rose', 'Fale direto.', null, null, 'chat', 1, 1, 1, now()
  );
  const c = chat.createChat({ title: 'x', model: REF, gemId: 'gem-livre' });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const sistema = pedido(stub).messages.find((m) => m.role === 'system').content;
    assert.match(sistema, /sem sermão moral/);
  } finally {
    stub.restore();
  }
});

test('temperature da conversa ganha da temperature da gem', async () => {
  run(
    `INSERT INTO gems (id, name, icon, color, system_prompt, model, temperature, mode, unfiltered, memory_read, memory_write, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    'gem-temp', 'Com temp', 'bot', 'teal', 'oi', null, 0.2, 'chat', 0, 1, 1, now()
  );
  const c = chat.createChat({ title: 'x', model: REF, gemId: 'gem-temp' });
  run('UPDATE chats SET temperature = 0.9 WHERE id = ?', c.id);
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    assert.equal(pedido(stub).temperature, 0.9);
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------------ memória

test('a memória entra no prompt e é anunciada na interface', async () => {
  await addMemory({ text: 'O nome do cachorro do Miguel é Tobias.', kind: 'fact' });
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'como se chama o cachorro?' }));
    const usada = eventos.find((e) => e.type === 'memory-used');
    assert.ok(usada, 'a interface precisa saber que a memória foi usada');
    assert.match(pedido(stub).messages[0].content, /Tobias/);
  } finally {
    stub.restore();
  }
});

test('gem que não lê memória não recebe fato nenhum', async () => {
  run(
    `INSERT INTO gems (id, name, icon, color, system_prompt, model, temperature, mode, unfiltered, memory_read, memory_write, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    'gem-surda', 'Sem memória', 'bot', 'slate', 'oi', null, null, 'chat', 0, 0, 0, now()
  );
  const c = chat.createChat({ title: 'x', model: REF, gemId: 'gem-surda' });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'como se chama o cachorro?' }));
    assert.ok(!eventos.some((e) => e.type === 'memory-used'));
    const sistema = pedido(stub).messages.find((m) => m.role === 'system');
    assert.ok(!sistema || !/Tobias/.test(sistema.content));
  } finally {
    stub.restore();
  }
});

test('o que um modelo aprende, o outro lê — a memória é compartilhada', async () => {
  const antes = listMemories().length;
  const c1 = chat.createChat({ title: 'x', model: REF });
  let stub = stubFetch(async () => respostaEm(['Anotado.']));
  try {
    const eventos = await collect(
      chat.runTurn({ chatId: c1.id, userContent: 'Eu moro em Florianópolis e trabalho com música.' })
    );
    const novos = eventos.find((e) => e.type === 'memory-new');
    assert.ok(novos && novos.items.length > 0, 'a conversa tinha que ter virado fato guardado');
    assert.ok(listMemories().length > antes);
  } finally {
    stub.restore();
  }

  // Outra conversa, outro turno: o fato tem que reaparecer no prompt.
  const c2 = chat.createChat({ title: 'x', model: REF });
  stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c2.id, userContent: 'onde eu moro mesmo?' }));
    assert.match(pedido(stub).messages[0].content, /Florian/);
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------------ anexos

test('anexo da conversa entra no prompt', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  await addAttachment({
    buffer: Buffer.from('O código de acesso do galpão é ZEBRA-88.'),
    name: 'galpao.txt',
    chatId: c.id
  });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'qual o código do galpão?' }));
    assert.ok(eventos.some((e) => e.type === 'docs-used'));
    assert.match(pedido(stub).messages[0].content, /ZEBRA-88/);
  } finally {
    stub.restore();
  }
});

// -------------------------------------------------------------------- web

test('busca na web entra no prompt e as fontes são listadas', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async (url) => {
    if (url.includes('duckduckgo')) {
      return fakeResponse(
        `<div class="result"><a class="result__a" href="https://fonte.org/a">Fonte A</a>
         <a class="result__snippet" href="#">resumo</a></div>`
      );
    }
    if (url.startsWith('https://fonte.org')) {
      return fakeResponse('<html><body><article>A resposta oficial é 42 unidades.</article></body></html>', {
        headers: { 'content-type': 'text/html' }
      });
    }
    return respostaEm(['ok']);
  });
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'quantas unidades?', useWeb: true }));
    const web = eventos.find((e) => e.type === 'web-used');
    assert.equal(web.hits[0].url, 'https://fonte.org/a');
    assert.equal(web.hits[0].ok, true);
    const sistema = pedido(stub, stub.calls.length - 1).messages[0].content;
    assert.match(sistema, /42 unidades/);
  } finally {
    stub.restore();
  }
});

test('busca na web que falha vira aviso, e a resposta sai mesmo assim', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async (url) => {
    if (url.includes('duckduckgo')) return fakeResponse('', { ok: false, status: 500 });
    return respostaEm(['respondi sem a web']);
  });
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'pergunta', useWeb: true }));
    assert.ok(eventos.some((e) => e.type === 'note' && /web falhou/.test(e.text)));
    assert.ok(eventos.some((e) => e.type === 'done'));
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------------- falha

test('provedor que cai no meio grava o pedaço que já tinha chegado', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () =>
    fakeResponse([
      'data: {"choices":[{"delta":{"content":"comecei a responder"}}]}\n\n',
      'data: {"error":{"message":"conexão perdida"}}\n\n'
    ])
  );
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const fim = eventos.find((e) => e.type === 'done');
    assert.ok(fim, 'o pedaço recebido não pode sumir');
    assert.equal(fim.message.content, 'comecei a responder');
    assert.equal(JSON.parse(fim.message.meta).interrupted, true);
    assert.match(eventos.find((e) => e.type === 'error').message, /conexão perdida/);

    const msgs = chat.listMessages(c.id);
    assert.equal(msgs.length, 2, 'pergunta e resposta parcial ficam gravadas');
  } finally {
    stub.restore();
  }
});

test('falha antes do primeiro token não grava resposta vazia', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => fakeResponse('sem chave', { ok: false, status: 401 }));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    assert.ok(!eventos.some((e) => e.type === 'done'));
    assert.match(eventos.find((e) => e.type === 'error').message, /401/);
    assert.equal(chat.listMessages(c.id).filter((m) => m.role === 'assistant').length, 0);
  } finally {
    stub.restore();
  }
});

// -------------------------------------------------------------- regenerar

test('regenerar apaga da resposta pra frente e não duplica a pergunta', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  let stub = stubFetch(async () => respostaEm(['primeira resposta']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'pergunta única' }));
  } finally {
    stub.restore();
  }

  const resposta = chat.listMessages(c.id).find((m) => m.role === 'assistant');
  const apagadas = chat.truncateFrom(c.id, resposta.id);
  assert.equal(apagadas, 1, 'só a resposta cai; a pergunta fica');

  const restantes = chat.listMessages(c.id);
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].role, 'user');

  stub = stubFetch(async () => respostaEm(['segunda resposta']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'pergunta única', resend: true }));
    const msgs = chat.listMessages(c.id);
    assert.equal(msgs.length, 2, 'a pergunta não pode ter sido gravada de novo');
    assert.equal(msgs[1].content, 'segunda resposta');
  } finally {
    stub.restore();
  }
});

test('regenerar no meio da conversa leva junto tudo que veio depois', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['resposta']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'um' }));
    await collect(chat.runTurn({ chatId: c.id, userContent: 'dois' }));
    await collect(chat.runTurn({ chatId: c.id, userContent: 'três' }));
  } finally {
    stub.restore();
  }
  const msgs = chat.listMessages(c.id);
  assert.equal(msgs.length, 6);

  // Volta pra resposta do primeiro turno: sobra só a pergunta "um".
  const apagadas = chat.truncateFrom(c.id, msgs[1].id);
  assert.equal(apagadas, 5);
  assert.deepEqual(chat.listMessages(c.id).map((m) => m.content), ['um']);
});

test('apagar conversa leva as mensagens junto', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
  } finally {
    stub.restore();
  }
  run('DELETE FROM chats WHERE id = ?', c.id);
  assert.equal(all('SELECT id FROM messages WHERE chat_id = ?', c.id).length, 0);
});

// ------------------------------------------------------------- travamento

test('modelo que nunca responde é cortado, e a conversa não fica presa', async () => {
  const { patchConfig } = await import('../server/config.mjs');
  patchConfig({ limits: { firstChunkSeconds: 0.15, stallSeconds: 0.15 } });

  const c = chat.createChat({ title: 'x', model: REF });
  // Conexão aceita, resposta que nunca vem — igual ao fetch de verdade, a
  // leitura só termina quando o sinal aborta.
  const stub = stubFetch(async (_url, options) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() {
      return '';
    },
    body: {
      getReader() {
        return {
          read() {
            return new Promise((_, reject) => {
              options.signal?.addEventListener(
                'abort',
                () => reject(Object.assign(new Error('abortado'), { name: 'AbortError' })),
                { once: true }
              );
            });
          }
        };
      }
    }
  }));

  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const erro = eventos.find((e) => e.type === 'error');
    assert.ok(erro, 'o turno tinha que terminar em erro em vez de pendurar');
    assert.match(erro.message, /não respondeu/);
    assert.ok(!eventos.some((e) => e.type === 'done'), 'sem resposta, nada a gravar');
  } finally {
    stub.restore();
    patchConfig({ limits: { firstChunkSeconds: 240, stallSeconds: 120 } });
  }
});

test('modelo que para no meio grava o pedaço e explica', async () => {
  const { patchConfig } = await import('../server/config.mjs');
  patchConfig({ limits: { firstChunkSeconds: 5, stallSeconds: 0.15 } });

  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async (_url, options) => {
    const encoder = new TextEncoder();
    let primeiro = true;
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
            read() {
              if (primeiro) {
                primeiro = false;
                return Promise.resolve({
                  done: false,
                  value: encoder.encode('data: {"choices":[{"delta":{"content":"comecei e travei"}}]}\n\n')
                });
              }
              return new Promise((_, reject) => {
                options.signal?.addEventListener(
                  'abort',
                  () => reject(Object.assign(new Error('abortado'), { name: 'AbortError' })),
                  { once: true }
                );
              });
            }
          };
        }
      }
    };
  });

  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const fim = eventos.find((e) => e.type === 'done');
    assert.equal(fim.message.content, 'comecei e travei', 'o que chegou não pode se perder');
    assert.match(eventos.find((e) => e.type === 'error').message, /parou de responder no meio/);
  } finally {
    stub.restore();
    patchConfig({ limits: { firstChunkSeconds: 240, stallSeconds: 120 } });
  }
});

// -------------------------------------------------------- conversa longa

test('conversa longa avisa que o modelo não recebeu tudo', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  // 44 mensagens gravadas direto: o limite de histórico é 40.
  for (let i = 0; i < 22; i++) {
    chat.addMessage(c.id, 'user', `pergunta ${i}`, null);
    chat.addMessage(c.id, 'assistant', `resposta ${i}`, REF);
  }

  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'a última' }));
    const corte = eventos.find((e) => e.type === 'history-cut');
    assert.ok(corte, 'o corte silencioso é o que faz o modelo parecer amnésico');
    assert.equal(corte.sent, 40);
    assert.equal(corte.total, 45, '44 gravadas antes mais a desta rodada');
    assert.equal(corte.dropped, 5);

    // E o que foi de fato enviado bate com o anunciado.
    const enviadas = pedido(stub).messages.filter((m) => m.role !== 'system');
    assert.equal(enviadas.length, 40);
    assert.equal(enviadas.at(-1).content, 'a última', 'o fim da conversa é o que tem que ir');
  } finally {
    stub.restore();
  }
});

test('conversa curta não anuncia corte nenhum', async () => {
  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['ok']));
  try {
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    assert.ok(!eventos.some((e) => e.type === 'history-cut'));
  } finally {
    stub.restore();
  }
});

test('extrator pendurado não segura a conversa depois da resposta', async () => {
  // Aprender roda depois do 'done', mas ainda dentro do turno — e é o turno que
  // segura a tranca da conversa e o stream. Extrator que não volta deixava a
  // conversa recusando pergunta com 409 pra sempre.
  const { patchConfig, loadConfig } = await import('../server/config.mjs');
  const cliId = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, 'Extrator travado', 'cli', NULL, NULL, ?, 1, 0, ?)`,
    cliId,
    JSON.stringify({ command: 'sh', args: ['-c', 'sleep 30'], stdin: true }),
    now()
  );

  const memoriaAntes = loadConfig().memory;
  const limitesAntes = loadConfig().limits;
  patchConfig({
    memory: { enabled: true, autoExtract: true, extractorModel: `${cliId}:default` },
    limits: { learnSeconds: 0.3 }
  });

  const c = chat.createChat({ title: 'x', model: REF });
  const stub = stubFetch(async () => respostaEm(['pronto']));
  try {
    const comecou = Date.now();
    const eventos = await collect(chat.runTurn({ chatId: c.id, userContent: 'oi' }));
    const gasto = Date.now() - comecou;
    assert.ok(eventos.find((e) => e.type === 'done'), 'a resposta tinha que ficar gravada');
    assert.ok(gasto < 5000, `o turno levou ${gasto}ms esperando o extrator`);
  } finally {
    stub.restore();
    patchConfig({ memory: memoriaAntes, limits: limitesAntes });
  }
});
