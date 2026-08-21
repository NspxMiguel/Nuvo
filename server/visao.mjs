// Ler o que está numa imagem.
//
// Quem estuda fotografa: a prova que o professor devolveu, a página do livro, o
// quadro no fim da aula. É assim que o material chega — e `extract.mjs` não lê
// imagem nenhuma, porque não existe como ler pixel sem um modelo que enxergue.
//
// Isto fica fora do `complete()` de propósito. Mandar imagem é a única coisa que
// cada fornecedor escreve de um jeito diferente o bastante pra não caber na
// mesma forma de mensagem: a Anthropic quer um bloco `image` com base64, a
// OpenAI quer uma `data:` URL dentro de `image_url`, o Google quer `inline_data`
// dentro de `parts`, e o Ollama quer um campo `images` ao lado do texto. Enfiar
// os quatro no adaptador de conversa mexeria no caminho por onde passa toda
// mensagem do app pra atender um caso que é de anexo.

import { adapterFor, contextFor, getProvider, parseRef } from './providers/index.mjs';
import { erroHttp } from './erro-traduzivel.mjs';
import { ensureOk, trimUrl } from './providers/util.mjs';

/** Formatos que os modelos aceitam, e como reconhecê-los pelos primeiros bytes. */
const ASSINATURAS = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], em: 8, mais: [0x57, 0x45, 0x42, 0x50] }
];

/**
 * O tipo da imagem pelos bytes, ou `null` se não for imagem.
 *
 * Pelos bytes e não pela extensão: foto de celular chega como `.HEIC` renomeado,
 * como `.png` que é jpeg, e como `image/*` que o navegador chutou.
 */
export function tipoDaImagem(buffer) {
  if (!buffer || buffer.length < 12) return null;
  for (const a of ASSINATURAS) {
    const cabe = a.bytes.every((b, i) => buffer[i] === b);
    const resto = !a.mais || a.mais.every((b, i) => buffer[a.em + i] === b);
    if (cabe && resto) return a.mime;
  }
  return null;
}

/**
 * HEIC é o padrão do iPhone e nenhum modelo lê.
 *
 * Reconhecer separado é o que permite dizer "converta pra JPG" em vez de "não
 * sei ler este arquivo" — a segunda frase manda a pessoa procurar defeito onde
 * não tem.
 */
export function ehHeic(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const marca = buffer.subarray(4, 12).toString('latin1');
  return marca.startsWith('ftyp') && /hei[cx]|mif1|msf1|hevc/.test(marca.slice(4));
}

const PEDIDO = `Transcreva o que está nesta imagem, em português do Brasil.

Regras:
- Escreva o texto como ele aparece, mantendo a numeração das questões e a ordem.
- Fórmula, equação e símbolo: escreva por extenso do jeito que se lê ("x elevado a 2", "raiz de 3").
- Tabela vira linhas de texto, uma por linha, com os campos separados por " | ".
- Desenho, gráfico ou esquema: descreva em uma frase entre colchetes o que ele mostra, no lugar dele.
- Não resuma, não corrija e não responda nada do que estiver escrito. Só transcreva.
- Se a imagem não tiver texto nenhum, descreva em uma frase o que ela é.`;

/** Só estes sabem receber imagem. CLI recebe texto pelo stdin e não tem como. */
const QUEM_ENXERGA = new Set(['anthropic', 'openai', 'google', 'ollama']);

export const enxerga = (kind) => QUEM_ENXERGA.has(kind);

/**
 * Os modelos configurados que podem receber imagem.
 *
 * Não dá pra saber se um modelo específico enxerga sem tentar — a lista de
 * modelos não diz. Então isto filtra por fornecedor, que é o que se sabe, e o
 * erro de um modelo que não enxerga volta traduzido lá de baixo.
 */
export function modelosQueEnxergam(provedores) {
  return provedores
    .filter((p) => p.enabled && enxerga(p.kind))
    .flatMap((p) =>
      (p.models || [])
        .filter((m) => (m.kind || 'chat') === 'chat')
        .map((m) => ({ ref: `${p.id}:${m.model_id}`, label: `${p.name} · ${m.label || m.model_id}` }))
    );
}

async function pedirTexto(ctx, kind, { model, mime, base64, signal }) {
  const corpo = {
    anthropic: () => ({
      url: `${trimUrl(ctx.baseUrl || 'https://api.anthropic.com/v1')}/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': ctx.apiKey || '',
        'anthropic-version': '2023-06-01'
      },
      body: {
        model,
        max_tokens: 8000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
              { type: 'text', text: PEDIDO }
            ]
          }
        ]
      },
      ler: (j) => (j.content || []).map((c) => c.text || '').join('')
    }),
    openai: () => ({
      url: `${trimUrl(ctx.baseUrl || 'https://api.openai.com/v1')}/chat/completions`,
      headers: {
        'content-type': 'application/json',
        ...(ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {})
      },
      body: {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PEDIDO },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
            ]
          }
        ]
      },
      ler: (j) => j.choices?.[0]?.message?.content || ''
    }),
    google: () => ({
      url:
        `${trimUrl(ctx.baseUrl || 'https://generativelanguage.googleapis.com/v1beta')}` +
        `/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(ctx.apiKey || '')}`,
      headers: { 'content-type': 'application/json' },
      body: {
        contents: [
          { role: 'user', parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: PEDIDO }] }
        ]
      },
      ler: (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
    }),
    ollama: () => ({
      url: `${trimUrl(ctx.baseUrl || 'http://127.0.0.1:11434')}/api/chat`,
      headers: { 'content-type': 'application/json' },
      body: {
        model,
        stream: false,
        messages: [{ role: 'user', content: PEDIDO, images: [base64] }]
      },
      ler: (j) => j.message?.content || ''
    })
  }[kind];

  const receita = corpo();
  const res = await fetch(receita.url, {
    method: 'POST',
    headers: receita.headers,
    body: JSON.stringify(receita.body),
    signal
  });
  await ensureOk(res, 'ler a imagem');
  return String(receita.ler(await res.json()) || '').trim();
}

/**
 * O texto de uma imagem, lido por um modelo que enxerga.
 *
 * @param {string} ref "providerId:modelId"
 * @param {{buffer: Buffer, signal?: AbortSignal}} entrada
 * @returns {Promise<{text: string, mime: string, modelo: string}>}
 */
export async function transcreverImagem(ref, { buffer, signal } = {}) {
  if (!ref) throw erroHttp(400, 'escolha uma IA que enxerga pra ler a imagem');
  const mime = tipoDaImagem(buffer);
  if (!mime) {
    throw ehHeic(buffer)
      ? erroHttp(400, 'foto em HEIC: o iPhone salva assim e nenhuma IA lê — exporte como JPG')
      : erroHttp(400, 'isto não é uma imagem que eu saiba ler');
  }

  const { providerId, modelId } = parseRef(ref);
  const provider = getProvider(providerId);
  if (!provider) throw erroHttp(404, 'provedor sumiu: {id}', { id: providerId });
  if (!enxerga(provider.kind)) {
    throw erroHttp(400, '{ia} não recebe imagem — escolha uma IA de API ou o Ollama', {
      ia: provider.name
    });
  }
  // O adaptador não é usado pra montar o pedido, mas tem que existir: provedor de
  // tipo desconhecido morreria aqui de qualquer jeito, e o erro daqui é legível.
  adapterFor(provider.kind);

  const texto = await pedirTexto(contextFor(provider), provider.kind, {
    model: modelId,
    mime,
    base64: buffer.toString('base64'),
    signal
  });

  if (!texto) throw erroHttp(422, 'a IA olhou a imagem e não devolveu texto nenhum');
  return { text: texto, mime, modelo: ref };
}
