// Scraping de memória: ler o que já foi conversado com outra IA e transformar
// em fato. Os formatos aqui são os de verdade — o export do ChatGPT vem em
// árvore, o do Claude vem em lista, e os dois trazem lixo no meio.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers.mjs';

const home = useTempHome();
const { parseExport, importConversations } = await import('../server/importers.mjs');
const { listMemories } = await import('../server/memory.mjs');

after(() => home.cleanup());

// ------------------------------------------------------------------ ChatGPT

/** Export do ChatGPT: mapping em árvore, nó raiz sem mensagem, papéis mistos. */
const CHATGPT = JSON.stringify([
  {
    title: 'Conversa sobre café',
    mapping: {
      raiz: { id: 'raiz', message: null, parent: null, children: ['a'] },
      a: {
        id: 'a',
        message: {
          author: { role: 'system' },
          create_time: 1,
          content: { content_type: 'text', parts: ['Você é um assistente.'] }
        }
      },
      b: {
        id: 'b',
        message: {
          author: { role: 'user' },
          create_time: 2,
          content: { content_type: 'text', parts: ['Eu prefiro café coado, nunca expresso.'] }
        }
      },
      c: {
        id: 'c',
        message: {
          author: { role: 'assistant' },
          create_time: 3,
          content: { content_type: 'text', parts: ['Anotado.'] }
        }
      },
      d: {
        id: 'd',
        message: {
          author: { role: 'user' },
          create_time: 4,
          content: { content_type: 'text', parts: [''] }
        }
      }
    }
  }
]);

test('export do ChatGPT: árvore vira turnos em ordem, sem raiz e sem system', () => {
  const [conversa] = parseExport(CHATGPT, 'conversations.json');
  assert.equal(conversa.title, 'Conversa sobre café');
  assert.deepEqual(
    conversa.turns.map((t) => `${t.role}:${t.text}`),
    ['user:Eu prefiro café coado, nunca expresso.', 'assistant:Anotado.'],
    'o nó raiz, o system e a mensagem vazia não podem virar turno'
  );
});

test('export do ChatGPT: parte multimodal não vira "[object Object]"', () => {
  const raw = JSON.stringify([
    {
      title: 'Com imagem',
      mapping: {
        a: {
          message: {
            author: { role: 'user' },
            create_time: 1,
            content: {
              content_type: 'multimodal_text',
              parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-abc' }, 'Eu moro em Curitiba.']
            }
          }
        }
      }
    }
  ]);
  const [conversa] = parseExport(raw, 'x.json');
  assert.ok(!/object Object/.test(conversa.turns[0].text), conversa.turns[0].text);
  assert.match(conversa.turns[0].text, /Curitiba/);
});

// -------------------------------------------------------------------- Claude

const CLAUDE = JSON.stringify([
  {
    name: 'Planejamento',
    chat_messages: [
      { sender: 'human', text: 'Meu projeto se chama Cadenza e é sobre música.' },
      { sender: 'assistant', text: 'Legal.' },
      { sender: 'human', text: '', content: [{ type: 'text', text: 'Eu trabalho com Node e SQLite.' }] },
      { sender: 'assistant', text: '', content: [{ type: 'tool_use', name: 'busca' }] }
    ]
  }
]);

test('export do Claude: lê text e content, e descarta mensagem sem texto', () => {
  const [conversa] = parseExport(CLAUDE, 'conversations.json');
  assert.equal(conversa.title, 'Planejamento');
  assert.deepEqual(
    conversa.turns.map((t) => `${t.role}:${t.text}`),
    [
      'user:Meu projeto se chama Cadenza e é sobre música.',
      'assistant:Legal.',
      'user:Eu trabalho com Node e SQLite.'
    ],
    'a mensagem que só tem chamada de ferramenta não tem texto e não vira turno'
  );
});

// --------------------------------------------------------------- outros casos

test('lista simples de mensagens é aceita', () => {
  const raw = JSON.stringify([
    { role: 'system', content: 'ignore isso' },
    { role: 'user', content: 'Eu gosto de trilha sonora de filme.' },
    { role: 'assistant', content: 'Anotado.' }
  ]);
  const [conversa] = parseExport(raw, 'chat.json');
  assert.deepEqual(
    conversa.turns.map((t) => `${t.role}:${t.text}`),
    ['user:Eu gosto de trilha sonora de filme.', 'assistant:Anotado.']
  );
});

test('lista simples com entrada quebrada no meio não produz turno fantasma', () => {
  const raw = JSON.stringify([
    { role: 'user', content: 'Eu moro em Belo Horizonte.' },
    { alguma: 'coisa' },
    { role: 'user' },
    { role: 'user', content: '   ' }
  ]);
  const [conversa] = parseExport(raw, 'chat.json');
  for (const turn of conversa.turns) {
    assert.equal(typeof turn.text, 'string', `turno sem texto: ${JSON.stringify(turn)}`);
    assert.ok(turn.text.trim(), `turno vazio virou turno: ${JSON.stringify(turn)}`);
  }
  assert.equal(conversa.turns.length, 1);
});

test('texto solto vira uma conversa de um turno', () => {
  const [conversa] = parseExport('Eu prefiro respostas curtas.\nEu trabalho com áudio.', 'notas.md');
  assert.equal(conversa.title, 'notas.md');
  assert.equal(conversa.turns.length, 1);
  assert.match(conversa.turns[0].text, /respostas curtas/);
});

test('JSON que não é conversa nenhuma não explode', () => {
  const [conversa] = parseExport(JSON.stringify({ qualquer: 'coisa' }), 'x.json');
  assert.ok(conversa.turns.length >= 0);
  assert.doesNotThrow(() => parseExport('', 'vazio.json'));
  assert.doesNotThrow(() => parseExport('[]', 'lista-vazia.json'));
});

// ------------------------------------------------------------------ importar

test('importar grava fato só do que o usuário disse', async () => {
  const antes = listMemories().length;
  const resultado = await importConversations(CLAUDE, { filename: 'claude.json' });

  assert.equal(resultado.conversations, 1);
  assert.equal(resultado.messages, 2, 'só as duas falas do usuário são lidas');
  assert.ok(resultado.facts.length > 0, 'tinha que ter aprendido algo');
  assert.ok(listMemories().length > antes);

  const textos = resultado.facts.map((f) => f.text).join(' | ');
  assert.ok(!/Legal\./.test(textos), 'o que a IA respondeu não é fato sobre o usuário');
  assert.match(textos, /Cadenza|Node/);

  for (const fato of resultado.facts) {
    assert.equal(fato.source, 'import');
    assert.match(fato.source_ref, /claude\.json/);
  }
});

test('importar duas vezes o mesmo arquivo não duplica fato', async () => {
  await importConversations(CHATGPT, { filename: 'gpt.json' });
  const depoisDaPrimeira = listMemories().length;
  await importConversations(CHATGPT, { filename: 'gpt.json' });
  assert.equal(listMemories().length, depoisDaPrimeira, 'o dedupe da memória tem que valer aqui também');
});

test('importar conversa sem fala de usuário não grava nada', async () => {
  const antes = listMemories().length;
  const raw = JSON.stringify([{ name: 'Só a IA', chat_messages: [{ sender: 'assistant', text: 'Oi.' }] }]);
  const resultado = await importConversations(raw, { filename: 'vazio.json' });
  assert.equal(resultado.facts.length, 0);
  assert.equal(listMemories().length, antes);
});

test('export grande avisa quando corta, em vez de fingir que leu tudo', async () => {
  const muitas = JSON.stringify(
    Array.from({ length: 12 }, (_, i) => ({
      name: `Conversa ${i}`,
      chat_messages: [{ sender: 'human', text: `Eu gosto do assunto número ${i}.` }]
    }))
  );
  const resultado = await importConversations(muitas, { filename: 'muitas.json', maxConversations: 5 });
  assert.equal(resultado.conversations, 5);
  assert.equal(resultado.total, 12, 'quem chamou precisa saber quantas existiam');
  assert.equal(resultado.skipped, 7, 'e quantas ficaram de fora');
});

test('export do ChatGPT: ramo abandonado e saída de ferramenta ficam de fora', () => {
  // Árvore como o ChatGPT exporta de verdade: a pergunta foi editada (ramo
  // "b-velho" ficou pendurado) e houve uma busca na web (papel "tool").
  const raw = JSON.stringify([
    {
      title: 'Com edição',
      current_node: 'd',
      mapping: {
        raiz: { id: 'raiz', message: null, parent: null, children: ['sis'] },
        sis: {
          id: 'sis',
          parent: 'raiz',
          children: ['b-velho', 'b'],
          message: {
            author: { role: 'system' },
            create_time: 1,
            content: { parts: ['Você é um assistente.'] }
          }
        },
        'b-velho': {
          id: 'b-velho',
          parent: 'sis',
          children: ['c-velho'],
          message: {
            author: { role: 'user' },
            create_time: 2,
            content: { parts: ['Eu odeio café, nunca me ofereça isso.'] }
          }
        },
        'c-velho': {
          id: 'c-velho',
          parent: 'b-velho',
          children: [],
          message: {
            author: { role: 'assistant' },
            create_time: 3,
            content: { parts: ['Combinado, nada de café.'] }
          }
        },
        b: {
          id: 'b',
          parent: 'sis',
          children: ['ferramenta'],
          message: {
            author: { role: 'user' },
            create_time: 4,
            content: { parts: ['Na verdade eu prefiro café coado.'] }
          }
        },
        ferramenta: {
          id: 'ferramenta',
          parent: 'b',
          children: ['d'],
          message: {
            author: { role: 'tool' },
            create_time: 5,
            content: { parts: ['Resultado da busca: o melhor café do mundo é o expresso italiano.'] }
          }
        },
        d: {
          id: 'd',
          parent: 'ferramenta',
          children: [],
          message: {
            author: { role: 'assistant' },
            create_time: 6,
            content: { parts: ['Anotado: coado.'] }
          }
        }
      }
    }
  ]);

  const [conversa] = parseExport(raw, 'conversations.json');
  const textos = conversa.turns.map((t) => t.text);

  assert.deepEqual(conversa.turns.map((t) => t.role), ['user', 'assistant']);
  assert.equal(textos[0], 'Na verdade eu prefiro café coado.');
  assert.ok(
    !textos.some((t) => /odeio café/.test(t)),
    'a versão que o usuário substituiu não pode voltar como memória permanente'
  );
  assert.ok(
    !textos.some((t) => /Resultado da busca/.test(t)),
    'saída de ferramenta não é fala do usuário'
  );
});

test('export do ChatGPT: mensagem escondida na interface não é fala', () => {
  const raw = JSON.stringify([
    {
      title: 'Com contexto injetado',
      current_node: 'b',
      mapping: {
        a: {
          id: 'a',
          parent: null,
          children: ['b'],
          message: {
            author: { role: 'user' },
            create_time: 1,
            metadata: { is_visually_hidden_from_conversation: true },
            content: { parts: ['O usuário está em São Paulo e usa o plano Plus.'] }
          }
        },
        b: {
          id: 'b',
          parent: 'a',
          children: [],
          message: {
            author: { role: 'user' },
            create_time: 2,
            content: { parts: ['Eu toco baixo desde 2015.'] }
          }
        }
      }
    }
  ]);

  const [conversa] = parseExport(raw, 'conversations.json');
  assert.deepEqual(conversa.turns.map((t) => t.text), ['Eu toco baixo desde 2015.']);
});
