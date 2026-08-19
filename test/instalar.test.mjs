// Instalador do Ollama. Nada aqui sai pra rede nem instala coisa nenhuma: o
// download é encenado e o "Ollama instalado" é um arquivo qualquer numa pasta
// temporária, que não roda.

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome, stubFetch, fakeResponse } from './helpers.mjs';

const home = useTempHome();
const { estadoDoOllama, ligarOllama, instalarOllama, baixarArquivo, receitaManual } = await import(
  '../server/instalar.mjs'
);

before(() => {
  // Quem roda o teste pode ter as duas variáveis no ambiente dele, e aí o
  // resultado dependeria da máquina em vez do código.
  delete process.env.OLLAMA_HOST;
});

after(() => {
  delete process.env.IAUNIFIER_OLLAMA_BIN;
  home.cleanup();
});

/** Nada atende no 11434 — é a máquina sem Ollama nenhum. */
function portaMorta() {
  return stubFetch(
    async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    },
    // A sonda é justamente no 127.0.0.1: aqui o localhost precisa ser encenado.
    { passthroughLocalhost: false }
  );
}

/** O Ollama respondendo, com ou sem a rota de versão. */
function portaViva({ versao = null } = {}) {
  return stubFetch(
    async (url) => {
      if (url.endsWith('/api/tags')) return fakeResponse(JSON.stringify({ models: [] }));
      if (url.endsWith('/api/version')) {
        if (!versao) return fakeResponse('não existe', { ok: false, status: 404 });
        return fakeResponse(JSON.stringify({ version: versao }));
      }
      throw new Error(`o instalador não devia chamar ${url}`);
    },
    { passthroughLocalhost: false }
  );
}

/** Um "Ollama instalado" que existe no disco mas não roda. */
function binarioDeMentira(nome = 'ollama-falso') {
  const caminho = join(home.dir, nome);
  writeFileSync(caminho, '#nao sou um programa\n', { mode: 0o644 });
  process.env.IAUNIFIER_OLLAMA_BIN = caminho;
  return caminho;
}

/** Corpo entregue em pedaços, com atraso opcional entre um e outro. */
function respostaEmPedacos(pedacos, { intervaloMs = 0, total } = {}) {
  const encoder = new TextEncoder();
  const bytes = pedacos.map((p) => encoder.encode(p));
  const tamanho = total ?? bytes.reduce((soma, b) => soma + b.length, 0);
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (nome) => (nome.toLowerCase() === 'content-length' ? String(tamanho) : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (i >= bytes.length) return { done: true, value: undefined };
            if (intervaloMs) await new Promise((ok) => setTimeout(ok, intervaloMs));
            return { done: false, value: bytes[i++] };
          },
          async cancel() {}
        };
      }
    }
  };
}

/** Junta o que o gerador emite e guarda o que ele devolve no fim. */
async function coletar(gerador) {
  const eventos = [];
  let passo = await gerador.next();
  while (!passo.done) {
    eventos.push(passo.value);
    passo = await gerador.next();
  }
  return { eventos, retorno: passo.value };
}

// ------------------------------------------------------------------ estado

test('Ollama atendendo é "no_ar", com a versão que ele informa', async () => {
  const stub = portaViva({ versao: '0.12.3' });
  binarioDeMentira();
  try {
    assert.deepEqual(await estadoDoOllama(), { estado: 'no_ar', versao: '0.12.3' });
  } finally {
    stub.restore();
  }
});

test('Ollama antigo, sem rota de versão, continua sendo "no_ar"', async () => {
  const stub = portaViva();
  try {
    const estado = await estadoDoOllama();
    assert.equal(estado.estado, 'no_ar');
    assert.equal(estado.versao, undefined);
  } finally {
    stub.restore();
  }
});

test('programa no disco sem ninguém atendendo é "instalado_parado"', async () => {
  const stub = portaMorta();
  const caminho = binarioDeMentira();
  try {
    assert.deepEqual(await estadoDoOllama(), { estado: 'instalado_parado', caminho });
  } finally {
    stub.restore();
  }
});

test('sem programa e sem ninguém atendendo é "ausente"', async () => {
  const stub = portaMorta();
  process.env.IAUNIFIER_OLLAMA_BIN = join(home.dir, 'isso-nao-existe');
  try {
    assert.deepEqual(await estadoDoOllama(), { estado: 'ausente' });
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------------- ligar

test('ligar o que já está no ar responde sim sem mexer em nada', async () => {
  const stub = portaViva();
  process.env.IAUNIFIER_OLLAMA_BIN = join(home.dir, 'isso-nao-existe');
  try {
    // Sem programa nenhum apontado: se respondeu sim, foi pela porta.
    assert.equal(await ligarOllama(), true);
  } finally {
    stub.restore();
  }
});

test('ligar sem ter o programa instalado responde não, sem estourar', async () => {
  const stub = portaMorta();
  process.env.IAUNIFIER_OLLAMA_BIN = join(home.dir, 'isso-nao-existe');
  try {
    assert.equal(await ligarOllama(), false);
  } finally {
    stub.restore();
  }
});

test('ligar um programa que não roda responde não em vez de travar', async () => {
  const stub = portaMorta();
  binarioDeMentira();
  try {
    assert.equal(await ligarOllama(), false);
  } finally {
    stub.restore();
  }
});

// --------------------------------------------------------------- instalação

test('com o Ollama já no ar, instalar não baixa nada', async () => {
  const stub = portaViva();
  try {
    const { eventos, retorno } = await coletar(instalarOllama());
    assert.deepEqual(retorno, { ok: true });
    assert.deepEqual(eventos, [], 'não há o que anunciar quando não há o que fazer');
    assert.equal(
      stub.calls.filter((c) => c.url.includes('ollama.com')).length,
      0,
      'nada podia ter sido baixado'
    );
  } finally {
    stub.restore();
  }
});

test('programa instalado que não sobe vira erro legível, sem baixar nada', async () => {
  const stub = portaMorta();
  const caminho = binarioDeMentira();
  try {
    await assert.rejects(coletar(instalarOllama()), (err) => {
      assert.match(err.message, /não consegui ligar/);
      assert.match(err.message, new RegExp(caminho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    });
    assert.equal(
      stub.calls.filter((c) => c.url.includes('ollama.com')).length,
      0,
      'baixar centenas de megabytes por cima do que já está no disco é desperdício'
    );
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------- download

test('o download conta o quanto já veio e fecha em 100%', async () => {
  const destino = join(home.dir, 'baixado.bin');
  const pedacos = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)];
  // Com atraso entre os pedaços: o aviso é contido a um por quarto de segundo,
  // e sem esperar nada os três chegariam no mesmo milissegundo.
  const stub = stubFetch(async () => respostaEmPedacos(pedacos, { intervaloMs: 260 }));
  try {
    const { eventos, retorno } = await coletar(baixarArquivo('https://ollama.com/download/x.zip', destino));

    assert.equal(retorno, 300, 'devolve quantos bytes gravou');
    assert.ok(eventos.length >= 3, `poucos avisos de progresso: ${eventos.length}`);
    assert.ok(eventos.every((e) => e.type === 'progresso'));

    const pcts = eventos.map((e) => e.pct);
    assert.deepEqual(
      pcts,
      [...pcts].sort((a, b) => a - b),
      'a barra não pode andar pra trás'
    );
    assert.ok(pcts[0] < 100, 'o primeiro aviso não podia já estar no fim');
    assert.equal(pcts.at(-1), 100);

    const ultimo = eventos.at(-1);
    assert.equal(ultimo.feito, 300);
    assert.equal(ultimo.total, 300);
    assert.equal(readFileSync(destino, 'utf8'), pedacos.join(''));
  } finally {
    stub.restore();
  }
});

test('cancelar interrompe o download e não deixa arquivo pela metade', async () => {
  const destino = join(home.dir, 'cancelado.bin');
  const stub = stubFetch(async () => respostaEmPedacos(['x'.repeat(50), 'y'.repeat(50), 'z'.repeat(50)], { intervaloMs: 200 }));
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 250);
  try {
    await assert.rejects(coletar(baixarArquivo('https://ollama.com/download/x.zip', destino, { signal: ctrl.signal })), {
      message: /cancelado/
    });
    assert.equal(existsSync(destino), false, 'o pedaço baixado tinha que ter sido apagado');
  } finally {
    stub.restore();
  }
});

test('site fora do ar vira frase que uma pessoa entende', async () => {
  const destino = join(home.dir, 'nao-veio.bin');
  const stub = stubFetch(async () => fakeResponse('Service Unavailable', { ok: false, status: 503 }));
  try {
    await assert.rejects(coletar(baixarArquivo('https://ollama.com/download/x.zip', destino)), (err) => {
      assert.match(err.message, /503/);
      assert.match(err.message, /Ollama/);
      assert.doesNotMatch(err.message, /undefined|\[object/);
      return true;
    });
    assert.equal(existsSync(destino), false);
  } finally {
    stub.restore();
  }
});

test('download interrompido no meio é recusado em vez de virar arquivo quebrado', async () => {
  const destino = join(home.dir, 'metade.bin');
  // O servidor prometeu 40 MB no cabeçalho e mandou três letras.
  const stub = stubFetch(async () => respostaEmPedacos(['abc'], { total: 40 * 1024 * 1024 }));
  try {
    await assert.rejects(coletar(baixarArquivo('https://ollama.com/download/x.zip', destino)), {
      message: /pela metade/
    });
    assert.equal(existsSync(destino), false, 'arquivo pela metade não pode ficar ocupando disco');
  } finally {
    stub.restore();
  }
});

test('resposta pequena demais não passa por instalador', async () => {
  const destino = join(home.dir, 'pequeno.bin');
  // Sem content-length e com uma página de erro no lugar do programa: é o que
  // um portal de wi-fi de hotel devolve.
  const stub = stubFetch(async () => {
    const r = respostaEmPedacos(['<html>faça login na rede</html>']);
    return { ...r, headers: { get: () => null } };
  });
  try {
    await assert.rejects(coletar(baixarArquivo('https://ollama.com/download/x.zip', destino)), {
      message: /não é o programa do Ollama/
    });
    assert.equal(existsSync(destino), false);
  } finally {
    stub.restore();
  }
});

// ------------------------------------------------------------------ manual

test('a receita manual tem comando pra copiar e explicação sem jargão', () => {
  const receita = receitaManual();
  assert.ok(receita.comando.includes('ollama.com'), 'o comando tem que apontar pro site oficial');
  assert.ok(receita.explicacao.length > 40);
  assert.doesNotMatch(receita.comando, /\n/, 'é um comando só, pro botão de copiar');
  assert.doesNotMatch(receita.comando, /\| *sh|\| *bash/, 'nada de canalizar download direto pro shell');
});
