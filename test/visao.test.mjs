// Ler imagem: o que é imagem, o que não é, e o pedido que sai pra cada
// fornecedor. Nada aqui vai à rede — o `fetch` é trocado por um de mentira, e o
// que está sob teste é o formato do corpo, que é a única parte que cada
// fornecedor escreve diferente.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const visao = await import('../server/visao.mjs');
const { extractText } = await import('../server/extract.mjs');
const { run, now, uid } = await import('../server/db.mjs');

after(() => home.cleanup());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), Buffer.alloc(20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(12)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(20)]);

test('o tipo sai dos bytes, não da extensão', () => {
  // Foto de celular chega renomeada o tempo todo: .png que é jpeg, .jpg que é
  // heic, e `image/*` que o navegador chutou.
  assert.equal(visao.tipoDaImagem(PNG), 'image/png');
  assert.equal(visao.tipoDaImagem(JPG), 'image/jpeg');
  assert.equal(visao.tipoDaImagem(WEBP), 'image/webp');
  assert.equal(visao.tipoDaImagem(HEIC), null, 'HEIC não é formato que modelo aceite');
  assert.equal(visao.tipoDaImagem(Buffer.from('texto puro de verdade')), null);
  assert.equal(visao.tipoDaImagem(Buffer.alloc(3)), null, 'arquivo curto demais não quebra');
  assert.equal(visao.tipoDaImagem(null), null);
});

test('HEIC é reconhecido separado, pra poder dizer o que fazer', () => {
  // "Não sei ler este arquivo" manda a pessoa procurar defeito onde não tem.
  // "Exporte como JPG" resolve.
  assert.equal(visao.ehHeic(HEIC), true);
  assert.equal(visao.ehHeic(PNG), false);
  const lido = extractText(HEIC, 'IMG_3042.HEIC', '');
  assert.equal(lido.kind, 'imagem');
  assert.equal(lido.precisaVisao, false);
  assert.match(lido.note, /JPG/);
});

test('imagem legível vira pedido de visão, não erro de formato', () => {
  const lido = extractText(PNG, 'prova.png', 'image/png');
  assert.equal(lido.kind, 'imagem');
  assert.equal(lido.precisaVisao, true);
  assert.equal(lido.note, null, 'não é uma falha: é um arquivo que precisa de outro leitor');
});

test('quem enxerga e quem não enxerga', () => {
  for (const k of ['anthropic', 'openai', 'google', 'ollama']) assert.equal(visao.enxerga(k), true);
  assert.equal(visao.enxerga('cli'), false, 'programa de terminal recebe texto no stdin');
  assert.equal(visao.enxerga('sei-la'), false);
});

test('a lista de modelos que enxergam deixa de fora o desligado e o de terminal', () => {
  const fora = visao.modelosQueEnxergam([
    { id: 'a', name: 'Claude', kind: 'anthropic', enabled: 1, models: [{ model_id: 'opus', label: 'Opus' }] },
    { id: 'b', name: 'CLI', kind: 'cli', enabled: 1, models: [{ model_id: 'default' }] },
    { id: 'c', name: 'Desligado', kind: 'openai', enabled: 0, models: [{ model_id: 'gpt' }] },
    { id: 'd', name: 'Ollama', kind: 'ollama', enabled: 1, models: [{ model_id: 'llava', kind: 'chat' }] },
    { id: 'e', name: 'Vetor', kind: 'openai', enabled: 1, models: [{ model_id: 'emb', kind: 'embedding' }] }
  ]);
  assert.deepEqual(fora.map((m) => m.ref), ['a:opus', 'd:llava']);
  assert.equal(fora[0].label, 'Claude · Opus');
});

// ------------------------------------------- o corpo que sai pra cada um deles

function provedorDeMentira(kind) {
  const id = uid();
  run(
    `INSERT INTO providers (id, name, kind, base_url, secret_name, config, enabled, auto, created_at)
     VALUES (?, ?, ?, ?, NULL, '{}', 1, 0, ?)`,
    id,
    kind,
    kind,
    kind === 'ollama' ? 'http://127.0.0.1:11434' : `https://exemplo.invalido/${kind}`,
    now()
  );
  return id;
}

async function pedidoDe(kind, resposta) {
  const id = provedorDeMentira(kind);
  const original = globalThis.fetch;
  let visto = null;
  globalThis.fetch = async (url, opcoes) => {
    visto = { url: String(url), body: JSON.parse(opcoes.body), headers: opcoes.headers };
    return new Response(JSON.stringify(resposta), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const fora = await visao.transcreverImagem(`${id}:modelo-x`, { buffer: PNG });
    return { visto, fora };
  } finally {
    globalThis.fetch = original;
  }
}

test('Anthropic recebe a imagem como bloco base64', async () => {
  const { visto, fora } = await pedidoDe('anthropic', { content: [{ type: 'text', text: 'Questão 1' }] });
  const [imagem, texto] = visto.body.messages[0].content;
  assert.equal(imagem.type, 'image');
  assert.equal(imagem.source.media_type, 'image/png');
  assert.equal(imagem.source.data, PNG.toString('base64'));
  assert.equal(texto.type, 'text');
  assert.equal(visto.headers['anthropic-version'], '2023-06-01');
  assert.equal(fora.text, 'Questão 1');
});

test('OpenAI recebe a imagem como data: URL', async () => {
  const { visto, fora } = await pedidoDe('openai', {
    choices: [{ message: { content: 'Questão 2' } }]
  });
  const partes = visto.body.messages[0].content;
  const img = partes.find((p) => p.type === 'image_url');
  assert.match(img.image_url.url, /^data:image\/png;base64,/);
  assert.equal(fora.text, 'Questão 2');
});

test('Google recebe a imagem em inline_data', async () => {
  const { visto, fora } = await pedidoDe('google', {
    candidates: [{ content: { parts: [{ text: 'Questão 3' }] } }]
  });
  const parte = visto.body.contents[0].parts.find((p) => p.inline_data);
  assert.equal(parte.inline_data.mime_type, 'image/png');
  assert.match(visto.url, /:generateContent/);
  assert.equal(fora.text, 'Questão 3');
});

test('Ollama recebe a imagem no campo images, ao lado do texto', async () => {
  const { visto, fora } = await pedidoDe('ollama', { message: { content: 'Questão 4' } });
  assert.equal(visto.body.stream, false);
  assert.deepEqual(visto.body.messages[0].images, [PNG.toString('base64')]);
  assert.equal(fora.text, 'Questão 4');
});

test('o que não dá pra ler é recusado com o motivo certo', async () => {
  await assert.rejects(() => visao.transcreverImagem('', { buffer: PNG }), /escolha uma IA/);
  const id = provedorDeMentira('anthropic');
  await assert.rejects(
    () => visao.transcreverImagem(`${id}:m`, { buffer: HEIC }),
    /HEIC/,
    'HEIC precisa dizer o que fazer'
  );
  await assert.rejects(
    () => visao.transcreverImagem(`${id}:m`, { buffer: Buffer.from('texto') }),
    /não é uma imagem/
  );
  const cli = provedorDeMentira('cli');
  await assert.rejects(
    () => visao.transcreverImagem(`${cli}:m`, { buffer: PNG }),
    /não recebe imagem/
  );
});

test('IA que devolve nada não vira anexo vazio em silêncio', async () => {
  await assert.rejects(
    () => pedidoDe('anthropic', { content: [] }),
    /não devolveu texto nenhum/
  );
});
