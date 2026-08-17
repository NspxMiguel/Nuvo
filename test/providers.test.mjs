// Adaptadores de provedor: cada um fala um dialeto diferente, e o resto do
// app só enxerga {delta}, {reasoning} e {usage}.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome, stubFetch, fakeResponse, collect } from './helpers.mjs';

const home = useTempHome();
const openai = await import('../server/providers/openai.mjs');
const anthropic = await import('../server/providers/anthropic.mjs');
const google = await import('../server/providers/google.mjs');
const ollama = await import('../server/providers/ollama.mjs');
const cli = await import('../server/providers/cli.mjs');
const { parseRef, refOf } = await import('../server/providers/index.mjs');

after(() => home.cleanup());

// ------------------------------------------------------------------- refs

test('ref separa no primeiro dois-pontos, então llama3:8b sobrevive', () => {
  const { providerId, modelId } = parseRef('abc-123:llama3:8b');
  assert.equal(providerId, 'abc-123');
  assert.equal(modelId, 'llama3:8b');
  assert.equal(refOf(providerId, modelId), 'abc-123:llama3:8b');
});

test('ref inválido reclama', () => {
  assert.throws(() => parseRef('sem-dois-pontos'), /modelo inválido/);
});

// ----------------------------------------------------------------- openai

test('openai: junta os pedaços e normaliza o uso', async () => {
  const stub = stubFetch(async () =>
    fakeResponse([
      'data: {"choices":[{"delta":{"content":"parte um "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"pensando..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"parte dois"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":12,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n'
    ])
  );
  try {
    const saida = await collect(
      openai.stream({ baseUrl: 'http://x/v1' }, { model: 'm', messages: [{ role: 'user', content: 'oi' }] })
    );
    assert.equal(saida.filter((c) => c.delta).map((c) => c.delta).join(''), 'parte um parte dois');
    assert.ok(saida.some((c) => c.reasoning === 'pensando...'));
    const uso = saida.find((c) => c.usage).usage;
    assert.deepEqual(uso, { input: 12, output: 5 });
  } finally {
    stub.restore();
  }
});

test('openai: erro do provedor vira exceção com a mensagem dele', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(['data: {"error":{"message":"modelo não existe"}}\n\n'])
  );
  try {
    await assert.rejects(
      collect(openai.stream({ baseUrl: 'http://x/v1' }, { model: 'm', messages: [] })),
      /modelo não existe/
    );
  } finally {
    stub.restore();
  }
});

test('openai: HTTP de erro traz o status e o corpo', async () => {
  const stub = stubFetch(async () => fakeResponse('chave inválida', { ok: false, status: 401 }));
  try {
    await assert.rejects(
      collect(openai.stream({ baseUrl: 'http://x/v1' }, { model: 'm', messages: [] })),
      /401/
    );
  } finally {
    stub.restore();
  }
});

test('openai: sampling só vai quando pedido', async () => {
  const stub = stubFetch(async () => fakeResponse(['data: [DONE]\n\n']));
  try {
    await collect(openai.stream({ baseUrl: 'http://x/v1' }, { model: 'm', messages: [] }));
    let corpo = JSON.parse(stub.calls[0].options.body);
    assert.ok(!('temperature' in corpo));
    assert.ok(!('top_p' in corpo));

    await collect(
      openai.stream({ baseUrl: 'http://x/v1' }, { model: 'm', messages: [], temperature: 0.4, topP: 0.8, maxTokens: 99 })
    );
    corpo = JSON.parse(stub.calls[1].options.body);
    assert.equal(corpo.temperature, 0.4);
    assert.equal(corpo.top_p, 0.8);
    assert.equal(corpo.max_tokens, 99);
  } finally {
    stub.restore();
  }
});

// -------------------------------------------------------------- anthropic

test('anthropic: texto, raciocínio e uso', async () => {
  const stub = stubFetch(async () =>
    fakeResponse([
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"olá"}}\n\n',
      'data: {"type":"message_delta","usage":{"input_tokens":8,"output_tokens":3}}\n\n'
    ])
  );
  try {
    const saida = await collect(
      anthropic.stream({ apiKey: 'k' }, { model: 'claude-opus-5', messages: [{ role: 'user', content: 'oi' }] })
    );
    assert.ok(saida.some((c) => c.reasoning === 'hmm'));
    assert.ok(saida.some((c) => c.delta === 'olá'));
    assert.deepEqual(saida.find((c) => c.usage).usage, { input: 8, output: 3 });
  } finally {
    stub.restore();
  }
});

test('anthropic: modelo novo não recebe temperature (a API devolve 400)', async () => {
  const stub = stubFetch(async () => fakeResponse([]));
  try {
    await collect(
      anthropic.stream({ apiKey: 'k' }, { model: 'claude-opus-5', messages: [], temperature: 0.7, topP: 0.5 })
    );
    const corpo = JSON.parse(stub.calls[0].options.body);
    assert.ok(!('temperature' in corpo), 'opus-5 não aceita temperature');
    assert.ok(!('top_p' in corpo));

    await collect(
      anthropic.stream({ apiKey: 'k' }, { model: 'claude-haiku-4-5', messages: [], temperature: 0.7 })
    );
    const antigo = JSON.parse(stub.calls[1].options.body);
    assert.equal(antigo.temperature, 0.7, 'modelo antigo continua aceitando');
  } finally {
    stub.restore();
  }
});

test('anthropic: max_tokens é obrigatório e sempre vai', async () => {
  const stub = stubFetch(async () => fakeResponse([]));
  try {
    await collect(anthropic.stream({ apiKey: 'k' }, { model: 'claude-opus-5', messages: [] }));
    const corpo = JSON.parse(stub.calls[0].options.body);
    assert.ok(corpo.max_tokens > 0);
  } finally {
    stub.restore();
  }
});

test('anthropic: recusa por política vira texto visível, não silêncio', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(['data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n'])
  );
  try {
    const saida = await collect(anthropic.stream({ apiKey: 'k' }, { model: 'claude-opus-5', messages: [] }));
    assert.ok(saida.some((c) => /recusou/.test(c.delta || '')));
  } finally {
    stub.restore();
  }
});

// ----------------------------------------------------------------- google

test('google: partes viram delta e o filtro cai quando pedido', async () => {
  const stub = stubFetch(async () =>
    fakeResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"resposta do gemini"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":6}}\n\n'
    ])
  );
  try {
    const saida = await collect(
      google.stream({ apiKey: 'k' }, { model: 'gemini-x', messages: [{ role: 'user', content: 'oi' }], unfiltered: true })
    );
    assert.ok(saida.some((c) => c.delta === 'resposta do gemini'));
    assert.deepEqual(saida.find((c) => c.usage).usage, { input: 4, output: 6 });

    const corpo = JSON.parse(stub.calls[0].options.body);
    assert.equal(corpo.safetySettings.length, 4);
    assert.ok(corpo.safetySettings.every((s) => s.threshold === 'BLOCK_NONE'));
  } finally {
    stub.restore();
  }
});

test('google: papel do assistente vira "model"', async () => {
  const stub = stubFetch(async () => fakeResponse([]));
  try {
    await collect(
      google.stream(
        { apiKey: 'k' },
        { model: 'g', messages: [{ role: 'assistant', content: 'oi' }, { role: 'user', content: 'tudo bem?' }] }
      )
    );
    const corpo = JSON.parse(stub.calls[0].options.body);
    assert.equal(corpo.contents[0].role, 'model');
    assert.equal(corpo.contents[1].role, 'user');
  } finally {
    stub.restore();
  }
});

// ----------------------------------------------------------------- ollama

test('ollama: NDJSON vira delta, e o erro do corpo vira exceção', async () => {
  let stub = stubFetch(async () =>
    fakeResponse([
      '{"message":{"thinking":"pensa"}}\n',
      '{"message":{"content":"resposta local"}}\n',
      '{"done":true,"prompt_eval_count":3,"eval_count":9}\n'
    ])
  );
  try {
    const saida = await collect(ollama.stream({ baseUrl: 'http://o' }, { model: 'llama3', messages: [] }));
    assert.ok(saida.some((c) => c.reasoning === 'pensa'));
    assert.ok(saida.some((c) => c.delta === 'resposta local'));
    assert.deepEqual(saida.find((c) => c.usage).usage, { input: 3, output: 9 });
  } finally {
    stub.restore();
  }

  stub = stubFetch(async () => fakeResponse(['{"error":"modelo não carregado"}\n']));
  try {
    await assert.rejects(
      collect(ollama.stream({ baseUrl: 'http://o' }, { model: 'x', messages: [] })),
      /não carregado/
    );
  } finally {
    stub.restore();
  }
});

test('ollama: listar modelos traz o tamanho no rótulo', async () => {
  const stub = stubFetch(async () =>
    fakeResponse(JSON.stringify({ models: [{ name: 'llama3:8b', size: 4_800_000_000 }, { name: 'nomic-embed-text', size: 270_000_000 }] }))
  );
  try {
    const modelos = await ollama.listModels({ baseUrl: 'http://o' });
    assert.match(modelos[0].label, /4\.5 GB|GB/);
    assert.equal(modelos[0].kind, 'chat');
    assert.equal(modelos[1].kind, 'embedding', 'modelo de embedding tem que ser marcado');
  } finally {
    stub.restore();
  }
});

test('ollama: baixar modelo emite progresso em porcentagem', async () => {
  const stub = stubFetch(async () =>
    fakeResponse([
      '{"status":"pulling manifest"}\n',
      '{"status":"downloading","completed":50,"total":200}\n',
      '{"status":"success"}\n'
    ])
  );
  try {
    const passos = await collect(ollama.pull({ baseUrl: 'http://o' }, { model: 'llama3' }));
    assert.equal(passos[1].percent, 25);
    assert.equal(passos.at(-1).status, 'success');
  } finally {
    stub.restore();
  }
});

// -------------------------------------------------------------------- cli

test('cli: manda o prompt pelo stdin e devolve o stdout', async () => {
  const saida = await collect(
    cli.stream(
      { config: { command: 'cat', args: [], stdin: true } },
      { model: 'default', system: 'Instrução do sistema', messages: [{ role: 'user', content: 'texto que volta' }] }
    )
  );
  const texto = saida.filter((c) => c.delta).map((c) => c.delta).join('');
  assert.match(texto, /texto que volta/);
  assert.match(texto, /Instrução do sistema/, 'o system prompt entra no texto achatado');
});

test('cli: comando que não existe vira erro explicado', async () => {
  await assert.rejects(
    collect(
      cli.stream(
        { config: { command: 'comando-que-nao-existe-mesmo', args: [], stdin: true } },
        { model: 'default', messages: [{ role: 'user', content: 'oi' }] }
      )
    ),
    /ENOENT|não|spawn/i
  );
});

test('cli: código de saída diferente de zero vira erro', async () => {
  await assert.rejects(
    collect(
      cli.stream(
        { config: { command: 'sh', args: ['-c', 'exit 3'], stdin: true } },
        { model: 'default', messages: [{ role: 'user', content: 'oi' }] }
      )
    ),
    /código 3/
  );
});

test('cli: o motivo que o comando escreveu no stderr entra no erro', async () => {
  // É o caso real do `codex exec` fora de repositório git: só o código de
  // saída não diz nada, e o stderr diz exatamente o que fazer.
  await assert.rejects(
    collect(
      cli.stream(
        {
          config: {
            command: 'sh',
            args: ['-c', 'echo "Not inside a trusted directory" >&2; exit 1'],
            stdin: true
          }
        },
        { model: 'default', messages: [{ role: 'user', content: 'oi' }] }
      )
    ),
    /Not inside a trusted directory/
  );
});

test('cli: sem comando configurado reclama antes de tentar rodar', async () => {
  await assert.rejects(
    collect(cli.stream({ config: {} }, { model: 'default', messages: [] })),
    /sem comando/
  );
});

// ------------------------------------------------------- prazo do provedor

/** Fonte que trava e não ouve cancelamento — o CLI cujo neto ficou com o cano. */
function fonteSurda(antes = []) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of antes) yield item;
      await new Promise(() => {});
    }
  };
}

test('prazo corta mesmo quando a fonte não ouve o cancelamento', async () => {
  const { withStallTimeout } = await import('../server/providers/index.mjs');
  // O prazo é `unref`: num processo sem mais nada pendurado, o Node sairia
  // antes de ele vencer. No servidor de verdade o soquete segura.
  const vida = setInterval(() => {}, 1000);
  try {
    await assert.rejects(async () => {
      for await (const _ of withStallTimeout(() => fonteSurda(), { firstMs: 80, stallMs: 80 })) {
        /* nada chega */
      }
    }, /não respondeu em/);
  } finally {
    clearInterval(vida);
  }
});

test('prazo do meio também corta fonte surda, guardando o que já veio', async () => {
  const { withStallTimeout } = await import('../server/providers/index.mjs');
  const vida = setInterval(() => {}, 1000);
  const recebido = [];
  try {
    await assert.rejects(async () => {
      for await (const item of withStallTimeout(() => fonteSurda([{ delta: 'oi' }]), {
        firstMs: 5000,
        stallMs: 80
      })) {
        recebido.push(item);
      }
    }, /parou de responder no meio/);
  } finally {
    clearInterval(vida);
  }
  assert.deepEqual(recebido, [{ delta: 'oi' }]);
});

test('sinal já cancelado chega no provedor antes da primeira leitura', async () => {
  const { withStallTimeout } = await import('../server/providers/index.mjs');
  const controle = new AbortController();
  controle.abort();

  let viuCancelado = null;
  const abrir = (sinal) => {
    viuCancelado = sinal.aborted;
    return {
      async *[Symbol.asyncIterator]() {
        yield { delta: 'não devia ter rodado' };
      }
    };
  };

  for await (const _ of withStallTimeout(abrir, {
    firstMs: 5000,
    stallMs: 5000,
    signal: controle.signal
  })) {
    /* a fonte falsa ainda emite; o que se checa é o sinal */
  }
  assert.equal(viuCancelado, true, 'o provedor tem que nascer sabendo que foi cancelado');
});

test('cli: comando que sai antes de ler o prompt grande não derruba o servidor', async () => {
  // Prompt maior que o cano do sistema (~64 kB): a escrita fica pendurada
  // esperando alguém ler. O comando sai sem ler, o cano quebra, e o EPIPE
  // subia sem dono — não é a conversa que caía, é o processo inteiro.
  const gigante = 'a'.repeat(300_000);
  const saida = await collect(
    cli.stream(
      { config: { command: 'sh', args: ['-c', 'echo pronto'], stdin: true } },
      { model: 'default', messages: [{ role: 'user', content: gigante }] }
    )
  );
  assert.match(saida.map((c) => c.delta || '').join(''), /pronto/);
});

test('cli: cancelar mata o neto, não só o filho', async () => {
  const controle = new AbortController();
  const marca = `iaunifier-teste-${process.pid}-neto`;
  // O `sh` é o filho; o `sleep` é o neto. Matar só o filho deixava o neto vivo.
  const iterador = cli.stream(
    { config: { command: 'sh', args: ['-c', `sleep 30 & echo ${marca}; wait`], stdin: true } },
    { model: 'default', messages: [{ role: 'user', content: 'oi' }], signal: controle.signal }
  );

  for await (const chunk of iterador) {
    if (String(chunk.delta || '').includes(marca)) break;
  }
  controle.abort();
  await iterador.return?.();

  // Espera o sinal chegar antes de perguntar quem sobrou.
  await new Promise((r) => setTimeout(r, 400));
  const { execSync } = await import('node:child_process');
  const vivos = execSync('ps -A -o command= || true', { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.includes(marca) && !l.includes('ps -A'));
  assert.deepEqual(vivos, [], `sobrou processo do teste: ${vivos.join(' | ')}`);
});

test('corpo da resposta é fechado quando o stream acaba antes do fim', async () => {
  // O SSE do OpenAI termina em [DONE] e o gerador sai ali, com bytes ainda por
  // vir. Sem fechar o corpo, o soquete fica preso e o provedor segue gerando —
  // e cobrando — do outro lado.
  const resposta = fakeResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'oi' } }] })}\n\n`,
    'data: [DONE]\n\n',
    'data: {"nunca":"lido"}\n\n'
  ]);
  const stub = stubFetch(async () => resposta);
  try {
    await collect(
      openai.stream(
        { config: {}, baseUrl: 'http://provedor.invalido/v1', secret: null },
        { model: 'x', messages: [{ role: 'user', content: 'oi' }] }
      )
    );
  } finally {
    stub.restore();
  }
  assert.equal(resposta.cancelado.vezes, 1, 'o corpo tinha que ter sido fechado');
});
