// Cota estourada: o que o app faz quando o provedor responde 429.
//
// Cota por minuto passa sozinha em segundos e vale esperar; cota diária não
// passa hoje e insistir só empurra o erro pra frente. O teste sobe um servidor
// HTTP de mentira — nada sai da máquina.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { complete } = await import('../server/complete.mjs');
const { createProvider } = await import('../server/providers/index.mjs');

/** Um provedor OpenAI-like que segue um roteiro de respostas. */
function servidorComRoteiro(respostas) {
  const pedidos = [];
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (p) => (corpo += p));
    req.on('end', () => {
      pedidos.push(corpo);
      const proxima = respostas.shift() || { status: 200, texto: 'fim' };
      if (proxima.status !== 200) {
        res.writeHead(proxima.status, {
          'content-type': 'application/json',
          ...(proxima.retryAfter ? { 'retry-after': String(proxima.retryAfter) } : {})
        });
        return res.end(JSON.stringify({ error: { message: proxima.mensagem || 'sem cota' } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: proxima.texto } }] })}\n\n`
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return { srv, pedidos };
}

async function palco(respostas) {
  const { srv, pedidos } = servidorComRoteiro(respostas);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const porta = srv.address().port;
  const p = createProvider({
    name: 'Falso',
    kind: 'openai',
    baseUrl: `http://127.0.0.1:${porta}/v1`,
    secretName: null,
    config: { models: ['m'] },
    auto: 0
  });
  return { ref: `${p.id}:m`, pedidos, fechar: () => new Promise((ok) => srv.close(ok)) };
}

after(() => home.cleanup());

test('cota por minuto: espera o tempo que o provedor pediu e tenta de novo', async () => {
  const { ref, pedidos, fechar } = await palco([
    { status: 429, retryAfter: 1, mensagem: 'tokens per minute' },
    { status: 200, texto: 'saiu na segunda' }
  ]);
  try {
    const t0 = Date.now();
    const r = await complete(ref, { prompt: 'oi' });
    assert.equal(r.text, 'saiu na segunda');
    assert.equal(pedidos.length, 2, 'tentou duas vezes');
    assert.ok(Date.now() - t0 >= 1000, 'e esperou de verdade antes da segunda');
  } finally {
    await fechar();
  }
});

test('cota diária: não insiste, porque a espera pedida é longa demais', async () => {
  const { ref, pedidos, fechar } = await palco([
    {
      status: 429,
      mensagem: 'tokens per day (TPD): Limit 200000. Please try again in 1h16m39.504s'
    }
  ]);
  try {
    await assert.rejects(() => complete(ref, { prompt: 'oi' }), (err) => {
      assert.equal(err.httpStatus, 429);
      assert.match(err.message, /HTTP 429/);
      return true;
    });
    assert.equal(pedidos.length, 1, 'uma tentativa só');
  } finally {
    await fechar();
  }
});

test('o tempo de espera também é lido da frase, quando não vem no cabeçalho', async () => {
  const { ref, pedidos, fechar } = await palco([
    { status: 429, mensagem: 'Please try again in 1.5s' },
    { status: 200, texto: 'pronto' }
  ]);
  try {
    const r = await complete(ref, { prompt: 'oi' });
    assert.equal(r.text, 'pronto');
    assert.equal(pedidos.length, 2);
  } finally {
    await fechar();
  }
});

test('erro que não é de cota sai na primeira, sem repetir o pedido', async () => {
  const { ref, pedidos, fechar } = await palco([{ status: 401, mensagem: 'chave inválida' }]);
  try {
    await assert.rejects(() => complete(ref, { prompt: 'oi' }));
    assert.equal(pedidos.length, 1, 'chave errada não melhora esperando');
  } finally {
    await fechar();
  }
});

test('depois de três tentativas o erro sobe, em vez de repetir pra sempre', async () => {
  const { ref, pedidos, fechar } = await palco([
    { status: 503, mensagem: 'fora do ar' },
    { status: 503, mensagem: 'fora do ar' },
    { status: 503, mensagem: 'fora do ar' },
    { status: 200, texto: 'tarde demais' }
  ]);
  try {
    await assert.rejects(() => complete(ref, { prompt: 'oi' }));
    assert.equal(pedidos.length, 3);
  } finally {
    await fechar();
  }
});
